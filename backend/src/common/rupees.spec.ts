import { rupeesOf } from './rupees';

/**
 * Every figure the ledger holds is integer paise; every figure a person reads is
 * rupees. This is that boundary, and it exists because a user-facing message read
 * "Minimum withdrawal is 10000 paise" — which a first-time user cannot tell from
 * ₹10,000.
 *
 * Exact bigint arithmetic throughout: money must never round through a float.
 */
describe('rupeesOf', () => {
  it('drops the paise when the amount is whole rupees', () => {
    expect(rupeesOf(10_000n)).toBe('₹100');
    expect(rupeesOf(100n)).toBe('₹1');
    expect(rupeesOf(0n)).toBe('₹0');
  });

  it('keeps both digits when there are paise', () => {
    expect(rupeesOf(123_450n)).toBe('₹1,234.50');
    expect(rupeesOf(1n)).toBe('₹0.01');
    expect(rupeesOf(99n)).toBe('₹0.99');
    expect(rupeesOf(105n)).toBe('₹1.05');
  });

  it('groups the Indian way — lakh and crore, not thousands all the way up', () => {
    expect(rupeesOf(100_000_00n)).toBe('₹1,00,000');
    expect(rupeesOf(1_00_00_000_00n)).toBe('₹1,00,00,000');
    expect(rupeesOf(1_234_500n)).toBe('₹12,345');
  });

  it('stays exact at sizes a float would corrupt', () => {
    // 2^53 paise and beyond. A Number-based formatter starts lying here; the
    // ledger is bigint precisely so it does not.
    expect(rupeesOf(9_007_199_254_740_993n)).toBe('₹9,00,71,99,25,47,409.93');
  });

  it('does not hide a negative', () => {
    // Nothing should produce one, so if a message ever shows it, it must be
    // visible rather than silently formatted away as positive.
    expect(rupeesOf(-500n)).toBe('-₹5');
  });
});
