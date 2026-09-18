// WHAT THE REVIEW STEP SHOWS. THE DECISION ONLY — NOTHING DRAWN.
//
// ── WHY IT IS A FILE OF ITS OWN ────────────────────────────────────────────
//
// The review step is five different screens wearing one name: the guide, a
// question, a wait, the same wait said better, and the question asked again.
// Which of the five somebody is looking at depends on one fact from the record,
// one note on the phone and two things that just happened — and every
// combination of those can be walked under node if the deciding is kept out of
// the drawing.
//
// Same arrangement, and the same reason, as src/foregroundRefresh.js: the
// decision is a file and the doing is a screen.
//
// PURE. No React, no fetch, no clock at all.
//
// ── THERE IS NO WAITING PERIOD. REMOVED 18 SEPTEMBER 2026 ──────────────────
//
// There used to be a sixth face, 'locked', and a REVIEW_OPENS_AFTER_MS of
// twenty-four hours measured from the delivery instant. It came from
// REVIEW-FLOW-PROMPT.md step twelve and the reasoning behind it was that a
// review written in the minute the parcel lands is not a review of using
// anything.
//
// THE OWNER TOOK IT OUT, in his own words: "I don't want the review step to get
// locked for 24 hours after delivery. A user can provide a review whenever they
// want to, and for marketplaces like quick marketplaces like ZEPTO, Blinkit and
// Instamart, they can actually use it and give the review anytime they want.
// This 24-hour lock, I don't want in my app."
//
// IT IS OUT FOR EVERY SHOP AND NOT ONLY THE THREE. Zepto is what made it
// obviously wrong — a ten minute delivery behind a day-long wait — but the rule
// he stated is general.
//
// AND IT IS GONE RATHER THAN SET TO ZERO. A waiting period of nought is still a
// waiting period: it keeps a clock, a face nobody can reach, and a number
// somebody will one day put back. The gate is the parcel arriving and there is
// nothing after it.
//
// WHAT IS NOT THIS. The 48 to 72 hours a shop takes to publish a review is a
// fact about the SHOP and is untouched — see reviewsGoLiveIn in ui/journeyWords.js.
// So is the return window hold, which is about money and a different clock
// entirely.

/**
 * The five faces of the review step, in the order somebody meets them.
 *
 *   guide         they have not gone to write one yet
 *   asking        they went and came back. "Have you posted the review?"
 *   notice        they said yes, just now. The shop takes 48 to 72 hours
 *   notice-again  a look ran and found nothing. The same thing, said knowing more
 *   asking-again  any later visit. "Review confirmation received." and the question
 *
 * SIX UNTIL 18 SEPTEMBER 2026. The first was 'locked' and it is gone — see the
 * note at the top of this file for the owner's words. Everything about the five
 * below it is unchanged.
 */
export const REVIEW_FACES = [
  'guide', 'asking', 'notice', 'notice-again', 'asking-again',
];

/**
 * WHICH OF THE FIVE IS THIS?
 *
 * ── IT IS NEVER ASKED WHEN THE PARCEL ARRIVED, AND THAT IS THE POINT ──────
 *
 * It used to take `deliveredAt` and a clock, and shut the step for a day. Both
 * arguments are gone rather than ignored: an argument that is accepted and
 * unused is an invitation to start reading it again, and a screen would go on
 * passing a delivery instant as though it still mattered.
 *
 * SO A DELIVERY INSTANT WE DO NOT HAVE CANNOT LOCK ANYBODY OUT. There is no
 * longer anything here for it to be missing FROM. "We don't know when it
 * arrived" was never a reason to refuse somebody the step they came for, and now
 * it cannot become one by accident.
 *
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
  inFayrShop, wentToReview, told, justAskedYes, lookJustRan,
} = {}) {
  // ── INSIDE FAYR THERE IS NOTHING TO ASK — 18 SEPTEMBER 2026, PHASE 7 ────
  //
  // The four faces below the guide all put a question or answer one: "have you
  // posted the review?", "the shop takes 48 to 72 hours", the same again. Every
  // one of them exists because the person LEFT the app to write the review and
  // Fayr had to ask what happened while they were gone. For a shop inside Fayr
  // the review is written here, the one tap that copies it also opens the
  // order's own page here, and coming back runs the check by itself — so there
  // is nothing Fayr does not already know, and the guide is the whole step.
  if (inFayrShop === true) return 'guide';
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
