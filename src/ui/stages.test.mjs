// Regression tests for the list stage vocabulary and, more importantly, for the
// promise that a user never sees a raw enum.
//
// What this exists to stop, seen live: "Next: dkim" and
// "✓ Verified state: HOLDING · ORDER_UNREADABLE" on the screen where someone
// checks whether they are getting their money back; and a server-CLOSED task
// still showing "Order not found yet — Buy on Amazon, then check again".

import { taskStage, closedInfo, explainBlocker, nextStepLine, TONES } from './stages.js';
import { STATES, BLOCKERS } from '../taskflow.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const NOW = Date.UTC(2026, 7, 13);
const DAY = 86400000;

console.log('=== 1. every real state maps to a stage, in order ===');
{
  const steps = [
    [{ state: STATES.CLAIMED }, 1, 'Purchase pending'],
    [{ state: STATES.PURCHASED, order: { id: 'o1' } }, 2, 'Delivery pending'],
    [{ state: STATES.DELIVERED }, 3, 'Review pending'],
    [{ state: STATES.REVIEWED }, 4, 'Under verification'],
    [{ state: STATES.HOLDING, windowEndsAt: NOW + 5 * DAY, now: NOW }, 5, 'In return window'],
    [{ state: STATES.HOLDING, windowEndsAt: NOW - DAY, now: NOW }, 6, 'Refund ready'],
    [{ state: STATES.REFUNDED }, 7, 'Refunded'],
  ];
  let last = 0;
  for (const [task, step, label] of steps) {
    const s = taskStage(task);
    ok(s.step === step && s.label === label, `${task.state} → step ${step} "${label}"`);
    ok(s.step > last, `  and it advances (${last} → ${s.step})`);
    last = s.step;
  }
  ok(steps.length === 7, 'all 7 tracker segments are reachable');
}

console.log('\n=== 2. only the steps with real user work carry a CTA ===');
{
  ok(taskStage({ state: STATES.CLAIMED }).cta === 'Buy now', 'buy is on the user');
  ok(taskStage({ state: STATES.DELIVERED }).cta === 'Write review', 'the review is on the user');
  ok(
    taskStage({ state: STATES.HOLDING, windowEndsAt: NOW - DAY, now: NOW }).cta === 'Release refund',
    'releasing is on the user',
  );
  // These used to show "upload order proof" / "upload delivery proof" in the
  // design; the scraper reads both, so asking would be asking for nothing.
  ok(taskStage({ state: STATES.PURCHASED, order: {} }).cta === null, 'delivery needs no user action');
  ok(taskStage({ state: STATES.REVIEWED }).cta === null, 'verification needs no user action');
  ok(taskStage({ state: STATES.REFUNDED }).cta === null, 'a paid task needs nothing');
}

console.log('\n=== 3. a closed task never invites more work ===');
{
  const open = closedInfo({ state: STATES.CLAIMED });
  ok(open.closed === false, 'an open task is not closed');

  const expired = closedInfo({ state: STATES.CLAIMED, closedAt: NOW, closeReason: 'expired' });
  ok(expired.closed === true && expired.label === 'Window closed', 'an expired claim reads as closed');
  ok(/tickets were returned/.test(expired.body), 'and answers the real question: where did my tickets go');
  ok(!/buy/i.test(expired.body) || /claim it again/.test(expired.body),
    'it never tells them to go buy the product again without saying the claim is over');

  const refunded = closedInfo({ state: STATES.REFUNDED, closedAt: NOW, closeReason: 'refunded' });
  ok(refunded.label === 'Refunded' && refunded.tone === 'green', 'a paid task closes green, not red');

  const odd = closedInfo({ state: STATES.CLAIMED, closedAt: NOW, closeReason: 'something_new' });
  ok(odd.closed === true && odd.title === 'This claim is closed', 'an unknown reason still reads as a sentence');
}

console.log('\n=== 4. NO blocker ever renders as an enum ===');
{
  const all = Object.values(BLOCKERS).concat(['some_future_blocker']);
  for (const b of all) {
    const e = explainBlocker(b, 'Amazon');
    ok(e != null, `${b} has an explanation`);
    const text = `${e.title} ${e.body} ${e.cta || ''}`;
    ok(!/_/.test(text), `  ${b}: no snake_case leaks into the copy`);
    ok(!/[A-Z]{4,}/.test(text.replace(/Fayr|Amazon/g, '')), `  ${b}: no SHOUTING enum leaks either`);
    ok(e.title.length > 0 && e.body.length > 10, `  ${b}: says what happened`);
  }
  ok(explainBlocker(null) === null, 'no blocker → nothing to explain');
}

console.log('\n=== 5. the blocker copy names the platform and offers one way out ===');
{
  const r = explainBlocker(BLOCKERS.RECONNECT, 'Flipkart');
  ok(/Flipkart/.test(r.title) && /Flipkart/.test(r.cta), 'reconnect names the actual marketplace');
  ok(r.action === 'reconnect', 'and carries a machine hint, not shown as text');

  const u = explainBlocker(BLOCKERS.ORDER_UNREADABLE, 'Amazon');
  ok(u.action === 'upload', 'an unreadable order routes to the screenshot upload');
  ok(/screenshot/i.test(u.body), 'and says so in words');

  const rev = explainBlocker(BLOCKERS.REVIEW_NOT_PUBLIC, 'Amazon');
  ok(rev.cta === null && rev.action === null, 'nothing to do but wait → no fake button');
  ok(/nothing is lost/.test(rev.body), 'and it reassures rather than alarms');

  const ret = explainBlocker(BLOCKERS.RETURNED, 'Amazon');
  ok(ret.action === 'support', 'a returned order routes to support, the only real recourse');

  ok(explainBlocker(BLOCKERS.RECONNECT, null).title.includes('the marketplace'),
    'a missing platform name degrades to a phrase, never "undefined"');
}

console.log('\n=== 6. the next-step line replaces "Next: <source>" ===');
{
  for (const state of [STATES.CLAIMED, STATES.PURCHASED, STATES.DELIVERED, STATES.REVIEWED, STATES.REFUNDED]) {
    const line = nextStepLine({ state, order: { id: 'o' } });
    ok(line.length > 10 && !/_/.test(line) && /[.!]$/.test(line), `${state}: a real sentence`);
  }
  ok(TONES.includes(taskStage({ state: STATES.CLAIMED }).tone), 'stage tones come from the design palette');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
