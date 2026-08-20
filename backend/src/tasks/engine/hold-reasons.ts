/**
 * What a held refund SAYS to the person waiting for their money.
 *
 * The release path used to throw its internal reason at the user —
 * "Order amount is unknown, cannot compute the refund (quantity-unknown)". That is
 * an enum on the screen where someone checks whether they are getting paid.
 *
 * Two rules, the same ones the out-of-window wording follows:
 *   1. It must not read as though the app is broken. A hold is a decision.
 *   2. It must say what happens next, or say plainly that there is nothing to do.
 *
 * The machine-readable reason still goes to the log and the staff queue. This is
 * only what the human sees.
 */

const HOLD_MESSAGES: Record<string, string> = {
  'quantity-unknown':
    'We need to check this one by hand before paying it. The order does not say how '
    + 'many units you bought, and your refund is for one — so a person at Fayr will '
    + 'confirm the amount. Nothing is lost and you do not need to do anything.',
  'quantity-not-divisible':
    'We need to check this one by hand before paying it. The amount does not divide '
    + 'evenly across the units on your order, so a person at Fayr will confirm what '
    + 'to refund. Nothing is lost and you do not need to do anything.',
  'quantity-implausible':
    'We need to check this one by hand before paying it. The number of units on the '
    + 'order does not look right to us, so a person at Fayr will confirm it. Nothing '
    + 'is lost and you do not need to do anything.',
  'amount-unknown':
    'We could not read the price you paid, so a person at Fayr will confirm it before '
    + 'your refund is paid. Nothing is lost and you do not need to do anything.',
  'item-price-above-total-and-ambiguous':
    'The prices on this order do not line up, so a person at Fayr will confirm what '
    + 'you paid before your refund is paid. Nothing is lost and you do not need to do '
    + 'anything.',
  'amount-gap-implausible':
    'The prices on this order do not line up, so a person at Fayr will confirm what '
    + 'you paid before your refund is paid. Nothing is lost and you do not need to do '
    + 'anything.',
};

const FALLBACK =
  'We need to check this one by hand before paying it. A person at Fayr will look at '
  + 'it and your refund follows. Nothing is lost and you do not need to do anything.';

/** A held release, in words a first-time user can read. Never an enum. */
export function explainHold(reason: string | null | undefined): string {
  if (reason == null) return FALLBACK;
  return HOLD_MESSAGES[reason] ?? FALLBACK;
}
