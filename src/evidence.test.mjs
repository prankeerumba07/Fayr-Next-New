// Proves the ORDER-FIRST flow: a purchase alone (no review yet) drives
// CLAIMED -> PURCHASED -> DELIVERED, the user confirms the fetched order, and a
// return/auth-failure/not-bought-yet each behave correctly. This is the flow
// that replaces "upload a screenshot of your order and your delivery" - the tool
// reads the order out of the marketplace's own order history instead.
//
// Pure JS (readers + transition), so it runs without the native WebView.

import {
  createTask, transition, readEvidence, readFlipkartEvidence, readMyntraEvidence,
  readMeeshoEvidence, STATES, SOURCES, DAY, BLOCKERS,
} from './taskflow.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const NOW = Date.UTC(2026, 6, 18);
const ordered = NOW - 10 * DAY;
const delivered = NOW - 7 * DAY;

// Evidence -> event, keyed the way ConnectScreen keys it.
const evEvent = (evidence, at) => ({
  type: 'EVIDENCE',
  key: `evidence:${evidence.order ? evidence.order.id : evidence.blocker || 'none'}`,
  evidence,
  at: at == null ? NOW : at,
});

// --- Synthetic payloads, shaped EXACTLY as platforms.js emits them ----------

// The WebView now matches by name+amount and emits the matched order + the
// match confidence in orderProbe (matchScore/amountOk/ambiguous). These payloads
// are shaped exactly as the scripts emit them.

// Flipkart: whole-rupee itemSellingPrice, ms-epoch dates, productName present.
const fkPaid = {
  order: {
    pid: 'ITMxyz', productName: 'boAt Airdopes 141 TWS Earbuds',
    orderId: 'OD123456789', orderDate: ordered, deliveryDate: delivered,
    itemAmount: 388, orderAmount: 1326, returned: false, returnStatus: null, statusKey: 'DELIVERED',
  },
  review: null,
  orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 4, nameAvailable: true, targetFound: true, matchScore: 1, amountOk: true, ambiguous: false, candidateCount: 1 },
};
const fkNotBought = { order: null, review: null, orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 4, nameAvailable: true, targetFound: false, matchScore: 0, candidateCount: 0 } };
const fkAuthFail = { order: null, review: null, orderProbe: { ordersFetched: false, authFailed: true } };
const fkReturned = {
  order: { pid: 'ITMret', productName: 'Some Returned Item', orderId: 'OD999', orderDate: ordered, deliveryDate: delivered, itemAmount: 500, orderAmount: 500, returned: true, returnStatus: 'RETURNED' },
  review: null, orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 2, targetFound: true, matchScore: 0.8, amountOk: true, ambiguous: false, candidateCount: 1 },
};
// A weak/amount-off match: surfaced, but flagged so the confirm screen warns.
const fkAmountOff = {
  order: { pid: 'ITMvar', productName: 'Prestige Iris 500W Mixer Grinder', orderId: 'OD777', orderDate: ordered, deliveryDate: delivered, itemAmount: 1599, orderAmount: 1599, returned: false },
  review: null, orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 3, targetFound: true, matchScore: 0.75, amountOk: false, ambiguous: false, candidateCount: 1 },
};

// Flipkart with a unit record that STATES one unit — the payable case.
const fkOneUnit = {
  order: {
    pid: 'ITMone', productName: 'boAt Airdopes 141 TWS Earbuds',
    orderId: 'OD-ONE', orderDate: ordered, deliveryDate: delivered,
    itemAmount: 388, orderAmount: 388, returned: false, statusKey: 'DELIVERED',
    quantity: 1, quantitySource: 'unit-record-stated', quantityReason: null, unitRecords: 1,
  },
  review: null,
  orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 1, nameAvailable: true, targetFound: true, matchScore: 1, amountOk: true, ambiguous: false, candidateCount: 1 },
};
// Flipkart with THREE unit records for one product. byPid keeps whichever was
// read last, so the amount itself is arbitrary — not just the count.
const fkThreeRecords = {
  order: {
    pid: 'ITMmany', productName: 'boAt Airdopes 141 TWS Earbuds',
    orderId: 'OD-MANY', orderDate: ordered, deliveryDate: delivered,
    itemAmount: 388, orderAmount: 1164, returned: false, statusKey: 'DELIVERED',
    quantity: 3, quantitySource: 'unit-records-stated', quantityReason: null, unitRecords: 3,
  },
  review: null,
  orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 1, nameAvailable: true, targetFound: true, matchScore: 1, amountOk: true, ambiguous: false, candidateCount: 1 },
};

// MEESHO. Shaped from what platforms.js actually emits (its `finish()` payload),
// NOT from a real capture — no Meesho order history has ever been captured, and
// the web login is currently blocked by an order_block experiment. Every field
// below is taken from the emitter's own source, and the reader is written to the
// same limits the emitter documents:
//   - NO amount anywhere in the payload. Not a per-item price, not even an order
//     total. So the refund cannot be computed at all and waits for a person.
//   - NO review permalink, so the ongoing public-visibility re-check cannot run.
//   - The star comes from orders.json; the review TEXT is app-only on the web,
//     so `reviewtext` is usually null even for a review that really exists.
const meeshoRated = {
  platform: 'meesho',
  source: 'orders.json',
  reviews: [{
    productname: 'Boldfit Cotton Headband for Men',
    rating: 5,
    reviewtext: 'Fits well and holds up after washing.',
    mediacount: 2,
    reviewstatus: 'RATED',
    approved: true,
    orderid: '1234567890',
    suborderid: '9876543210',
    orderdate: '12 Aug 2026',
    statusmessage: 'Delivered',
    imageurl: 'https://images.meesho.com/x.jpg',
    productid: '55512345',
    verified: true,
  }],
  ratedCount: 1, reviewsWithText: 1, reviewsWithMedia: 1, totalSubOrders: 3,
};
// The ORDINARY Meesho case on the web: rated, but the comment never came through.
const meeshoStarOnly = {
  platform: 'meesho', source: 'orders.json',
  reviews: [{
    productname: 'Boldfit Cotton Headband for Men',
    rating: 4, reviewtext: null, mediacount: null, reviewstatus: 'RATED',
    approved: true, orderid: '1234567890', suborderid: '9876543210',
    orderdate: '12 Aug 2026', statusmessage: 'Delivered',
    imageurl: null, productid: '55512345', verified: true,
  }],
  ratedCount: 1, reviewsWithText: 0, reviewsWithMedia: 0, totalSubOrders: 3,
};
// Bought, never rated: platforms.js emits only RATED sub-orders, so an unrated
// purchase arrives as an empty reviews[] with totalSubOrders > 0.
const meeshoUnrated = {
  platform: 'meesho', source: 'orders.json',
  reviews: [], ratedCount: 0, reviewsWithText: 0, reviewsWithMedia: 0, totalSubOrders: 3,
};
const meeshoNothing = {
  platform: 'meesho', source: 'orders.json',
  reviews: [], ratedCount: 0, reviewsWithText: 0, reviewsWithMedia: 0, totalSubOrders: 0,
};

// Myntra: mrp only (paid price not yet located), name present, amount not checked.
const myPaid = {
  order: {
    orderid: 'M-42', createdon: ordered, deliverydate: delivered,
    name: 'Roadster Blue Shirt', mrp: 1499, returned: false, styleid: 55123,
  },
  review: null,
  orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 6, nameAvailable: true, targetFound: true, matchScore: 1, amountOk: null, ambiguous: false, candidateCount: 1 },
};


console.log('=== Meesho: the purchase is provable, the public review is not ===');
{
  const t = { product: 'Boldfit Cotton Headband', amount: 149 };

  const withText = readMeeshoEvidence(meeshoRated, t);
  ok(withText.blocker == null, 'a rated order is not a blocker');
  ok(withText.order && withText.order.id === '1234567890', 'the order number is surfaced');
  ok(withText.order.itemPaise === null, 'NO amount: Meesho exposes no price at all, so none is invented');
  ok(withText.order.orderTotalPaise === null, 'not even an order total — unlike Blinkit');
  ok(withText.order.quantity === null, 'and no unit count either');
  ok(withText.order.product === 'Boldfit Cotton Headband for Men', 'the product name comes from the order');
  ok(withText.order.source === SOURCES.ORDER_HISTORY, 'sourced to the order history');
  ok(withText.review && withText.review.rating === 5, 'the star is carried');
  ok(withText.review.published === true,
    'a review with real TEXT is treated as the public review Meesho shows');
  ok(withText.review.permalink == null,
    'but there is no permalink, so nothing can re-check it later');
  // WHO said the review is public. On Meesho the honest answer is "nobody":
  // published:false here is an ABSENCE of information, not a finding, and the
  // difference is what decides whether a Fayr reviewer is allowed to fill it.
  ok(withText.review.publishedSource == null,
    'and nothing CHECKED a public page, so the visibility verdict is left unsourced');

  const starOnly = readMeeshoEvidence(meeshoStarOnly, t);
  ok(starOnly.review && starOnly.review.rating === 4, 'a star-only rating still carries its star');
  ok(starOnly.review.published === false,
    'star-only is NOT public proof — a star is not a review, and the refund waits');
  ok(starOnly.review.publishedSource == null,
    'unsourced too: no machine looked, which is exactly why a person is allowed to');
  ok(starOnly.reason && /star/i.test(starOnly.reason),
    'and the reason says so in words, not a code');
  ok(starOnly.order && starOnly.order.id === '1234567890',
    'the purchase is still surfaced — the order is real either way');
}

console.log('\n=== Meesho: honest misses ===');
{
  const t = { product: 'Boldfit Cotton Headband', amount: 149 };
  const unrated = readMeeshoEvidence(meeshoUnrated, t);
  ok(unrated.blocker == null && unrated.order === null,
    'bought but never rated: the task WAITS, it does not stall');
  ok(/not rated|rated/i.test(unrated.reason), 'and the reason says the order is not rated yet');

  const nothing = readMeeshoEvidence(meeshoNothing, t);
  ok(nothing.order === null, 'nothing read at all: no order');
  ok(/orders/i.test(nothing.reason), 'and the reason points at the Orders list');

  const wrongProduct = readMeeshoEvidence(meeshoRated, { product: 'Something Else Entirely' });
  ok(wrongProduct.order === null,
    "a different product does not match, so another purchase is never claimed as the campaign's");
}

console.log('\n=== Meesho: what it can and cannot advance ===');
{
  const t = { product: 'Boldfit Cotton Headband', amount: 149 };
  let task = createTask({ id: 't_me', platform: 'meesho', product: 'Boldfit Cotton Headband' });
  task = transition(task, { type: 'EVIDENCE', evidence: readMeeshoEvidence(meeshoRated, t) }).task;
  ok(task.state === STATES.PURCHASED, 'a rated Meesho order reaches PURCHASED');
  // No delivery date in the payload, so it cannot reach DELIVERED on its own.
  ok(readMeeshoEvidence(meeshoRated, t).delivery === null,
    'Meesho exposes no delivery DATE, so none is guessed from the status text');

  const starTask = transition(
    createTask({ id: 't_me2', platform: 'meesho', product: 'Boldfit Cotton Headband' }),
    { type: 'EVIDENCE', evidence: readMeeshoEvidence(meeshoStarOnly, t) },
  ).task;
  const held = transition(starTask, { type: 'START_HOLD' });
  ok(held.task.blocker === BLOCKERS.REVIEW_NOT_PUBLIC || held.rejected,
    'a star-only task cannot start the return-window hold — the payout signal is missing');
}

console.log('\n=== Meesho: routed by the dispatcher ===');
{
  const ev = readEvidence('meesho', meeshoRated, { product: 'Boldfit Cotton Headband' });
  ok(ev.order && ev.order.id === '1234567890', 'readEvidence("meesho") reaches the Meesho reader');
  ok(!/isn.t wired/.test(ev.reason || ''), 'and no longer reports Meesho as unwired');
}

console.log('=== Flipkart: HOW MANY UNITS — from a record that states its own count ===');
{
  const one = readFlipkartEvidence(fkOneUnit, { product: 'boAt Airdopes 141', amount: 388 });
  ok(one.order.quantity === 1, 'a record stating ONE unit is payable');
  ok(one.order.quantitySource === 'unit-record-stated', 'and says where the count came from');
  ok(one.order.itemAmountAmbiguous === false, 'one record, so the amount is not arbitrary');

  const many = readFlipkartEvidence(fkThreeRecords, { product: 'boAt Airdopes 141', amount: 388 });
  ok(many.order.quantity === null, 'three units does not pay automatically');
  ok(many.order.quantityObserved === 3, 'but the count is carried for the staff member');
  ok(many.order.quantityReason === 'multi-unit-amount-unclear', 'with the reason named');
  ok(many.order.itemAmountAmbiguous === true,
    'and the AMOUNT is flagged too — with three records, whichever was read last won');

  const silent = readFlipkartEvidence(fkPaid, { product: 'boAt Airdopes 141', amount: 388 });
  ok(silent.order.quantity === null, 'a payload that states no count stays unknown');
  ok(silent.order.quantityReason === 'not-stated', 'and says the records were silent');
  ok(silent.order.itemAmountAmbiguous === false,
    'a single silent record does not make the amount arbitrary — only the count unknown');
}

console.log('=== Flipkart: purchase alone advances CLAIMED -> PURCHASED, no review needed ===');
{
  const ev = readFlipkartEvidence(fkPaid, { product: 'boAt Airdopes 141', amount: 388 });
  ok(ev.blocker == null, 'no blocker on a clean order');
  ok(ev.order && ev.order.id === 'OD123456789', 'order id surfaced');
  ok(ev.order.product === 'boAt Airdopes 141 TWS Earbuds', 'product NAME from the order (matched by name, not id)');
  ok(ev.order.itemPaise === 38800, 'itemPaise = 388 rupees -> 38800 paise (item price, not order total)');
  ok(ev.order.orderTotalPaise === 132600, 'order total kept separately (132600), never used for refund');
  ok(ev.order.match && ev.order.match.score === 1 && ev.order.match.amountOk === true, 'match confidence surfaced (name+amount both confirmed)');
  ok(ev.order.source === SOURCES.ORDER_HISTORY, 'sourced to the order-history API');
  ok(ev.delivery && ev.delivery.at === delivered, 'delivery date surfaced');

  let t = createTask({ id: 't_fk', platform: 'flipkart', product: 'boAt Airdopes' });
  ok(t.state === STATES.CLAIMED, 'starts CLAIMED');
  t = transition(t, evEvent(ev)).task;
  ok(t.state === STATES.DELIVERED, 'order + delivery evidence -> jumps to DELIVERED');
  ok(t.order.id === 'OD123456789' && t.review == null, 'order recorded, still no review (order-first)');

  const conf = transition(t, { type: 'CONFIRM_ORDER', key: 'confirm', at: NOW });
  ok(conf.changed && conf.task.orderConfirmed === true, '"Yes, I bought this" confirms the fetched order');
}

console.log('\n=== Flipkart: order present but NOT delivered yet -> PURCHASED, waits for delivery ===');
{
  const noDeliv = JSON.parse(JSON.stringify(fkPaid));
  noDeliv.order.deliveryDate = null;
  const ev = readFlipkartEvidence(noDeliv, { product: 'boAt Airdopes 141', amount: 388 });
  ok(ev.delivery == null, 'no delivery evidence');
  let t = createTask({ id: 't_fk2', platform: 'flipkart' });
  t = transition(t, evEvent(ev)).task;
  ok(t.state === STATES.PURCHASED, 'stops at PURCHASED until the delivery date appears');
}

console.log('\n=== Flipkart: product not in orders yet -> stays CLAIMED, NO blocker (just waiting) ===');
{
  const ev = readFlipkartEvidence(fkNotBought, { product: 'boAt Airdopes 141', amount: 388 });
  ok(ev.blocker == null && ev.order == null, 'not a failure - no order, no blocker');
  ok(/isn't in your Flipkart orders yet/.test(ev.reason), 'reason says waiting for the purchase');
  let t = createTask({ id: 't_fk3', platform: 'flipkart' });
  t = transition(t, evEvent(ev)).task;
  ok(t.state === STATES.CLAIMED, 'task stays CLAIMED, unblocked');
}

console.log('\n=== Flipkart: order API auth failure -> RECONNECT blocker (needs a human) ===');
{
  const ev = readFlipkartEvidence(fkAuthFail, {});
  ok(ev.blocker === 'reconnect_account', 'auth failure -> reconnect, not "no orders"');
}

console.log('\n=== Flipkart: returned order carries returned=true through the flow ===');
{
  const ev = readFlipkartEvidence(fkReturned, { product: 'Some Returned Item' });
  ok(ev.returned === true, 'returned flag surfaced');
  let t = createTask({ id: 't_fk4', platform: 'flipkart' });
  t = transition(t, evEvent(ev)).task;
  ok(t.returned === true, 'task records the return (refund gate will block on it)');
}

console.log('\n=== Flipkart: amount-off match is surfaced but FLAGGED for the confirm screen ===');
{
  const ev = readFlipkartEvidence(fkAmountOff, { product: 'Prestige Iris 750W Mixer Grinder', amount: 2499 });
  ok(ev.order && ev.order.id === 'OD777', 'candidate still surfaced (name matched)');
  ok(ev.order.match.amountOk === false, 'amountOk=false -> "is this your order?" must warn the price differs');
  // It still advances to a candidate state; the human confirm gate is what
  // stops a wrong-priced order from proceeding, not a silent auto-reject.
  let t = createTask({ id: 't_off', platform: 'flipkart' });
  t = transition(t, evEvent(ev)).task;
  ok(t.order.match.amountOk === false, 'the flag persists on the task for the UI to render');
}

console.log('\n=== Myntra: purchase advances the flow; paid price honestly withheld ===');
{
  const ev = readMyntraEvidence(myPaid, { product: 'Roadster Blue Shirt' });
  ok(ev.blocker == null && ev.order.id === 'M-42', 'order surfaced');
  ok(ev.order.itemPaise === null, 'itemPaise NULL - Myntra paid price not located yet (no over-refund)');
  ok(ev.order.mrpPaise === 149900, 'mrp kept as reference (149900), flagged mrp_only_needs_capture');
  ok(ev.order.amountSource === 'mrp_only_needs_capture', 'amountSource states the gap explicitly');
  ok(ev.order.product === 'Roadster Blue Shirt', 'product name from the order');
  let t = createTask({ id: 't_my', platform: 'myntra' });
  t = transition(t, evEvent(ev)).task;
  ok(t.state === STATES.DELIVERED, 'purchase + delivery -> DELIVERED (works despite unknown price)');
}

console.log('\n=== Dispatcher: readEvidence routes by platform ===');
{
  ok(readEvidence('flipkart', fkPaid, { product: 'boAt Airdopes 141' }).order.id === 'OD123456789', 'flipkart -> readFlipkartEvidence');
  ok(readEvidence('myntra', myPaid, { product: 'Roadster Blue Shirt' }).order.id === 'M-42', 'myntra -> readMyntraEvidence');
  ok(readEvidence('meesho', {}, {}).order == null, 'unwired platform -> honest null, no crash');
}

// --- Quick-commerce (Zepto/Blinkit/Instamart): flat reviews[], each entry
//     carries the order facts; the campaign product is matched by name+amount
//     on-device (readQuickCommerceEvidence, via readEvidence). Shaped exactly as
//     the platforms.js scripts emit them (epoch-ms dates, rupee amounts).
const zeptoPayload = {
  source: 'captured',
  reviews: [
    { productname: 'Amul Gold Milk 500 ml', rating: 5, orderdate: ordered, deliverydate: delivered,
      orderid: 'ZEP-1001', returned: false, returnstatus: 'DELIVERED', statuscode: 'DELIVERED',
      orderrated: true, imageurl: 'https://cdn.zeptonow.com/x/milk.png', amount: 604.5 },
    { productname: 'Lays Chips', rating: null, orderdate: ordered, deliverydate: delivered,
      orderid: 'ZEP-1002', returned: false, statuscode: 'DELIVERED', orderrated: false, imageurl: null, amount: 40 },
  ],
};
const blinkitPayload = {
  source: 'captured-layout',
  reviews: [
    { productname: 'Amul Butter 500 g', rating: null, orderdate: ordered, deliverydate: delivered,
      orderid: 'BLK-77', returned: false, statuscode: 'DELIVERED', orderrated: true,
      imageurl: 'https://cdn.grofers.com/product/butter.jpg', amount: 275 },
  ],
};
const instamartPayload = {
  source: 'captured-mapi',
  reviews: [
    // NOTE: no `amount` and no image - Instamart web exposes neither.
    { productname: 'Maggi 2-Minute Noodles', rating: null, orderdate: ordered, deliverydate: delivered,
      orderid: 'SW-55', returned: false, statuscode: 'DELIVERED', orderrated: true, imageurl: null },
  ],
};

console.log('\n=== Zepto: rated order matched by name+amount -> DELIVERED, image/amount/status surfaced ===');
{
  const ev = readEvidence('zepto', zeptoPayload, { product: 'Amul Gold Milk', amount: 604.5 });
  ok(ev.blocker == null && ev.order && ev.order.id === 'ZEP-1001', 'matched the right order by name (not the Lays entry)');
  ok(ev.order.itemPaise === null, 'itemPaise null - no per-item price on quick-commerce web (no over-refund)');
  ok(ev.order.orderTotalPaise === 60450, 'order total 604.5 -> 60450 paise (fractional rupees handled via string)');
  ok(ev.order.image === 'https://cdn.zeptonow.com/x/milk.png', 'product image surfaced');
  ok(ev.order.statusText === 'DELIVERED', 'order status surfaced');
  ok(ev.order.match && ev.order.match.amountOk === true, 'amount corroborated the name match');
  ok(ev.order.source === SOURCES.ORDER_HISTORY, 'sourced to the order-history API');
  ok(ev.review && ev.review.published === true, 'rated order -> the review signal these platforms expose');
  ok(ev.review.publishedSource === SOURCES.ORDER_HISTORY,
    'sourced to the order record that stated it, so no staff check is ever needed here');
  ok(ev.delivery && ev.delivery.at === delivered, 'delivery date surfaced');
  let t = createTask({ id: 't_zep', platform: 'zepto' });
  t = transition(t, evEvent(ev)).task;
  ok(t.state === STATES.DELIVERED, 'purchase + delivery -> DELIVERED (order-first, no screenshot)');
}

console.log('\n=== Blinkit: order total shown as the order amount; rated -> published ===');
{
  const ev = readEvidence('blinkit', blinkitPayload, { product: 'Amul Butter', amount: 275 });
  ok(ev.order.id === 'BLK-77', 'matched the Blinkit order');
  ok(ev.order.orderTotalPaise === 27500, 'order amount 275 -> 27500 paise');
  ok(ev.order.image === 'https://cdn.grofers.com/product/butter.jpg', 'blinkit product image surfaced');
  ok(ev.review && ev.review.published === true, 'rated order -> published');
  ok(ev.review.publishedSource === SOURCES.ORDER_HISTORY, 'and sourced to the order record');
}

console.log('\n=== Instamart: advances even though web exposes no amount or image (honest nulls) ===');
{
  const ev = readEvidence('instamart', instamartPayload, { product: 'Maggi Noodles' });
  ok(ev.order.id === 'SW-55', 'matched the Instamart order by name');
  ok(ev.order.orderTotalPaise === null && ev.order.amountSource === null, 'no amount exposed -> honest null, not a fake 0');
  ok(ev.order.image === null, 'no image exposed -> honest null');
  let t = createTask({ id: 't_ins', platform: 'instamart' });
  t = transition(t, evEvent(ev)).task;
  ok(t.state === STATES.DELIVERED, 'still advances to DELIVERED on order + delivery');
}

console.log('\n=== Quick-commerce: product not in captured orders -> waiting, no blocker ===');
{
  const ev = readEvidence('zepto', { source: 'captured', reviews: [{ productname: 'Something Else', orderid: 'ZEP-9', orderdate: ordered, amount: 100 }] }, { product: 'Amul Gold Milk', amount: 604.5 });
  ok(ev.blocker == null && ev.order == null, 'no match -> no blocker (still just waiting for the purchase)');
  ok(/isn't in your Zepto orders yet/.test(ev.reason), 'reason: not in your orders yet');
}

console.log('\n=== Quick-commerce: nothing captured at all -> could not read, still no hard blocker ===');
{
  const ev = readEvidence('blinkit', { source: 'captured-layout', reviews: [] }, { product: 'Amul Butter' });
  ok(ev.blocker == null && ev.order == null, 'no orders captured -> no blocker');
  ok(/Couldn't read your Blinkit orders/.test(ev.reason), "reason: couldn't read the orders");
}

console.log('\n=== Dispatcher: quick-commerce platforms are routed ===');
{
  ok(readEvidence('zepto', zeptoPayload, { product: 'Amul Gold Milk' }).order.id === 'ZEP-1001', 'zepto -> quick-commerce reader');
  ok(readEvidence('blinkit', blinkitPayload, { product: 'Amul Butter' }).order.id === 'BLK-77', 'blinkit -> quick-commerce reader');
  ok(readEvidence('instamart', instamartPayload, { product: 'Maggi Noodles' }).order.id === 'SW-55', 'instamart -> quick-commerce reader');
}

console.log('\n=== Idempotency: re-fetching the same order is a no-op, not a second advance ===');
{
  const ev = readFlipkartEvidence(fkPaid, { product: 'boAt Airdopes 141', amount: 388 });
  let t = createTask({ id: 't_fk5', platform: 'flipkart' });
  const r1 = transition(t, evEvent(ev));
  const r2 = transition(r1.task, evEvent(ev)); // same key
  ok(r1.changed === true && r2.changed === false, 'second identical evidence event ignored');
}

// ---------------------------------------------------------------------------
// AMAZON MISS PROBE. Four different causes all produced the identical record
// ("No matching review found", probe:null) and cost four sessions of guesswork.
// The probe has to tell them apart from the record alone.
{
  console.log('\n=== Amazon miss probe: WHY nothing matched ===');
  const target = { product: 'Lukzer Heavy-Duty Metal Garment Rack', asin: null };

  // 1. The real 2026-08-12 failure: no campaign ASIN, so platforms.js failed
  //    CLOSED and returned zero reviews before any name was scored.
  const noTarget = readEvidence('amazon', {
    error: 'no_campaign_target', reviews: [], count: 0,
  }, target);
  ok(noTarget.probe != null, 'a miss now carries a probe instead of null');
  ok(noTarget.probe.fetchError === 'no_campaign_target', 'the fail-closed signal survives to the backend');
  ok(noTarget.probe.targetAsinSet === false, 'records that no campaign ASIN was set');
  ok(noTarget.probe.reviewsSeen === 0, 'zero reviews seen');
  ok(noTarget.probe.bestScore === 0, 'no scoring happened at all');
  ok(noTarget.order === null && noTarget.review === null, 'still an honest miss, no invented data');

  // 2. Reviews came back, but their permalinks yielded no product title, so
  //    productScore had nothing to compare and every score is 0.
  const noNames = readEvidence('amazon', {
    reviews: [{ reviewid: 'R1' }, { reviewid: 'R2' }], count: 2,
  }, target);
  ok(noNames.probe.reviewsSeen === 2, 'two reviews seen');
  ok(noNames.probe.namesResolved === 0, 'but no product names resolved');
  ok(noNames.probe.bestScore === 0, 'so the best score is 0, not a near miss');
  ok(noNames.probe.fetchError === null, 'and it is NOT the fail-closed case');

  // 3. A genuine name mismatch — the ONLY case where editing the campaign
  //    productName can help. Distinguishable by a non-zero best score.
  const mismatch = readEvidence('amazon', {
    reviews: [{ reviewid: 'R1', name: 'Lukzer Metal Shoe Rack 5 Layer' }], count: 1,
  }, target);
  ok(mismatch.probe.namesResolved === 1, 'the name WAS resolved');
  ok(mismatch.probe.bestScore > 0 && mismatch.probe.bestScore < 0.6,
    `best score ${mismatch.probe.bestScore} is a near miss, under the 0.6 bar`);
  ok(mismatch.probe.bestCandidate === 'Lukzer Metal Shoe Rack 5 Layer', 'names the losing candidate');
  ok(mismatch.probe.nameThreshold === 0.6, 'states the bar it was judged against');

  // The probe must not become the privacy leak it was added to explain.
  const keys = Object.keys(noNames.probe).sort().join(',');
  ok(!/reviewtext|reviewText|orderid|orderId/i.test(keys), 'probe carries no review text and no order ids');

  // 4. PRE-filter counts. This is the distinction the 2026-08-12 Nike failure
  //    could not make: reviewsSeen was 0 either way, because it counts the list
  //    AFTER the on-device ASIN filter has already emptied it.
  const asinAteThem = readEvidence('amazon', {
    reviewsFound: 9, asinOnlyCount: 0, nameFallbackUsed: false, reviews: [], count: 0,
  }, { product: 'Nike PROMINA', asin: 'B0F16FQFZY' });
  ok(asinAteThem.probe.reviewsFound === 9, 'reviewsFound shows 9 reviews WERE read');
  ok(asinAteThem.probe.asinOnlyCount === 0, 'and that the exact-ASIN filter kept none of them');
  ok(asinAteThem.probe.reviewsSeen === 0, 'while reviewsSeen (post-filter) is still 0');
  ok(asinAteThem.probe.targetAsinSet === true, 'with the ASIN definitely set');

  // A genuinely empty account reads differently now, which is the whole point.
  const trulyEmpty = readEvidence('amazon', {
    reviewsFound: 0, asinOnlyCount: 0, reviews: [], count: 0,
  }, { product: 'Nike PROMINA', asin: 'B0F16FQFZY' });
  ok(trulyEmpty.probe.reviewsFound === 0, 'an empty reviews page reports reviewsFound 0');
  ok(asinAteThem.probe.reviewsFound !== trulyEmpty.probe.reviewsFound,
    'the two failures are now DISTINGUISHABLE from the record alone');

  // And the fallback firing is recorded, so a name-matched pass is never mistaken
  // for an exact-ASIN pass.
  const viaName = readEvidence('amazon', {
    reviewsFound: 9, asinOnlyCount: 0, nameFallbackUsed: true, count: 1,
    reviews: [{ reviewid: 'R1', name: 'Nike PROMINA Extra Wide Training Shoes', asin: 'B0VARIANT9', published: true }],
  }, { product: 'Nike PROMINA Extra Wide Training Shoes, Black/White', asin: 'B0F16FQFZY' });
  ok(viaName.review != null, 'a variant-ASIN review is now matched by NAME');
  ok(viaName.review.asin === 'B0VARIANT9', 'and it keeps the real variant ASIN it was found under');
  ok(viaName.review.published === true, 'published survives the fallback path');
  ok(viaName.review.publishedSource === SOURCES.REVIEW_PUBLIC,
    'and it is sourced to the public-review read that produced it — a machine, not a person');
}

// ---------------------------------------------------------------------------
// A DUPLICATE still refreshes diagnostics. Without this, a probe could only ever
// land on a key's FIRST use — so a task that had already recorded one miss was
// permanently undiagnosable, which is exactly what happened to the Nike task.
{
  console.log('\n=== duplicate evidence: no state change, but fresh diagnostics ===');
  let t = createTask({ id: 't_dup', platform: 'amazon', product: 'Nike PROMINA' });
  const key = 'evidence:none:nonames';
  const first = transition(t, {
    type: 'EVIDENCE', key,
    evidence: { reason: 'No matching review found for this task.', probe: { reviewsSeen: 12, namesResolved: 0 } },
  });
  t = first.task;
  ok(first.changed === true, 'first miss applies');

  const dup = transition(t, {
    type: 'EVIDENCE', key,
    evidence: { reason: 'No matching review found for this task.', probe: { reviewsSeen: 14, namesResolved: 0 } },
  });
  ok(dup.changed === false, 'a repeat is still a no-op for STATE');
  ok(/duplicate event ignored/.test(dup.reason), 'and still reports itself as a duplicate');
  ok(dup.diagnostics != null, 'but it now carries diagnostics out');
  ok(dup.diagnostics.probe.reviewsSeen === 14, 'with the NEWEST probe, not the stale one');
  ok(dup.diagnostics.blockerReason === 'No matching review found for this task.', 'and the reason');
  ok('blocker' in dup.diagnostics, 'and the BLOCKER moves with it — a stale blocker beside a fresh reason self-contradicts');
  ok(dup.diagnostics.blocker === null, 'a non-blocking miss clears any earlier blocker rather than leaving it');
  ok(dup.task.state === first.task.state, 'state genuinely untouched');

  // Non-evidence duplicates must NOT invent diagnostics.
  const dupAction = transition(t, { type: 'MARK_REVIEWED', key });
  ok(dupAction.diagnostics === undefined, 'a duplicate ACTION carries no diagnostics');
}

// ---------------------------------------------------------------------------
// ORDER-CARD CONSISTENCY across platforms. TaskScreen renders Order ID, order
// date, an amount, a product photo and a status line. Order ID and date must be
// present for EVERY platform that finds an order; the amount label legitimately
// differs by what each marketplace exposes; image/statusText were rendered but
// never populated outside quick-commerce.
{
  console.log('\n=== order card: ID + date everywhere, image/status now filled ===');

  const az = readEvidence('amazon', {
    reviewsFound: 1, asinOnlyCount: 1, count: 1,
    reviews: [{
      reviewid: 'R1', name: 'Nike Mens Promina Extra Wide Training Shoes',
      asin: 'B0F16X1NQ7', published: true, orderid: '408-1509645-3524313',
      orderdate: '2 June 2026', deliverydate: '8 June', itemamount: '938.00',
      orderamount: '1326.00', imageurl: 'https://m.media-amazon.com/i/abc.jpg',
      returnstatus: null,
      // Required by the Gap-1 check: without ordersource === 'order-details' the
      // reader reports order_unreadable rather than emitting nulls as data.
      ordersource: SOURCES.ORDER_DETAILS,
    }],
  }, { product: 'Nike PROMINA Extra Wide Training Shoes', asin: 'B0F16FQFZY' });
  ok(az.order != null && az.order.id === '408-1509645-3524313', 'amazon: order ID present');
  ok(az.order.date != null, 'amazon: order date present');
  ok(az.order.image === 'https://m.media-amazon.com/i/abc.jpg',
    'amazon: product photo now mapped (was silently discarded)');

  const fk = readFlipkartEvidence({
    order: {
      orderId: 'OD337767552058345100', orderDate: 1780820241075, deliveryDate: 1781064787000,
      itemAmount: 367, orderAmount: 328, productName: 'MODRIXFASHION Women Heels',
      returned: false, returnStatus: null, statusKey: 'DELIVERED',
    },
    orderProbe: { ordersFetched: true },
  }, { product: 'Modrix Fashion Women Heels' });
  ok(fk.order.id === 'OD337767552058345100', 'flipkart: order ID present');
  ok(fk.order.date != null, 'flipkart: order date present');
  ok(fk.order.statusText === 'DELIVERED',
    'flipkart: status line now mapped from statusKey (was unread)');
  ok(fk.order.image == null, 'flipkart: no thumbnail exists -> honestly absent, not faked');

  // Quick-commerce was always the one that populated these; it must not regress.
  // NB: the quick-commerce reader reads raw.reviews (each entry IS an order that
  // may carry a rating), not raw.orders.
  const qc = readEvidence('blinkit', {
    reviews: [{
      orderid: '2156871839', orderdate: '2026-06-01', productname: 'Nostrae By Ekhasa Chrysanthemum Artificial Flower Pot',
      amount: '604', delivered: true, imageurl: 'https://cdn.grofers.com/x.jpg', statuscode: 'DELIVERED',
    }],
  }, { product: 'Nostrae By Ekhasa Chrysanthemum Artificial Flower Pot' });
  if (qc.order) {
    ok(qc.order.id === '2156871839', 'blinkit: order ID present');
    ok(qc.order.date != null, 'blinkit: order date present');
    ok(qc.order.image === 'https://cdn.grofers.com/x.jpg', 'blinkit: photo still populated');
    ok(qc.order.statusText === 'DELIVERED', 'blinkit: status still populated');
  } else {
    ok(false, 'blinkit fixture failed to match — check the reader contract');
  }

  // The AMOUNT label differs by platform on purpose: Amazon/Flipkart know the
  // item's own price, quick-commerce knows only the order total. That is honest
  // degradation, not an inconsistency to paper over.
  ok(az.order.itemPaise === 93800 && az.order.orderTotalPaise === 132600,
    'amazon: both item and total known');
  ok(qc.order && qc.order.itemPaise === null && qc.order.orderTotalPaise === 60400,
    'blinkit: total only, item deliberately null');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
