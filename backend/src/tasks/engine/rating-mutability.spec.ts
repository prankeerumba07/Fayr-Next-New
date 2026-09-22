import { STATES } from './states';
import { policyForWindowDays } from './return-policy';
import {
  RATING_MUTABILITY,
  WRITTEN_REVIEW_IS_PRIVATE,
  ratingMutability,
  watchingTheReviewIsWorthIt,
} from './rating-mutability';
import { refundEligibility } from './transition';
import type { EngineTask } from './task-state';

/**
 * WHAT EACH SHOP LETS A PERSON DO TO A RATING THEY HAVE ALREADY GIVEN.
 *
 * ── THE OWNER'S OWN GROUND TRUTH, 22 SEPTEMBER 2026 ────────────────────────
 *
 *   "On ZEPTO, once the user gives a review and rating, they cannot edit it or
 *    remove it later. On Blinkit and Swiggy Instamart, the user can edit the
 *    review and change the rating later, but they cannot completely remove or
 *    delete it."
 *
 * This is measurement he made on the three apps, not an inference from code, and
 * it decides whether the hold's review-anchored clock is a safeguard or a delay.
 */
describe('what a shop lets somebody do to a rating', () => {
  it('ZEPTO IS FIXED: it cannot be edited and it cannot be removed', () => {
    expect(ratingMutability('ZEPTO')).toBe('FIXED');
  });

  it('BLINKIT AND INSTAMART CAN CHANGE: editable, never deletable', () => {
    expect(ratingMutability('BLINKIT')).toBe('CAN_CHANGE');
    expect(ratingMutability('INSTAMART')).toBe('CAN_CHANGE');
  });

  it('and case never decides it, because the engine and the database disagree about it', () => {
    // createTask defaults to a lower-case platform; every database row is upper.
    // A rule about somebody's money must not turn on which of the two arrived.
    for (const name of ['zepto', 'Zepto', 'ZEPTO ', ' zepto']) {
      expect(ratingMutability(name)).toBe('FIXED');
    }
  });

  it('AN UNMEASURED SHOP GETS THE MOST CAUTIOUS ANSWER, never the convenient one', () => {
    // Assuming a rating is fixed when nobody has checked would release money on
    // a promise the shop never made.
    for (const name of ['AMAZON', 'FLIPKART', 'MEESHO', 'MYNTRA', 'SOMETHING_NEW']) {
      expect(ratingMutability(name)).toBe('CAN_VANISH');
    }
    for (const junk of [null, undefined, '', '   ']) {
      expect(ratingMutability(junk as string | null | undefined)).toBe('CAN_VANISH');
    }
  });

  it('only the three the owner measured are named at all', () => {
    expect(Object.keys(RATING_MUTABILITY).sort()).toEqual(
      ['BLINKIT', 'INSTAMART', 'ZEPTO'],
    );
  });

  it('WATCHING IS WORTH IT EXACTLY WHERE THE RATING CAN STILL MOVE', () => {
    expect(watchingTheReviewIsWorthIt('ZEPTO')).toBe(false);
    expect(watchingTheReviewIsWorthIt('BLINKIT')).toBe(true);
    expect(watchingTheReviewIsWorthIt('INSTAMART')).toBe(true);
    expect(watchingTheReviewIsWorthIt('AMAZON')).toBe(true);
  });

  it('and it says out loud what it cannot check, because silence reads as a pass', () => {
    expect(WRITTEN_REVIEW_IS_PRIVATE).toMatch(/nobody/i);
    expect(WRITTEN_REVIEW_IS_PRIVATE).toMatch(/only the rating is checkable/i);
    // Not a machine name — a sentence somebody can read.
    expect(WRITTEN_REVIEW_IS_PRIVATE.split(' ').length).toBeGreaterThan(12);
  });
});

/**
 * AND WHAT IT ACTUALLY CHANGES ABOUT SOMEBODY'S MONEY.
 *
 * The point of the ground truth above is not that it is written down. It is that
 * a Zepto refund is no longer held to watch a rating that cannot move.
 */
describe('the hold that follows from it', () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = 1_790_000_000_000;
  // BUILT THE WAY THE SERVER BUILDS IT. createPolicy deliberately drops holdMs —
  // only policyForWindowDays sets it, and only for the three shops that deliver
  // in minutes. Constructing it by hand here would have tested a policy the
  // product never produces, which is how a green test proves nothing.
  const policy = (platform: string) => policyForWindowDays(null, platform, null);

  /** Delivered four hours ago; the review seen one minute ago. */
  const held = (platform: string): EngineTask => ({
    id: 't1',
    platform,
    category: null,
    target: { asin: null, reviewId: null, product: null },
    state: STATES.HOLDING,
    order: null,
    delivery: { at: NOW - 4 * HOUR, source: 'order-history' } as EngineTask['delivery'],
    review: { published: true } as EngineTask['review'],
    returned: false,
    holdStartedAt: NOW - 60 * 1000,
    orderConfirmed: true,
    blocker: null,
    blockerReason: null,
    probe: null,
    visibilityChecks: [],
    applied: {},
    history: [],
  });

  it('A ZEPTO REFUND IS NOT HELD TO WATCH A RATING THAT CANNOT MOVE', () => {
    const out = refundEligibility(held('ZEPTO'), NOW, policy('ZEPTO'));
    expect(out.reasons).toEqual([]);
    expect(out.eligible).toBe(true);
  });

  it('BUT BLINKIT AND INSTAMART ARE, because theirs can still be edited', () => {
    for (const platform of ['BLINKIT', 'INSTAMART']) {
      const out = refundEligibility(held(platform), NOW, policy(platform));
      expect(out.eligible).toBe(false);
      expect(out.reasons.join(' ')).toMatch(/watched for/);
    }
  });

  it('AND ZEPTO IS STILL HELD BY THE OTHER CLOCK, which answers a different risk', () => {
    // The owner's own Cadbury order was CANCELLED after delivery, so the
    // delivery-anchored window is real on Zepto and is untouched. Only the watch
    // on the review is skipped.
    const tooSoon = { ...held('ZEPTO'), delivery: { at: NOW - 60 * 1000, source: 'order-history' } as EngineTask['delivery'] };
    const out = refundEligibility(tooSoon, NOW, policy('ZEPTO'));
    expect(out.eligible).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/return window/);
  });
});
