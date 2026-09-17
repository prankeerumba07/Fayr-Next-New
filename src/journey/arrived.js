// "PRODUCT DELIVERED." FOR THREE AND A HALF SECONDS, AND THEN GONE BY ITSELF.
//
// ── THE OWNER'S OWN STEP TEN, AND THE CORRECTION THAT CAME WITH IT ────────
//
// REVIEW-FLOW-PROMPT.md: "A short celebration: Product delivered. for 3 to 4
// seconds, then the next screen by itself. (He first wrote 34 seconds and
// corrected it the same evening: three to four. Nothing to ask about — build
// three to four.)"
//
// ── WHY IT IS NOT A STEP OF THE JOURNEY ───────────────────────────────────
//
// Because it is not a state anybody can be IN. Three and a half seconds after
// the parcel is known to have arrived, it is over, and nothing about the record
// changed while it was on screen. A journey step is a place the server's record
// can put somebody and leave them; this is a moment on the way past one.
//
// So it is drawn by the journey's router, over the step the record really says,
// and the note that it has been seen is a note on the phone — the same file, and
// the same reasoning, as every other "what has this person already done" note.
//
// ── THE DECIDING IS HERE AND THE DRAWING IS IN ArrivedMoment.js ───────────
//
// Two files and not one, because the decision has to run under node and the
// drawing cannot. The names differ by more than their first letter on purpose:
// this project is built on a filesystem that does not tell two files apart by
// case, and a pair called deliveredCelebration.js and DeliveredCelebration.js
// silently became ONE file here on 17 September 2026.
//
// PURE. No React, no clock unless it is handed in.

/**
 * HOW LONG IT STAYS. Three and a half seconds, in the middle of what was asked.
 *
 * NOT THREE, AND NOT FOUR. Three is the floor and four the ceiling of the range
 * the owner named, and a number written at either end of a range is a number one
 * rounding away from being outside it.
 */
export const CELEBRATION_MS = 3500;

/** The range it has to sit inside, kept here so the check reads off one place. */
export const SHORTEST_CELEBRATION_MS = 3000;
export const LONGEST_CELEBRATION_MS = 4000;

/**
 * IS THIS THE MOMENT THE PARCEL ARRIVED?
 *
 * `stepKey`      which step the record says this person is on.
 * `deliveredAt`  the delivery instant off the record, or null.
 * `alreadySeen`  whether this phone has already shown it for this claim.
 *
 * ── IT IS KEYED ON THE STEP AND NOT ON THE STATE, DELIBERATELY ────────────
 *
 * The step is what the router already has in its hand, and it is the one thing
 * that is true of "the parcel arrived and the review step is next" whichever way
 * the record got there — a read of the shop's page, a staff decision, or a
 * photograph somebody sent. A second reading of the state here would be a second
 * opinion about where somebody is.
 *
 * ── AND IT NEEDS A DELIVERY INSTANT, WHICH IS NOT BELT AND BRACES ─────────
 *
 * The review step is also where somebody sits for the whole day the step is shut
 * for, and for however long they take to write the review after that.
 * Celebrating an arrival with no arrival on the record would be a celebration
 * fired by a step rather than by an event.
 */
export function shouldCelebrateDelivery({
  stepKey, deliveredAt, alreadySeen,
} = {}) {
  if (alreadySeen === true) return false;
  if (stepKey !== 'review') return false;
  return typeof deliveredAt === 'number' && Number.isFinite(deliveredAt);
}
