// THE NUMBER ON THE SCREEN MUST BE THE NUMBER THAT GETS PAID.
//
// This exists because it was not. Two separate defects of the same shape have
// now been found on this one figure:
//
//   1. the backend computed the displayed refund from `order.itemPaise` directly
//      while the payout used the amount actually CHARGED — on the live Flipkart
//      order that is ₹367 shown against ₹328 paid;
//   2. the Task screen applied the campaign's percentage but NOT its payout cap,
//      which the backend applies as min(base, cap). On a capped campaign the
//      screen promised more than the wallet would ever receive, and on a cap of
//      zero (a real admin trap — typing 0 stores a real zero cap) it promised the
//      full percentage of an order that would pay nothing.
//
// So there is one rule here: prefer the number the BACKEND already computed.
// The local calculation is a fallback for the moment before the first authoritative
// response lands, and it must follow the backend's arithmetic exactly — percentage
// first, floored, then the cap.

import { percentOfPaise } from '../money.js';

/**
 * @param opts.authoritativePaise the backend's own refund figure
 *   (`task.refund.amountPaise`), a string of integer paise or a number. This
 *   wins whenever it exists, because it is by definition the number that would
 *   be paid.
 * @param opts.chargedPaise the amount actually charged, from resolveChargedPaise.
 *   Never a raw itemPaise.
 * @param opts.percent the campaign's payout percentage.
 * @param opts.capPaise the campaign's payout cap, or null for no cap. A cap of
 *   ZERO is a real cap and is honoured — showing ₹0.00 is truthful about what
 *   would be paid, and hiding it would put the screen back out of step with the
 *   payout, which is the whole defect this file exists to close.
 * @returns integer paise, or null when no number can honestly be shown.
 */
export function displayRefundPaise(opts) {
  const o = opts || {};
  const authoritative = toPaise(o.authoritativePaise);
  if (authoritative != null) return authoritative;

  const charged = o.chargedPaise;
  if (charged == null || !Number.isInteger(charged)) return null;
  const base = percentOfPaise(charged, o.percent);
  if (base == null) return null;
  const cap = toPaise(o.capPaise);
  return cap != null && base > cap ? cap : base;
}

/** paise as a string or number → non-negative integer paise, else null. */
function toPaise(v) {
  if (v == null) return null;
  const n = typeof v === 'string' ? (/^\d+$/.test(v) ? Number(v) : NaN) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  return n;
}
