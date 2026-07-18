// Proves the ORDER-FIRST flow: a purchase alone (no review yet) drives
// CLAIMED -> PURCHASED -> DELIVERED, the user confirms the fetched order, and a
// return/auth-failure/not-bought-yet each behave correctly. This is the flow
// that replaces "upload a screenshot of your order and your delivery" - the tool
// reads the order out of the marketplace's own order history instead.
//
// Pure JS (readers + transition), so it runs without the native WebView.

import {
  createTask, transition, readEvidence, readFlipkartEvidence, readMyntraEvidence,
  STATES, SOURCES, DAY,
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

// Myntra: mrp only (paid price not yet located), name present, amount not checked.
const myPaid = {
  order: {
    orderid: 'M-42', createdon: ordered, deliverydate: delivered,
    name: 'Roadster Blue Shirt', mrp: 1499, returned: false, styleid: 55123,
  },
  review: null,
  orderProbe: { ordersFetched: true, authFailed: false, ordersCount: 6, nameAvailable: true, targetFound: true, matchScore: 1, amountOk: null, ambiguous: false, candidateCount: 1 },
};

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

console.log('\n=== Idempotency: re-fetching the same order is a no-op, not a second advance ===');
{
  const ev = readFlipkartEvidence(fkPaid, { product: 'boAt Airdopes 141', amount: 388 });
  let t = createTask({ id: 't_fk5', platform: 'flipkart' });
  const r1 = transition(t, evEvent(ev));
  const r2 = transition(r1.task, evEvent(ev)); // same key
  ok(r1.changed === true && r2.changed === false, 'second identical evidence event ignored');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
