import { staffAmountBounds, MAX_STAFF_AMOUNT_MULTIPLE } from './staff-amount';

/**
 * WHAT A PERSON IS ALLOWED TO TYPE INTO A PAYOUT.
 *
 * Typing an amount is more dangerous than typing a count: a count is bounded by
 * what anyone could plausibly buy, while a mistyped amount is bounded by nothing
 * at all. ₹499 becomes ₹4990 with one extra keystroke and the ledger pays it.
 *
 * So the ceiling is derived from something REAL — the campaign's own price and
 * the order's own total — never a round number somebody picked. Both are upper
 * bounds for different reasons, and the tighter one wins.
 */
describe('staffAmountBounds', () => {
  it('caps at a multiple of the campaign price', () => {
    const b = staffAmountBounds({ campaignPricePaise: 50_000n, orderTotalPaise: null });
    expect(b.maxPaise).toBe(50_000n * BigInt(MAX_STAFF_AMOUNT_MULTIPLE));
    expect(b.anchor).toBe('campaign-price');
  });

  it('caps at the ORDER TOTAL when that is tighter — you cannot pay more for one item than the whole order', () => {
    const b = staffAmountBounds({ campaignPricePaise: 50_000n, orderTotalPaise: 60_000n });
    expect(b.maxPaise).toBe(60_000n);
    expect(b.anchor).toBe('order-total');
  });

  it('keeps the campaign multiple when the order total is the looser bound', () => {
    // A merged cart's total can be far above this item, so it is a weak bound
    // there — the campaign price is the one that means something.
    const b = staffAmountBounds({ campaignPricePaise: 50_000n, orderTotalPaise: 900_000n });
    expect(b.maxPaise).toBe(100_000n);
    expect(b.anchor).toBe('campaign-price');
  });

  it('falls back to the order total when the campaign has no usable price', () => {
    const b = staffAmountBounds({ campaignPricePaise: null, orderTotalPaise: 60_000n });
    expect(b.maxPaise).toBe(60_000n);
    expect(b.anchor).toBe('order-total');
    // A zero campaign price is not a price. The zero-payout-cap trap is the same
    // mistake in a neighbouring field: a real 0 read as a real limit.
    const z = staffAmountBounds({ campaignPricePaise: 0n, orderTotalPaise: 60_000n });
    expect(z.maxPaise).toBe(60_000n);
  });

  it('refuses outright when there is NOTHING real to bound it by', () => {
    // No campaign price and no order total means any figure would be accepted on
    // trust. That is not a ceiling, so there is no ceiling — and rather than
    // invent one, this says so and the caller refuses.
    const b = staffAmountBounds({ campaignPricePaise: null, orderTotalPaise: null });
    expect(b.maxPaise).toBeNull();
    expect(b.anchor).toBeNull();
  });

  it('is inclusive of its own ceiling', () => {
    const b = staffAmountBounds({ campaignPricePaise: 50_000n, orderTotalPaise: null });
    expect(b.allows(100_000n)).toBe(true);
    expect(b.allows(100_001n)).toBe(false);
    expect(b.allows(1n)).toBe(true);
    expect(b.allows(0n)).toBe(false); // zero is not a purchase
    expect(b.allows(-1n)).toBe(false);
  });

  it('allows nothing at all when there is no bound', () => {
    const b = staffAmountBounds({ campaignPricePaise: null, orderTotalPaise: null });
    expect(b.allows(1n)).toBe(false);
  });
});
