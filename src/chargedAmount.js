// WHICH FIGURE DID THE USER ACTUALLY PAY? — device mirror.
//
// Policy, decided 2026-08-11: a refund is always based on the amount actually
// charged, never a listed/sticker price. This is a semantics-for-semantics port
// of backend/src/tasks/engine/charged-amount.ts, and exists so the screen never
// promises a number the backend would refuse (or pay differently). Keep the two
// in step — the backend is authoritative; this only decides what to DISPLAY.
//
// The short version of why min(item, total) is the rule, and why it isn't blind:
//   - Amazon's itemPaise is the item's own charged line and its total can bundle
//     unrelated products (merged carts), so total > item there.
//   - Flipkart's itemPaise is moneyDataBag.itemSellingPrice — the LISTED price.
//     Proven live: heels order carried item 36700 vs total 32800.
//   - quick-commerce emits only a total, which may cover several products.
// So: total >= item -> item; total < item -> total; and the two cases we refuse
// to guess go to staff.

/**
 * Above this a "quantity" is far more likely a misread field than a real basket,
 * and dividing by it would produce an absurdly small refund that looked legitimate.
 */
const MAX_PLAUSIBLE_QUANTITY = 100;

/** Pure, integer paise in and out. `order` is the device's task.order shape. */
export function resolveChargedPaise(order) {
  const staff = (reason) => ({ paise: null, basis: null, needsStaff: true, reason });

  // A STATED per-unit price is evidence rather than inference, so it wins — and it
  // makes the quantity irrelevant, because a refund is always for ONE unit.
  const unit = order && order.unitPricePaise != null ? order.unitPricePaise : null;
  if (unit != null) {
    if (unit <= 0) return staff('amount-unknown');
    return { paise: unit, basis: 'unit-price', needsStaff: false, reason: null };
  }

  // Otherwise we are working from a LINE figure. `itemPaise` is the historic,
  // ambiguous name for the same thing and is read as a line total — the safe
  // reading, because treating a line total as a unit price overpays.
  const line = order && order.lineTotalPaise != null
    ? order.lineTotalPaise
    : (order && order.itemPaise != null ? order.itemPaise : null);
  const total = order && order.orderTotalPaise != null ? order.orderTotalPaise : null;
  const ambiguous = !!(order && order.itemAmountAmbiguous === true);

  // Never fall back to a bare order total: on quick-commerce it can cover a whole
  // basket, so paying it would refund several products for one review.
  if (line == null) return staff('amount-unknown');

  let lineCharged;
  let basis;
  if (total == null) {
    lineCharged = line;
    basis = 'item-price-only';
  } else if (total >= line) {
    lineCharged = line;
    basis = 'item-price';
  } else if (ambiguous) {
    return staff('item-price-above-total-and-ambiguous');
  } else if (total * 2 < line) {
    // A gap this large is not a coupon: more likely several products on one total,
    // or marketplace gift-card/wallet/promo credit, which the terms make ineligible.
    return staff('amount-gap-implausible');
  } else {
    lineCharged = total;
    basis = 'order-total-lower';
  }

  // QUANTITY. NEVER ASSUME 1. A line total carries as many units as were bought,
  // so paying a percentage of it without knowing how many pays a multiple of what
  // the campaign intended. No reader captures quantity today, so this refuses far
  // more often than it pays — deliberately. Refusing costs a staff review;
  // guessing costs money.
  const quantity = order && order.quantity != null ? order.quantity : null;
  if (quantity == null) return staff('quantity-unknown');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PLAUSIBLE_QUANTITY) {
    return staff('quantity-implausible');
  }
  if (quantity === 1) {
    return { paise: lineCharged, basis, needsStaff: false, reason: null };
  }
  // More than one unit: the refund is for ONE of them, and only exact division is
  // accepted — rounding real money either way is not a silent decision.
  if (lineCharged % quantity !== 0) return staff('quantity-not-divisible');
  return {
    paise: lineCharged / quantity,
    basis: 'unit-from-line-total',
    needsStaff: false,
    reason: null,
  };
}
