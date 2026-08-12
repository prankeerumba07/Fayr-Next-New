// Phase 1 pure-core tests: the idempotency key (decision A — no purchase/delivery
// collision), the evidence→DTO mapping (paise→string, unknown-returned omitted),
// and the offline outbox reducer. Runs under plain `node`.
import { evidenceKey } from './evidenceKey.js';
import { toEvidenceDto } from './evidenceDto.js';
import { enqueue, remove, isEmpty, size } from './outbox.js';
import { ACTION_PATHS, isTaskAction, alreadyApplied } from './taskActions.js';

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) {
    pass++;
    console.log('  PASS ' + m);
  } else {
    fail++;
    console.log('  FAIL ' + m);
  }
};

const ORDER = { id: 'ORD-1', itemPaise: 129900, source: 'order-history' };

console.log('=== evidenceKey: decision A — purchase vs delivery must NOT collide ===');
const kPurchase = evidenceKey({ order: ORDER });
const kDelivered = evidenceKey({ order: ORDER, delivery: { at: 111, source: 'order-history' } });
ok(kPurchase !== kDelivered, `purchase (${kPurchase}) ≠ purchase+delivery (${kDelivered})`);
ok(
  evidenceKey({ order: ORDER }) === kPurchase,
  'identical purchase evidence → identical key (idempotent re-fetch)',
);
ok(
  evidenceKey({ order: ORDER, delivery: { at: 999, source: 'order-history' } }) === kDelivered,
  'same facts, different delivery timestamp → same key (no jitter re-trigger)',
);
const kReturned = evidenceKey({ order: ORDER, delivery: { at: 1, source: 'x' }, returned: true });
ok(kReturned !== kDelivered, 'a later RETURN on the same order → distinct key, still applies');
const kPublished = evidenceKey({ order: ORDER, delivery: { at: 1, source: 'x' }, review: { published: true } });
ok(kPublished !== kDelivered, 'review going public → distinct key');
ok(
  evidenceKey({ blocker: 'order_unreadable' }) === 'evidence:blocker:order_unreadable',
  'blocker keyed by blocker name',
);
ok(evidenceKey({}) === 'evidence:none:_', 'empty evidence → stable sentinel key');

console.log('=== toEvidenceDto: money → decimal string, returned omitted when unknown ===');
const dto = toEvidenceDto({
  order: { id: 'ORD-1', date: 123, itemPaise: 129900, orderTotalPaise: 132600, source: 'order-details' },
  delivery: { at: 456, source: 'order-details' },
  review: { product: 'boAt 141', published: true, rating: 5 },
});
ok(dto.order.itemPaise === '129900' && typeof dto.order.itemPaise === 'string', 'itemPaise number → "129900"');
ok(dto.order.orderTotalPaise === '132600', 'orderTotalPaise → string');
ok(dto.order.source === 'order-details', 'order source passed through');
ok(dto.delivery.at === 456 && dto.delivery.source === 'order-details', 'delivery mapped');
ok(dto.review.published === true, 'review.published coerced to boolean');
ok(!('returned' in dto), 'returned OMITTED when unknown (null/undefined)');
ok(typeof dto.key === 'string' && dto.key.startsWith('evidence:ORD-1'), 'key derived from evidence');

const dtoRet = toEvidenceDto({ order: { id: 'X', itemPaise: 5000, source: 'order-history' }, returned: false });
ok(dtoRet.returned === false, 'returned:false sent explicitly (known-not-returned)');

const dtoBad = toEvidenceDto({ order: { id: 'X', itemPaise: 129.9, source: 'order-history' } });
ok(!('itemPaise' in dtoBad.order), 'non-integer paise DROPPED, never sent as a bad amount');

const dtoKey = toEvidenceDto({ order: { id: 'X', source: 'order-history' } }, 'my-key');
ok(dtoKey.key === 'my-key', 'explicit key wins over derived');

// probe diagnostic: forwarded when present (the "why nothing was found" signal),
// omitted otherwise — so the backend can see a no-order/auth-fail case.
const dtoProbe = toEvidenceDto({ probe: { ordersFetched: true, targetFound: false, candidateCount: 12 } });
ok(dtoProbe.probe && dtoProbe.probe.targetFound === false && dtoProbe.probe.candidateCount === 12, 'probe forwarded when present');
ok(!('probe' in toEvidenceDto({ order: { id: 'X', source: 'order-history' } })), 'probe omitted when absent');
ok(!('probe' in toEvidenceDto({ probe: null })), 'null probe not forwarded');

console.log('=== outbox: dedupe by (taskId,key), remove, empty ===');
let q = [];
ok(isEmpty(q), 'starts empty');
q = enqueue(q, { taskId: 't1', key: 'k1', body: { a: 1 } });
q = enqueue(q, { taskId: 't1', key: 'k2', body: { a: 2 } });
ok(size(q) === 2, 'two distinct (taskId,key) entries');
q = enqueue(q, { taskId: 't1', key: 'k1', body: { a: 99 } });
ok(size(q) === 2, 're-enqueue same (taskId,key) replaces, no pile-up');
ok(q.find((x) => x.key === 'k1').body.a === 99, 'replacement keeps the newest body');
q = remove(q, 't1', 'k1');
ok(size(q) === 1 && q[0].key === 'k2', 'remove drops exactly that entry');

console.log('\n=== task actions: routes, routing, and the repeat-tap guard ===');
// The four user-driven transitions, wired to the backend on 2026-08-09. Before
// this they were local-only: a tapped "I've written my review" moved the screen
// and nothing else, so the next evidence sync silently reverted it.
ok(ACTION_PATHS.CONFIRM_ORDER === 'confirm-order', 'CONFIRM_ORDER -> POST /tasks/:id/confirm-order');
ok(ACTION_PATHS.MARK_REVIEWED === 'reviewed', 'MARK_REVIEWED -> POST /tasks/:id/reviewed');
ok(ACTION_PATHS.START_HOLD === 'start-hold', 'START_HOLD -> POST /tasks/:id/start-hold');
ok(ACTION_PATHS.RELEASE_REFUND === 'release-refund', 'RELEASE_REFUND -> POST /tasks/:id/release-refund');
ok(Object.keys(ACTION_PATHS).length === 4, 'exactly four actions, no accidental fifth');

ok(isTaskAction('MARK_REVIEWED') && isTaskAction('RELEASE_REFUND'), 'actions are recognised as actions');
ok(!isTaskAction('EVIDENCE'), 'EVIDENCE is NOT an action — it keeps the optimistic + outbox path');
ok(!isTaskAction('VISIBILITY_CHECK') && !isTaskAction('nonsense'), 'unknown types are not routed as actions');

// MARK_REVIEWED is the one that needs guarding: the route takes no idempotency
// key and the engine ACCEPTS a repeat from REVIEWED, so a second tap would write
// a duplicate audit row for no state change.
ok(alreadyApplied('MARK_REVIEWED', { state: 'REVIEWED' }), 'skip MARK_REVIEWED when already REVIEWED');
ok(alreadyApplied('MARK_REVIEWED', { state: 'HOLDING' }), 'skip MARK_REVIEWED when past it (HOLDING)');
ok(alreadyApplied('MARK_REVIEWED', { state: 'REFUNDED' }), 'skip MARK_REVIEWED when past it (REFUNDED)');
ok(!alreadyApplied('MARK_REVIEWED', { state: 'DELIVERED' }), 'DO send MARK_REVIEWED from DELIVERED — the real Blinkit case');
ok(!alreadyApplied('MARK_REVIEWED', { state: 'CLAIMED' }), 'DO send MARK_REVIEWED from CLAIMED (server rejects it, honestly)');
ok(!alreadyApplied('MARK_REVIEWED', null), 'no authoritative snapshot -> never skip (never guess)');
ok(!alreadyApplied('MARK_REVIEWED', {}), 'snapshot without a state -> never skip');

// The other three are unguarded ON PURPOSE — each for its own reason.
ok(!alreadyApplied('START_HOLD', { state: 'HOLDING' }), 'START_HOLD unguarded: the server 409s a repeat');
ok(!alreadyApplied('RELEASE_REFUND', { state: 'REFUNDED' }), 'RELEASE_REFUND unguarded: REFUNDED is terminal + release:<id> dedupes');
// CONFIRM_ORDER is now guarded on a REAL server fact — TaskResponse returns
// orderConfirmed on `order`. This is the live 2026-08-10 double-event (two
// events 909ms apart on a Zepto task, the DB's only duplicate key).
ok(alreadyApplied('CONFIRM_ORDER', { state: 'DELIVERED', order: { orderConfirmed: true } }),
  'skip CONFIRM_ORDER when the server says it is already confirmed');
ok(!alreadyApplied('CONFIRM_ORDER', { state: 'DELIVERED', order: { orderConfirmed: false } }),
  'DO send CONFIRM_ORDER when not yet confirmed');
ok(!alreadyApplied('CONFIRM_ORDER', { state: 'DELIVERED', order: {} }),
  'absent field means "server does not say" -> never skip, never guess');
ok(!alreadyApplied('CONFIRM_ORDER', { state: 'DELIVERED', order: null }),
  'no order yet -> never skip');
ok(!alreadyApplied('CONFIRM_ORDER', { state: 'DELIVERED', orderConfirmed: true }),
  'the flag is read from order, not the task root — a top-level copy is ignored');

console.log('\n=== miss keys are DIAGNOSIS-derived, so a task can fail twice differently ===');
// Live bug, 2026-08-12: every miss collapsed to `evidence:none:_`. A Nike task
// spent that key on 08-11; the next day's fetch was short-circuited before the
// engine ran and left NO trace at all — no event, no probe, no updatedAt change.
ok(evidenceKey({}) === 'evidence:none:_', 'no probe at all -> historical key, unchanged');
ok(evidenceKey({ probe: null }) === 'evidence:none:_', 'null probe -> same');

const kNoTarget = evidenceKey({ probe: { fetchError: 'no_campaign_target' } });
const kEmpty = evidenceKey({ probe: { reviewsSeen: 0 } });
const kNoNames = evidenceKey({ probe: { reviewsSeen: 12, namesResolved: 0 } });
const kNear = evidenceKey({ probe: { reviewsSeen: 12, namesResolved: 12, bestScore: 0.5 } });
ok(kNoTarget === 'evidence:none:err-no_campaign_target', 'fail-closed gets its own key');
ok(kEmpty === 'evidence:none:empty', 'empty reviews page gets its own key');
ok(kNoNames === 'evidence:none:nonames', 'no resolvable product names gets its own key');
ok(kNear === 'evidence:none:score-0.5', 'a near-miss carries its score bucket');
ok(new Set([kNoTarget, kEmpty, kNoNames, kNear, 'evidence:none:_']).size === 5,
  'all five diagnoses are DISTINCT keys — no failure can swallow another');

// Idempotency is the whole reason this is a key: an identical repeat must collapse.
ok(evidenceKey({ probe: { reviewsSeen: 0 } }) === kEmpty, 'same diagnosis repeated -> same key');
// ...but harmless count jitter must NOT mint a new key, or the log grows forever
// every time the user writes an unrelated review.
ok(evidenceKey({ probe: { reviewsSeen: 13, namesResolved: 0 } }) === kNoNames,
  'reviewsSeen 12 -> 13 with the same diagnosis -> SAME key, no log growth');
ok(evidenceKey({ probe: { reviewsSeen: 12, namesResolved: 12, bestScore: 0.54 } }) === kNear,
  'score 0.50 vs 0.54 bucket together');
ok(evidenceKey({ probe: { reviewsSeen: 12, namesResolved: 12, bestScore: 0.2 } }) !== kNear,
  'but 0.2 (wrong product) is NOT the same as 0.5 (nearly there)');

// THE NIKE CASE: an already-failed task must accept a fresh diagnostic.
const staleKey = evidenceKey({});                       // what Nike already spent
const freshKey = evidenceKey({ probe: { reviewsSeen: 12, namesResolved: 0 } });
ok(staleKey !== freshKey,
  'a task that already spent evidence:none:_ still applies a probe-bearing miss');

// Success and blocker keys must be untouched by all of this.
ok(evidenceKey({ order: ORDER, delivery: { at: 1, source: 'x' } }) === kDelivered,
  'a real order key is unchanged');
ok(evidenceKey({ blocker: 'order_unreadable', probe: { reviewsSeen: 0 } })
  === 'evidence:blocker:order_unreadable', 'a blocker still keys by blocker, probe ignored');
// An order WITHOUT an id is still a miss — it cannot be keyed by identity.
ok(evidenceKey({ order: { itemPaise: 100, source: 'x' }, probe: { reviewsSeen: 0 } })
  === 'evidence:none:empty', 'an id-less order falls back to the diagnosis key');

console.log('\n=== order.match must SURVIVE the wire (it was dropped here) ===');
// The confirm screen's ambiguity and price warnings are driven off `match`, and
// the backend's refund gate now REFUSES to release a doubtful match without an
// explicit confirmation. Dropping this field silently disarmed both.
const dtoMatch = toEvidenceDto({
  order: {
    id: 'OD-1', itemPaise: 32800, source: 'order-history',
    match: { score: 0.83, amountOk: false, ambiguous: true, candidateCount: 4 },
  },
});
ok(dtoMatch.order.match != null, 'match is sent, not dropped');
ok(dtoMatch.order.match.score === 0.83, 'score forwarded');
ok(dtoMatch.order.match.amountOk === false, 'amountOk:false forwarded — the price warning');
ok(dtoMatch.order.match.ambiguous === true, 'ambiguous forwarded — the "which order?" warning');
ok(dtoMatch.order.match.candidateCount === 4, 'candidateCount forwarded');

ok(!('match' in toEvidenceDto({ order: { id: 'X', source: 'order-history' } }).order),
  'omitted entirely when the matcher never ran');

// The DTO bounds score to 0..1; a rounding artefact must not 400 the whole
// submission and lose real evidence over a diagnostic field.
const clamped = toEvidenceDto({
  order: { id: 'X', source: 'order-history', match: { score: 1.0000000002 } },
});
ok(clamped.order.match.score === 1, 'a score just over 1 is clamped, not rejected');
const clampedLow = toEvidenceDto({
  order: { id: 'X', source: 'order-history', match: { score: -0.0001 } },
});
ok(clampedLow.order.match.score === 0, 'a score just under 0 is clamped too');
const junk = toEvidenceDto({
  order: { id: 'X', source: 'order-history', match: { score: NaN, candidateCount: 1.5 } },
});
ok(!('score' in junk.order.match), 'NaN score dropped rather than sent');
ok(!('candidateCount' in junk.order.match), 'non-integer candidateCount dropped');
// amountOk is TRI-STATE: false is meaningful, null/undefined means "unknown".
const okFalse = toEvidenceDto({
  order: { id: 'X', source: 'order-history', match: { amountOk: false } },
});
ok(okFalse.order.match.amountOk === false, 'amountOk:false is preserved, not treated as absent');
const okNull = toEvidenceDto({
  order: { id: 'X', source: 'order-history', match: { amountOk: null } },
});
ok(!('amountOk' in okNull.order.match), 'amountOk:null omitted — unknown is not false');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
