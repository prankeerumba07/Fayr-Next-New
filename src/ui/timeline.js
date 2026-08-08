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
