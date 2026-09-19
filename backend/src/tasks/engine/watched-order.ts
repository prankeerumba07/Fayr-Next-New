/**
 * THE ORDER FAYR WATCHED BEING PLACED — THE RULES, WITH NOTHING ELSE IN THEM.
 *
 * ── WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT ─────────────────────────────
 *
 * MEASURED ON THE OWNER'S OWN ZEPTO PURCHASE, 18 SEPTEMBER 2026. One second
 * after he paid, the shop's page inside Fayr moved to
 *
 *   /order/status/01a0b4d7-870c-7dca-b701-e038477c5106
 *
 * The UUID in that address is the one handle the phone has on THAT order. It is
 * how the phone opens that order's own page later — for the order read, the
 * delivery read and the review read — instead of walking the shop's list and
 * reading six strangers, which is what it did that evening.
 *
 * IT IS NOT THE ORDER NUMBER. The same order's page prints JKLIKGSNS48449, and
 * THAT is what tasks.orderId holds and what the refund gate compares across
 * tasks to stop one purchase paying twice. The two are different identifiers for
 * one order and neither goes in the other's column. See tasks.watchedOrderKey
 * in schema.prisma for the same rule said beside the column.
 *
 * IT IS NOT EVIDENCE. Nothing here says an order matched, a parcel arrived or a
 * review was posted, and no gate reads it to decide money. It is a place to
 * look. The server still reads the page's TEXT and judges it exactly as before.
 *
 * ── UNTRUSTED, BOUNDED, WRITTEN ONCE ──────────────────────────────────────────
 *
 * It arrives through the ordinary device-evidence route, from a phone nobody can
 * attest, so the shape is bounded to what can honestly be part of an address —
 * the same rule src/shop/theOrderPage.js applies before it puts one in a URL —
 * and the first key a task hears is the key it keeps. A second, different key is
 * not an error the phone can act on and is not thrown: the phone's outbox would
 * park a refusal and retry it for ever.
 *
 * PURE. No Prisma, no Nest, no clock. The service next door does the writing.
 */

/**
 * WHAT A WATCHED ORDER KEY MAY LOOK LIKE: letters, digits, dot, underscore and
 * dash, no more than 120 of them.
 *
 * The same class of characters theOrderPage.js accepts, for the same reason: this
 * string ends up in the middle of an address the phone opens, and a slash, a
 * question mark or a space in it would let a record steer the view somewhere else
 * on the shop. Bounded in length because it is an address fragment, not prose.
 */
export const WATCHED_ORDER_KEY_SHAPE = /^[A-Za-z0-9._-]{1,120}$/;

/** Is this a watched order key at all? */
export function isAWatchedOrderKey(value: unknown): value is string {
  return typeof value === 'string' && WATCHED_ORDER_KEY_SHAPE.test(value);
}

/**
 * The fields of a submission that the ENGINE has something to do with.
 *
 * Named here rather than tested field by field at the call site, so the day a
 * new kind of evidence is added there is one list to add it to.
 */
const WHAT_THE_ENGINE_READS = [
  'order', 'delivery', 'review', 'blocker', 'returned', 'reason', 'probe',
] as const;

/**
 * DOES THIS SUBMISSION CARRY THE WATCHED KEY AND NOTHING THE ENGINE WOULD ACT ON?
 *
 * ── WHY IT MATTERS ────────────────────────────────────────────────────────────
 *
 * The phone reports the key through the evidence route, with nothing else in the
 * body. Running that body through transition() as an EVIDENCE event would not be
 * a no-op: onEvidence patches blocker to null, blockerReason to null and probe to
 * null on every fragment that carries no blocker, and writes an event row. A
 * task sitting on a real blocker would have it wiped by a key arriving. So a
 * body that is only the key is recorded and handed back without an engine event,
 * and a body that carries the key AND real evidence records the key and then
 * runs the evidence exactly as it always did.
 *
 * `undefined` and `null` both mean "not carried": the DTO leaves absent fields
 * undefined, and a client that writes null has still said nothing.
 */
export function carriesOnlyTheWatchedKey(
  dto: Record<string, unknown> | null | undefined,
): boolean {
  if (dto == null || typeof dto !== 'object') return false;
  if (!isAWatchedOrderKey(dto.watchedOrderKey)) return false;
  return WHAT_THE_ENGINE_READS.every((field) => dto[field] == null);
}

/**
 * WHICH KEY THE TASK KEEPS: the one it already has, or the incoming one when it
 * has none.
 *
 * FIRST WINS, and that is the whole rule. The confirmation page for one purchase
 * is seen once, and a second key can only mean a second purchase made from the
 * same claim or a page that merely looked like a confirmation. Neither is a reason
 * to move where three later reads will look. The caller logs a second, different
 * key and does not refuse it — see the top of this file for why refusing is the
 * wrong shape for the phone's outbox.
 */
export function theWatchedKeyToKeep(
  existing: string | null | undefined,
  incoming: string,
): string {
  return isAWatchedOrderKey(existing) ? existing : incoming;
}
