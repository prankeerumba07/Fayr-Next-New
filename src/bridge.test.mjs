// Proves the prototype<->logic bridge against the ACTUAL campaign shapes from
// FayrAppV3.jsx (values copied verbatim), with no browser and no device.

import {
  taskForCampaign, refundPaise, refundRupeesStr, refundRupeesWhole,
  stateToStep, apply, events, view, POLICY,
} from './bridge.js';
import { STATES, DAY, windowEnd } from './taskflow.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// Real entries from CAMPAIGNS in FayrAppV3.jsx (verbatim fields that matter).
const c2 = { id: 'c2', product: 'Brillare 100% Natural Rosemary Oil', marketplace: 'amazon', pct: 90, maxBack: 404, examplePay: 449 };
const c5 = { id: 'c5', product: 'Dove Refreshing Sakura Body Wash', marketplace: 'amazon', pct: 90, maxBack: 314, examplePay: 349 };
const c1 = { id: 'c1', product: 'Perfora Magic Whitening Toothpaste', marketplace: 'flipkart', pct: 100, maxBack: 299, examplePay: 299 };

console.log('=== 1. real per-item refund (integer paise), not the baked maxBack ===');
ok(refundPaise(c2) === 40410, 'c2: 90% of ₹449 -> 40410 paise (₹404.10) ' + refundPaise(c2));
ok(refundRupeesStr(c2) === '404.10', 'c2 display ₹404.10, vs baked maxBack 404 (loses the .10)');
ok(refundRupeesWhole(c2) === 404, 'c2 whole-rupee wallet credit 404 == maxBack');
ok(refundPaise(c5) === 31410, 'c5: 90% of ₹349 -> 31410 paise (₹314.10) ' + refundPaise(c5));
ok(refundRupeesWhole(c5) === 314, 'c5 whole-rupee 314 == maxBack 314');
ok(refundPaise(c1) === 29900, 'c1: 100% of ₹299 -> 29900 paise ' + refundPaise(c1));
// The 100x guard: refund is paise, wallet is rupees. Crediting paise into the
// rupee wallet would pay 100x. refundRupeesWhole is the safe boundary.
ok(refundPaise(c2) === refundRupeesWhole(c2) * 100 + 10, 'paise vs rupee boundary is explicit (404.10 -> 404 rupees + 10p dropped)');

console.log('\n=== 2. state -> prototype step mapping ===');
const base = taskForCampaign(c2);
ok(stateToStep(base) === 1, 'CLAIMED -> step 1 (buy)');
ok(stateToStep({ ...base, state: STATES.PURCHASED }) === 3, 'PURCHASED -> step 3 (order verified)');
ok(stateToStep({ ...base, state: STATES.DELIVERED }) === 4, 'DELIVERED -> step 4');
ok(stateToStep({ ...base, state: STATES.REVIEWED }) === 5, 'REVIEWED -> step 5');
ok(stateToStep({ ...base, state: STATES.REFUNDED }) === 9, 'REFUNDED -> step 9 (paid)');

console.log('\n=== 3. full happy journey through the REAL state machine ===');
const now = Date.UTC(2026, 6, 16);
const orderAt = now - 12 * DAY;
const deliveryAt = now - 9 * DAY; // default 7-day window closed by `now`
let t = taskForCampaign(c2);
ok(t.state === STATES.CLAIMED && stateToStep(t) === 1, 'start CLAIMED/step1');

// order + delivery evidence arrives (simulated, structurally real)
let r = apply(t, events.simulated(c2, { orderAt, deliveryAt, published: true, at: now }));
t = r.task;
ok(t.state === STATES.DELIVERED, 'evidence w/ delivery -> DELIVERED (' + t.state + ')');
ok(stateToStep(t) === 4, 'step 4 after delivery');
ok(t.order.itemPaise === 44900, 'order item price carried as paise 44900');

// re-applying the SAME evidence is a no-op (idempotent under a double-tap)
const r2 = apply(t, events.simulated(c2, { orderAt, deliveryAt, published: true, at: now }));
ok(r2.task === t && r2.changed === false, 'duplicate evidence key -> no-op');

t = apply(t, events.markReviewed(now)).task;
ok(t.state === STATES.REVIEWED && stateToStep(t) === 5, 'MARK_REVIEWED -> REVIEWED/step5');

t = apply(t, events.startHold(now)).task;
ok(t.state === STATES.HOLDING, 'START_HOLD -> HOLDING');
ok(stateToStep(t, now) === 7, 'window already closed -> step 7 (Refund Confirmed / Withdraw)');

const v = view(t, c2, now);
ok(v.eligible === true, 'view: eligible to release');
ok(v.refundRupees === 404, 'view: refund 404 rupees');

t = apply(t, events.release(now)).task;
ok(t.state === STATES.REFUNDED && stateToStep(t) === 9, 'RELEASE_REFUND -> REFUNDED/step9');

console.log('\n=== 4. the gates that a timer-based prototype cannot enforce ===');
// (a) window NOT closed yet -> held, step stays 6
let h = taskForCampaign(c2);
const freshDelivery = now - 2 * DAY; // 7-day window still open
h = apply(h, events.simulated(c2, { orderAt, deliveryAt: freshDelivery, published: true, at: now })).task;
h = apply(h, events.markReviewed(now)).task;
h = apply(h, events.startHold(now)).task;
ok(h.state === STATES.HOLDING && stateToStep(h, now) === 6, 'open window -> step 6 (still holding)');
ok(apply(h, events.release(now)).rejected === true, 'release refused while window open');
ok(windowEnd(h, POLICY) === freshDelivery + 7 * DAY, 'window anchored to delivery + 7d default');

// (b) returned/cancelled order blocks the refund even after the window closes
let ret = taskForCampaign(c5);
ret = apply(ret, events.simulated(c5, { orderAt, deliveryAt, published: true, returned: true, at: now })).task;
ret = apply(ret, events.markReviewed(now)).task;
ret = apply(ret, events.startHold(now)).task;
const rv = view(ret, c5, now);
ok(rv.eligible === false, 'returned order -> not eligible');
ok(rv.blockedReasons.some((x) => /returned or cancelled/.test(x)), 'reason names the return');

// (c) review deleted mid-hold -> regress to REVIEWED, refund blocked (loophole 3)
let del = taskForCampaign(c2);
del = apply(del, events.simulated(c2, { orderAt, deliveryAt, published: true, at: now })).task;
del = apply(del, events.markReviewed(now)).task;
del = apply(del, events.startHold(now)).task;
ok(del.state === STATES.HOLDING, 'in HOLDING before the re-check');
del = apply(del, events.visibility(false, now + DAY)).task;
ok(del.state === STATES.REVIEWED, 'review vanished mid-hold -> regress to REVIEWED');
ok(apply(del, events.release(now + DAY)).rejected === true, 'refund refused after regression');

console.log('\n=== 5. unreadable delivery -> stall at PURCHASED with a gap, no blank ===');
let g = taskForCampaign(c2);
g = apply(g, events.simulated(c2, { orderAt, at: now })).task; // no deliveryAt
ok(g.state === STATES.PURCHASED && stateToStep(g) === 3, 'order but no delivery -> PURCHASED/step3');
ok(g.delivery == null, 'delivery is null (a gap the UI must show, not a blank)');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
