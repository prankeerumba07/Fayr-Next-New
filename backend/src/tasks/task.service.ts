import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Campaign, type Task } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { InsufficientTicketsError } from '../tickets/ticket.types';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';
import {
  chargedDisagreesWithCampaign,
  resolveChargedPaise,
} from './engine/charged-amount';
import { checkPlausibility } from './engine/evidence-plausibility';
import { explainHold } from './engine/hold-reasons';
import { orderWindow, screenEvidenceByWindow } from './engine/order-window';
import type {
  AmountEvidenceSource,
  Evidence,
} from './engine/evidence.types';
import { computeRefundPaise } from './engine/money';
import { policyForWindowDays } from './engine/return-policy';
import { DAY, SOURCES, STATES } from './engine/states';
import {
  refundEligibility,
  transition,
  type EngineEvent,
  type TransitionResult,
} from './engine/transition';
import type { EngineTask } from './engine/task-state';
import { rupeesOf } from '../common/rupees';
import { staffAmountBounds } from './engine/staff-amount';
import { toEngineTask, toEvidenceJson, toPromotedColumns } from './task.mapper';
import {
  toAwaitingAmountItem,
  toRefundPreview,
  type AwaitingAmountItem,
  type AwaitingAmountResponse,
  type RefundPreviewResponse,
} from './awaiting-amount.response';
import {
  machineSettledVisibility,
  needsEyesOnPage,
  toReviewCheckItem,
  type ReviewCheckItem,
  type ReviewCheckResponse,
} from './review-check.response';
import { toTaskResponse, type TaskResponse } from './task.response';
import {
  evidenceFromDto,
  type SubmitEvidenceDto,
} from './dto/submit-evidence.dto';

type Tx = Prisma.TransactionClient;

/** The outcome of a release attempt — lets the endpoint 409 while the scheduler skips. */
type ReleaseOutcome =
  | { status: 'released' | 'already'; task: TaskResponse }
  | { status: 'ineligible'; reasons: string[] }
  | { status: 'amount-unknown'; reason: string | null };

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
  private readonly logger = new Logger(TaskService.name);
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

        // Claim-limit: a purchase is permanent. Once ANY prior task for this
        // (user, campaign) has progressed past CLAIMED — i.e. a purchase was
        // confirmed, regardless of where it ended up (delivered, reviewed, or
        // even fully refunded) — the user may never claim this campaign again.
        // The state machine only moves forward, and an unpurchased expiry leaves
        // the task at CLAIMED, so `state != CLAIMED` is exactly "was purchased".
        const everPurchased = await tx.task.findFirst({
          where: { userId, campaignId, state: { not: 'CLAIMED' } },
          select: { id: true },
        });
        if (everPurchased) {
          throw new ConflictException("You've already completed this campaign");
        }

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

  /**
   * Staff override for a held (platform, orderId) collision — see
   * AdminTaskController for why a human, and not the user, decides this.
   *
   * Idempotent: approving twice is the same as approving once. It grants nothing
   * on its own; it only stops the duplicate-order gate refusing, and every other
   * refund condition still has to pass.
   */
  async allowDuplicateOrder(
    taskId: string,
  ): Promise<{
    task: TaskResponse;
    userId: string;
    orderId: string | null;
    itemId: string | null;
  }> {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row) throw new NotFoundException('Task not found');
    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { duplicateOrderApproved: true },
      include: { campaign: true },
    });
    return {
      task: toTaskResponse(updated, updated.campaign),
      userId: row.userId,
      orderId: row.orderId,
      // WHICH LINE was overridden, or null when the reason for the hold was that
      // nobody could tell. The audit row has to distinguish "we agreed this is a
      // second item in one basket" from "we could not identify the line at all".
      itemId: row.itemId,
    };
  }

  /**
   * Every refund waiting on somebody stating a unit count.
   *
   * "Held on the count" is decided by running the REAL resolver over each task,
   * not by a SQL predicate on the evidence JSON. A predicate would be a second
   * definition of the same decision, and second routes to one answer are exactly
   * what has produced every money defect found so far. The SQL narrows to rows
   * that could possibly qualify; the resolver decides.
   */
  async listAwaitingAmount(): Promise<AwaitingAmountResponse> {
    const rows = await this.prisma.task.findMany({
      // A refund is only in question once an order exists, and a REFUNDED task is
      // already paid. Everything else is decided by the resolver below.
      where: {
        orderId: { not: null },
        state: { in: ['PURCHASED', 'DELIVERED', 'REVIEWED', 'HOLDING'] },
      },
      include: { campaign: true, user: { select: { id: true, mobile: true } } },
      orderBy: { createdAt: 'asc' }, // oldest first: someone has waited longest
      take: 200,
    });
    const items = rows
      .map((row) => toAwaitingAmountItem(row))
      .filter((item): item is AwaitingAmountItem => item !== null);
    return { items, total: items.length };
  }

  /** What confirming a given figure would actually pay. Changes nothing. */
  async previewRefund(
    taskId: string,
    overrides: { quantity?: number; unitPricePaise?: bigint },
  ): Promise<RefundPreviewResponse> {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row) throw new NotFoundException('Task not found');
    return toRefundPreview(row, overrides);
  }

  /**
   * A staff member states how many units the order covers.
   *
   * This exists because the quantity rule HOLDS a refund it cannot justify, and
   * almost no marketplace page states a unit count. A hold nobody can clear is
   * not a safety measure, it is a dead end: the user is told a Fayr reviewer will
   * check it, and on any task that did not arrive through the OCR screenshot flow
   * no reviewer had a way to say what they saw.
   *
   * It goes through applyEvidence — the SAME funnel as the scraper and the OCR
   * approval — rather than writing the column directly, so the decision lands as
   * a task event with a state transition and cannot bypass any engine rule (the
   * order-window check included).
   *
   * The whole order is resent because the engine replaces `order` wholesale
   * rather than merging fields; resending a partial one would drop the order id
   * and its date, and the task would lose its anchor. `source` is kept as the
   * INCOMING order's own source: this is the same order, with one fact confirmed,
   * so it must not be downgraded to a lower authority tier — and `quantitySource`
   * records that a person, not a page, supplied the count.
   *
   * Idempotent per VALUE: pressing the button twice with 1 is one decision, while
   * correcting 1 to 3 is a second, real one.
   *
   * It moves no money. The return window, the published review and the
   * FINANCE-gated withdrawal all still stand between this and a rupee.
   */
  async setStaffQuantity(
    taskId: string,
    quantity: number,
  ): Promise<{
    task: TaskResponse;
    userId: string;
    previousQuantity: number | null;
  }> {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row) throw new NotFoundException('Task not found');

    const engine = toEngineTask(row, []);
    const order = engine.order;
    if (!order) {
      // Plain words: staff read these out to people on the phone.
      throw new ConflictException(
        'This task has no order yet, so there is no line to count units on.',
      );
    }

    const previousQuantity = order.quantity ?? null;
    // Nothing would change. Report the task as it stands rather than writing a
    // second identical event — a double click is one decision, and this is what
    // makes that true now that the key below is unique per press.
    if (previousQuantity === quantity && order.quantitySource === 'staff') {
      return {
        task: toTaskResponse(row, row.campaign),
        userId: row.userId,
        previousQuantity,
      };
    }
    const task = await this.applyEvidence(
      row.userId,
      taskId,
      {
        order: {
          ...order,
          quantity,
          quantitySource: 'staff',
          quantityReason: null,
          // What a reader had OBSERVED but declined to assert is superseded now
          // that a person has decided, so it is not left behind to contradict the
          // number the refund actually used.
          quantityObserved: null,
        },
      },
      // UNIQUE per press, not derived from the number.
      //
      // It used to be `staff-quantity:${quantity}` — which looks idempotent and is
      // a trap. A recount that goes 1 → 3 → 1 repeats the first key, the engine
      // treats the third press as a duplicate event and silently does nothing,
      // and the panel still says "Saved. Corrected to 1 unit". A reviewer would
      // have been shown a sentence the record did not support. Landing back on an
      // earlier number is an ordinary thing for a person to do.
      `staff-quantity:${quantity}:${randomUUID()}`,
    );
    return { task, userId: row.userId, previousQuantity };
  }

  /**
   * A staff member states what ONE UNIT cost.
   *
   * The most dangerous write in the system: it is the only money figure a human
   * invents rather than a machine reads, and a slipped keystroke pays real money
   * for no reason. Four gates, all server-side, because a gate the panel enforces
   * is a gate the next client forgets:
   *
   *   1. NOTHING IS OVERWRITTEN. A staff figure may only fill a gap. If any
   *      amount is already on file it was established by a source that outranks a
   *      person typing, and this must not jump that queue — the reviewer's job
   *      there is a different decision, not an override.
   *   2. A REAL CEILING. Derived from the campaign's price and the order's own
   *      total (see staff-amount.ts), never a round number. With neither, there
   *      is nothing to bound by and the write is refused rather than trusted.
   *   3. DISAGREEMENT MUST BE ACKNOWLEDGED. A figure outside the campaign
   *      tolerance is legitimate — discounts exist — but it may not pass
   *      unremarked, so it needs an explicit acknowledgement to land.
   *   4. IT IS A PER-UNIT PRICE, not a line total. That is the one figure that
   *      needs no quantity and cannot be divided by the wrong number.
   *
   * Through applyEvidence, like every other evidence write, so it cannot bypass
   * an engine rule. The order's own `source` is left alone: the order really was
   * read from wherever it was read from, and only the AMOUNT is human-supplied —
   * which `amountSource` records. A later scraper read outranks this and will
   * replace it, which is correct.
   */
  async setStaffAmount(
    taskId: string,
    input: {
      unitPricePaise: bigint;
      evidenceSource: AmountEvidenceSource;
      acknowledgedDisagreement: boolean;
    },
  ): Promise<{
    task: TaskResponse;
    userId: string;
    previousUnitPricePaise: string | null;
  }> {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row) throw new NotFoundException('Task not found');
    const engine = toEngineTask(row, []);
    const order = engine.order;
    if (!order) {
      throw new ConflictException(
        'This task has no order yet, so there is no purchase to price.',
      );
    }

    // Gate 1 — fill a gap, or correct a FIGURE A PERSON PUT THERE. Never overwrite
    // a machine read: that outranks a human typing.
    //
    // The second half matters as much as the first. Refusing every overwrite
    // would mean a reviewer who mistypes has no way back — a worse dead end than
    // the one this whole queue exists to remove — so `amountSource` is what
    // separates the two cases, and it is the only thing that may.
    const existing =
      order.unitPricePaise ?? order.lineTotalPaise ?? order.itemPaise ?? null;
    const staffSupplied = (order.amountSource ?? '').startsWith('staff:');
    if (existing != null && !staffSupplied) {
      throw new ConflictException(
        `This order already has an amount on file (${rupeesOf(existing)}), read from `
        + `the marketplace itself. That cannot be replaced by hand — if it looks wrong, `
        + `it needs a decision about which figure to believe, not an override.`,
      );
    }
    const previousUnitPricePaise =
      existing != null && staffSupplied ? existing.toString() : null;
    const nextAmountSource = `staff:${input.evidenceSource}`;
    // The same no-op as the count above: the same figure, read off the same kind
    // of document. A different `evidenceSource` on the same figure IS a change —
    // "I read it on the invoice, not the order page" is a better record — so that
    // still writes.
    if (existing === input.unitPricePaise && order.amountSource === nextAmountSource) {
      return {
        task: toTaskResponse(row, row.campaign),
        userId: row.userId,
        previousUnitPricePaise,
      };
    }

    // Gate 2 — a ceiling that means something.
    const bounds = staffAmountBounds({
      campaignPricePaise: row.campaign.productPricePaise,
      orderTotalPaise: order.orderTotalPaise ?? null,
    });
    if (bounds.maxPaise == null) {
      throw new ConflictException(
        'There is nothing to check this figure against — this campaign has no price '
        + 'and the order has no total. Set the campaign price first.',
      );
    }
    if (!bounds.allows(input.unitPricePaise)) {
      const anchorWords =
        bounds.anchor === 'order-total'
          ? "the order's own total"
          : "twice the campaign's price";
      throw new BadRequestException(
        `${rupeesOf(input.unitPricePaise)} is above the most this can be — `
        + `${rupeesOf(bounds.maxPaise)}, which is ${anchorWords}. Check for a typo.`,
      );
    }

    // Gate 3 — a disagreement may pass, but not silently.
    const disagrees = chargedDisagreesWithCampaign(
      input.unitPricePaise,
      row.campaign.productPricePaise,
    );
    if (disagrees && !input.acknowledgedDisagreement) {
      throw new ConflictException(
        `${rupeesOf(input.unitPricePaise)} does not match what this campaign says the `
        + `product costs (${rupeesOf(row.campaign.productPricePaise)}). That can be `
        + `right — a discount is real — but it has to be acknowledged before it is saved.`,
      );
    }

    const task = await this.applyEvidence(
      row.userId,
      taskId,
      {
        order: {
          ...order,
          unitPricePaise: input.unitPricePaise,
          // WHERE a person read it. Distinct from the order's `source`, which
          // still records where the ORDER was read from.
          amountSource: nextAmountSource,
        },
      },
      // UNIQUE per press, for the same reason as the count — and it matters more
      // here, because the value a value-derived key would swallow is money.
      // 499 → 599 → 499 kept 599 on file while the panel reported 499 saved.
      `staff-amount:${input.unitPricePaise.toString()}:${randomUUID()}`,
    );
    return { task, userId: row.userId, previousUnitPricePaise };
  }

  /**
   * Every review waiting on a person to open a product page and look.
   *
   * Same shape as the unit-count queue and for the same reason: the app already
   * tells these users a Fayr reviewer will confirm their review is live, and a
   * promise with no queue behind it is a promise nobody keeps. The SQL narrows to
   * rows that could possibly qualify; the real predicate (needsEyesOnPage) runs
   * over the hydrated evidence, so there is one definition of the decision rather
   * than a JSONB expression drifting alongside it.
   */
  async listAwaitingReviewCheck(): Promise<ReviewCheckResponse> {
    const rows = await this.prisma.task.findMany({
      // A review only becomes relevant once the purchase is real, and a REFUNDED
      // task is already paid. Everything else is the resolver's call.
      where: { state: { in: ['PURCHASED', 'DELIVERED', 'REVIEWED', 'HOLDING'] } },
      include: { campaign: true, user: { select: { id: true, mobile: true } } },
      orderBy: { createdAt: 'asc' }, // oldest first: someone has waited longest
      take: 200,
    });
    const items = rows
      .map((row) => toReviewCheckItem(row))
      .filter((item): item is ReviewCheckItem => item !== null);
    return { items, total: items.length };
  }

  /**
   * A staff member states that they opened the public product page and saw (or
   * did not see) the review.
   *
   * THE MOST DIRECT of the three staff decisions: `published` is the payout
   * signal — it starts the holding period, and the holding period is the only
   * thing between a review and a refund. So it goes through applyEvidence like
   * every other evidence write. There is deliberately no second route that sets
   * `published` on its own; a second route to a payout signal is the exact defect
   * class this codebase keeps finding.
   *
   * Three gates:
   *
   *   1. A REVIEW MUST ALREADY BE ON FILE, with the marketplace's own star.
   *      Confirming the visibility of a review nothing has reported would let a
   *      person invent the review itself, which is a far larger claim than the one
   *      this action is for.
   *   2. IT FILLS A GAP, IT DOES NOT OVERRULE A MACHINE. If anything that
   *      outranks a person has checked the public page — the permalink fetch, the
   *      marketplace's own moderation verdict — that stands. Otherwise this action
   *      would be a hand-operated way to disarm the deleted-review countermeasure.
   *   3. ONLY THE TIER THAT SPOKE MAY TAKE IT BACK. `visible: false` is a
   *      withdrawal of a Fayr reviewer's own confirmation, not a new power to
   *      un-publish something a machine established.
   *
   * It moves no money. The return window, the delivery date, the amount and the
   * FINANCE-gated withdrawal all still stand between this and a rupee.
   */
  async confirmReviewVisible(
    taskId: string,
    input: { visible: boolean; productUrl: string; seenAt?: string; },
  ): Promise<{
    task: TaskResponse;
    userId: string;
    seenAt: string;
    /** What the verdict was before, so a correction reads as a correction. */
    previousVisible: boolean | null;
    previousSource: string | null;
    previousUrl: string | null;
    /** True when the record already said this — nothing was written. */
    unchanged: boolean;
  }> {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!row) throw new NotFoundException('Task not found');
    const engine = toEngineTask(row, []);
    const review = engine.review;

    // Gate 1 — there has to be a review to be visible.
    if (!needsEyesOnPage(review)) {
      if (!review || review.rating == null) {
        // Plain words: staff read these out to people on the phone.
        throw new ConflictException(
          'There is no review on this task yet, so there is nothing to confirm. '
          + 'The marketplace has to show the rating first.',
        );
      }
      // Gate 2 — a machine has already looked at the public page.
      if (machineSettledVisibility(review)) {
        throw new ConflictException(
          review.published === true
            ? 'Fayr has already checked the public review page for this one and '
              + 'found the review, so there is nothing to add by hand.'
            : 'Fayr has already checked the public review page for this one and '
              + 'the review was not there. That cannot be overridden by hand — it '
              + 'needs a decision about which observation to believe.',
        );
      }
      throw new ConflictException(
        'This review is already counted as publicly visible, so there is nothing '
        + 'waiting on a check.',
      );
    }

    const previousVisible =
      review!.publishedSource === SOURCES.STAFF_VISIBLE
        ? review!.published === true
        : null;

    // Gate 3 — you may only withdraw what a Fayr reviewer said. Reaching this
    // point already means no machine has settled it, so the only remaining case
    // is "nobody has said anything yet", and there is nothing to withdraw.
    if (!input.visible && review!.publishedSource !== SOURCES.STAFF_VISIBLE) {
      throw new ConflictException(
        'Nobody has confirmed this review is live, so there is nothing to '
        + 'withdraw. Leave it as it is and it stays in the queue.',
      );
    }

    const seenAtMs =
      input.seenAt != null ? new Date(input.seenAt).getTime() : Date.now();
    if (!Number.isFinite(seenAtMs)) {
      throw new BadRequestException('That date could not be read.');
    }
    if (seenAtMs > Date.now()) {
      throw new BadRequestException(
        'That date is in the future — nobody has looked at a page tomorrow.',
      );
    }
    if (seenAtMs < row.createdAt.getTime()) {
      throw new BadRequestException(
        'That date is before this task was even claimed, so the review could not '
        + 'have been on the page then.',
      );
    }

    // Nothing would change: the same verdict, from the same tier, on the same
    // page. Report the task as it stands rather than writing a second identical
    // event — a double click is one decision.
    if (
      previousVisible === input.visible &&
      review!.visibleUrl === input.productUrl
    ) {
      return {
        task: toTaskResponse(row, row.campaign),
        userId: row.userId,
        seenAt: new Date(review!.visibleCheckedAt ?? seenAtMs).toISOString(),
        previousVisible,
        previousSource: review!.publishedSource ?? null,
        previousUrl: review!.visibleUrl ?? null,
        unchanged: true,
      };
    }

    const task = await this.applyEvidence(
      row.userId,
      taskId,
      {
        // The whole review is resent because the engine replaces `review`
        // wholesale rather than merging fields; a partial one would drop the star
        // and the review id.
        review: {
          ...review!,
          published: input.visible,
          publishedSource: SOURCES.STAFF_VISIBLE,
          visibleUrl: input.productUrl,
          visibleCheckedAt: seenAtMs,
        },
      },
      // UNIQUE per press, not derived from the verdict. A key like
      // `staff-visible:yes` looks idempotent and is actually a trap: confirm →
      // withdraw → confirm repeats the first key, the engine treats the third
      // press as a duplicate and silently does nothing, and the panel says
      // "saved" over a record that did not change. The no-op case above is what
      // makes a double click one decision; this only has to be distinct.
      `staff-visible:${input.visible ? 'yes' : 'no'}:${randomUUID()}`,
    );
    return {
      task,
      userId: row.userId,
      seenAt: new Date(seenAtMs).toISOString(),
      previousVisible,
      previousSource: review!.publishedSource ?? null,
      previousUrl: review!.visibleUrl ?? null,
      unchanged: false,
    };
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

  /**
   * Apply on-device evidence → advances CLAIMED → PURCHASED → DELIVERED.
   *
   * This is the UNTRUSTED channel: the body is whatever the client sent, and the
   * client also declares its own `source` tier. So it — and only it — runs the
   * plausibility gate. `applyEvidence` deliberately does not: its other caller is
   * the staff OCR approval flow, where a human has already reviewed the evidence
   * and where an OCR delivery date is legitimately the upload time.
   */
  submitEvidence(
    userId: string,
    taskId: string,
    dto: SubmitEvidenceDto,
  ): Promise<TaskResponse> {
    return this.runEvent(
      userId,
      taskId,
      { type: 'EVIDENCE', evidence: evidenceFromDto(dto), key: dto.key },
      { plausibility: true },
    );
  }

  /**
   * Apply an already-built Evidence object through the SAME engine path as user
   * evidence. This is the funnel the staff OCR-approval flow uses (source `ocr`)
   * and the one the on-device scraper will use later (higher-tier sources) — one
   * pipeline, tiered sources, so an approved screenshot advances the task under
   * the identical state-machine rules. `userId` is the task OWNER (evidence is
   * always applied to that user's own task); the caller supplies it.
   */
  applyEvidence(
    userId: string,
    taskId: string,
    evidence: Evidence,
    key?: string,
  ): Promise<TaskResponse> {
    return this.runEvent(userId, taskId, { type: 'EVIDENCE', evidence, key });
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
      const outcome = await this.attemptRelease(tx, row, campaign, Date.now());
      switch (outcome.status) {
        case 'released':
        case 'already':
          return outcome.task;
        case 'amount-unknown':
          // PLAIN WORDS, NOT AN ENUM. This used to throw
          // "Order amount is unknown, cannot compute the refund (quantity-unknown)"
          // straight at the user — an internal name on the screen where someone
          // checks whether they are getting their money. The machine-readable
          // reason still goes to the log and the staff queue; the person gets a
          // sentence that says what is happening and that nothing is lost.
          this.logger.warn(
            `release held on task ${taskId}: ${outcome.reason ?? 'amount-unknown'}`,
          );
          throw new ConflictException(explainHold(outcome.reason));
        case 'ineligible':
          throw new ConflictException(outcome.reasons.join('; '));
      }
      throw new Error('unreachable release outcome');
    });
  }

  /**
   * System-driven release for the 1.6 scheduler: same eligibility gate as the
   * endpoint, but returns null instead of throwing when the task isn't eligible
   * (so the scheduler skips it silently) and is not scoped to a user.
   */
  autoRelease(
    taskId: string,
    now: number = Date.now(),
  ): Promise<TaskResponse | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM tasks WHERE id = ${taskId}::uuid FOR UPDATE`;
      if (locked.length === 0) return null;
      const row = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { id: row.campaignId },
      });
      const outcome = await this.attemptRelease(tx, row, campaign, now);
      return outcome.status === 'released' || outcome.status === 'already'
        ? outcome.task
        : null;
    });
  }

  /**
   * The shared release core: run the refund gate, and on success post the wallet
   * refund (HOUSE → USER) and move the task to REFUNDED — all on the caller's tx.
   * Returns a discriminated outcome so the endpoint can raise a precise 409 while
   * the scheduler can skip quietly.
   */
  private async attemptRelease(
    tx: Tx,
    row: Task,
    campaign: Campaign,
    now: number,
  ): Promise<ReleaseOutcome> {
    const task = toEngineTask(row, await this.loadAppliedKeys(tx, row.id));
    if (task.state === STATES.REFUNDED) {
      return { status: 'already', task: toTaskResponse(row, campaign) };
    }

    const policy = policyForWindowDays(campaign.returnWindowDays);
    const elig = refundEligibility(task, now, policy);
    if (!elig.eligible) {
      return { status: 'ineligible', reasons: elig.reasons };
    }

    // A refund is based on the amount ACTUALLY CHARGED, never a listed price —
    // see charged-amount.ts for why that is not the same field on every
    // platform. Never read task.order.itemPaise directly here.
    //
    // Resolved BEFORE the doubtful gate on purpose: an unknown amount is its own
    // outcome (a staff route), and must not be mistaken for "the price
    // disagrees" by the check below.
    const charged = resolveChargedPaise(task.order);
    if (charged.paise == null) {
      return { status: 'amount-unknown', reason: charged.reason };
    }

    // A DOUBTFUL order match must not pay out on a match score alone. Two
    // signals mean this release deserves a human's eyes:
    //
    //   `ambiguous`  several orders scored within 0.15 of the winner by name.
    //                Device-sourced and irreducibly so — only the WINNING
    //                candidate ever leaves the WebView (a deliberate privacy
    //                boundary), so the backend cannot recompute it.
    //
    //   price gap    what was actually CHARGED disagrees with the campaign's
    //                price. This used to read the device's `match.amountOk`,
    //                which compares listed-against-listed while the refund pays
    //                the charged figure — so it fired on honest orders (the live
    //                heels case: ₹367 sticker vs ₹328 charged on a ₹328
    //                campaign) and was noise rather than a fraud signal. The
    //                backend now computes it from the charged amount instead.
    //
    // Either one REQUIRES the user's explicit "Yes, this is my order" before
    // money moves. A clean match at the right price still needs no tap.
    //
    // Two consequences of computing the price half here rather than trusting the
    // device. It no longer requires a `match` object at all, so Amazon — which
    // emits none — is covered for the first time. And it is retroactive: a task
    // already sitting in HOLDING is judged on its stored amounts at release
    // time, so a stale `amountOk` cannot decide anything, whether it was written
    // by an old app build or erased by a later fetch.
    // ONE PURCHASE, ONE REFUND.
    //
    // Nothing used to stop a single real order being paid out on several
    // campaigns: every claim gate is keyed on campaignId, never on the purchase.
    // It was not theoretical — order OD337767552058345100 paid twice, 590.40
    // against a 328 purchase, and it granted the +10 completion tickets twice as
    // well (markPaid grants per REFUNDED task, so a second refunded task is a
    // second grant).
    //
    // Keyed on (platform, orderId, ITEM) — the line, not just the order.
    //
    // It was keyed on the order number alone, and the comment here said that was
    // the only identity the evidence carried: "no per-line-item id survives the
    // wire on ANY platform". That was wrong. Four of the six live platforms state
    // a real per-line identifier and every one already reaches the backend — the
    // ASIN (which is on the order DETAIL page, not just the listing), Flipkart's
    // pid, Meesho's sub-order id, Instamart's product-variant id. Nothing in the
    // frozen scraper had to change to use them.
    //
    // Order-level keying was wrong in BOTH directions:
    //   - a merged Amazon cart is two genuinely different products under one
    //     order number. Both are legitimate tasks, and every single one of them
    //     needed a staff override — a queue of work created by the key rather
    //     than by any risk;
    //   - and two claims on the SAME line, which is the fraud this gate exists
    //     for, looked exactly the same to it as the merged cart did.
    //
    // FAIL CLOSED ON UNKNOWN. A null line id is not "a different line". Two tasks
    // on one order number may both pay only when BOTH sides name a line and the
    // lines differ; if either is unknown we cannot prove they are distinct, so a
    // human decides. Zepto and Blinkit are permanently in that case by design —
    // their only candidate identifier is a row number, which the reader refuses
    // rather than dress up as an identity.
    //
    // It still HOLDS rather than refuses, and at payout rather than by rejecting
    // the evidence: refusing would strand a real purchase with no route forward.
    const orderId = task.order?.id ?? null;
    const itemId = task.order?.itemId ?? null;
    if (orderId != null) {
      const siblings = await tx.task.findMany({
        where: {
          id: { not: row.id },
          platform: row.platform,
          orderId,
          state: STATES.REFUNDED,
        },
        select: { id: true, itemId: true },
      });
      // A paid sibling collides unless both sides name a line and they differ.
      const sameLine = siblings.some((s) => s.itemId != null && s.itemId === itemId);
      const indistinguishable = siblings.some(
        (s) => itemId == null || s.itemId == null,
      );
      if ((sameLine || indistinguishable) && !row.duplicateOrderApproved) {
        return {
          status: 'ineligible',
          reasons: [
            // Two different investigations, so two different sentences. "The same
            // item was already paid" is a likely duplicate; "we cannot tell which
            // line this is" is a reading problem on a possibly-honest basket.
            sameLine
              ? 'this exact item has already been refunded on another offer — a Fayr reviewer needs to check it'
              : 'this order has already been refunded on another offer — a Fayr reviewer needs to check it',
          ],
        };
      }
    }

    const match = task.order?.match ?? null;
    const priceDisagrees = chargedDisagreesWithCampaign(
      charged.paise,
      campaign.productPricePaise,
    );
    const doubtful = match?.ambiguous === true || priceDisagrees;
    if (doubtful && task.orderConfirmed !== true) {
      return {
        status: 'ineligible',
        reasons: [
          match?.ambiguous === true
            ? 'more than one order matched this product — confirm which one is yours'
            : "the amount you paid doesn't match this offer — confirm this is your order",
        ],
      };
    }

    const refundPaise = computeRefundPaise(
      charged.paise,
      campaign.payoutPercent,
      campaign.payoutCapPaise,
    );

    const event: EngineEvent = {
      type: 'RELEASE_REFUND',
      at: now,
      policy,
      key: `release:${row.id}`,
    };
    const result = transition(task, event);
    if (result.rejected) {
      return {
        status: 'ineligible',
        reasons: [result.reason ?? 'not eligible'],
      };
    }

    await this.wallet.postRefund(
      {
        userId: row.userId,
        amountPaise: refundPaise,
        idempotencyKey: `refund:${row.id}`,
        referenceType: 'task',
        referenceId: row.id,
      },
      tx,
    );
    await this.persist(tx, task, result, event, campaign, {
      at: now,
      reason: 'refunded',
    });

    const updated = await tx.task.findUniqueOrThrow({ where: { id: row.id } });
    return { status: 'released', task: toTaskResponse(updated, campaign) };
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
   * HOLDING tasks the 1.6 scheduler should re-check, each with the review
   * permalink to fetch (null if the evidence never carried one). Ordered by the
   * soonest window end so the most time-sensitive holds are processed first.
   */
  async holdingTasksForRecheck(): Promise<
    { id: string; permalink: string | null }[]
  > {
    const rows = await this.prisma.task.findMany({
      where: { state: 'HOLDING', closedAt: null },
      orderBy: { windowEndsAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      permalink: toEngineTask(row, []).review?.permalink ?? null,
    }));
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
    opts: { plausibility?: boolean } = {},
  ): Promise<TaskResponse> {
    return this.prisma.$transaction(async (tx) => {
      const { row, campaign } = await this.lockOwned(tx, userId, taskId);
      const task = toEngineTask(row, await this.loadAppliedKeys(tx, taskId));
      // Refuse evidence that cannot be true, INSIDE the row lock so the anchored
      // order the swap-check compares against can't shift under us.
      if (opts.plausibility && event.type === 'EVIDENCE') {
        const verdict = checkPlausibility(
          event.evidence,
          { productPricePaise: campaign.productPricePaise },
          Date.now(),
          task.order,
        );
        if (!verdict.ok) {
          throw new BadRequestException(
            `Evidence rejected as impossible: ${verdict.rejections.join(', ')}`,
          );
        }
      }

      // THE DATE RULE — the campaign must have caused the purchase.
      //
      // Deliberately OUTSIDE the `opts.plausibility` flag: that flag is turned off
      // by the staff OCR-approval path, so putting the rule inside it would let a
      // screenshot of a January order in through a door the scraper is barred
      // from. This runs for EVERY evidence event whatever its source, which is
      // what makes the rule authoritative rather than a scraper convention — and
      // what will bind manual entry automatically when it exists.
      let effective = event;
      if (event.type === 'EVIDENCE') {
        const screened = screenEvidenceByWindow(
          event.evidence,
          orderWindow({
            claimedAt: row.createdAt.getTime(),
            campaignCreatedAt: campaign.createdAt.getTime(),
            claimExpiresAt: row.claimExpiresAt?.getTime() ?? null,
          }),
        );
        if (screened.refused) {
          // The submission still lands as an audit record, and the task carries a
          // blocker the screen explains — but the order never becomes the anchor,
          // so no itemPaise or orderId is written and no refund can be computed.
          this.logger.warn(
            `order out of window (${screened.verdict}) on task ${taskId}`,
          );
          effective = { ...event, evidence: screened.evidence };
        }
      }
      const result = transition(task, effective);
      if (result.rejected) {
        throw new ConflictException(result.reason ?? 'transition rejected');
      }
      if (result.changed) {
        await this.persist(tx, task, result, event, campaign);
      } else if (result.diagnostics) {
        // A duplicate-key no-op still refreshes WHY the last attempt failed.
        // Task state is untouched and NO event row is written, so re-fetching
        // repeatedly costs nothing in the log but always leaves usable evidence.
        await this.persistDiagnostics(tx, taskId, result.diagnostics);
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

  /**
   * Write ONLY the diagnostics from a duplicate-key no-op: the probe (inside the
   * evidence JSON) and blockerReason. Reads the row's current evidence and swaps
   * those two fields, so no verified fact can be disturbed — and writes no event.
   */
  private async persistDiagnostics(
    tx: Tx,
    taskId: string,
    diagnostics: {
      probe: unknown;
      blockerReason: string | null;
      blocker: string | null;
    },
  ): Promise<void> {
    const row = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const current =
      row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
        ? (row.evidence as Prisma.JsonObject)
        : {};
    await tx.task.update({
      where: { id: taskId },
      data: {
        evidence: {
          ...current,
          probe: (diagnostics.probe ?? null) as Prisma.InputJsonValue,
        },
        blockerReason: diagnostics.blockerReason,
        // Must move with the reason. A stale blocker beside a fresh reason is a
        // record that contradicts itself and costs a whole session to unpick.
        blocker: diagnostics.blocker,
      },
    });
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
        // WHY this particular check found what it found. The task row keeps
        // only the latest; the event log keeps every check, which is what makes
        // "the 2nd fetch failed differently from the 1st" diagnosable at all.
        reason: event.evidence.reason ?? null,
        probe: (event.evidence.probe ?? null) as Prisma.InputJsonValue,
      };
    default:
      return undefined;
  }
}
