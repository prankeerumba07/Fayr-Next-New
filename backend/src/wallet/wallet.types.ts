import type { LedgerKind } from '@prisma/client';

/**
 * A ledger integrity violation — an unbalanced transaction, a bad amount, a
 * single-leg post. These are refused before anything is written. Callers/
 * controllers decide the HTTP mapping; the global exception filter turns an
 * unmapped one into a safe 500 (these should never reach a valid caller).
 */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * One leg of a double-entry posting: a SIGNED integer-paise amount applied to
 * one account. Positive credits the account, negative debits it. All amounts are
 * `bigint` — money is never a float, never a JS `number`.
 */
export interface PostLeg {
  accountId: string;
  amountPaise: bigint;
}

/**
 * A balanced set of legs to post as one economic event. `idempotencyKey` makes
 * the post safe under retries — the same key never posts twice.
 */
export interface PostInput {
  kind: LedgerKind;
  idempotencyKey: string;
  legs: PostLeg[];
  memo?: string;
  /** What caused this posting (e.g. 'task'), and its id — for audit/trace. */
  referenceType?: string;
  referenceId?: string;
}
