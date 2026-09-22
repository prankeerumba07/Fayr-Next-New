/**
 * CAN THE PERSON CHANGE THE RATING AFTER THEY HAVE GIVEN IT?
 *
 * ── THE OWNER'S OWN GROUND TRUTH, 22 SEPTEMBER 2026 ────────────────────────
 *
 * Measured by him on the three quick-commerce apps, and stated in his words:
 *
 *   "On ZEPTO, once the user gives a review and rating, they cannot edit it or
 *    remove it later. On Blinkit and Swiggy Instamart, the user can edit the
 *    review and change the rating later, but they cannot completely remove or
 *    delete it."
 *
 * And, separately, that the written review on all three is private — invisible
 * to other shoppers and unreadable by Fayr. See WHAT_CANNOT_BE_CHECKED below.
 *
 * ── WHY THIS DECIDES WHETHER A HOLD IS WORTH ANYTHING ─────────────────────
 *
 * CLAUDE.md names loophole 3 as "review deletion after payout" and says the
 * re-check during HOLDING is its direct countermeasure. That countermeasure is
 * only worth what the shop makes possible:
 *
 *   FIXED       the rating cannot be edited or removed. There is nothing to
 *               re-check, and a hold that watches it protects NOTHING while
 *               costing an honest person their money for the length of it.
 *               Loophole 3 is structurally absent on this shop.
 *   CAN_CHANGE  the rating can be edited but never deleted. "Is it rated?" is
 *               therefore always true and is the WRONG QUESTION. The one worth
 *               asking is whether it is still the rating they gave, so what has
 *               to be recorded and compared is the VALUE, not the presence.
 *   CAN_VANISH  the review can be removed outright, which is the case
 *               CLAUDE.md was written about and the permalink re-check answers.
 *
 * NOT A GUESS AND NOT A DEFAULT. A shop nobody has measured is CAN_VANISH — the
 * most cautious of the three — because assuming a rating is fixed when it is not
 * would release money on a promise the shop never made.
 */
export type RatingMutability = 'FIXED' | 'CAN_CHANGE' | 'CAN_VANISH';

/**
 * What each shop allows, by the name the database uses.
 *
 * Only the three the owner measured are named. Everything else falls to the
 * cautious answer, which is what the `??` in ratingMutability does.
 */
export const RATING_MUTABILITY: Readonly<Record<string, RatingMutability>> = {
  // "once the user gives a review and rating, they cannot edit it or remove it"
  ZEPTO: 'FIXED',
  // "can edit the review and change the rating later, but cannot completely
  //  remove or delete it"
  BLINKIT: 'CAN_CHANGE',
  INSTAMART: 'CAN_CHANGE',
};

/** What this shop allows. Unmeasured shops get the most cautious answer. */
export function ratingMutability(
  platform: string | null | undefined,
): RatingMutability {
  if (typeof platform !== 'string' || platform === '') return 'CAN_VANISH';
  return RATING_MUTABILITY[platform.trim().toUpperCase()] ?? 'CAN_VANISH';
}

/**
 * IS THERE ANY POINT WATCHING THE REVIEW ON THIS SHOP?
 *
 * The one question the hold's review-anchored clock should ask. False only for
 * a shop where the rating is FIXED, because watching a thing that cannot change
 * is not a safeguard — it is a delay with a safeguard's name on it, and the
 * person waiting for their own money pays for it.
 */
export function watchingTheReviewIsWorthIt(
  platform: string | null | undefined,
): boolean {
  return ratingMutability(platform) !== 'FIXED';
}

/**
 * WHAT FAYR CANNOT CHECK ON THESE SHOPS, IN WORDS, SO NOTHING PRETENDS IT CAN.
 *
 * The owner: "The review is not visible to other users, and FAYR also cannot
 * read it. Even if I open these apps myself and check a product, I cannot see
 * any public reviews."
 *
 * Kept as a sentence rather than a silence because a check that is absent looks
 * exactly like a check that passed. Anything reporting on a quick-commerce task
 * should be able to say this out loud rather than leave a reader to assume.
 */
export const WRITTEN_REVIEW_IS_PRIVATE =
  'This shop keeps the written review private, so nobody — including Fayr — can '
  + 'read it or tell whether its words changed. Only the rating is checkable.';
