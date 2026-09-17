// WHAT THE REVIEW STEP SHOWS, AND WHEN. THE DECISION ONLY — NOTHING DRAWN.
//
// ── WHY IT IS A FILE OF ITS OWN ────────────────────────────────────────────
//
// The review step is now six different screens wearing one name: shut for a day,
// the guide, a question, a wait, the same wait said better, and the question
// asked again. Which of the six somebody is looking at depends on two facts from
// the record, one note on the phone and two things that just happened — and
// every combination of those can be walked under node if the deciding is kept
// out of the drawing.
//
// Same arrangement, and the same reason, as src/foregroundRefresh.js: the
// decision is a file and the doing is a screen.
//
// PURE. No React, no fetch, no clock unless it is handed in.

/**
 * HOW LONG THE REVIEW STEP IS SHUT FOR AFTER THE PARCEL ARRIVES.
 *
 * ── THE OWNER'S OWN NUMBER, AND THE REASON HE GAVE FOR IT ─────────────────
 *
 * REVIEW-FLOW-PROMPT.md, step twelve: "The review step is LOCKED for 24 hours
 * after delivery." The step above it says what the day is for — "Write a fair
 * review after using the product" — and a review written in the minute the
 * parcel lands is not a review of using anything.
 *
 * MEASURED FROM THE DELIVERY INSTANT ON THE RECORD, which is the server's word,
 * read off the shop's own page. Never the moment the phone noticed: two phones
 * would then open the step at two different times for one parcel.
 */
export const REVIEW_OPENS_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * IS THE REVIEW STEP STILL SHUT, AND FOR HOW MUCH LONGER?
 *
 * `deliveredAt`  the delivery instant off the record, in milliseconds, or null.
 * `now`          the clock, handed in.
 *
 * ── NO DELIVERY INSTANT MEANS NOT SHUT, AND THAT IS THE SAFE DIRECTION ────
 *
 * A step shut on a clock nobody can read is a step that never opens, and the
 * person has no way to tell anybody. It cannot arise on the ordinary path — the
 * journey only reaches the review step once the record carries a delivery — so
 * this is the direction to fail in rather than a case that happens.
 */
export function reviewLock({ deliveredAt, now } = {}) {
  const at = typeof deliveredAt === 'number' && Number.isFinite(deliveredAt)
    ? deliveredAt
    : null;
  const clock = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  if (at == null) return { locked: false, opensAt: null, msLeft: 0 };
  const opensAt = at + REVIEW_OPENS_AFTER_MS;
  const msLeft = opensAt - clock;
  return { locked: msLeft > 0, opensAt, msLeft: msLeft > 0 ? msLeft : 0 };
}

/**
 * The six faces of the review step, in the order somebody meets them.
 *
 *   locked        the day since the parcel arrived is not up yet
 *   guide         it is open, and they have not gone to write one yet
 *   asking        they went and came back. "Have you posted the review?"
 *   notice        they said yes, just now. The shop takes 48 to 72 hours
 *   notice-again  a look ran and found nothing. The same thing, said knowing more
 *   asking-again  any later visit. "Review confirmation received." and the question
 */
export const REVIEW_FACES = [
  'locked', 'guide', 'asking', 'notice', 'notice-again', 'asking-again',
];

/**
 * WHICH OF THE SIX IS THIS?
 *
 * `deliveredAt`     the delivery instant off the record, or null.
 * `now`             the clock, handed in.
 * `wentToReview`    whether they have gone to write the review. OUR OWN SIDE's
 *                   record is what answers it — step fourteen asks for it there
 *                   in those words — and a note on the phone answers it too,
 *                   because our side can be a moment behind and a person who has
 *                   plainly just come back from the shop must not be shown the
 *                   screen that sends them there again.
 *
 *                   A BOOLEAN AND NOT AN INSTANT, deliberately. The note on the
 *                   phone has no instant to give, and an invented one would end
 *                   up printed on the screen as "you posted it two hours ago".
 *                   The instant is a separate thing the screen shows only when
 *                   the record really has one.
 * `told`            whether they have ever been told about the 48 to 72 hours.
 * `justAskedYes`    they tapped Yes a moment ago, on this screen.
 * `lookJustRan`     a look at their reviews has just handed back to us.
 *
 * ── THE ORDER OF THE TESTS IS THE WHOLE DESIGN ────────────────────────────
 *
 * TOLD COMES BEFORE EVERYTHING THAT FOLLOWS IT. Step nineteen, in the owner's
 * words: "the screen must NOT repeat the first-time message. It knows they have
 * already been told and already tried." So the long wait message is shown for
 * the two moments it is actually about — the moment they say yes, and the moment
 * a look comes back empty — and never as the resting state of a screen somebody
 * opens a week later.
 *
 * AND "JUST ASKED YES" BEATS "A LOOK JUST RAN", because both can be true on one
 * render and the first is the more recent thing to have happened.
 */
export function reviewStepFace({
  deliveredAt, now, wentToReview, told, justAskedYes, lookJustRan,
} = {}) {
  if (reviewLock({ deliveredAt, now }).locked) return 'locked';
  if (wentToReview !== true) return 'guide';
  if (told !== true) return 'asking';
  if (justAskedYes === true) return 'notice';
  if (lookJustRan === true) return 'notice-again';
  return 'asking-again';
}

/** Does this face offer the two answers, Yes and No? */
export function facePutsTheQuestion(face) {
  return face === 'asking' || face === 'asking-again';
}

/** Does this face say how long the shop takes? */
export function faceSaysTheWait(face) {
  return face === 'notice' || face === 'notice-again';
}
