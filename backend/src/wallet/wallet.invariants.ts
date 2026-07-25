import { LedgerError, type PostLeg } from './wallet.types';

/**
 * Pure ledger invariants — no database, no I/O. They are the FIRST line of
 * defense (fast, clear errors, unit-tested in isolation); the database triggers
 * added in this step are the second, independent line that holds even if a
 * future caller bypasses this service.
 */

/** Sum of all leg amounts, in paise. */
export function sumLegs(legs: PostLeg[]): bigint {
  return legs.reduce((acc, leg) => acc + leg.amountPaise, 0n);
}

/**
 * A valid double-entry posting has at least two legs, every leg is a non-zero
 * bigint, and the legs sum to exactly zero (debits == credits).
 */
export function assertBalancedLegs(legs: PostLeg[]): void {
  if (legs.length < 2) {
    throw new LedgerError(
      `double-entry requires at least 2 legs, got ${legs.length}`,
    );
  }
  for (const leg of legs) {
    if (typeof leg.amountPaise !== 'bigint') {
      throw new LedgerError('leg amount must be a bigint (integer paise)');
    }
    if (leg.amountPaise === 0n) {
      throw new LedgerError('a ledger leg cannot be zero paise');
    }
  }
  const total = sumLegs(legs);
  if (total !== 0n) {
    throw new LedgerError(
      `unbalanced transaction: legs sum to ${total} paise (must be 0)`,
    );
  }
}

/** A user-facing money amount (a refund, a withdrawal) must be a positive bigint. */
export function assertPositiveAmount(amountPaise: bigint): void {
  if (typeof amountPaise !== 'bigint') {
    throw new LedgerError('amount must be a bigint (integer paise)');
  }
  if (amountPaise <= 0n) {
    throw new LedgerError(`amount must be positive, got ${amountPaise} paise`);
  }
}
