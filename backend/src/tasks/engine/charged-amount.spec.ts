import {
  chargedDisagreesWithCampaign,
  resolveChargedPaise,
} from './charged-amount';
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

/**
 * The refund gate's price signal. This replaced `match.amountOk`, which compared
 * the campaign's LISTED price against the marketplace's LISTED price while the
 * refund paid the CHARGED figure — so it fired on honest orders and was noise
 * rather than a fraud signal.
 */
describe('chargedDisagreesWithCampaign', () => {
  it('passes the live heels order that the OLD listed-vs-listed check rejected', () => {
    // Real: OD337767552058345100. Sticker ₹367, charged ₹328, campaign priced
    // honestly at ₹328. amountOk read false (|328−367| = 39 > 16.4) and every
    // release needed a confirmation tap. On the charged basis it agrees exactly.
    expect(chargedDisagreesWithCampaign(32800n, 32800n)).toBe(false);
  });

  it('fires when what was actually paid differs from the offer', () => {
    // ₹999 charged against a ₹1,299 campaign: |30000| > max(200, 6495).
    expect(chargedDisagreesWithCampaign(99900n, 129900n)).toBe(true);
    // …and symmetrically when the user paid MORE than the offer says.
    expect(chargedDisagreesWithCampaign(159900n, 129900n)).toBe(true);
  });

  it('allows a normal discount inside 5%', () => {
    // ₹1,299 campaign → tolerance 6495 paise.
    expect(chargedDisagreesWithCampaign(123405n, 129900n)).toBe(false); // exactly 5% off
    expect(chargedDisagreesWithCampaign(123404n, 129900n)).toBe(true); // one paise past
    expect(chargedDisagreesWithCampaign(129900n + 6495n, 129900n)).toBe(false);
  });

  it('uses the ₹2 floor on cheap items, where 5% would be absurdly tight', () => {
    // ₹30 campaign: 5% is 150 paise, so the 200-paise floor governs.
    expect(chargedDisagreesWithCampaign(3200n, 3000n)).toBe(false); // exactly ₹2 off
    expect(chargedDisagreesWithCampaign(3201n, 3000n)).toBe(true);
    expect(chargedDisagreesWithCampaign(2800n, 3000n)).toBe(false);
  });

  it('asserts no disagreement when there is nothing to compare', () => {
    // A missing price must not block every release. And a campaign price of 0 is
    // the zero-cap trap's sibling: read literally it would flag every order.
    expect(chargedDisagreesWithCampaign(32800n, null)).toBe(false);
    expect(chargedDisagreesWithCampaign(32800n, undefined)).toBe(false);
    expect(chargedDisagreesWithCampaign(32800n, 0n)).toBe(false);
    expect(chargedDisagreesWithCampaign(32800n, -1n)).toBe(false);
  });

  it('is exact at the boundary in both directions (integer bigint maths)', () => {
    // 10000 campaign → tolerance 500. Equal-to-tolerance passes; one past fails.
    expect(chargedDisagreesWithCampaign(9500n, 10000n)).toBe(false);
    expect(chargedDisagreesWithCampaign(9499n, 10000n)).toBe(true);
    expect(chargedDisagreesWithCampaign(10500n, 10000n)).toBe(false);
    expect(chargedDisagreesWithCampaign(10501n, 10000n)).toBe(true);
    expect(chargedDisagreesWithCampaign(0n, 10000n)).toBe(true); // a free item is not the offer
  });
});
