// The words on the payoff screen — and nothing else.
//
// Step 16 of the demo is the moment the money moves. Until now, tapping "Release
// ₹539.10 to wallet" re-rendered the same timeline with one row flipped to done,
// and the only way to see the result was to switch tabs to Earnings by hand. This
// is the screen that moment was missing.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO: work out either figure.
//
// The design derives both, and both derivations are wrong in ways this codebase
// has already paid for once:
//
//   * the amount, as a percentage of the campaign's LISTED price floored to whole
//     rupees — which would print ₹539 where the ledger, the run-sheet and
//     TaskScreen all say ₹539.10, and would be a percentage of a price the buyer
//     may never have been charged;
//   * the basis, from the campaign's EXPECTED price — so "Paid ₹599" could name a
//     figure nobody was ever charged.
//
// Both are already decided in src/ui/refund.js, which prefers the backend's own
// answer because that is the figure the payout actually used. So this module
// receives numbers that are already resolved and chooses only WORDS. The test
// enforces that: it fails if this file so much as mentions a percentage, a cap, or
// the listed price.
//
// Pure module, no RN imports, so it runs under node (same reason as stages.js).

import { formatPaise } from '../money.js'; // explicit extension: also run under node

/** Copy from the design, verbatim. Kept here so no screen re-types it. */
const EYEBROW = 'Refund paid';
const TITLE = "You've been paid";
const CHIP = '✓ Credited to fayr Wallet';
/** The half of the sub-line that is true whatever else is missing. */
const ALWAYS_TRUE = 'Your honest review made this happen.';

/**
 * What the celebration says, or NULL when there is nothing true to celebrate.
 *
 * Two conditions, both of them refusals rather than fallbacks:
 *
 *   1. THE STATE MUST BE EXACTLY 'REFUNDED'. Every earlier state means the money
 *      has not moved, whatever the timeline shows. Matched exactly — a lowercased
 *      value is a bug somewhere upstream, not a licence to say someone was paid.
 *   2. THE AMOUNT MUST BE A RESOLVED INTEGER. `amountPaise` and `basedOnPaise`
 *      are null together on the server (one resolver, one answer), and on a
 *      staff-confirmed per-unit price the basis exists only there. With no amount
 *      there is nothing to celebrate, and "You've been paid ₹—" is worse than
 *      staying on the timeline the user was already reading.
 *
 * @param v.state         the task state, already normalised
 * @param v.refundPaise   from displayRefundPaise() — integer paise
 * @param v.basedOnPaise  from displayChargedPaise() — integer paise, or null
 * @param v.percent       the campaign's payout percent
 */
export function rewardView(v) {
  if (v == null) return null;
  if (v.state !== 'REFUNDED') return null;

  const amount = formatPaise(v.refundPaise);
  if (amount == null) return null;

  // The arithmetic half of the sub-line is DROPPED rather than guessed when
  // either input is missing. A zero percent counts as missing: "× 0% refund"
  // printed beside a real payment is a contradiction on its own screen.
  const basis = formatPaise(v.basedOnPaise);
  const hasPercent = Number.isInteger(v.percent) && v.percent > 0;
  const sub =
    basis != null && hasPercent
      ? `Paid ₹${basis} × ${v.percent}% refund. ${ALWAYS_TRUE}`
      : ALWAYS_TRUE;

  return { eyebrow: EYEBROW, title: TITLE, chip: CHIP, amount: `₹${amount}`, sub };
}
