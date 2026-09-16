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
 * ── AND A THIRD THING IT WAS GETTING WRONG, MEASURED ──────────────────────
 *
 * The owner's own order, 16 September 2026. One order number, two products:
 *
 *     Lukzer | Heavy-Duty Metal Garment Rack ...     ₹938.00
 *     SR 2 PES ... Bathroom Corner Shelf ...         ₹388.00
 *     Grand Total:                                 ₹1,331.00
 *
 * The offer is the garment rack. With no item line and no basis, the last branch
 * below handed the BILL back as `orderAmountPaise`, and the refund screen printed
 * "Order amount ₹1,331.00" for a product that cost ₹938.00. A figure on a refund
 * screen that is LARGER than what the product cost is the wrong direction to be
 * wrong in, and ₹1,331 is not this order's amount for anything Fayr is paying.
 *
 * `matchedPricePaise` is what the page stated for the offer's own product. It is
 * NOT a refund basis and is never used as one — see EvidenceOrder.matchedPricePaise
 * on the server — but it is the right number to SHOW, and it is preferred over
 * the bill. The bill is still shown when it differs, under its own name, so the
 * two can never be read as one figure.
 *
 * @returns {{lineLabel: string|null, linePaise: number|null,
 *   perUnitPaise: number|null, orderAmountPaise: number|null,
 *   orderAmountLabel: string|null, cannotCompute: boolean}}
 */
export function orderPriceLines(opts) {
  const o = opts || {};
  const line = toPaise(o.itemPaise);
  const basis = toPaise(o.basisPaise);
  const total = toPaise(o.orderTotalPaise);
  const matched = toPaise(o.matchedPricePaise);
  const qty = Number.isInteger(o.quantity) && o.quantity > 0 ? o.quantity : null;

  /**
   * THE BILL, SHOWN BESIDE A PRODUCT'S PRICE AND NEVER INSTEAD OF ONE.
   *
   * Only when it is really a different number from the price above it, and
   * always under the name "Order total" — never "Order amount", which is the
   * label that made ₹1,331.00 read as this order's amount.
   */
  const alsoTheBill = (shown) => (
    total != null && total !== shown
      ? { orderAmountPaise: total, orderAmountLabel: 'Order total' }
      : { orderAmountPaise: null, orderAmountLabel: null }
  );

  if (line != null) {
    return {
      // Say what the number IS. A multi-unit line is not an item price.
      lineLabel: qty != null && qty > 1 ? `Price for ${qty} units` : 'Item price',
      linePaise: line,
      // Only when the refund's basis is genuinely a different number from the
      // line — otherwise the card would print the same figure twice.
      perUnitPaise: qty != null && qty > 1 && basis != null && basis !== line ? basis : null,
      orderAmountPaise: null,
      orderAmountLabel: null,
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
      ...alsoTheBill(basis),
      cannotCompute: false,
    };
  }
  // ── NO BASIS YET, BUT THE PAGE DID SAY WHAT THIS PRODUCT COST ───────────
  //
  // BEFORE the bill and after the basis, and both halves of that are the point.
  // After the basis, because the basis is the figure the money really uses and
  // nothing should outrank it. Before the bill, because on an order holding two
  // products the bill is not this product's price and showing it as one is the
  // defect this branch exists to end.
  //
  // IT CLAIMS NOTHING ABOUT THE REFUND. The refund section says separately
  // whether the amount is settled; this only stops the screen printing somebody
  // else's bathroom shelf into the price of a garment rack.
  if (matched != null) {
    return {
      lineLabel: 'Item price',
      linePaise: matched,
      perUnitPaise: null,
      ...alsoTheBill(matched),
      cannotCompute: false,
    };
  }
  if (total != null) {
    // ── THE LAST RESORT: A BILL AND NOTHING ELSE ──────────────────────────
    //
    // Blinkit and Instamart publish a basket total and no per-item price at all,
    // so there the total really IS the only amount there is and calling it the
    // order amount is honest.
    //
    // AND SAID MORE CAREFULLY THAN IT WAS. An earlier version of this comment
    // claimed nothing else reached here. That was wrong: `matchedPricePaise` is
    // set only by the two server paths that choose an order from the shop's own
    // list, so an order read by the DEVICE'S own scraper arrives without it, and
    // one whose item line could not be read lands here too. What is true is
    // narrower and is the thing that matters — nothing reaches here while a
    // per-product figure is known, so the bill is never shown INSTEAD of a
    // product's price. It is shown when it is the only figure there is.
    return {
      lineLabel: null,
      linePaise: null,
      perUnitPaise: null,
      orderAmountPaise: total,
      orderAmountLabel: 'Order amount',
      cannotCompute: false,
    };
  }
  return {
    lineLabel: null,
    linePaise: null,
    perUnitPaise: null,
    orderAmountPaise: null,
    orderAmountLabel: null,
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
