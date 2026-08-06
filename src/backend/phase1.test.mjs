// Phase 1 pure-core tests: the idempotency key (decision A — no purchase/delivery
// collision), the evidence→DTO mapping (paise→string, unknown-returned omitted),
// and the offline outbox reducer. Runs under plain `node`.
import { evidenceKey } from './evidenceKey.js';
import { toEvidenceDto } from './evidenceDto.js';
import { enqueue, remove, isEmpty, size } from './outbox.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
