import { Injectable } from '@nestjs/common';
import { Prisma, type TicketEntry, type TicketReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TICKETS, ticketKey } from './ticket.constants';
import { InsufficientTicketsError, TicketError } from './ticket.types';

interface TicketPost {
  userId: string;
  delta: number;
  reason: TicketReason;
  idempotencyKey: string;
  taskId?: string;
}

/**
 * The ticket economy — an append-only ledger of ticket movements. A balance is
 * always SUM(delta); there is no stored, mutable count to drift.
 *
 * Unlike the wallet (where the counter-party HOUSE account is allowed to go
 * negative), a user's ticket balance has a hard FLOOR of zero: a claim can never
 * take tickets the user doesn't have. That check must be race-free, so every
 * posting serializes on the user row (SELECT ... FOR UPDATE) — concurrent posts
 * for the same user run one at a time, which also makes the recorded
 * `balanceAfter` exact. A DEFERRED database trigger (migration
 * `ticket_ledger_guards`) is the independent backstop: it refuses any commit
 * that would leave a user's balance negative, even one that bypasses this
 * service. Every posting is idempotent by `idempotencyKey`.
 */
@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}

  /** A user's ticket balance = SUM(delta) (0 if they have no entries yet). */
  async getBalance(userId: string): Promise<number> {
    const agg = await this.prisma.ticketEntry.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return agg._sum.delta ?? 0;
  }

  /** The one-time +15 signup grant. Idempotent per user. */
  grantSignup(userId: string): Promise<TicketEntry> {
    return this.post({
      userId,
      delta: TICKETS.SIGNUP_GRANT,
      reason: 'SIGNUP_GRANT',
      idempotencyKey: ticketKey.signup(userId),
    });
  }

  /**
   * Deduct the claim cost (default 5) when a user claims a campaign. Throws
   * InsufficientTicketsError if they don't have enough. Idempotent per task.
   */
  async deductForClaim(
    userId: string,
    taskId: string,
    cost: number = TICKETS.DEFAULT_CLAIM_COST,
  ): Promise<TicketEntry> {
    if (!Number.isInteger(cost) || cost <= 0) {
      throw new TicketError(
        `claim cost must be a positive integer, got ${cost}`,
      );
    }
    return this.post({
      userId,
      delta: -cost,
      reason: 'CLAIM',
      taskId,
      idempotencyKey: ticketKey.claim(taskId),
    });
  }

  /**
   * Return the tickets a claim consumed, when it expires without a purchase.
   * Returns EXACTLY what the claim took (read from the CLAIM entry), so a later
   * change to the campaign's cost can't refund the wrong amount. Idempotent.
   */
  async returnOnExpiry(userId: string, taskId: string): Promise<TicketEntry> {
    const claim = await this.prisma.ticketEntry.findFirst({
      where: { taskId, reason: 'CLAIM' },
    });
    if (!claim) {
      throw new TicketError(
        `cannot return tickets: task ${taskId} has no claim deduction`,
      );
    }
    return this.post({
      userId,
      delta: -claim.delta, // claim.delta is negative → this is a positive return
      reason: 'EXPIRY_RETURN',
      taskId,
      idempotencyKey: ticketKey.expiry(taskId),
    });
  }

  /** The +10 grant after a task is fully completed + withdrawn. Idempotent. */
  grantCompletion(userId: string, taskId: string): Promise<TicketEntry> {
    return this.post({
      userId,
      delta: TICKETS.COMPLETION_GRANT,
      reason: 'COMPLETION_RETURN',
      taskId,
      idempotencyKey: ticketKey.completion(taskId),
    });
  }

  /**
   * Post one ticket movement: atomic, serialized on the user row, floored at
   * zero, and idempotent by key.
   */
  private async post(input: TicketPost): Promise<TicketEntry> {
    // Fast path for the common (non-racing) retry.
    const existing = await this.findByKey(input.idempotencyKey);
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize all ticket posts for this user: prevents a negative-balance
        // race and makes the recorded balanceAfter exact. Also asserts the user
        // exists (a claim for a phantom user must not silently succeed).
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw new TicketError(`unknown user ${input.userId}`);
        }

        const agg = await tx.ticketEntry.aggregate({
          where: { userId: input.userId },
          _sum: { delta: true },
        });
        const current = agg._sum.delta ?? 0;
        const balanceAfter = current + input.delta;
        if (balanceAfter < 0) {
          throw new InsufficientTicketsError(current, -input.delta);
        }

        return tx.ticketEntry.create({
          data: {
            userId: input.userId,
            delta: input.delta,
            reason: input.reason,
            taskId: input.taskId,
            balanceAfter,
            idempotencyKey: input.idempotencyKey,
          },
        });
      });
    } catch (err) {
      // A concurrent post won the idempotency-key race — return the winner.
      if (isUniqueViolation(err)) {
        const won = await this.findByKey(input.idempotencyKey);
        if (won) return won;
      }
      throw err;
    }
  }

  private findByKey(idempotencyKey: string): Promise<TicketEntry | null> {
    return this.prisma.ticketEntry.findUnique({ where: { idempotencyKey } });
  }
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
