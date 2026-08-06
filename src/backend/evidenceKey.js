// The idempotency key sent with an evidence POST, so a re-run of the SAME check
// is a backend no-op (the engine records applied keys per task).
//
// It is a SUPERSET of ConnectScreen's local key (`evidence:<orderId|blocker>`):
// it ALSO encodes which material, state-advancing facts the fragment carries —
// order / delivery / returned / review-published — so that
//   - re-fetching an UNCHANGED order → identical key → the backend no-ops it;
//   - a purchase-only fetch and a LATER purchase+delivery fetch on the SAME
//     order → DIFFERENT keys → both apply, and the delivery is never silently
//     dropped (the bug that reusing the bare order-id key would cause).
//
// Deterministic: same evidence in → same key out. No clock, no randomness — that
// is what makes it safe to reuse as an idempotency key. Pure (no RN, no network).
export function evidenceKey(evidence) {
  const e = evidence || {};
  // A blocker is its own kind of event; key it by the blocker so a repeated
  // "still unreadable" result collapses, but a change of blocker applies.
  if (e.blocker) return `evidence:blocker:${e.blocker}`;

  const base = e.order && e.order.id ? String(e.order.id) : 'none';
  // Presence of each state-advancing fact (NOT its exact value): this is the
  // granularity that distinguishes purchase-only from purchase+delivery without
  // re-triggering on harmless value jitter.
  const flags =
    (e.order ? 'o' : '') +
    (e.delivery ? 'd' : '') +
    (e.returned === true ? 'r' : e.returned === false ? 'n' : '') +
    (e.review && e.review.published === true ? 'p' : '');
  return `evidence:${base}:${flags || '_'}`;
}
