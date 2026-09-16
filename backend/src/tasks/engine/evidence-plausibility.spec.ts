import { checkPlausibility } from './evidence-plausibility';
import type { Evidence, EvidenceOrder } from './evidence.types';
import { SOURCES } from './states';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000;
const CAMPAIGN = { productPricePaise: 32800n }; // ₹328, the real heels campaign

const ev = (e: Partial<Evidence>): Evidence => e as Evidence;
const order = (o: Partial<EvidenceOrder>): EvidenceOrder => ({
  id: 'OD-1',
  source: SOURCES.ORDER_HISTORY,
  ...o,
});

describe('checkPlausibility', () => {
  it('accepts ordinary real evidence', () => {
    const r = checkPlausibility(
      ev({
        order: order({ date: NOW - 10 * DAY, itemPaise: 36700n, orderTotalPaise: 32800n }),
        delivery: { at: NOW - 7 * DAY, source: SOURCES.ORDER_HISTORY },
        review: { published: true, reviewDate: NOW - 2 * DAY } as never,
      }),
      CAMPAIGN,
      NOW,
    );
    expect(r.ok).toBe(true);
    expect(r.rejections).toEqual([]);
  });

  it('rejects the holding-window bypass: an implausibly old delivery date', () => {
    // The attack: backdate delivery so the return window has "already elapsed"
    // and the refund releases before any VISIBILITY_CHECK can run.
    const r = checkPlausibility(
      ev({ delivery: { at: NOW - 800 * DAY, source: SOURCES.ORDER_HISTORY } }),
      CAMPAIGN,
      NOW,
    );
    expect(r.ok).toBe(false);
    expect(r.rejections).toContain('delivery-date-implausibly-old');
  });

  /**
   * THE DATE THE SHOP SAID ITS OWN RETURN WINDOW CLOSES.
   *
   * NOT A MONEY GUARD, and saying so is the point of this block. windowEnd takes
   * the LATER of this and the operator's policy table, so no value of it pays
   * anybody sooner. What is guarded against is a task nobody can ever release: a
   * hold anchored to a date years out because a page was read wrong.
   */
  describe('a stated return window that is not a return window', () => {
    it('accepts a real one, which is measured in days', () => {
      const r = checkPlausibility(
        ev({
          delivery: {
            at: NOW - 7 * DAY,
            returnWindowEndsAt: NOW + 23 * DAY,
            source: SOURCES.ORDER_HISTORY,
          },
        }),
        CAMPAIGN,
        NOW,
      );
      expect(r.rejections).not.toContain('return-window-implausibly-long');
    });

    it('REFUSES ONE A YEAR PAST THE DELIVERY, which no marketplace has', () => {
      const r = checkPlausibility(
        ev({
          delivery: {
            at: NOW - 7 * DAY,
            returnWindowEndsAt: NOW - 7 * DAY + 400 * DAY,
            source: SOURCES.ORDER_HISTORY,
          },
        }),
        CAMPAIGN,
        NOW,
      );
      expect(r.ok).toBe(false);
      expect(r.rejections).toContain('return-window-implausibly-long');
    });

    it('and a page that never stated one is not refused for it', () => {
      const r = checkPlausibility(
        ev({ delivery: { at: NOW - 7 * DAY, source: SOURCES.ORDER_HISTORY } }),
        CAMPAIGN,
        NOW,
      );
      expect(r.rejections).not.toContain('return-window-implausibly-long');
    });
  });

  it('rejects future dates for order, delivery and review', () => {
    const r = checkPlausibility(
      ev({
        order: order({ date: NOW + 30 * DAY }),
        delivery: { at: NOW + 30 * DAY, source: SOURCES.ORDER_HISTORY },
        review: { published: true, reviewDate: NOW + 30 * DAY } as never,
      }),
      CAMPAIGN,
      NOW,
    );
    expect(r.rejections).toEqual(
      expect.arrayContaining([
        'order-date-in-future',
        'delivery-date-in-future',
        'review-date-in-future',
      ]),
    );
  });

  it('tolerates timezone skew rather than rejecting real evidence', () => {
    const r = checkPlausibility(
      ev({ delivery: { at: NOW + 2 * 60 * 60 * 1000, source: SOURCES.ORDER_HISTORY } }),
      CAMPAIGN,
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects delivered-before-ordered and a review predating the order', () => {
    const r = checkPlausibility(
      ev({
        order: order({ date: NOW - 5 * DAY }),
        delivery: { at: NOW - 20 * DAY, source: SOURCES.ORDER_HISTORY },
        review: { published: true, reviewDate: NOW - 40 * DAY } as never,
      }),
      CAMPAIGN,
      NOW,
    );
    expect(r.rejections).toContain('delivered-before-ordered');
    expect(r.rejections).toContain('review-predates-order');
  });

  it('rejects nonsense amounts but allows real discounts and price drift', () => {
    // 10x over the campaign price.
    expect(
      checkPlausibility(ev({ order: order({ itemPaise: 500000n }) }), CAMPAIGN, NOW)
        .rejections,
    ).toContain('item-amount-implausible');
    // A tenth of it.
    expect(
      checkPlausibility(ev({ order: order({ itemPaise: 500n }) }), CAMPAIGN, NOW)
        .rejections,
    ).toContain('item-amount-implausible');
    // A real 12% discount must pass untouched.
    expect(
      checkPlausibility(ev({ order: order({ itemPaise: 28800n }) }), CAMPAIGN, NOW).ok,
    ).toBe(true);
    // 3x is odd but possible (campaign edited, variant priced up) — not our job.
    expect(
      checkPlausibility(ev({ order: order({ itemPaise: 98400n }) }), CAMPAIGN, NOW).ok,
    ).toBe(true);
  });

  it('refuses an ORDER SWAP once the task is anchored to a real order', () => {
    // The re-pricing attack: resubmit a different, more expensive order id.
    const r = checkPlausibility(
      ev({ order: order({ id: 'OD-DIFFERENT', itemPaise: 32800n }) }),
      CAMPAIGN,
      NOW,
      order({ id: 'OD-ORIGINAL' }),
    );
    expect(r.ok).toBe(false);
    expect(r.rejections).toContain('order-id-changed');
  });

  it('allows richer evidence about the SAME order id', () => {
    const r = checkPlausibility(
      ev({ order: order({ id: 'OD-1', itemPaise: 32800n }) }),
      CAMPAIGN,
      NOW,
      order({ id: 'OD-1' }),
    );
    expect(r.ok).toBe(true);
  });

  it('never rejects for a missing field — absent is not impossible', () => {
    expect(checkPlausibility(ev({}), CAMPAIGN, NOW).ok).toBe(true);
    expect(
      checkPlausibility(ev({ order: order({}) }), { productPricePaise: null }, NOW).ok,
    ).toBe(true);
  });

  it('rejects a negative amount even with no campaign price to compare', () => {
    const r = checkPlausibility(
      ev({ order: order({ itemPaise: -1n }) }),
      { productPricePaise: 32800n },
      NOW,
    );
    expect(r.rejections).toContain('item-amount-implausible');
  });
});
