import {
  assertBalancedLegs,
  assertPositiveAmount,
  sumLegs,
} from './wallet.invariants';
import { LedgerError, type PostLeg } from './wallet.types';

/**
 * Pure unit tests for the ledger invariants — no database. They pin the FIRST
 * line of defense; the database triggers (the second, independent line) are
 * proven against a real Postgres in test/wallet.ledger.e2e-spec.ts.
 */

const leg = (accountId: string, amountPaise: bigint): PostLeg => ({
  accountId,
  amountPaise,
});

describe('wallet invariants', () => {
  describe('sumLegs', () => {
    it('sums signed bigint legs', () => {
      expect(sumLegs([leg('a', -500n), leg('b', 500n)])).toBe(0n);
      expect(sumLegs([leg('a', -500n), leg('b', 300n), leg('c', 100n)])).toBe(
        -100n,
      );
      expect(sumLegs([])).toBe(0n);
    });
  });

  describe('assertBalancedLegs', () => {
    it('accepts a balanced two-leg posting', () => {
      expect(() =>
        assertBalancedLegs([leg('house', -50000n), leg('user', 50000n)]),
      ).not.toThrow();
    });

    it('accepts a balanced multi-leg posting', () => {
      expect(() =>
        assertBalancedLegs([
          leg('house', -50000n),
          leg('user', 30000n),
          leg('fees', 20000n),
        ]),
      ).not.toThrow();
    });

    it('rejects fewer than two legs (not double-entry)', () => {
      expect(() => assertBalancedLegs([leg('user', 0n)])).toThrow(LedgerError);
      expect(() => assertBalancedLegs([])).toThrow(/at least 2 legs/);
    });

    it('rejects a zero-paise leg', () => {
      expect(() => assertBalancedLegs([leg('a', 0n), leg('b', 0n)])).toThrow(
        /cannot be zero/,
      );
    });

    it('rejects an unbalanced posting (debits != credits)', () => {
      expect(() =>
        assertBalancedLegs([leg('house', -50000n), leg('user', 40000n)]),
      ).toThrow(/unbalanced/);
    });

    it('rejects a non-bigint amount (guards against float/number money)', () => {
      expect(() =>
        assertBalancedLegs([
          leg('a', 100 as unknown as bigint),
          leg('b', -100n),
        ]),
      ).toThrow(/must be a bigint/);
    });
  });

  describe('assertPositiveAmount', () => {
    it('accepts a positive bigint', () => {
      expect(() => assertPositiveAmount(1n)).not.toThrow();
      expect(() => assertPositiveAmount(50000n)).not.toThrow();
    });

    it('rejects zero and negatives', () => {
      expect(() => assertPositiveAmount(0n)).toThrow(/must be positive/);
      expect(() => assertPositiveAmount(-1n)).toThrow(/must be positive/);
    });

    it('rejects a non-bigint amount', () => {
      expect(() => assertPositiveAmount(100 as unknown as bigint)).toThrow(
        /must be a bigint/,
      );
    });
  });
});
