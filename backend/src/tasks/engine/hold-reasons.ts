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

/**
 * The same holds, said to the STAFF MEMBER who has to clear them.
 *
 * A separate map on purpose. The user-facing wording above is reassurance —
 * "nothing is lost, you do not need to do anything" — which is exactly wrong in
 * front of the person whose job it is to do something. These say what is missing
 * and what to look at. They live in this file so the two cannot drift apart.
 *
 * Still plain words, never an enum: a reviewer reads these out to users on the
 * phone.
 */
const STAFF_HOLD_MESSAGES: Record<string, string> = {
  'quantity-unknown':
    'The order does not say how many units were bought, and a refund is for one '
    + 'unit. Open the order page, count the units on this product, and enter it.',
  'quantity-not-divisible':
    'The amount does not divide evenly by the unit count on file, so no per-unit '
    + 'figure can be taken from it. Check the order page and enter the real count.',
  'quantity-implausible':
    'The unit count on file cannot be right. Check the order page and enter the '
    + 'real count.',
  'amount-unknown':
    'No price could be read for this item, so there is nothing to take a '
    + 'percentage of. The unit count alone will not release this one.',
  'item-price-above-total-and-ambiguous':
    'The item price sits above the order total and the reader found more than one '
    + 'amount in the row, so neither figure can be trusted.',
  'amount-gap-implausible':
    'The item price and the order total are too far apart to be a discount — most '
    + 'likely several products share one total, or promotional credit was used.',
};

const STAFF_FALLBACK =
  'This refund is held and needs a person to decide it. The reason was not '
  + 'recognised, which is itself worth looking at.';

/** A held release, in words the reviewer clearing it can act on. */
export function explainHoldForStaff(reason: string | null | undefined): string {
  if (reason == null) return STAFF_FALLBACK;
  return STAFF_HOLD_MESSAGES[reason] ?? STAFF_FALLBACK;
}
