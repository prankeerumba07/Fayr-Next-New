// Convert an on-device Evidence object (the output of src/taskflow.js
// readEvidence) into the exact JSON body POST /tasks/:id/evidence expects:
//   - money (paise) as decimal STRINGS (JSON has no BigInt; the DTO matches /^\d+$/);
//   - `returned` sent only when known (omitted === "unknown");
//   - the idempotency `key` (derived here if not supplied);
//   - the scraper `probe` diagnostic forwarded (WHY a check found nothing) —
//     previously dropped, which blinded the backend to no-order/auth-fail cases.
// Pure — no network, no RN. Mirrors backend evidenceFromDto in reverse.
import { evidenceKey } from './evidenceKey.js';

// Mirrors QUANTITY_SOURCES / QUANTITY_REASONS in
// backend/src/tasks/engine/evidence.types.ts. Literals rather than an import
// because the device bundle cannot reach backend source.
const QUANTITY_SOURCES = [
  'label-qty', 'label-quantity', 'unit-record-stated', 'unit-records-stated', 'staff',
];
const QUANTITY_REASONS = [
  'not-stated', 'picker', 'conflicting', 'implausible', 'partial', 'no-item-container',
  'multi-unit-amount-unclear',
];

// paise number|string|null → decimal string, or undefined to OMIT. Drops any
// non-integer/negative value rather than send something the ledger would reject.
function paiseStr(v) {
  if (v == null) return undefined;
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 ? String(v) : undefined;
  }
  if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  return undefined;
}

// Drop undefined keys so the JSON body carries only what's present.
function clean(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// The match block, trimmed to what the DTO validates. `score` is bounded 0..1
// server-side, so clamp rather than let a rounding artefact 400 the whole
// submission and lose real evidence over a diagnostic field.
function cleanMatch(m) {
  const score = typeof m.score === 'number' && Number.isFinite(m.score)
    ? Math.min(1, Math.max(0, m.score))
    : undefined;
  return clean({
    score,
    amountOk: typeof m.amountOk === 'boolean' ? m.amountOk : undefined,
    ambiguous: m.ambiguous === true ? true : undefined,
    candidateCount: Number.isInteger(m.candidateCount) && m.candidateCount >= 0
      ? m.candidateCount
      : undefined,
  });
}

export function toEvidenceDto(evidence, key) {
  const e = evidence || {};
  const body = { key: key || evidenceKey(e) };
  if (e.blocker) body.blocker = e.blocker;
  if (e.reason) body.reason = e.reason;

  if (e.review) {
    body.review = clean({
      reviewId: e.review.reviewId ?? undefined,
      asin: e.review.asin ?? undefined,
      product: e.review.product ?? undefined,
      rating: e.review.rating ?? undefined,
      published: e.review.published === true, // required boolean
      verified: e.review.verified ?? undefined,
      reviewDate: e.review.reviewDate ?? undefined,
      reviewDateSource: e.review.reviewDateSource ?? undefined,
      permalink: e.review.permalink ?? undefined,
    });
  }

  if (e.order) {
    body.order = clean({
      id: e.order.id ?? undefined,
      date: e.order.date ?? undefined,
      dateRaw: e.order.dateRaw ?? undefined,
      itemPaise: paiseStr(e.order.itemPaise),
      // The explicit money pair. itemPaise is the historic ambiguous name and is
      // read as a LINE TOTAL by the backend, so these two say which is which.
      unitPricePaise: paiseStr(e.order.unitPricePaise),
      lineTotalPaise: paiseStr(e.order.lineTotalPaise),
      // Only sent when a reader genuinely read it. Absent means UNKNOWN, and the
      // backend never reads unknown as 1 — it holds the refund for a human.
      ...(Number.isInteger(e.order.quantity) && e.order.quantity >= 1
        ? { quantity: e.order.quantity }
        : null),
      // Provenance for the quantity. Both are validated against a CLOSED LIST
      // backend-side, and an unrecognised value would 400 the WHOLE submission —
      // losing the order, the review and the delivery date with it. So anything
      // not on the list is dropped here rather than risked on the wire.
      ...(QUANTITY_SOURCES.indexOf(e.order.quantitySource) >= 0
        ? { quantitySource: e.order.quantitySource }
        : null),
      ...(QUANTITY_REASONS.indexOf(e.order.quantityReason) >= 0
        ? { quantityReason: e.order.quantityReason }
        : null),
      // A count the page stated that we will NOT compute with. Sent so a staff
      // member sees it; never read by the refund.
      ...(Number.isInteger(e.order.quantityObserved) && e.order.quantityObserved >= 1
        ? { quantityObserved: e.order.quantityObserved }
        : null),
      orderTotalPaise: paiseStr(e.order.orderTotalPaise),
      mrpPaise: paiseStr(e.order.mrpPaise),
      amountSource: e.order.amountSource ?? undefined,
      itemAmountAmbiguous: e.order.itemAmountAmbiguous ?? undefined,
      // HOW the order was matched. Must survive the wire: the backend's refund
      // gate refuses to release an ambiguous or amount-rejected match without an
      // explicit user confirmation, and it can only see that from here.
      match: e.order.match ? cleanMatch(e.order.match) : undefined,
      product: e.order.product ?? undefined,
      image: e.order.image ?? undefined,
      statusText: e.order.statusText ?? undefined,
      source: e.order.source, // required by the DTO
    });
  }

  if (e.delivery) {
    body.delivery = clean({
      at: e.delivery.at, // required int (epoch ms)
      raw: e.delivery.raw ?? undefined,
      source: e.delivery.source, // required by the DTO
    });
  }

  if (e.returned != null) body.returned = e.returned === true;

  // The scraper's order/verify probe (ordersFetched, authFailed, targetFound,
  // candidateCount, nameAvailable, …). Forward it so the reason a check found
  // nothing is recorded backend-side. The DTO validates it as an optional
  // object; evidenceFromDto maps it to Evidence.probe.
  if (e.probe && typeof e.probe === 'object') body.probe = e.probe;

  return body;
}
