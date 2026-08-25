// A screenshot is SUPPORTING evidence. The product invariant (CLAUDE.md) is that
// it never approves itself and never moves money — so the copy is tested, not
// trusted: no state may claim the refund is coming, and the disclaimer must be
// unconditional rather than something a future edit can hide on the happy path.

import {
  STATUS_UI, statusUi, proofView, SUPPORTING_ONLY, WHAT_TO_CAPTURE,
} from './proof.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  XFAIL ' + m); } };

const up = (over) => ({
  id: 'u1', kind: 'PURCHASE', status: 'pending_review',
  reviewReason: null, uploadedAt: '2026-08-14T10:00:00.000Z', ...over,
});

console.log('=== 1. the invariant: never promises money ===');
{
  const all = Object.values(STATUS_UI).map((u) => `${u.label} ${u.note}`).join(' ').toLowerCase();
  ok(!/refunded|paid|money is|will be paid|approved for payout/.test(all),
    'no status claims the refund has happened');
  ok(/reviewer/.test(STATUS_UI.approved.note),
    'even "Accepted" credits the decision to a person, not the upload');
  ok(/normal timeline|normal return window|holding/i.test(STATUS_UI.approved.note + SUPPORTING_ONLY),
    'and acceptance does not shortcut the holding period');
  ok(/supporting proof/i.test(SUPPORTING_ONLY) && /Fayr reviewer/.test(SUPPORTING_ONLY),
    'the standing disclaimer says supporting-only AND names the human decision');
  ok(STATUS_UI.approved.canReplace === false, 'an accepted proof cannot be silently replaced');
}

console.log('\n=== 2. the reviewer’s own words win ===');
{
  const v = proofView([up({ status: 'rejected', reviewReason: 'The order number is cut off.' })], 'PURCHASE');
  ok(v.banner.note === 'The order number is cut off.', 'a real reviewer note replaces the generic copy');
  ok(v.banner.fromReviewer === true, 'and is flagged as coming from a person');

  const g = proofView([up({ status: 'rejected' })], 'PURCHASE');
  ok(g.banner.note === STATUS_UI.rejected.note, 'with no note, the generic copy is used');
  ok(g.banner.fromReviewer === false, 'and is not passed off as a reviewer’s words');
}

console.log('\n=== 3. which upload is "latest", and what can be done ===');
{
  const v = proofView([
    up({ id: 'a', uploadedAt: '2026-08-10T00:00:00.000Z', status: 'rejected' }),
    up({ id: 'c', uploadedAt: '2026-08-14T00:00:00.000Z', status: 'pending_review' }),
    up({ id: 'b', uploadedAt: '2026-08-12T00:00:00.000Z', status: 'rejected' }),
  ], 'PURCHASE');
  ok(v.latest.id === 'c', 'the newest upload is the one that counts');
  ok(v.history.length === 2, 'the rest become history');
  ok(v.uploads[0].id === 'c' && v.uploads[2].id === 'a', 'uploads are newest-first');

  ok(proofView([], 'PURCHASE').canUpload === true, 'with nothing uploaded, upload is offered');
  ok(proofView([up({ status: 'approved' })], 'PURCHASE').canUpload === false, 'an accepted proof closes the uploader');
  ok(proofView([up({ status: 'approved' })], 'PURCHASE').uploadLabel === null, 'and offers no upload label');
  ok(proofView([up({ status: 'needs_more' })], 'PURCHASE').uploadLabel === 'Upload a new screenshot',
    '"needs more" asks for a new one');
  ok(proofView([up({ status: 'pending_review' })], 'PURCHASE').uploadLabel === 'Add another screenshot',
    'while under review it offers to ADD, not replace — nothing is thrown away');
}

console.log('\n=== 4. kinds stay separate, and edges ===');
{
  const mixed = [up({ id: 'p', kind: 'PURCHASE' }), up({ id: 'r', kind: 'REVIEW' })];
  ok(proofView(mixed, 'REVIEW').latest.id === 'r', 'a REVIEW proof never shows under PURCHASE');
  ok(proofView(mixed, 'DELIVERY').latest === null, 'a kind with no uploads is empty, not the wrong one');
  ok(proofView(null, 'PURCHASE').uploads.length === 0, 'null input does not throw');
  ok(proofView([null], 'PURCHASE').latest === null, 'null entries are dropped');
  ok(statusUi('nonsense').label === STATUS_UI.pending_review.label,
    'an unknown status degrades to "under review", never to "accepted"');
  for (const k of ['PURCHASE', 'DELIVERY', 'REVIEW']) {
    ok(WHAT_TO_CAPTURE[k].length > 30, `${k}: says specifically what to capture`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
