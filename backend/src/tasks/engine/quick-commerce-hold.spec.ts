import {
  DEFAULT_RETURN_POLICY,
  QUICK_COMMERCE_HOLD_HOURS,
  SHOPS_THAT_CANNOT_BE_SENT_BACK,
  cannotBeSentBack,
  policyForWindowDays,
} from './return-policy';
import { refundEligibility, windowEnd } from './transition';
import { checkPlausibility } from './evidence-plausibility';
import { judgeFoundOrders, theDeliveryInstant } from '../order-candidates';
import { createTask } from './task-state';
import { STATES, SOURCES } from './states';
import type { EngineTask } from './task-state';

/**
 * THREE HOURS, NOT SEVEN DAYS, FOR THE THREE SHOPS THAT CANNOT BE SENT BACK TO.
 *
 * ── THE OWNER'S WORDS, 19 SEPTEMBER 2026 ────────────────────────────────────
 *
 *   "[Zepto, Blinkit, Instamart] ... once the product is delivered to the user,
 *    it cannot be sent back ... give them 2 or 3 hours of time, and then we
 *    refund the money to the user."
 *
 * ── WHAT THIS HOLDS, AND IT IS FOUR THINGS ──────────────────────────────────
 *
 *   the hold is three hours, counted from the DELIVERY the shop's page stated
 *   an operator who typed a window still wins, on every platform
 *   everything else the refund gate asks for is unchanged
 *   and the other four shops did not move by one second
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A delivered, reviewed, not-returned, confirmed task — the shape that releases. */
function readyToRelease(over: Partial<EngineTask> = {}): EngineTask {
  const task = createTask({ id: 't1', platform: 'ZEPTO', category: null });
  return {
    ...task,
    state: STATES.HOLDING,
    delivery: { at: Date.UTC(2026, 8, 20, 6, 0), source: SOURCES.ORDER_HISTORY },
    review: { published: true, publishedSource: SOURCES.ORDER_HISTORY },
    returned: false,
    orderConfirmed: true,
    ...over,
  } as EngineTask;
}

describe('the quick-commerce hold', () => {
  describe('H1 — three hours after the delivery the page stated', () => {
    it('is one constant, and it is three', () => {
      expect(QUICK_COMMERCE_HOLD_HOURS).toBe(3);
    });

    it('names exactly the three shops that deliver in minutes', () => {
      expect([...SHOPS_THAT_CANNOT_BE_SENT_BACK].sort())
        .toEqual(['BLINKIT', 'INSTAMART', 'ZEPTO']);
      for (const shop of ['ZEPTO', 'BLINKIT', 'INSTAMART']) {
        expect(cannotBeSentBack(shop)).toBe(true);
      }
      for (const shop of ['AMAZON', 'FLIPKART', 'MEESHO', 'MYNTRA', '', null, undefined, 7]) {
        expect(cannotBeSentBack(shop as string)).toBe(false);
      }
    });

    it('and does not care which case the platform reached it in', () => {
      // The engine's own createTask defaults to a lower-case name; every row out
      // of the database is upper-case. A rule about money must not turn on that.
      for (const said of ['zepto', 'Zepto', 'ZEPTO', ' zepto ']) {
        expect(cannotBeSentBack(said)).toBe(true);
      }
    });

    it('THE WINDOW ENDS THREE HOURS AFTER DELIVERY on all three, with no days set', () => {
      for (const platform of ['ZEPTO', 'BLINKIT', 'INSTAMART']) {
        const task = readyToRelease({ platform });
        const policy = policyForWindowDays(null, platform);
        const delivered = task.delivery!.at;
        expect(windowEnd(task, policy)).toBe(delivered + 3 * HOUR);
      }
    });

    it('COUNTED FROM THE DELIVERY, not from the review and not from the claim', () => {
      // Moving the delivery moves the window by exactly as much, and nothing
      // else on the task moves it at all.
      const policy = policyForWindowDays(null, 'ZEPTO');
      const early = readyToRelease();
      const later = readyToRelease({
        delivery: { at: early.delivery!.at + 5 * HOUR, source: SOURCES.ORDER_HISTORY },
      });
      expect(windowEnd(later, policy)! - windowEnd(early, policy)!).toBe(5 * HOUR);
      // A task with no delivery has no window at all, exactly as before.
      expect(windowEnd(readyToRelease({ delivery: null }), policy)).toBeNull();
    });

    it('and the other four shops did not move by one second', () => {
      for (const platform of ['AMAZON', 'FLIPKART', 'MEESHO', 'MYNTRA']) {
        const task = readyToRelease({ platform });
        const policy = policyForWindowDays(null, platform);
        // Nothing in the category table, so the operator's default of seven days.
        expect(policy.holdMs ?? null).toBeNull();
        expect(windowEnd(task, policy))
          .toBe(task.delivery!.at + DEFAULT_RETURN_POLICY.defaultDays * DAY);
      }
    });

    it('and the day table still decides a quick-commerce campaign WITH a category', () => {
      // holdMs replaces the day table only when the operator set no window. The
      // category table is untouched and still answers for everybody else.
      const policy = policyForWindowDays(null, 'ZEPTO');
      const task = readyToRelease({ category: 'electronics' });
      // The hold wins over the category, because the shop cannot be sent back to
      // whatever the product is.
      expect(windowEnd(task, policy)).toBe(task.delivery!.at + 3 * HOUR);
    });
  });

  describe('H2 — an operator who typed a window still wins', () => {
    it('AN EXPLICIT returnWindowDays BEATS THE THREE HOURS, on all three shops', () => {
      for (const platform of ['ZEPTO', 'BLINKIT', 'INSTAMART']) {
        const policy = policyForWindowDays(5, platform);
        expect(policy.holdMs ?? null).toBeNull();
        const task = readyToRelease({ platform });
        expect(windowEnd(task, policy)).toBe(task.delivery!.at + 5 * DAY);
      }
    });

    it('including a window of zero days, which is a real answer', () => {
      const policy = policyForWindowDays(0, 'ZEPTO');
      expect(policy.holdMs ?? null).toBeNull();
      const task = readyToRelease();
      expect(windowEnd(task, policy)).toBe(task.delivery!.at);
    });

    it('and the override is asked FIRST, so nothing about the shop can reach it', () => {
      // Structural: the policy an override builds carries no holdMs at all, so
      // there is nothing for windowEnd to prefer.
      for (const platform of ['ZEPTO', 'AMAZON', null, undefined]) {
        expect(policyForWindowDays(2, platform).holdMs ?? null).toBeNull();
      }
    });
  });

  describe('H3 — everything else the refund gate asks for still stands', () => {
    const policy = policyForWindowDays(null, 'ZEPTO');
    const afterTheHold = readyToRelease().delivery!.at + 3 * HOUR + 1;

    it('releases when the three hours have passed and everything else is right', () => {
      const elig = refundEligibility(readyToRelease(), afterTheHold, policy);
      expect(elig.reasons).toEqual([]);
      expect(elig.eligible).toBe(true);
    });

    it('AND NOT ONE MINUTE BEFORE', () => {
      const task = readyToRelease();
      const elig = refundEligibility(task, task.delivery!.at + 3 * HOUR - 60000, policy);
      expect(elig.eligible).toBe(false);
      expect(elig.reasons.join(' ')).toMatch(/return window ends/);
    });

    it('REVIEWED FIRST: a task that is not HOLDING is not eligible', () => {
      for (const state of [STATES.CLAIMED, STATES.PURCHASED, STATES.DELIVERED, STATES.REVIEWED]) {
        const elig = refundEligibility(readyToRelease({ state }), afterTheHold, policy);
        expect(elig.eligible).toBe(false);
        expect(elig.reasons.join(' ')).toContain('expected HOLDING');
      }
    });

    it('a review that is not publicly visible still holds it', () => {
      const elig = refundEligibility(
        readyToRelease({ review: { published: false } }), afterTheHold, policy,
      );
      expect(elig.eligible).toBe(false);
      expect(elig.reasons.join(' ')).toContain('review is not publicly visible');
    });

    it('a returned order still holds it, and an unknown return status too', () => {
      expect(refundEligibility(readyToRelease({ returned: true }), afterTheHold, policy).eligible)
        .toBe(false);
      expect(refundEligibility(readyToRelease({ returned: null }), afterTheHold, policy).eligible)
        .toBe(false);
    });

    it('AND A PAGE STATING ITS OWN RETURN WINDOW STILL WINS WHEN IT IS LATER', () => {
      // Unchanged, and it does not apply to Zepto because Zepto prints none. The
      // later of the two, always: the shop's word can only ever lengthen a hold.
      const stated = readyToRelease().delivery!.at + 5 * DAY;
      const task = readyToRelease({
        delivery: {
          at: readyToRelease().delivery!.at,
          source: SOURCES.ORDER_HISTORY,
          returnWindowEndsAt: stated,
        },
      });
      expect(windowEnd(task, policy)).toBe(stated);
      // And an EARLIER stated window cannot shorten the three hours.
      const early = readyToRelease({
        delivery: {
          at: readyToRelease().delivery!.at,
          source: SOURCES.ORDER_HISTORY,
          returnWindowEndsAt: readyToRelease().delivery!.at + 60000,
        },
      });
      expect(windowEnd(early, policy)).toBe(readyToRelease().delivery!.at + 3 * HOUR);
    });
  });
});

/**
 * ── P1: THE MORNING DELIVERY THAT USED TO BE READ AS BEING IN THE FUTURE ────
 *
 * PHASE 8B-c, 20 SEPTEMBER 2026, and this is the check the 18 September run got
 * away without. evidence-plausibility allows six hours of clock skew. A delivery
 * day turned into an instant at NOON universal is half past five in the EVENING
 * in India, so a Zepto page read before about half past eleven in the morning
 * carried a delivery hours ahead of the moment it was being read, and the whole
 * submission was refused as delivery-date-in-future. The one live run happened
 * at five to eight in the evening, which is the only reason it landed.
 *
 * THE WHOLE ROAD IS WALKED HERE, from the page's own words to the hour the
 * refund is due, because each half on its own passes while the pair is wrong.
 */
describe('a parcel that arrived this morning, read this morning', () => {
  /** India is five and a half hours ahead. 10:32 there is 05:02 universal. */
  const ARRIVED = Date.UTC(2026, 8, 20, 5, 2);
  /** They read the page eight minutes later, at 10:40 in India. */
  const READ_AT = Date.UTC(2026, 8, 20, 5, 10);

  const PAGE = [
    'Order ID', '#SOSMORNING0001',
    'Order Placed at', '20 Sep 2026, 10:24 AM',
    'Boldfit Strapless Sports Headband', '1 x \u20b9149',
    'Total \u20b9149',
    'Order Arrived at', '20 Sep 2026, 10:32 AM',
  ].join('\n');

  const [judged] = judgeFoundOrders([PAGE], {
    productName: 'Boldfit Strapless Sports Headband',
    productPricePaise: 14900n,
  });

  it('THE PAGE\u2019S OWN 10:32 AM IS THE INSTANT THAT IS CARRIED', () => {
    expect(theDeliveryInstant(judged)?.getTime()).toBe(ARRIVED);
    // Written out rather than derived: 10:32 in India minus five and a half
    // hours is 05:02 universal, on the same day.
    expect(ARRIVED).toBe(Date.UTC(2026, 8, 20, 5, 2));
  });

  it('AND IT IS ACCEPTED, read eight minutes after it arrived', () => {
    const answer = checkPlausibility(
      { delivery: { at: theDeliveryInstant(judged)!.getTime(), source: SOURCES.ORDER_HISTORY } },
      { productPricePaise: 14900n },
      READ_AT,
    );
    expect(answer.rejections).toEqual([]);
    expect(answer.ok).toBe(true);
  });

  it('WHERE THE DAY AT NOON WOULD HAVE BEEN REFUSED OUTRIGHT', () => {
    // The same page, read the same minute, with the delivery anchored where it
    // used to be. Noon universal is seven hours ahead of 05:10, and the skew
    // allowance is six.
    const answer = checkPlausibility(
      { delivery: { at: judged.deliveryDate!.getTime(), source: SOURCES.ORDER_HISTORY } },
      { productPricePaise: 14900n },
      READ_AT,
    );
    expect(answer.rejections).toContain('delivery-date-in-future');
    expect(answer.ok).toBe(false);
  });

  it('AND THE REFUND IS DUE AT 1:32 PM IN INDIA, three hours after it arrived', () => {
    const policy = policyForWindowDays(null, 'ZEPTO');
    const task = readyToRelease({
      delivery: {
        at: theDeliveryInstant(judged)!.getTime(),
        source: SOURCES.ORDER_HISTORY,
      },
    });
    // 13:32 in India is 08:02 universal, on the same day.
    expect(windowEnd(task, policy)).toBe(Date.UTC(2026, 8, 20, 8, 2));
    // Held at 1:31 pm in India, released at 1:32.
    expect(refundEligibility(task, Date.UTC(2026, 8, 20, 8, 1), policy).eligible)
      .toBe(false);
    expect(refundEligibility(task, Date.UTC(2026, 8, 20, 8, 2), policy).eligible)
      .toBe(true);
  });
});
