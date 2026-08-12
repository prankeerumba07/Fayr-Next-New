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

/** Pure, integer paise in and out. `order` is the device's task.order shape. */
export function resolveChargedPaise(order) {
  const item = order && order.itemPaise != null ? order.itemPaise : null;
  const total = order && order.orderTotalPaise != null ? order.orderTotalPaise : null;
  const ambiguous = !!(order && order.itemAmountAmbiguous === true);

  const staff = (reason) => ({ paise: null, basis: null, needsStaff: true, reason });

  // Never fall back to a bare order total: on quick-commerce it can cover a
  // whole basket, so paying it would refund several products for one review.
  if (item == null) return staff('amount-unknown');

  if (total == null) {
    return { paise: item, basis: 'item-price-only', needsStaff: false, reason: null };
  }
  if (total >= item) {
    return { paise: item, basis: 'item-price', needsStaff: false, reason: null };
  }
  // The item figure exceeds what the order was charged, so it can't be the paid
  // price. Prefer the total — but only where we can justify it.
  if (ambiguous) return staff('item-price-above-total-and-ambiguous');
  // A gap this large is not a coupon: more likely several products on one total,
  // or marketplace gift-card/wallet/promo credit, which the terms make
  // ineligible outright. Under-paying is unfair and over-paying is worse, so
  // neither is guessed.
  if (total * 2 < item) return staff('amount-gap-implausible');

  return { paise: total, basis: 'order-total-lower', needsStaff: false, reason: null };
}
