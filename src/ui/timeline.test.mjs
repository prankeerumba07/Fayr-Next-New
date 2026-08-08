// Regression tests for the timeline monotonicity clamp.
//
// The bug these exist for was found on a REAL task, not in review: the Instamart
// razor (2026-08-08) was delivered on 3 March, so its 7-day return window had
// closed 151 days before the task was claimed. The screen showed "Return window"
// done and "Refund confirmed" active while the backend had the task at DELIVERED
// with no review and no computable refund amount.

import { clampMonotonic, GATING_STAGES } from './timeline.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const at = (ss, k) => ss.find((s) => s.key === k);

// The exact stage list TaskScreen builds, with each stage's OWN unclamped
// verdict — the shape that produced the live bug.
const razorAsBuilt = () => [
  { key: 'claimed', state: 'done' },
  { key: 'order', state: 'done' },
  { key: 'tracked', state: 'pending', chip: { label: 'Needs staff check' } },
  { key: 'delivered', state: 'done' },
  { key: 'review', state: 'active', action: { label: 'I’ve written my review' } },
  { key: 'verifying', state: 'pending' },
  // windowClosed was true 151 days before the claim
  { key: 'window', state: 'done' },
  { key: 'confirmed', state: 'active', chip: { label: 'Confirmed' }, action: { label: 'Release' } },
  { key: 'wallet', state: 'pending' },
];

console.log('=== 1. the live Instamart razor case ===');
{
  const before = razorAsBuilt();
  ok(at(before, 'window').state === 'done', 'BEFORE: return window claimed done (the bug)');
  ok(at(before, 'confirmed').state === 'active', 'BEFORE: refund confirmed read as the current stage');

  const s = clampMonotonic(razorAsBuilt());
  ok(at(s, 'review').state === 'active', 'frontier keeps its own state: review is active');
  ok(at(s, 'review').action != null, 'frontier keeps its action button (still actionable)');
  ok(at(s, 'window').state === 'pending', 'FIXED: return window no longer done');
  ok(at(s, 'confirmed').state === 'pending', 'FIXED: refund confirmed no longer active');
  ok(at(s, 'confirmed').chip === null, 'FIXED: the "Confirmed" chip is gone');
  ok(at(s, 'confirmed').action === null, 'FIXED: no release button on an unreachable refund');
  ok(at(s, 'wallet').state === 'pending', 'wallet stays pending');
  ok(s.filter((x) => x.state === 'done').length === 3, '3 of 9 done, not 5 (claimed/order/delivered)');
}

console.log('\n=== 2. the invariant itself, over every gating stage ===');
{
  const s = clampMonotonic(razorAsBuilt());
  let seenNotDone = false, violations = 0;
  for (const st of s) {
    if (!GATING_STAGES.includes(st.key)) continue;
    if (st.state !== 'done') seenNotDone = true;
    else if (seenNotDone) violations++;
  }
  ok(violations === 0, 'no gating stage is done after an earlier one that is not');
}

console.log('\n=== 3. `tracked` is exempt — an unknown price must not un-deliver a parcel ===');
{
  const s = clampMonotonic(razorAsBuilt());
  ok(at(s, 'delivered').state === 'done', 'delivery stays verified though the amount is unknown');
  ok(at(s, 'tracked').chip != null, 'the "Needs staff check" chip survives the clamp');
}
{
  // Amount known but review not written: tracked done, later stages still clamped.
  const s = clampMonotonic([
    { key: 'claimed', state: 'done' }, { key: 'order', state: 'done' },
    { key: 'tracked', state: 'done' }, { key: 'delivered', state: 'done' },
    { key: 'review', state: 'active' }, { key: 'verifying', state: 'pending' },
    { key: 'window', state: 'done' }, { key: 'confirmed', state: 'done' },
    { key: 'wallet', state: 'pending' },
  ]);
  ok(at(s, 'tracked').state === 'done', 'a known amount still reads as done out of sequence');
  ok(at(s, 'window').state === 'pending' && at(s, 'confirmed').state === 'pending', 'but the chain is still clamped');
}

console.log('\n=== 4. a genuinely complete task is left alone ===');
{
  const all = GATING_STAGES.map((key) => ({ key, state: 'done' }));
  all.splice(2, 0, { key: 'tracked', state: 'done' });
  const s = clampMonotonic(all);
  ok(s.every((x) => x.state === 'done'), 'a fully done timeline is not demoted');
}

console.log('\n=== 5. the frontier is the FIRST failure, not the last ===');
{
  const s = clampMonotonic([
    { key: 'claimed', state: 'done' },
    { key: 'order', state: 'active', action: { label: 'Check Blinkit' } },
    { key: 'delivered', state: 'done' },
    { key: 'review', state: 'done' },
    { key: 'window', state: 'done' },
  ]);
  ok(at(s, 'order').state === 'active' && at(s, 'order').action != null, 'order is the frontier and stays actionable');
  ok(at(s, 'delivered').state === 'pending', 'a "done" delivery behind an unfound order is demoted');
  ok(at(s, 'review').state === 'pending' && at(s, 'window').state === 'pending', 'everything downstream is pending');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
