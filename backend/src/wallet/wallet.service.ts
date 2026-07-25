import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type LedgerTransaction,
  type WalletAccount,
  type WalletEntry,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_IDS, type SystemAccountKind } from './wallet.constants';
import { assertBalancedLegs, assertPositiveAmount } from './wallet.invariants';
import { LedgerError, type PostInput } from './wallet.types';

/** A posted transaction with its legs attached. */
export type PostedTransaction = LedgerTransaction & { entries: WalletEntry[] };

/**
 * The wallet ledger — the money core.
 *
 * Every balance is SUM(amountPaise) over append-only legs; there is no stored,
 * mutable balance to drift. Every economic event is a balanced double-entry
 * transaction (debits == credits) written atomically, and is idempotent by
 * `idempotencyKey` so a retry never double-posts. Three layers protect this:
 *
 *   1. pure invariants (wallet.invariants.ts) — fast, clear rejections;
 *   2. the atomic write below;
 *   3. database triggers (migration `wallet_ledger_guards`) — a deferred
 *      balanced-check + append-only immutability, which hold even if a future
 *      caller writes without going through this service.
 *
 * All amounts are integer paise as `bigint`. Never a float, never a `number`.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotently ensure a system account exists; returns it. */
  async ensureSystemAccount(kind: SystemAccountKind): Promise<WalletAccount> {
    const id = SYSTEM_ACCOUNT_IDS[kind];
    return this.prisma.walletAccount.upsert({
      where: { id },
      create: { id, kind, userId: null },
      update: {},
    });
  }

  /** The user's single refundable account, created on first touch. */
  async getOrCreateUserAccount(userId: string): Promise<WalletAccount> {
    return this.prisma.walletAccount.upsert({
      where: { userId_kind: { userId, kind: 'USER' } },
      create: { userId, kind: 'USER' },
      update: {},
    });
  }

  /** Balance of one account = SUM of its legs (0 if it has none). */
  async getBalance(accountId: string): Promise<bigint> {
    const agg = await this.prisma.walletEntry.aggregate({
      where: { accountId },
      _sum: { amountPaise: true },
    });
    return agg._sum.amountPaise ?? 0n;
  }

  /** A user's refundable balance in paise (0 if they have no account yet). */
  async getUserBalance(userId: string): Promise<bigint> {
    const account = await this.prisma.walletAccount.findUnique({
      where: { userId_kind: { userId, kind: 'USER' } },
    });
    return account ? this.getBalance(account.id) : 0n;
  }

  /**
   * The core primitive: post a balanced set of legs as one transaction, atomically
   * and idempotently. A replay of the same `idempotencyKey` returns the original
   * transaction unchanged — it never posts twice.
   */
  async post(input: PostInput): Promise<PostedTransaction> {
    assertBalancedLegs(input.legs);

    // Fast path for the common retry: the transaction already exists.
    const existing = await this.findByKey(input.idempotencyKey);
    if (existing) return existing;

    try {
      return await this.prisma.ledgerTransaction.create({
        data: {
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          memo: input.memo,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          entries: {
            create: input.legs.map((leg) => ({
              accountId: leg.accountId,
              amountPaise: leg.amountPaise,
            })),
          },
        },
        include: { entries: true },
      });
    } catch (err) {
      // A concurrent post won the idempotency-key race — return the winner rather
      // than surfacing a unique-violation. (The unique index is the true guard;
      // the fast path above only avoids the common, non-racing case.)
      if (isUniqueViolation(err)) {
        const won = await this.findByKey(input.idempotencyKey);
        if (won) return won;
      }
      throw err;
    }
  }

  /**
   * Credit a user's refundable balance from the HOUSE account (the refund event).
   * Legs: HOUSE −amount, USER +amount → balanced. `amount` must be positive paise.
   */
  async postRefund(input: {
    userId: string;
    amountPaise: bigint;
    idempotencyKey: string;
    referenceType?: string;
    referenceId?: string;
    memo?: string;
  }): Promise<PostedTransaction> {
    assertPositiveAmount(input.amountPaise);

    // A replayed refund must not create a fresh account touch either; short-circuit
    // on the key before ensuring accounts exist.
    const existing = await this.findByKey(input.idempotencyKey);
    if (existing) return existing;

    const house = await this.ensureSystemAccount('HOUSE');
    const userAccount = await this.getOrCreateUserAccount(input.userId);

    return this.post({
      kind: 'REFUND',
      idempotencyKey: input.idempotencyKey,
      memo: input.memo,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      legs: [
        { accountId: house.id, amountPaise: -input.amountPaise },
        { accountId: userAccount.id, amountPaise: input.amountPaise },
      ],
    });
  }

  private findByKey(idempotencyKey: string): Promise<PostedTransaction | null> {
    return this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    });
  }
}

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

export { LedgerError };
