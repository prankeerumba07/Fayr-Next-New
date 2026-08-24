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

/**
 * WHICH price the refund was worked out from, for the screen to show beside it.
 *
 * The same rule as displayRefundPaise, one level down, and it exists for the same
 * reason: the backend has already resolved this and its answer is by definition
 * the one the payout used. The device's own resolver is the fallback for the
 * moment before the first response lands — and it CANNOT always reach an answer,
 * because a staff-confirmed per-unit price is a figure only the backend has.
 *
 * @param opts.authoritativePaise `task.refund.basedOnPaise`.
 * @param opts.localPaise resolveChargedPaise(...).paise, computed on-device.
 * @returns integer paise, or null when no price can honestly be shown.
 */
export function displayChargedPaise(opts) {
  const o = opts || {};
  const authoritative = toPaise(o.authoritativePaise);
  if (authoritative != null) return authoritative;
  return toPaise(o.localPaise);
}

/**
 * WHICH price lines the order card shows, and what to call them.
 *
 * A pure helper because the alternative was four nested ternaries inside JSX that
 * no test could reach — and two of them were saying the wrong thing:
 *
 *   - a line total for three units was labelled "Item price", so the screen
 *     showed ₹1,299 where the refund was based on ₹433. One number, two routes,
 *     on the screen itself;
 *   - with no raw item line at all the card said "Couldn't read the item price —
 *     refund can't be computed", which stopped being true the moment a staff
 *     member confirmed what one unit cost. The refund WAS computed, and the
 *     screen still called it impossible.
 *
 * `basisPaise` is the figure the refund was actually worked out from, from
 * displayChargedPaise — never a raw field picked and hoped over.
 *
 * @returns {{lineLabel: string|null, linePaise: number|null,
 *   perUnitPaise: number|null, orderAmountPaise: number|null,
 *   cannotCompute: boolean}}
 */
export function orderPriceLines(opts) {
  const o = opts || {};
  const line = toPaise(o.itemPaise);
  const basis = toPaise(o.basisPaise);
  const total = toPaise(o.orderTotalPaise);
  const qty = Number.isInteger(o.quantity) && o.quantity > 0 ? o.quantity : null;

  if (line != null) {
    return {
      // Say what the number IS. A multi-unit line is not an item price.
      lineLabel: qty != null && qty > 1 ? `Price for ${qty} units` : 'Item price',
      linePaise: line,
      // Only when the refund's basis is genuinely a different number from the
      // line — otherwise the card would print the same figure twice.
      perUnitPaise: qty != null && qty > 1 && basis != null && basis !== line ? basis : null,
      orderAmountPaise: null,
      cannotCompute: false,
    };
  }
  // No raw item line. A basis can still exist — a staff-confirmed per-unit price
  // is exactly that case, and it is the whole reason this file changed.
  if (basis != null) {
    return {
      lineLabel: 'Price we refund from',
      linePaise: basis,
      perUnitPaise: null,
      orderAmountPaise: total != null && total !== basis ? total : null,
      cannotCompute: false,
    };
  }
  if (total != null) {
    return {
      lineLabel: null,
      linePaise: null,
      perUnitPaise: null,
      orderAmountPaise: total,
      cannotCompute: false,
    };
  }
  return {
    lineLabel: null,
    linePaise: null,
    perUnitPaise: null,
    orderAmountPaise: null,
    cannotCompute: true,
  };
}

/** paise as a string or number → non-negative integer paise, else null. */
function toPaise(v) {
  if (v == null) return null;
  const n = typeof v === 'string' ? (/^\d+$/.test(v) ? Number(v) : NaN) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  return n;
}
