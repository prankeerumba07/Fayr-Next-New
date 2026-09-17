// Timeline monotonicity — pure, so it can be tested without React Native.
//
// TaskScreen builds each stage from its OWN fact: is there an order, is there a
// delivery date, has the return window elapsed, is the refund eligible. Those
// facts are independent of each other, so they can and do disagree with the
// order the stages are drawn in. A reader takes a sequence literally — a green
// tick on step 7 is read as "steps 1-6 happened".
//
// Seen live (Instamart razor, 2026-08-08): the order was delivered on 3 March,
// so the 7-day return window had elapsed 151 days before the task was even
// claimed. `windowClosed` was true from the very first render, so the screen
// showed "Return window ✓" as done and "Refund confirmed" as the active stage —
// while the task sat at DELIVERED with no review written and a refund the
// backend would have refused to compute for want of an item price.

/**
 * The stages that form the refund's true prerequisite chain, in order.
 *
 * `tracked` (the refund amount) is deliberately absent. The item price being
 * unknown does not un-deliver the parcel, and demoting a verified delivery
 * would be the same lie pointing the other way — it is a parallel requirement,
 * not a sequential one, and it gates the refund through the `confirmed` stage's
 * own condition instead.
 */
export const GATING_STAGES = [
  'claimed',
  'order',
  'delivered',
  'review',
  'verifying',
  'window',
  'confirmed',
  'wallet',
];

/**
 * The `confirmed` stage's own verdict — extracted from TaskScreen so it can be
 * tested, since a React Native screen can't be imported under node.
 *
 * It exists because of a live failure (Flipkart heels, 2026-08-12): the stage
 * read `done` as soon as a refund became *calculable*, and Stage renders a
 * stage's action ONLY while it is 'active'. That single word hid the app's only
 * RELEASE_REFUND button, so a task sat at HOLDING showing "Refund confirmed"
 * with nothing to tap and zero rows in the ledger. Releasable is not released:
 * only a real release may tick this stage off, and that half is unchanged.
 *
 * ── AND THE BUTTON IT WAS GUARDING IS GONE, 17 SEPTEMBER 2026 ────────────
 *
 * Section A of REVIEW-FLOW-PROMPT.md, in the owner's words: "Release is an
 * operator's verb. A person does not release their own refund." The scheduler
 * does it, gated on the refund rules, and by the time anybody reads this screen
 * the decision has already been made and the money has already moved.
 *
 * SO THE CHIPS REPORT RATHER THAN OFFER. "Released" was the operator's word for
 * it and is now what a person would actually say: it is in their wallet. The
 * state machine below is untouched — what it guards is still true, and it is
 * what keeps a releasable task from reading as a paid one.
 *
 * @param {{refunded: boolean, eligible: boolean, hasAmount: boolean}} f
 *   refunded  — the refund has been released (task.state REFUNDED)
 *   eligible  — the engine's refund gate passes (HOLDING, published, window shut)
 *   hasAmount — the charged amount resolved, so there is a number to pay
 */
export function releaseStageState({ refunded, eligible, hasAmount }) {
  if (refunded) return { state: 'done', chip: { label: 'In your wallet', tone: 'ok' } };
  if (!eligible) return { state: 'pending', chip: null };
  // Eligible but no number: the engine would refuse with 'amount-unknown', so
  // say the manual step out loud rather than claiming a figure nobody has.
  if (!hasAmount) return { state: 'active', chip: { label: 'Needs staff check', tone: 'warn' } };
  // Payable, and nothing for anybody here to do about it. No chip: an 'ok' chip
  // on a refund that has not moved is the overclaim this function replaced.
  return { state: 'active', chip: null };
}

/**
 * Clamp a built stage list so no stage ever reads as further along than the
 * chain genuinely is. Walks the gating stages in order; the first one whose own
 * condition isn't met is the FRONTIER and keeps exactly what it claims (usually
 * 'active', with its action button). Every gating stage after it is forced to
 * 'pending', and loses any chip, action or auto-note that would make it look
 * current.
 *
 * Mutates and returns the same array — it runs on a list built fresh each
 * render, so there is nothing to share.
 */
export function clampMonotonic(stages, gating = GATING_STAGES) {
  let pastFrontier = false;
  for (const s of stages) {
    if (!gating.includes(s.key)) continue;
    if (pastFrontier) {
      s.state = 'pending';
      s.chip = null;
      s.action = null;
      s.auto = false;
    } else if (s.state !== 'done') {
      pastFrontier = true;
    }
  }
  return stages;
}
