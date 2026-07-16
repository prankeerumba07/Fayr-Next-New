// Verifies the wiring that replaced TaskStatus's timer machine. It replays the
// EXACT logic the root's driveTaskToStep + TaskStatus's hold/release effects run,
// and asserts the derived prototype `step` at each beat — the part that can't be
// click-tested in this environment.

import { taskForCampaign, simulatedEvidence, events, apply, stateToStep, view } from './bridge.js';
import { STATES } from './taskflow.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const c2 = { id: 'c2', product: 'Brillare 100% Natural Rosemary Oil', marketplace: 'amazon', pct: 90, maxBack: 404, examplePay: 449 };
const NOW = Date.UTC(2026, 6, 16);

// Verbatim copy of the root's driveTaskToStep (kept in sync by hand — if the app
// changes, this must too).
function driveTaskToStep(task, cc, step, now) {
  let t = task || taskForCampaign(cc);
  const past = { orderAt: now - 12 * 864e5, deliveryAt: now - 9 * 864e5, published: true };
  const evs = [];
  if (step >= 3) evs.push({ type: 'EVIDENCE', key: 'ev:order:' + cc.id, evidence: simulatedEvidence(cc, { orderAt: past.orderAt, published: true }), at: now });
  if (step >= 4) evs.push({ type: 'EVIDENCE', key: 'ev:deliv:' + cc.id, evidence: simulatedEvidence(cc, past), at: now });
  if (step >= 5) evs.push(events.markReviewed(now));
  if (step >= 6) evs.push(events.startHold(now));
  if (step >= 7) evs.push(events.release(now));
  for (const ev of evs) t = apply(t, ev).task;
  return t;
}

console.log('=== 1. the normal journey: advance(3)->(4)->(5), then hold, then withdraw ===');
let t = taskForCampaign(c2); // claim()
ok(stateToStep(t, NOW) === 1, 'claimed -> step 1');

t = driveTaskToStep(t, c2, 3, NOW); // OcrConfirm advance(3)
ok(t.state === STATES.PURCHASED && stateToStep(t, NOW) === 3, 'order verified -> PURCHASED/step3');

t = driveTaskToStep(t, c2, 4, NOW); // DeliveryConfirm advance(4)
ok(t.state === STATES.DELIVERED && stateToStep(t, NOW) === 4, 'delivered -> DELIVERED/step4');

t = driveTaskToStep(t, c2, 5, NOW); // ReviewProof advance(5)
ok(t.state === STATES.REVIEWED && stateToStep(t, NOW) === 5, 'reviewed -> REVIEWED/step5');

// TaskStatus effect: REVIEWED -> startHold
t = apply(t, events.startHold(NOW)).task;
ok(t.state === STATES.HOLDING, 'TaskStatus effect enters HOLDING');
ok(stateToStep(t, NOW) === 7, 'window already closed -> step 7 (Refund Confirmed / Withdraw shows)');
ok(view(t, c2, NOW).eligible === true && view(t, c2, NOW).refundDisplay === '404.10', 'eligible, refund shows ₹404.10');

// Withdraw button: release
t = apply(t, events.release(NOW)).task;
ok(t.state === STATES.REFUNDED && stateToStep(t, NOW) === 9, 'withdraw -> REFUNDED/step9 (paid)');

console.log('\n=== 2. any entry path converges (dev-menu jump straight to a late step) ===');
let j = driveTaskToStep(null, c2, 7, NOW); // SKIP WAIT / finalize target 7 from scratch
ok(j.state === STATES.REFUNDED && stateToStep(j, NOW) === 9, 'drive straight to step 7 -> REFUNDED (cumulative)');

console.log('\n=== 3. re-entering a screen re-fires events but nothing double-applies ===');
let d = driveTaskToStep(null, c2, 5, NOW);
const before = d;
d = driveTaskToStep(d, c2, 5, NOW); // same step again (screen re-render / re-nav)
ok(d.state === before.state && d.history.length === before.history.length, 'repeat drive to same step is a no-op (idempotent keys)');

console.log('\n=== 4. seeded demo campaign (no task) keeps its legacy step ===');
// TaskStatus: `const step = v ? v.step : (e.step || 1)`. No task -> fallback.
const noTaskStep = (task, enrolledStep) => (task ? stateToStep(task) : (enrolledStep || 1));
ok(noTaskStep(undefined, 2) === 2, 'no task -> falls back to enrolled.step (seeded c1 stays at 2)');
ok(noTaskStep(taskForCampaign(c2), 2) === 1, 'real task overrides the shadow step');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
