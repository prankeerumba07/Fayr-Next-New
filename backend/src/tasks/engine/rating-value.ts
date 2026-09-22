import { ratingMutability } from './rating-mutability';

/**
 * THE RATING THEY GAVE, AS A NUMBER — WHERE THE SHOP LETS US SEE ONE.
 *
 * ── WHY A NUMBER AND NOT A BOOLEAN ────────────────────────────────────────
 *
 * Fayr records `published: true`, meaning "a rating exists". On Blinkit and
 * Instamart that is PERMANENTLY TRUE once rated — the owner measured it: the
 * rating there can be edited but never deleted. So the question "is it rated?"
 * can never fail on those two shops, and a check that can never fail is a green
 * tick that means nothing.
 *
 * The number can fail. Five stars that becomes one is a real event, and it is
 * the only version of loophole 3 those shops actually permit.
 *
 * ── AND THE SHOPS THAT ALLOW IT ARE THE SHOPS THAT HIDE IT ────────────────
 *
 * Measured in src/platforms.js, by whoever wrote each reader, and the pattern is
 * the opposite of convenient:
 *
 *   ZEPTO      rating is FIXED         and the star IS readable
 *   BLINKIT    rating can be EDITED    and the star is SOMETIMES readable
 *              (platforms.js has a state of its own for the gap:
 *               "RATED_STAR_NOT_EXPOSED_ON_WEB")
 *   INSTAMART  rating can be EDITED    and the star is NEVER readable
 *              (platforms.js: "Swiggy web exposes is_rated but never the star
 *               count — it lives nowhere in the order list OR order details")
 *
 * So the two shops where a rating can move are the two where the number is
 * hardest or impossible to get. On Instamart this comparison CANNOT BE MADE, and
 * that is recorded here as a fact rather than left as a silence — see
 * CANNOT_SEE_THE_NUMBER and the `checkable` field every answer carries.
 */
export type RatingCheck =
  /** The shop shows the number and it is good enough. */
  | 'MEETS'
  /** The shop shows the number and it is BELOW what the campaign asked for. */
  | 'BELOW_WHAT_THE_CAMPAIGN_ASKED'
  /** The shop shows the number and it is LOWER than when we first saw it. */
  | 'LOWERED_SINCE_WE_LOOKED'
  /** The campaign asked for no minimum and nothing has moved. */
  | 'NOTHING_TO_CHECK'
  /** The shop never shows the number, so no comparison is possible at all. */
  | 'SHOP_NEVER_SHOWS_THE_NUMBER'
  /** The shop can show it and did not this time — unknown, never a verdict. */
  | 'NOT_SEEN_THIS_TIME';

/** Said out loud, because an absent check looks exactly like a passed one. */
export const CANNOT_SEE_THE_NUMBER =
  'This shop never shows the star count anywhere Fayr can read, so the rating '
  + 'can be seen to exist but never compared. Only that it was rated is checkable.';

/**
 * CAN THE NUMBER BE READ ON THIS SHOP AT ALL?
 *
 * INSTAMART IS THE ONLY NO, and it is a measurement rather than a policy: its
 * own reader in platforms.js sets `rating: null` and says why. Everything else
 * is assumed readable, because every other reader in that file emits a star.
 */
export function theNumberIsReadable(platform: string | null | undefined): boolean {
  if (typeof platform !== 'string' || platform === '') return false;
  return platform.trim().toUpperCase() !== 'INSTAMART';
}

/**
 * IS IT WORTH RE-READING THE NUMBER ON THIS SHOP?
 *
 * Only where the rating can still move AND the number can be seen. Zepto's is
 * fixed, so there is nothing to catch; Instamart's is invisible, so there is
 * nothing to catch it with. That leaves Blinkit, and saying so plainly is more
 * use than a check that runs everywhere and means something on one shop.
 */
export function worthComparingLater(platform: string | null | undefined): boolean {
  return theNumberIsReadable(platform) && ratingMutability(platform) === 'CAN_CHANGE';
}

export interface RatingVerdict {
  check: RatingCheck;
  /** False when the shop never shows a number — the honest blank. */
  checkable: boolean;
  /** True only for a verdict that should stop money. */
  holdsTheRefund: boolean;
  /** Plain words, for a person reading a held refund. */
  because: string;
}

/**
 * WHAT TO MAKE OF THE RATING ON THIS TASK.
 *
 * `platform`   which shop, because they differ and must not be averaged.
 * `minRating`  what the campaign asked for, or null if it asked for nothing.
 * `firstSeen`  the number when Fayr first read it, or null.
 * `now`        the number on the most recent read, or null.
 *
 * ── WHAT HOLDS MONEY AND WHAT ONLY GETS RECORDED ──────────────────────────
 *
 * A number BELOW what the campaign asked for holds the refund: the person did
 * not do the thing the offer was for, and that is true the first time it is
 * seen, not only on a re-read.
 *
 * A number that has FALLEN since we looked holds it too, on the one shop where
 * that can happen. This is loophole 3, in the only form Blinkit permits.
 *
 * AND A NUMBER NOBODY CAN SEE HOLDS NOTHING. Refusing to pay because a shop
 * keeps its own data private would punish every honest person on Instamart for
 * Swiggy's choice. It is recorded as unverifiable and the refund proceeds on the
 * evidence that does exist — which is exactly how the scheduler already treats
 * an unverified quick-commerce release.
 */
export function checkTheRating(input: {
  platform: string | null | undefined;
  minRating: number | null | undefined;
  firstSeen: number | null | undefined;
  now: number | null | undefined;
}): RatingVerdict {
  const min = typeof input.minRating === 'number' && Number.isFinite(input.minRating)
    ? input.minRating
    : null;
  const first = typeof input.firstSeen === 'number' && Number.isFinite(input.firstSeen)
    ? input.firstSeen
    : null;
  const latest = typeof input.now === 'number' && Number.isFinite(input.now)
    ? input.now
    : null;

  if (!theNumberIsReadable(input.platform)) {
    return {
      check: 'SHOP_NEVER_SHOWS_THE_NUMBER',
      checkable: false,
      holdsTheRefund: false,
      because: CANNOT_SEE_THE_NUMBER,
    };
  }

  if (latest == null && first == null) {
    return {
      check: 'NOT_SEEN_THIS_TIME',
      checkable: true,
      holdsTheRefund: false,
      because: 'The shop can show the star count but has not this time. Unknown '
        + 'is not a verdict, so nothing is concluded from it.',
    };
  }

  // The most recent number we actually have.
  const value = latest ?? first;

  if (min != null && value != null && value < min) {
    return {
      check: 'BELOW_WHAT_THE_CAMPAIGN_ASKED',
      checkable: true,
      holdsTheRefund: true,
      because: `The offer asked for at least ${min} and the rating is ${value}.`,
    };
  }

  if (first != null && latest != null && latest < first) {
    return {
      check: 'LOWERED_SINCE_WE_LOOKED',
      checkable: true,
      holdsTheRefund: true,
      because: `The rating was ${first} when Fayr read it and is ${latest} now.`,
    };
  }

  return {
    check: min == null ? 'NOTHING_TO_CHECK' : 'MEETS',
    checkable: true,
    holdsTheRefund: false,
    because: min == null
      ? 'The offer asked for no particular rating, and nothing has moved.'
      : `The offer asked for at least ${min} and the rating is ${value}.`,
  };
}
