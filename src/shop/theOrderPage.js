// WHERE ONE ORDER'S OWN PAGE IS, FOR A SHOP INSIDE FAYR — without knowing a domain.
//
// ── WHAT THIS IS FOR: THE REVIEW STEP'S ONE TAP (PHASE 7, TASK 5) ───────────
//
// The review is written inside Fayr, and then ONE tap copies it to the
// clipboard AND opens the shop's web view on THAT ORDER'S OWN PAGE, where the
// person rates, pastes and submits. This file answers where that page is.
//
// ── AND IT STILL HOLDS NO ADDRESS, WHICH IS THE RULE FOR THIS FOLDER ───────
//
// insideFayr.js is refused by its own check if an http address ever appears in
// it, so that no second copy of a shop's domain can drift from the frozen
// platforms.js. The same rule holds here. Where a shop keeps an order's page IS
// measured — src/order/detailLook.js has Zepto's, read off the owner's own
// account — and that file is frozen, so its answer is IMPORTED by the screen and
// HANDED IN here as `shape`. This file only puts the number in the middle.
//
// ── AND IT IS A DIFFERENT LANDING FROM SHOPPING, ON PURPOSE ───────────────
//
// 6A made a SHOPPING session land on the shop's front page and never an order
// list, because somebody who came to buy must not be dropped on their own order
// history. That rule is untouched: whereToLand still drops the path for a
// shopping session. The review step is a different journey step with the
// opposite need, so it gets its own landing mode — `orderUrl` — rather than a
// loosening of that rule. theSignIn.test.mjs still asserts the shopping landing
// never carries an order path; the checks beside this file assert the order
// landing does.

/**
 * THE ADDRESS OF ONE ORDER'S OWN PAGE, or null when it cannot be built honestly.
 *
 * `shape`    how this shop names an order, from the frozen detailLook.js:
 *            `{ detail, tail }` — the page's prefix and whatever the shop's own
 *            links carry after the number.
 * `orderId`  the order's number, off the record.
 *
 * Null for a shop with no measured shape and for an empty number. Nothing is
 * guessed: a shop nobody has measured has nowhere to send anybody.
 */
export function theOrderPage(shape, orderId) {
  if (shape == null || typeof shape !== 'object') return null;
  const detail = typeof shape.detail === 'string' ? shape.detail : '';
  const tail = typeof shape.tail === 'string' ? shape.tail : '';
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (detail === '' || id === '') return null;
  // THE NUMBER GOES IN AS AN ADDRESS PART. An order id with a slash, a question
  // mark or a space in it is not an order id, and putting it in raw would let a
  // record steer the view somewhere else on the shop.
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  return `${detail}${id}${tail}`;
}
