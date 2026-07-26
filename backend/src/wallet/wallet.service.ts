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

/** One leg on a user's account, carrying its parent transaction for context. */
export type UserWalletEntry = WalletEntry & { transaction: LedgerTransaction };

/** A read-only view of a user's wallet: balance + every leg on their USER account. */
export interface UserWalletStatement {
  accountId: string | null;
  balancePaise: bigint;
  entries: UserWalletEntry[];
}

/**
 * A Prisma client that may be the shared one OR an interactive-transaction
 * client. Passing a `tx` lets a caller compose a wallet post into a LARGER
 * atomic operation (e.g. release-refund updates the task AND posts the refund in
 * one transaction). Called without one, every method behaves exactly as before.
 */
type Db = Prisma.TransactionClient;

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
  ensureSystemAccount(
    kind: SystemAccountKind,
    tx?: Db,
  ): Promise<WalletAccount> {
    const db = tx ?? this.prisma;
    const id = SYSTEM_ACCOUNT_IDS[kind];
    return db.walletAccount.upsert({
      where: { id },
      create: { id, kind, userId: null },
      update: {},
    });
  }

  /** The user's single refundable account, created on first touch. */
  getOrCreateUserAccount(userId: string, tx?: Db): Promise<WalletAccount> {
    const db = tx ?? this.prisma;
    return db.walletAccount.upsert({
      where: { userId_kind: { userId, kind: 'USER' } },
      create: { userId, kind: 'USER' },
      update: {},
    });
  }

  /** Balance of one account = SUM of its legs (0 if it has none). */
  async getBalance(accountId: string, tx?: Db): Promise<bigint> {
    const db = tx ?? this.prisma;
    const agg = await db.walletEntry.aggregate({
      where: { accountId },
      _sum: { amountPaise: true },
    });
    return agg._sum.amountPaise ?? 0n;
  }

  /** A user's refundable balance in paise (0 if they have no account yet). */
  async getUserBalance(userId: string, tx?: Db): Promise<bigint> {
    const db = tx ?? this.prisma;
    const account = await db.walletAccount.findUnique({
      where: { userId_kind: { userId, kind: 'USER' } },
    });
    return account ? this.getBalance(account.id, tx) : 0n;
  }

  /**
   * A user's wallet statement: their refundable balance plus every leg on their
   * USER account (each with its parent transaction, so the staff view can show
   * kind/memo/reference), newest first. Read-only — never posts. If the user has
   * no account yet, balance is 0 and entries are empty.
   */
  async getUserStatement(userId: string): Promise<UserWalletStatement> {
    const account = await this.prisma.walletAccount.findUnique({
      where: { userId_kind: { userId, kind: 'USER' } },
    });
    if (!account) return { accountId: null, balancePaise: 0n, entries: [] };

    const entries = await this.prisma.walletEntry.findMany({
      where: { accountId: account.id },
      include: { transaction: true },
      orderBy: { createdAt: 'desc' },
    });
    const balancePaise = entries.reduce((sum, e) => sum + e.amountPaise, 0n);
    return { accountId: account.id, balancePaise, entries };
  }

  /**
   * The core primitive: post a balanced set of legs as one transaction, atomically
   * and idempotently. A replay of the same `idempotencyKey` returns the original
   * transaction unchanged — it never posts twice.
   *
   * With a `tx`, the write joins the caller's transaction (which is expected to
   * serialize concurrent posts of the same key — e.g. via a row lock — since a
   * unique-key race would abort that whole transaction rather than recover here).
   */
  async post(input: PostInput, tx?: Db): Promise<PostedTransaction> {
    assertBalancedLegs(input.legs);
    const db = tx ?? this.prisma;

    const existing = await this.findByKey(input.idempotencyKey, db);
    if (existing) return existing;

    if (tx) {
      return this.createTransaction(input, tx);
    }

    try {
      return await this.createTransaction(input, this.prisma);
    } catch (err) {
      // A concurrent post won the idempotency-key race — return the winner rather
      // than surfacing a unique-violation. (Only reachable outside a caller's tx.)
      if (isUniqueViolation(err)) {
        const won = await this.findByKey(input.idempotencyKey, this.prisma);
        if (won) return won;
      }
      throw err;
    }
  }

  /**
   * Credit a user's refundable balance from the HOUSE account (the refund event).
   * Legs: HOUSE −amount, USER +amount → balanced. `amount` must be positive paise.
   */
  async postRefund(
    input: {
      userId: string;
      amountPaise: bigint;
      idempotencyKey: string;
      referenceType?: string;
      referenceId?: string;
      memo?: string;
    },
    tx?: Db,
  ): Promise<PostedTransaction> {
    assertPositiveAmount(input.amountPaise);
    const db = tx ?? this.prisma;

    // A replayed refund must not create a fresh account touch either; short-circuit
    // on the key before ensuring accounts exist.
    const existing = await this.findByKey(input.idempotencyKey, db);
    if (existing) return existing;

    const house = await this.ensureSystemAccount('HOUSE', tx);
    const userAccount = await this.getOrCreateUserAccount(input.userId, tx);

    return this.post(
      {
        kind: 'REFUND',
        idempotencyKey: input.idempotencyKey,
        memo: input.memo,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        legs: [
          { accountId: house.id, amountPaise: -input.amountPaise },
          { accountId: userAccount.id, amountPaise: input.amountPaise },
        ],
      },
      tx,
    );
  }

  private createTransaction(
    input: PostInput,
    db: Db,
  ): Promise<PostedTransaction> {
    return db.ledgerTransaction.create({
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
  }

  private findByKey(
    idempotencyKey: string,
    db: Db,
  ): Promise<PostedTransaction | null> {
    return db.ledgerTransaction.findUnique({
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
