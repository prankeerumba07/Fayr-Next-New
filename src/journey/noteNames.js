// WHAT ONE OF THE PHONE'S OWN NOTES IS CALLED — THE RULE, BY ITSELF.
//
// ── WHY IT IS A FILE AND NOT THREE LINES IN shopVisits.js ───────────────────
//
// Because shopVisits.js cannot be opened under node. It reaches for
// expo-file-system on the first line and for the task store on the second, so
// the one decision inside it that is worth proving — WHICH CLAIM A NOTE BELONGS
// TO — could only ever be read, never run. It is here instead, where it is
// walked against a closed claim and a fresh one in the same breath.
//
// Same split as every other pair in this project: ui/shopApp.js beside
// openShop.js, shop/insideFayr.js beside ShopScreen.js, the decision on one side
// and the wiring on the other.
//
// ── THE RULE, AND THE RUN THAT WROTE IT ─────────────────────────────────────
//
// A NOTE BELONGS TO A CLAIM, NOT TO AN OFFER.
//
// MEASURED ON THE OWNER'S PHONE, 16 September 2026, 22:18. He had tested an
// offer an hour earlier and tapped "yes, I bought it", which wrote a note. That
// claim was then deleted and he claimed the same offer again. The new task was
// CLAIMED, with no order and no shop visit — and the note was still answering,
// because it had been filed under the OFFER and the offer had not changed.
//
// ui/journey.js reads these notes for exactly the steps that happen before the
// server has anything to say, and the first thing it asks is "did they say they
// bought it". So a brand new claim went straight to "show us a screenshot": no
// "before you go", no shop, no "did you buy it", and the order read never ran at
// all. It reads as a broken fetch. Nothing fetched anything; the screen that
// fetches was never reached.
//
// AND IT IS NOT ONLY A TESTING PROBLEM. Any second claim of the same offer hits
// it — a claim that ran out and was swept, an offer somebody left and came back
// to. The notes describe a PURCHASE, and when the claim they were written under
// is gone, the purchase they describe is gone with it.
//
// ── WITH NO CLAIM, THE OFFER'S OWN NAME IS USED, AND THAT IS NOT A HOLE ─────
//
// The first note of all — signing in to the shop — really can be written before
// a claim exists, and it has to be namable then. It is the one note whose
// meaning is about the SHOP rather than about a purchase, and shopVisits.js says
// in as many words that losing it costs one page and never the beginning.
//
// The direction of the leak is what makes this safe. A note written with no
// claim is looked for again with no claim; the moment a claim exists, the name
// asked for carries the claim's id and the older, shorter name cannot answer it.
// A stale note can therefore only ever fail to be found, which shows somebody a
// page they have already seen. It can never claim a purchase that did not
// happen.

/** What separates the parts of a note's name. One place, so nothing guesses it. */
export const BETWEEN = '::';

/**
 * THE NAME OF ONE NOTE.
 *
 * `campaignId` the offer. Required — an empty one has no note.
 * `taskId`     the claim, or null when there is not one yet.
 * `why`        which of the notes this is.
 *
 * Answers null for anything it cannot name, rather than a name with a hole in
 * it: a note called "undefined::buy" would be one note shared by every offer on
 * the phone, which is the failure this file exists to prevent, made worse.
 */
export function noteNameFor(campaignId, taskId, why) {
  if (typeof campaignId !== 'string' || campaignId === '') return null;
  if (typeof why !== 'string' || why === '') return null;
  const claim = typeof taskId === 'string' && taskId !== '' ? taskId : null;
  return claim === null
    ? `${campaignId}${BETWEEN}${why}`
    : `${campaignId}${BETWEEN}${claim}${BETWEEN}${why}`;
}

/**
 * DOES THIS NOTE BELONG TO THIS CLAIM?
 *
 * Not used to decide anything on a phone — the name alone does that, because a
 * note is found by its name or it is not found. It is here so the property the
 * whole file exists for can be stated as a question and asked directly of two
 * different claims, rather than inferred from two strings not matching.
 */
export function noteIsForTheClaim(name, campaignId, taskId, why) {
  const wanted = noteNameFor(campaignId, taskId, why);
  return wanted != null && name === wanted;
}
