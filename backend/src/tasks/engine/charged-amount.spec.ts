import { resolveChargedPaise } from './charged-amount';
import type { EvidenceOrder } from './evidence.types';
import { SOURCES } from './states';

/**
 * Refunds are based on the amount ACTUALLY CHARGED, never a listed price.
 * Every case below is built from a real observed record, not invented numbers.
 * Mirrors src/chargedAmount.test.mjs — keep the two in step.
 */
const order = (o: Partial<EvidenceOrder>): EvidenceOrder => ({
  id: 'ORD-1',
  source: SOURCES.ORDER_HISTORY,
  ...o,
});

describe('resolveChargedPaise', () => {
  it('pays the charged total, not the listed item price (the live Flipkart overpay)', () => {
    // Real: heels order OD337767552058345100 — itemSellingPrice 36700 against an
    // order total of 32800. The old itemPaise-only rule would have paid ₹39 over.
    const r = resolveChargedPaise(
      order({ itemPaise: 36700n, orderTotalPaise: 32800n, itemAmountAmbiguous: false }),
    );
    expect(r.paise).toBe(32800n);
    expect(r.basis).toBe('order-total-lower');
    expect(r.needsStaff).toBe(false);
  });

  it('does NOT let a merged cart drag the refund up (Amazon)', () => {
    // Real: order 408-1509645-3524313 totals 1326.00 over items 388.00 + 938.00.
    const r = resolveChargedPaise(order({ itemPaise: 38800n, orderTotalPaise: 132600n }));
    expect(r.paise).toBe(38800n);
    expect(r.basis).toBe('item-price');
  });

  it('is unchanged when the two figures agree', () => {
    const r = resolveChargedPaise(order({ itemPaise: 14300n, orderTotalPaise: 14300n }));
    expect(r.paise).toBe(14300n);
    expect(r.basis).toBe('item-price');
  });

  it('uses the item price alone when there is no total to cross-check', () => {
    const r = resolveChargedPaise(order({ itemPaise: 14300n, orderTotalPaise: null }));
    expect(r.paise).toBe(14300n);
    expect(r.basis).toBe('item-price-only');
  });

  it('never auto-pays a bare order total (quick-commerce baskets)', () => {
    // Blinkit flower pot: ₹604 total across a multi-item order, no item price.
    const r = resolveChargedPaise(
      order({ itemPaise: null, orderTotalPaise: 60400n, itemAmountAmbiguous: true }),
    );
    expect(r.paise).toBeNull();
    expect(r.needsStaff).toBe(true);
    expect(r.reason).toBe('amount-unknown');
  });

  it('sends an ambiguous item price above the total to staff, not a coin flip', () => {
    const r = resolveChargedPaise(
      order({ itemPaise: 36700n, orderTotalPaise: 32800n, itemAmountAmbiguous: true }),
    );
    expect(r.paise).toBeNull();
    expect(r.reason).toBe('item-price-above-total-and-ambiguous');
  });

  it('sends an implausible gap to staff rather than guessing', () => {
    const r = resolveChargedPaise(order({ itemPaise: 500000n, orderTotalPaise: 20000n }));
    expect(r.paise).toBeNull();
    expect(r.reason).toBe('amount-gap-implausible');
  });

  it('treats exactly 50% off as payable, and a hair past it as staff', () => {
    expect(resolveChargedPaise(order({ itemPaise: 20000n, orderTotalPaise: 10000n })).paise).toBe(10000n);
    expect(resolveChargedPaise(order({ itemPaise: 20001n, orderTotalPaise: 10000n })).paise).toBeNull();
  });

  it('never returns a figure above either input', () => {
    const cases: [bigint, bigint][] = [
      [36700n, 32800n],
      [38800n, 132600n],
      [14300n, 14300n],
      [20000n, 10000n],
    ];
    for (const [item, total] of cases) {
      const r = resolveChargedPaise(order({ itemPaise: item, orderTotalPaise: total }));
      if (r.paise != null) {
        expect(r.paise <= item).toBe(true);
        expect(r.paise <= (total > item ? item : total)).toBe(true);
      }
    }
  });

  it('degrades safely on a missing order', () => {
    expect(resolveChargedPaise(null).needsStaff).toBe(true);
    expect(resolveChargedPaise(undefined).paise).toBeNull();
    expect(resolveChargedPaise(order({})).reason).toBe('amount-unknown');
  });
});
