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
/**
 * A miss's diagnosis, as a short stable token.
 *
 * Deliberately CATEGORIES, not raw counts. Keying on `reviewsSeen: 12` would mint
 * a new key the moment the user writes an unrelated 13th review, growing the
 * event log for no new information. Categories are bounded (five, plus ten score
 * buckets) while still separating the failures that need separating.
 *
 * `_` is preserved for "no probe at all" so an older client that sends none keeps
 * its historical key and does not suddenly re-apply.
 */
function missCategory(probe) {
  if (!probe) return '_';
  // The script refused to surface anything (e.g. no campaign ASIN was set). This
  // is not a matching failure at all and must never look like one.
  if (probe.fetchError) return `err-${String(probe.fetchError).slice(0, 32)}`;
  if (probe.reviewsSeen === 0) return 'empty';
  // Reviews came back but no product title resolved, so nothing could be scored.
  if (probe.namesResolved === 0) return 'nonames';
  if (typeof probe.bestScore === 'number' && probe.bestScore > 0) {
    // One decimal: enough to tell "0.5, nearly there" from "0.1, wrong product",
    // without a new key every time a title's wording shifts slightly.
    return `score-${probe.bestScore.toFixed(1)}`;
  }
  return 'nomatch';
}

export function evidenceKey(evidence) {
  const e = evidence || {};
  // A blocker is its own kind of event; key it by the blocker so a repeated
  // "still unreadable" result collapses, but a change of blocker applies.
  if (e.blocker) return `evidence:blocker:${e.blocker}`;

  // A MISS has no order id, so every miss on a task used to collapse to the one
  // key `evidence:none:_`. The first miss claimed it forever and every later miss
  // was short-circuited before the engine ran — so a task that failed once could
  // never record WHY it failed again. Proven live on 2026-08-12: a Nike task
  // spent that key on 2026-08-11, and the next day's fetch left no trace at all.
  //
  // So key a miss by its DIAGNOSIS. A different kind of failure writes a new
  // record; an identical repeat still collapses, which is the property that made
  // this an idempotency key in the first place.
  if (!(e.order && e.order.id)) {
    return `evidence:none:${missCategory(e.probe)}`;
  }

  const base = String(e.order.id);
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
