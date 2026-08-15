// The re-claim bug is the reason this file exists.
//
// A user re-claimed a campaign, got a fresh open task, and the screen kept
// showing the OLD closed one — telling them their live claim had expired. The
// store keys by campaignId and the backend list arrives newest-first, so plain
// last-write-wins handed the map to the oldest row. preferTask is the fix, and
// it is tested here rather than trusted.

import {
  preferTask, myProductsView, isSettled, emptyState,
} from './tasklist.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  XFAIL ' + m); } };

const task = (over) => ({
  id: 'a', state: 'CLAIMED', createdAt: '2026-08-01T00:00:00.000Z',
  closedAt: null, closeReason: null, campaign: { id: 'c1' }, ...over,
});

console.log('=== 1. preferTask — the re-claim bug ===');
{
  const oldClosed = task({ id: 'old', createdAt: '2026-08-01T00:00:00.000Z', closedAt: '2026-08-02T00:00:00.000Z', closeReason: 'expired' });
  const newOpen = task({ id: 'new', createdAt: '2026-08-10T00:00:00.000Z' });

  ok(preferTask(oldClosed, newOpen).id === 'new', 'a fresh open task beats an old closed one');
  ok(preferTask(newOpen, oldClosed).id === 'new', 'and wins in the other arrival order too — THE actual bug');
  ok(preferTask(null, newOpen).id === 'new', 'nothing to compare against takes the incoming');
  ok(preferTask(oldClosed, null).id === 'old', 'a null incoming never wipes what is shown');
  ok(preferTask(null, null) === null, 'two nulls stay null');
}

console.log('\n=== 2. preferTask — same row, and dates ===');
{
  const before = task({ id: 'x', state: 'CLAIMED' });
  const after = task({ id: 'x', state: 'PURCHASED' });
  ok(preferTask(before, after).state === 'PURCHASED', 'the same id is an update, so the incoming wins');

  const older = task({ id: 'o', createdAt: '2026-08-01T00:00:00.000Z' });
  const newer = task({ id: 'n', createdAt: '2026-08-09T00:00:00.000Z' });
  ok(preferTask(older, newer).id === 'n', 'both open: newer createdAt wins');
  ok(preferTask(newer, older).id === 'n', 'regardless of order');

  const c1 = task({ id: 'c1', createdAt: '2026-08-01T00:00:00.000Z', closedAt: '2026-08-03T00:00:00.000Z' });
  const c2 = task({ id: 'c2', createdAt: '2026-08-05T00:00:00.000Z', closedAt: '2026-08-06T00:00:00.000Z' });
  ok(preferTask(c1, c2).id === 'c2', 'both closed: still the newer one');

  const noDate1 = task({ id: 'p', createdAt: null });
  const noDate2 = task({ id: 'q', createdAt: null });
  ok(preferTask(noDate1, noDate2).id === 'p', 'undateable and indistinguishable: hold steady, do not flicker');
  ok(preferTask(task({ id: 'p', createdAt: 'not a date' }), task({ id: 'q', createdAt: null })).id === 'p',
    'an unparseable date is treated as no date, not as epoch 0');
}

console.log('\n=== 3. the two tabs ===');
{
  const tasks = [
    task({ id: '1', state: 'CLAIMED' }),
    task({ id: '2', state: 'REFUNDED', closedAt: '2026-08-09T00:00:00.000Z', closeReason: 'refunded' }),
    task({ id: '3', state: 'HOLDING' }),
    task({ id: '4', state: 'CLAIMED', closedAt: '2026-08-09T00:00:00.000Z', closeReason: 'expired' }),
  ];
  const v = myProductsView(tasks);
  ok(v.refunded.length === 1 && v.refunded[0].id === '2', 'only a REFUNDED task counts as settled');
  ok(v.inProgress.length === 3, 'everything else is in progress');
  ok(v.inProgress.some((r) => r.id === '4'), 'an EXPIRED claim is still listed, not quietly hidden');
  ok(v.inProgress.find((r) => r.id === '4').closed.closed === true, 'and it carries its closed info so the row can say so');
  ok(v.inProgress.find((r) => r.id === '4').cta === null, 'a closed claim offers no action — no button that cannot work');
  ok(v.inProgress.find((r) => r.id === '1').cta === 'Buy now', 'an open CLAIMED task keeps its real CTA');
  ok(v.counts.inProgress === 3 && v.counts.refunded === 1, 'counts match the rows');
}

console.log('\n=== 4. shape and edges ===');
{
  ok(myProductsView(null).inProgress.length === 0, 'null input does not throw');
  ok(myProductsView([null, undefined]).counts.inProgress === 0, 'null entries are dropped');
  ok(myProductsView([task({ state: 'CLAIMED' })]).inProgress[0].stage.step === 1, 'each row carries its stage');
  ok(isSettled(task({ state: 'REFUNDED' })) === true && isSettled(task({ state: 'HOLDING' })) === false, 'isSettled is REFUNDED-only');
  ok(isSettled(null) === false, 'isSettled(null) is false, not a throw');
  ok(emptyState('refunded').title !== emptyState('progress').title, 'each tab has its own empty copy');
  for (const t of ['progress', 'refunded']) {
    const e = emptyState(t);
    ok(!!e.icon && !!e.title && e.body.length > 10, `${t}: empty state is complete`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
