import { toTaskResponse } from './task.response';
import { QUICK_COMMERCE_HOLD_HOURS } from './engine/return-policy';

/**
 * THE DATE A SCREEN SHOWS AND THE DATE THE MONEY WAITS FOR ARE ONE DATE.
 *
 * ── THE REHEARSAL THIS EXISTS FOR ──────────────────────────────────────────
 *
 * 21 September 2026, the owner's own Zepto order, with PRACTICE_HOLD_MINUTES=2.
 * persist() wrote windowEndsAt two minutes after delivery, the scheduler paid on
 * it, and the app said:
 *
 *   "Your refund unlocks in 2 hours. Your refund is due at 3:57 am today."
 *
 * because toTaskResponse recomputed the hold without the rehearsal argument and
 * got the product's own three hours. The money and the screen disagreed by two
 * hours and fifty-eight minutes, and the one a person could see was wrong.
 *
 * ── AND IT IS A UNIT CHECK ON PURPOSE ──────────────────────────────────────
 *
 * The rehearsal hold is switched off under NODE_ENV=test, deliberately and for
 * a reason written at PracticeWindowService.holdMsAllowed, so no end-to-end run
 * can ever exercise a shortened hold. The argument itself can be handed in here.
 */
describe('the hold a task response reports', () => {
  const DELIVERED_AT = Date.parse('2026-09-20T19:27:00.000Z');
  const HOUR = 60 * 60 * 1000;

  /** A Zepto task sitting in HOLDING with a delivery and a published review. */
  const holdingRow = {
    id: 'a1b2c3d4-0000-0000-0000-000000000001',
    platform: 'ZEPTO',
    category: null,
    targetAsin: null,
    targetReviewId: null,
    targetProduct: "Ching's Chilli Oil Crunchy",
    state: 'HOLDING',
    returned: false,
    blocker: null,
    blockerReason: null,
    orderId: 'RGTLJGSNT54558',
    itemId: null,
    itemPaise: null,
    deliveredAt: new Date(DELIVERED_AT),
    reviewPublished: true,
    windowEndsAt: null,
    claimExpiresAt: null,
    closedAt: null,
    closeReason: null,
    createdAt: new Date(DELIVERED_AT - HOUR),
    updatedAt: new Date(DELIVERED_AT),
    duplicateOrderApproved: false,
    offerTermsAcceptedAt: null,
    offerTermsText: null,
    shopHoldEndsAt: null,
    shopVisitNoticeText: null,
    wentToShopAt: null,
    wentToReviewAt: null,
    practiceWindowDays: null,
    statedReturnWindowEndsAt: null,
    watchedOrderKey: null,
    userId: 'a1b2c3d4-0000-0000-0000-0000000000ff',
    campaignId: 'a1b2c3d4-0000-0000-0000-0000000000aa',
    evidence: {
      order: { id: 'RGTLJGSNT54558', itemPaise: '19500' },
      delivery: { at: DELIVERED_AT, source: 'order-history' },
      review: { published: true, publishedSource: 'order-history', verified: true },
      orderConfirmed: true,
      probe: null,
    },
  };

  const campaign = {
    id: 'a1b2c3d4-0000-0000-0000-0000000000aa',
    platform: 'ZEPTO',
    returnWindowDays: null,
    productName: "Ching's Chilli Oil Crunchy",
    productPricePaise: BigInt(19500),
    refundPercent: 80,
  };

  const windowOf = (practiceHoldMs: number | null): number | null => {
    const said = toTaskResponse(
      holdingRow as never,
      campaign as never,
      DELIVERED_AT + 60 * 1000,
      practiceHoldMs,
    ).windowEndsAt;
    return said == null ? null : Date.parse(said);
  };

  it('is the product’s own quick-commerce hold when no rehearsal hold is handed in', () => {
    expect(windowOf(null)).toBe(DELIVERED_AT + QUICK_COMMERCE_HOLD_HOURS * HOUR);
  });

  it('AND IS THE REHEARSAL HOLD WHEN ONE IS, which is what the money waits for', () => {
    const twoMinutes = 2 * 60 * 1000;
    expect(windowOf(twoMinutes)).toBe(DELIVERED_AT + twoMinutes);
    // AND NOT THE THREE HOURS THE SCREEN USED TO SHOW.
    expect(windowOf(twoMinutes)).not.toBe(DELIVERED_AT + QUICK_COMMERCE_HOLD_HOURS * HOUR);
  });

  it('and a rehearsal hold cannot LENGTHEN anything either — it replaces the hold', () => {
    const tenMinutes = 10 * 60 * 1000;
    expect(windowOf(tenMinutes)).toBe(DELIVERED_AT + tenMinutes);
  });
});
