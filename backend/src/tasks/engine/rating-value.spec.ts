import { policyForWindowDays } from './return-policy';
import { STATES } from './states';
import { createTask, type EngineTask } from './task-state';
import { refundEligibility, transition, type EngineEvent } from './transition';
import {
  CANNOT_SEE_THE_NUMBER,
  checkTheRating,
  theNumberIsReadable,
  worthComparingLater,
} from './rating-value';

/**
 * THE RATING AS A NUMBER, AND THE SHOPS THAT WILL NOT SHOW IT.
 *
 * ── WHY THIS EXISTS, 22 SEPTEMBER 2026 ────────────────────────────────────
 *
 * Fayr records `published: true`, meaning "a rating exists". The owner measured
 * that on Blinkit and Instamart a rating can be EDITED but never DELETED — so
 * that boolean is permanently true there and can never fail. A check that can
 * never fail is a green tick that means nothing.
 *
 * The NUMBER can fail, and five stars becoming one is the only form of loophole
 * 3 those shops permit.
 */
describe('can the number even be read', () => {
  it('INSTAMART NEVER SHOWS IT, and that is measured, not assumed', () => {
    // src/platforms.js, in its own words: "Swiggy web exposes is_rated but never
    // the star count - it lives nowhere in the order list OR order details", and
    // its reader sets `rating: null` accordingly.
    expect(theNumberIsReadable('INSTAMART')).toBe(false);
  });

  it('every other shop does', () => {
    for (const p of ['ZEPTO', 'BLINKIT', 'AMAZON', 'FLIPKART', 'MEESHO']) {
      expect(theNumberIsReadable(p)).toBe(true);
    }
  });

  it('and case never decides it', () => {
    for (const n of ['instamart', 'Instamart', ' INSTAMART ']) {
      expect(theNumberIsReadable(n)).toBe(false);
    }
  });

  it('ONLY BLINKIT IS WORTH RE-READING, and saying so beats a check that runs everywhere', () => {
    // Zepto's rating is FIXED, so there is nothing to catch.
    // Instamart's is invisible, so there is nothing to catch it with.
    expect(worthComparingLater('BLINKIT')).toBe(true);
    expect(worthComparingLater('ZEPTO')).toBe(false);
    expect(worthComparingLater('INSTAMART')).toBe(false);
  });
});

describe('what to make of the rating', () => {
  const on = (platform: string, over: Partial<Parameters<typeof checkTheRating>[0]> = {}) =>
    checkTheRating({ platform, minRating: null, firstSeen: null, now: null, ...over });

  it('A RATING BELOW WHAT THE CAMPAIGN ASKED FOR HOLDS THE REFUND', () => {
    // The campaign field minRating has existed all along and NOTHING in the task
    // engine read it. This is the first thing that does.
    const out = on('BLINKIT', { minRating: 4, now: 2 });
    expect(out.check).toBe('BELOW_WHAT_THE_CAMPAIGN_ASKED');
    expect(out.holdsTheRefund).toBe(true);
    expect(out.because).toContain('at least 4');
  });

  it('and it holds on the FIRST sighting, not only on a re-read', () => {
    // Somebody who rates 1 star has not done the thing the offer was for, and
    // that is true immediately.
    expect(on('ZEPTO', { minRating: 4, firstSeen: 1 }).holdsTheRefund).toBe(true);
  });

  it('A RATING THAT FELL SINCE WE LOOKED HOLDS IT TOO — loophole 3, as Blinkit permits it', () => {
    const out = on('BLINKIT', { minRating: null, firstSeen: 5, now: 1 });
    expect(out.check).toBe('LOWERED_SINCE_WE_LOOKED');
    expect(out.holdsTheRefund).toBe(true);
    expect(out.because).toContain('was 5');
  });

  it('but a rating that ROSE is not an offence', () => {
    expect(on('BLINKIT', { firstSeen: 3, now: 5 }).holdsTheRefund).toBe(false);
  });

  it('A NUMBER NOBODY CAN SEE HOLDS NOTHING, and says why', () => {
    // Refusing to pay because Swiggy keeps its own data private would punish
    // every honest person on Instamart for a choice that is not theirs.
    const out = on('INSTAMART', { minRating: 5, firstSeen: 5, now: 1 });
    expect(out.check).toBe('SHOP_NEVER_SHOWS_THE_NUMBER');
    expect(out.holdsTheRefund).toBe(false);
    expect(out.checkable).toBe(false);
    expect(out.because).toBe(CANNOT_SEE_THE_NUMBER);
  });

  it('AND THAT BLANK IS HONEST RATHER THAN SILENT', () => {
    // An absent check looks exactly like a check that passed. Every answer
    // carries `checkable`, so a report can tell the two apart.
    expect(on('INSTAMART').checkable).toBe(false);
    expect(on('BLINKIT').checkable).toBe(true);
    expect(CANNOT_SEE_THE_NUMBER).toMatch(/never shows the star count/);
  });

  it('UNKNOWN IS NEVER A VERDICT', () => {
    // A shop that CAN show the number and did not this time tells us nothing.
    const out = on('BLINKIT', { minRating: 4 });
    expect(out.check).toBe('NOT_SEEN_THIS_TIME');
    expect(out.holdsTheRefund).toBe(false);
  });

  it('and a campaign that asked for nothing is satisfied by anything', () => {
    const out = on('ZEPTO', { minRating: null, firstSeen: 1, now: 1 });
    expect(out.check).toBe('NOTHING_TO_CHECK');
    expect(out.holdsTheRefund).toBe(false);
  });

  it('never throws on rubbish, and never holds money because of rubbish', () => {
    for (const junk of [undefined, null, NaN, '5' as unknown as number]) {
      const out = checkTheRating({
        platform: 'BLINKIT', minRating: junk as number, firstSeen: junk as number, now: junk as number,
      });
      expect(out.holdsTheRefund).toBe(false);
    }
  });
});

/**
 * AND THE WIRING, WHICH THE PURE CHECKS ABOVE DO NOT TOUCH.
 *
 * Added after a mutation: blanking `if (rating.holdsTheRefund) reasons.push(...)`
 * in refundEligibility left every check in this file green. A rule that holds
 * money has to be walked through the thing that holds money.
 */
describe('and it actually holds the refund', () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = 1_790_000_000_000;

  const holding = (over: Partial<EngineTask> = {}): EngineTask => ({
    id: 't1',
    platform: 'BLINKIT',
    category: null,
    target: { asin: null, reviewId: null, product: null },
    state: STATES.HOLDING,
    order: null,
    delivery: { at: NOW - 8 * HOUR, source: 'order-history' } as EngineTask['delivery'],
    review: { published: true, rating: 5 } as EngineTask['review'],
    returned: false,
    holdStartedAt: NOW - 8 * HOUR,
    ratingFirstSeen: 5,
    orderConfirmed: true,
    blocker: null,
    blockerReason: null,
    probe: null,
    visibilityChecks: [],
    applied: {},
    history: [],
    ...over,
  });
  const policy = (minRating: number | null) =>
    policyForWindowDays(null, 'BLINKIT', null, minRating);

  it('A FIVE THAT BECAME A ONE STOPS THE MONEY', () => {
    const out = refundEligibility(
      holding({ review: { published: true, rating: 1 } as EngineTask['review'] }),
      NOW, policy(null),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/was 5 .* and is 1 now/);
  });

  it('AND A RATING BELOW WHAT THE OFFER ASKED FOR STOPS IT TOO', () => {
    const out = refundEligibility(
      holding({ review: { published: true, rating: 2 } as EngineTask['review'], ratingFirstSeen: 2 }),
      NOW, policy(4),
    );
    expect(out.eligible).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/at least 4/);
  });

  it('while a rating that held up pays', () => {
    expect(refundEligibility(holding(), NOW, policy(4)).eligible).toBe(true);
  });

  it('AND INSTAMART IS NEVER STOPPED BY A NUMBER NOBODY CAN SEE', () => {
    // The same shape that stops Blinkit above. Swiggy simply never shows the
    // star, so holding the money would punish an honest person for their choice.
    const out = refundEligibility(
      holding({
        platform: 'INSTAMART',
        review: { published: true, rating: 1 } as EngineTask['review'],
      }),
      NOW, policyForWindowDays(null, 'INSTAMART', null, 4),
    );
    expect(out.reasons.join(' ')).not.toMatch(/at least 4|was 5/);
  });
});

/**
 * AND THE BASELINE IS WRITTEN ONCE.
 *
 * Added after a mutation too: dropping `&& task.ratingFirstSeen == null` let the
 * baseline follow the latest reading, and nothing noticed. A baseline that moves
 * with the value it is measuring is not a baseline — somebody who can lower the
 * rating one step at a time would never trip the comparison.
 */
describe('the first number we ever saw', () => {
  const T0 = 1_790_000_000_000;
  const rated = (rating: number, at: number): EngineEvent => ({
    type: 'EVIDENCE',
    at,
    evidence: { review: { published: true, rating } },
  });

  it('IS KEPT, AND A LATER READING NEVER MOVES IT', () => {
    let t = createTask({ id: 't1', platform: 'blinkit' });
    t = transition(t, rated(5, T0)).task;
    expect(t.ratingFirstSeen).toBe(5);

    t = transition(t, rated(4, T0 + 1000)).task;
    t = transition(t, rated(1, T0 + 2000)).task;
    expect(t.review?.rating).toBe(1);
    expect(t.ratingFirstSeen).toBe(5);
  });

  it('and nothing is recorded until a number actually arrives', () => {
    let t = createTask({ id: 't2', platform: 'blinkit' });
    expect(t.ratingFirstSeen).toBeNull();
    t = transition(t, {
      type: 'EVIDENCE', at: T0, evidence: { review: { published: true } },
    }).task;
    expect(t.ratingFirstSeen).toBeNull();
  });
});
