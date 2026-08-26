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
 * A Prisma client that may be the shared one OR an interactive-transaction
 * client. Passing a `tx` lets a caller compose a ticket movement into a LARGER
 * atomic operation (e.g. claim deducts tickets AND creates the task in one
 * transaction). Called without one, every method behaves exactly as before.
 */
type Db = Prisma.TransactionClient;

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
  async getBalance(userId: string, tx?: Db): Promise<number> {
    const db = tx ?? this.prisma;
    const agg = await db.ticketEntry.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return agg._sum.delta ?? 0;
  }

  /**
   * A user's full ticket ledger, newest first. Read-only — the table is
   * append-only, so this never mutates. Used by the staff unified user view (2.2).
   */
  listEntries(userId: string): Promise<TicketEntry[]> {
    return this.prisma.ticketEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The one-time +15 signup grant. Idempotent per user. */
  grantSignup(userId: string, tx?: Db): Promise<TicketEntry> {
    return this.post(
      {
        userId,
        delta: TICKETS.SIGNUP_GRANT,
        reason: 'SIGNUP_GRANT',
        idempotencyKey: ticketKey.signup(userId),
      },
      tx,
    );
  }

  /**
   * Deduct the claim cost (default 5) when a user claims a campaign. Throws
   * InsufficientTicketsError if they don't have enough. Idempotent per task.
   */
  async deductForClaim(
    userId: string,
    taskId: string,
    cost: number = TICKETS.DEFAULT_CLAIM_COST,
    tx?: Db,
  ): Promise<TicketEntry> {
    if (!Number.isInteger(cost) || cost <= 0) {
      throw new TicketError(
        `claim cost must be a positive integer, got ${cost}`,
      );
    }
    return this.post(
      {
        userId,
        delta: -cost,
        reason: 'CLAIM',
        taskId,
        idempotencyKey: ticketKey.claim(taskId),
      },
      tx,
    );
  }

  /**
   * Return the tickets a claim consumed, when it expires without a purchase.
   * Returns EXACTLY what the claim took (read from the CLAIM entry), so a later
   * change to the campaign's cost can't refund the wrong amount. Idempotent.
   */
  async returnOnExpiry(
    userId: string,
    taskId: string,
    tx?: Db,
  ): Promise<TicketEntry> {
    const db = tx ?? this.prisma;
    const claim = await db.ticketEntry.findFirst({
      where: { taskId, reason: 'CLAIM' },
    });
    if (!claim) {
      throw new TicketError(
        `cannot return tickets: task ${taskId} has no claim deduction`,
      );
    }
    return this.post(
      {
        userId,
        delta: -claim.delta, // claim.delta is negative → this is a positive return
        reason: 'EXPIRY_RETURN',
        taskId,
        idempotencyKey: ticketKey.expiry(taskId),
      },
      tx,
    );
  }

  /** The +10 grant after a task is fully completed + withdrawn. Idempotent. */
  grantCompletion(
    userId: string,
    taskId: string,
    tx?: Db,
  ): Promise<TicketEntry> {
    return this.post(
      {
        userId,
        delta: TICKETS.COMPLETION_GRANT,
        reason: 'COMPLETION_RETURN',
        taskId,
        idempotencyKey: ticketKey.completion(taskId),
      },
      tx,
    );
  }

  /**
   * A MANUAL CORRECTION — the only way tickets move outside the two grants, the
   * claim and the expiry return.
   *
   * It exists because of a state a real account was actually found in: the signup
   * grant is idempotent per user for life, so an account that has already spent
   * its 15 can never be re-granted, and nothing else could put tickets back. The
   * demo seed needs to build claims on such an account; a support agent
   * correcting a genuine mistake needs the same thing.
   *
   * It is a posting, not an edit. Append-only, floored at zero, serialized on the
   * user row, idempotent by the caller's key — every guarantee the lifecycle
   * postings have. No prior row is ever rewritten, which is the only reason a
   * balance read as SUM(delta) can be trusted.
   *
   * The caller owns the key, and it is required: an unkeyed correction posts twice
   * on a retry, and a doubled ticket balance is a fraud control quietly failing.
   *
   * Not reachable over HTTP. Deliberately: an endpoint that mints tickets needs an
   * approval trail of its own, and that is a decision, not a helper.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async adjust(
    userId: string,
    delta: number,
    idempotencyKey: string,
  ): Promise<TicketEntry> {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new TicketError(
        `a ticket adjustment must be a non-zero whole number, got ${delta}`,
      );
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      throw new TicketError('a ticket adjustment needs an idempotency key');
    }
    return this.post({
      userId,
      delta,
      reason: 'ADJUSTMENT',
      idempotencyKey,
    });
  }

  /**
   * Post one ticket movement: atomic, serialized on the user row, floored at
   * zero, and idempotent by key. With a `tx`, it joins the caller's transaction;
   * otherwise it opens its own.
   */
  private async post(input: TicketPost, tx?: Db): Promise<TicketEntry> {
    // Fast path for the common (non-racing) retry.
    const existing = await this.findByKey(
      input.idempotencyKey,
      tx ?? this.prisma,
    );
    if (existing) return existing;

    if (tx) {
      // Joins the caller's transaction; the caller is expected to serialize (the
      // claim flow locks the user row), so no in-place unique-race recovery here.
      return this.postWithin(tx, input);
    }

    try {
      return await this.prisma.$transaction((db) => this.postWithin(db, input));
    } catch (err) {
      if (isUniqueViolation(err)) {
        const won = await this.findByKey(input.idempotencyKey, this.prisma);
        if (won) return won;
      }
      throw err;
    }
  }

  /** The locked, floored, single-entry insert — runs on whichever client is given. */
  private async postWithin(db: Db, input: TicketPost): Promise<TicketEntry> {
    // Serialize all ticket posts for this user: prevents a negative-balance race
    // and makes the recorded balanceAfter exact. Also asserts the user exists (a
    // claim for a phantom user must not silently succeed).
    const locked = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new TicketError(`unknown user ${input.userId}`);
    }

    const agg = await db.ticketEntry.aggregate({
      where: { userId: input.userId },
      _sum: { delta: true },
    });
    const current = agg._sum.delta ?? 0;
    const balanceAfter = current + input.delta;
    if (balanceAfter < 0) {
      throw new InsufficientTicketsError(current, -input.delta);
    }

    return db.ticketEntry.create({
      data: {
        userId: input.userId,
        delta: input.delta,
        reason: input.reason,
        taskId: input.taskId,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  private findByKey(
    idempotencyKey: string,
    db: Db,
  ): Promise<TicketEntry | null> {
    return db.ticketEntry.findUnique({ where: { idempotencyKey } });
  }
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
