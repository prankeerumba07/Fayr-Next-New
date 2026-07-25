import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Campaign, type Task } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientTicketsError } from '../tickets/ticket.types';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import { computeRefundPaise } from './engine/money';
import { policyForWindowDays } from './engine/return-policy';
import { DAY, STATES } from './engine/states';
import {
  refundEligibility,
  transition,
  type EngineEvent,
  type TransitionResult,
} from './engine/transition';
import type { EngineTask } from './engine/task-state';
import { toEngineTask, toEvidenceJson, toPromotedColumns } from './task.mapper';
import { toTaskResponse, type TaskResponse } from './task.response';
import {
  evidenceFromDto,
  type SubmitEvidenceDto,
} from './dto/submit-evidence.dto';

type Tx = Prisma.TransactionClient;

/**
 * The authoritative owner of task state + the money/ticket effects around it.
 *
 * The pure engine (src/tasks/engine) decides transitions; this service hydrates a
 * task from the DB, runs the engine, and persists the result — under a task-row
 * lock so concurrent events can't race off a stale state. Two effects are
 * composed INTO the surrounding transaction so they're atomic with the task
 * write: claiming deducts tickets, releasing posts the wallet refund. If a ticket
 * deduction fails, the whole claim rolls back — no orphan task.
 */
@Injectable()
export class TaskService {
  private readonly claimTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly wallet: WalletService,
    config: ConfigService<Env, true>,
  ) {
    this.claimTtlDays = config.get('CLAIM_TTL_DAYS', { infer: true });
  }

  /** Claim a campaign: deduct tickets + create the task, atomically. */
  async claim(userId: string, campaignId: string): Promise<TaskResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the user row: serializes ticket ops for the floor check and
        // asserts the user exists before anything is created.
        const u = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (u.length === 0) throw new NotFoundException('User not found');

        const campaign = await tx.campaign.findUnique({
          where: { id: campaignId },
        });
        if (!campaign) throw new NotFoundException('Campaign not found');
        if (campaign.status !== 'ACTIVE') {
          throw new ConflictException('Campaign is not active');
        }

        // Idempotent per (user, campaign): return the existing OPEN task rather
        // than double-claiming.
        const open = await tx.task.findFirst({
          where: { userId, campaignId, closedAt: null },
        });
        if (open) return toTaskResponse(open, campaign);

        if (campaign.totalSlots != null) {
          const taken = await tx.task.count({ where: { campaignId } });
          if (taken >= campaign.totalSlots) {
            throw new ConflictException('Campaign is full');
          }
        }

        const taskId = randomUUID();
        const row = await tx.task.create({
          data: {
            id: taskId,
            userId,
            campaignId,
            platform: campaign.platform,
            state: 'CLAIMED',
            category: campaign.category,
            targetAsin: campaign.asin,
            targetProduct: campaign.productName,
            claimExpiresAt: new Date(Date.now() + this.claimTtlDays * DAY),
          },
        });

        // Same transaction: an InsufficientTicketsError rolls the task back.
        await this.tickets.deductForClaim(
          userId,
          taskId,
          campaign.ticketCost,
          tx,
        );

        await tx.taskEvent.create({
          data: {
            taskId,
            type: 'CLAIM',
            fromState: 'CLAIMED',
            toState: 'CLAIMED',
            reason: 'claimed',
            idempotencyKey: `claim-task:${taskId}`,
            payload: { campaignId, ticketCost: campaign.ticketCost },
          },
        });

        return toTaskResponse(row, campaign);
      });
    } catch (err) {
      if (err instanceof InsufficientTicketsError) {
        throw new ConflictException(
          `Not enough tickets: have ${err.available}, need ${err.required}`,
        );
      }
      throw err;
    }
  }

  /** The caller's tasks, newest first. */
  async listForUser(userId: string): Promise<TaskResponse[]> {
    const rows = await this.prisma.task.findMany({
      where: { userId },
      include: { campaign: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => toTaskResponse(row, row.campaign));
  }

  /** One of the caller's tasks. 404 (never leak) if missing or not theirs. */
  async getForUser(userId: string, taskId: string): Promise<TaskResponse> {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row || row.userId !== userId) {
      throw new NotFoundException('Task not found');
    }
    return toTaskResponse(row, row.campaign);
  }

  /** Apply on-device evidence → advances CLAIMED → PURCHASED → DELIVERED. */
  submitEvidence(
    userId: string,
    taskId: string,
    dto: SubmitEvidenceDto,
  ): Promise<TaskResponse> {
    return this.runEvent(userId, taskId, {
      type: 'EVIDENCE',
      evidence: evidenceFromDto(dto),
    });
  }

  confirmOrder(userId: string, taskId: string): Promise<TaskResponse> {
    return this.runEvent(userId, taskId, { type: 'CONFIRM_ORDER' });
  }

  markReviewed(userId: string, taskId: string): Promise<TaskResponse> {
    return this.runEvent(userId, taskId, { type: 'MARK_REVIEWED' });
  }

  startHold(userId: string, taskId: string): Promise<TaskResponse> {
    return this.runEvent(userId, taskId, { type: 'START_HOLD' });
  }

  /**
   * Release the refund: eligibility-gated (window elapsed, published, not
   * returned, amount known), then posts HOUSE → USER in the SAME transaction as
   * the task's move to REFUNDED. Idempotent — a second call returns the refunded
   * task without paying twice.
   */
  async releaseRefund(userId: string, taskId: string): Promise<TaskResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { row, campaign } = await this.lockOwned(tx, userId, taskId);
      const task = toEngineTask(row, await this.loadAppliedKeys(tx, taskId));

      if (task.state === STATES.REFUNDED) {
        return toTaskResponse(row, campaign); // already released
      }

      const policy = policyForWindowDays(campaign.returnWindowDays);
      const now = Date.now();
      const elig = refundEligibility(task, now, policy);
      if (!elig.eligible) {
        throw new ConflictException(elig.reasons.join('; '));
      }

      const itemPaise = task.order?.itemPaise ?? null;
      if (itemPaise == null) {
        throw new ConflictException(
          'Order amount is unknown, cannot compute the refund',
        );
      }
      const refundPaise = computeRefundPaise(
        itemPaise,
        campaign.payoutPercent,
        campaign.payoutCapPaise,
      );

      const event: EngineEvent = {
        type: 'RELEASE_REFUND',
        at: now,
        policy,
        key: `release:${taskId}`,
      };
      const result = transition(task, event);
      if (result.rejected) {
        throw new ConflictException(result.reason ?? 'not eligible for refund');
      }

      await this.wallet.postRefund(
        {
          userId,
          amountPaise: refundPaise,
          idempotencyKey: `refund:${taskId}`,
          referenceType: 'task',
          referenceId: taskId,
        },
        tx,
      );
      await this.persist(tx, task, result, event, campaign, {
        at: now,
        reason: 'refunded',
      });

      const updated = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      return toTaskResponse(updated, campaign);
    });
  }

  /**
   * Record a HOLDING-period visibility re-check (loophole 3). System-driven — the
   * 1.6 scheduler calls this after fetching the public review permalink. Always
   * appends an audit row; a review that vanished regresses the task to REVIEWED.
   */
  async recordVisibilityCheck(
    taskId: string,
    published: boolean,
    source?: string,
  ): Promise<TaskResponse> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Task not found');
      const row = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { id: row.campaignId },
      });
      const task = toEngineTask(row, await this.loadAppliedKeys(tx, taskId));

      const now = Date.now();
      const event: EngineEvent = {
        type: 'VISIBILITY_CHECK',
        published,
        at: now,
      };
      const result = transition(task, event);

      await tx.visibilityCheck.create({
        data: {
          taskId,
          published,
          source: source ?? null,
          checkedAt: new Date(now),
        },
      });
      if (result.changed) {
        await this.persist(tx, task, result, event, campaign);
      }

      const updated = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      return toTaskResponse(updated, campaign);
    });
  }

  /**
   * Expire CLAIMED tasks past their purchase deadline, returning the user's
   * tickets. Time-driven, so the 1.6 scheduler calls this; here it's a directly
   * testable method.
   */
  async sweepExpiredClaims(
    now: Date = new Date(),
  ): Promise<{ expired: number }> {
    const candidates = await this.prisma.task.findMany({
      where: { state: 'CLAIMED', closedAt: null, claimExpiresAt: { lt: now } },
      select: { id: true, userId: true },
    });
    let expired = 0;
    for (const c of candidates) {
      if (await this.expireClaim(c.userId, c.id)) expired++;
    }
    return { expired };
  }

  private expireClaim(userId: string, taskId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
      if (locked.length === 0) return false;
      const row = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      // Re-check under the lock: a purchase may have landed since the sweep read.
      if (row.state !== 'CLAIMED' || row.closedAt) return false;

      await this.tickets.returnOnExpiry(userId, taskId, tx);
      await tx.task.update({
        where: { id: taskId },
        data: { closedAt: new Date(), closeReason: 'expired' },
      });
      await tx.taskEvent.create({
        data: {
          taskId,
          type: 'EXPIRE',
          fromState: 'CLAIMED',
          toState: 'CLAIMED',
          reason: 'claim expired without purchase',
          idempotencyKey: `expire:${taskId}`,
        },
      });
      return true;
    });
  }

  // --- shared plumbing -------------------------------------------------------

  /** Run one engine event for a user's own task, under a row lock. */
  private runEvent(
    userId: string,
    taskId: string,
    event: EngineEvent,
  ): Promise<TaskResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { row, campaign } = await this.lockOwned(tx, userId, taskId);
      const task = toEngineTask(row, await this.loadAppliedKeys(tx, taskId));
      const result = transition(task, event);
      if (result.rejected) {
        throw new ConflictException(result.reason ?? 'transition rejected');
      }
      if (result.changed) {
        await this.persist(tx, task, result, event, campaign);
      }
      const updated = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      return toTaskResponse(updated, campaign);
    });
  }

  private async lockOwned(
    tx: Tx,
    userId: string,
    taskId: string,
  ): Promise<{ row: Task; campaign: Campaign }> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundException('Task not found');
    const row = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    if (row.userId !== userId) throw new NotFoundException('Task not found');
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: row.campaignId },
    });
    return { row, campaign };
  }

  private async loadAppliedKeys(tx: Tx, taskId: string): Promise<string[]> {
    const events = await tx.taskEvent.findMany({
      where: { taskId, NOT: { idempotencyKey: null } },
      select: { idempotencyKey: true },
    });
    return events
      .map((e) => e.idempotencyKey)
      .filter((k): k is string => k != null);
  }

  private async persist(
    tx: Tx,
    prior: EngineTask,
    result: TransitionResult,
    event: EngineEvent,
    campaign: Campaign,
    close?: { at: number; reason: string },
  ): Promise<void> {
    const policy = policyForWindowDays(campaign.returnWindowDays);
    await tx.task.update({
      where: { id: result.task.id },
      data: {
        ...toPromotedColumns(result.task, policy),
        evidence: toEvidenceJson(result.task),
        ...(close
          ? { closedAt: new Date(close.at), closeReason: close.reason }
          : {}),
      },
    });
    await tx.taskEvent.create({
      data: {
        taskId: result.task.id,
        type: event.type,
        fromState: prior.state,
        toState: result.task.state,
        reason: result.reason,
        idempotencyKey: event.key ?? null,
        payload: eventPayload(event),
      },
    });
  }
}

/** A JSON-safe audit payload for the event log (no BigInt). */
function eventPayload(event: EngineEvent): Prisma.InputJsonValue | undefined {
  switch (event.type) {
    case 'VISIBILITY_CHECK':
      return { published: event.published };
    case 'EVIDENCE':
      return {
        hasOrder: event.evidence.order != null,
        hasDelivery: event.evidence.delivery != null,
        blocker: event.evidence.blocker ?? null,
      };
    default:
      return undefined;
  }
}
