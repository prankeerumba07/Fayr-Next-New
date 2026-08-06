// Convert an on-device Evidence object (the output of src/taskflow.js
// readEvidence) into the exact JSON body POST /tasks/:id/evidence expects:
//   - money (paise) as decimal STRINGS (JSON has no BigInt; the DTO matches /^\d+$/);
//   - `returned` sent only when known (omitted === "unknown");
//   - the idempotency `key` (derived here if not supplied);
//   - the scraper `probe` diagnostic forwarded (WHY a check found nothing) —
//     previously dropped, which blinded the backend to no-order/auth-fail cases.
// Pure — no network, no RN. Mirrors backend evidenceFromDto in reverse.
import { evidenceKey } from './evidenceKey.js';

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
      orderTotalPaise: paiseStr(e.order.orderTotalPaise),
      mrpPaise: paiseStr(e.order.mrpPaise),
      amountSource: e.order.amountSource ?? undefined,
      itemAmountAmbiguous: e.order.itemAmountAmbiguous ?? undefined,
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
