/**
 * The task state machine — states, ordering, blockers, and evidence sources.
 *
 * Ported verbatim (semantics-preserving) from the proven src/taskflow.js. The
 * state NAMES are identical to the Prisma TaskState enum, so an EngineTask.state
 * persists straight into the tasks.state column with no mapping.
 */
export const STATES = {
  CLAIMED: 'CLAIMED',
  PURCHASED: 'PURCHASED',
  DELIVERED: 'DELIVERED',
  REVIEWED: 'REVIEWED',
  HOLDING: 'HOLDING',
  REFUNDED: 'REFUNDED',
} as const;

export type TaskStateName = (typeof STATES)[keyof typeof STATES];

/**
 * Ordered so regressions can be reasoned about (HOLDING → REVIEWED is allowed
 * when a review disappears mid-hold). rank() is the index into this array.
 */
export const ORDER: TaskStateName[] = [
  STATES.CLAIMED,
  STATES.PURCHASED,
  STATES.DELIVERED,
  STATES.REVIEWED,
  STATES.HOLDING,
  STATES.REFUNDED,
];

/** Why a task cannot advance. Surfaced to the user verbatim. */
export const BLOCKERS = {
  RECONNECT: 'reconnect_account',
  ORDER_UNREADABLE: 'order_unreadable',
  NO_DELIVERY_DATE: 'no_delivery_date',
  REVIEW_NOT_PUBLIC: 'review_not_public',
  RETURNED: 'returned',
  /**
   * The order is real and readable — it simply predates the claim (or postdates
   * the purchase deadline). A RULE, not a failure, and unfixable by any upload:
   * distinct from ORDER_UNREADABLE precisely so the screen can say so and NOT
   * offer a screenshot that cannot help.
   */
  ORDER_OUT_OF_WINDOW: 'order_out_of_window',
} as const;

export type BlockerName = (typeof BLOCKERS)[keyof typeof BLOCKERS];

/**
 * Where a fact came from — never let an unsourced value into the flow. These
 * double as the evidence AUTHORITY tiers (highest to lowest): a DKIM-signed
 * marketplace email and the scraper's order reads are the authoritative sources;
 * `ocr` (a staff-approved screenshot read) is the LOWEST tier — tier-3
 * supporting evidence. `ocr` is produced ONLY by the staff verification approve
 * action; the user-facing evidence DTO rejects it, so a user can never
 * self-submit an `ocr`-sourced fragment and skip the human gate.
 */
export const SOURCES = {
  ORDER_DETAILS: 'order-details',
  ORDER_HISTORY: 'order-history',
  DKIM: 'dkim',
  /**
   * A machine established that the review is PUBLICLY VISIBLE — either by
   * fetching the public permalink (Amazon, and the HOLDING re-check) or by
   * reading the marketplace's own moderation verdict (Flipkart says "approved").
   * The only source that can settle `published` without a person.
   */
  REVIEW_PUBLIC: 'review-public',
  MANUAL: 'manual',
  INVOICE: 'invoice',
  OCR: 'ocr',
  /**
   * A Fayr reviewer opened the public product page and said what they saw.
   *
   * Its own tier because it is unlike everything else here: asserted, so no
   * machine stands behind it, yet NOT chosen by the person being paid. It exists
   * for Meesho, which shows the star on the order and the words only inside its
   * app — so no machine can ever settle `published` there and the alternative is
   * a task that can never be refunded at all.
   *
   * It fills a gap and never overrules a machine. See review-visibility.spec.ts.
   */
  STAFF_VISIBLE: 'staff-confirmed-visible',
} as const;

export type SourceName = (typeof SOURCES)[keyof typeof SOURCES];

/**
 * ATTESTED — a machine read this off the marketplace itself. The user cannot
 * choose the value: a DKIM-signed email is cryptographically the marketplace's,
 * and the scraper reads the account's own rendered pages on-device.
 */
export const ATTESTED_SOURCES: readonly SourceName[] = [
  SOURCES.DKIM,
  SOURCES.ORDER_DETAILS,
  SOURCES.ORDER_HISTORY,
  SOURCES.REVIEW_PUBLIC,
];

/**
 * ASSERTED — a person said so. Anyone can type "I paid ₹5,000", and a doctored
 * screenshot extracts perfectly cleanly, so these are supporting evidence only
 * and always need a human in the loop.
 *
 * `staff-confirmed-visible` belongs here for the same reason the others do — no
 * machine stands behind it — but it is not the same KIND of assertion: the other
 * three are chosen by the person being paid, and that one is not. The ranking
 * below is where that difference is expressed, not this list.
 */
export const ASSERTED_SOURCES: readonly SourceName[] = [
  SOURCES.INVOICE,
  SOURCES.MANUAL,
  SOURCES.OCR,
  SOURCES.STAFF_VISIBLE,
];

export function isAttestedSource(source?: string | null): boolean {
  return ATTESTED_SOURCES.includes(source as SourceName);
}

/**
 * Evidence authority for merge decisions: a lower-authority source must never
 * overwrite a fact a higher-authority source already established.
 *
 * The ranking used to be BINARY — only `ocr` ranked low and everything else tied
 * at 1. That was a live hole, not just a coarse approximation: `manual` already
 * existed AND the user-facing evidence DTO already accepted it, so a user could
 * submit `source: 'manual'` with any `itemPaise`, tie with `order-details`, and
 * replace genuine scraped order data by last-write-wins.
 *
 * Tiers, highest first:
 *   5  dkim                     — signed by the marketplace; unforgeable by the user
 *   4  order-details            — scraped from the account's own pages, on-device
 *   4  order-history            — ditto (peers: a re-fetch should still update)
 *   4  review-public            — the public review itself, read by machine
 *   3  staff-confirmed-visible  — a Fayr reviewer opened the page and looked
 *   2  invoice                  — a document the USER chose to upload
 *   1  manual                   — a number the USER typed
 *   1  ocr                      — a screenshot the USER chose
 *   0  unknown                  — never ties with anything real
 *
 * `ocr` and `manual` sit level deliberately: both are entirely user-chosen, and
 * neither should be able to overwrite the other's staff-approved value.
 *
 * `staff-confirmed-visible` sits in a gap of its own, between every machine and
 * everything the user hands us, and the gap is the whole point:
 *   - ABOVE the user's own evidence, because a Fayr reviewer's observation is not
 *     something the person being paid selected;
 *   - BELOW every machine read, because a person remembering a page is weaker
 *     than a fetch of that page — which keeps the deleted-review countermeasure
 *     armed rather than overridable by hand.
 */
const SOURCE_RANK: Record<string, number> = {
  [SOURCES.DKIM]: 5,
  [SOURCES.ORDER_DETAILS]: 4,
  [SOURCES.ORDER_HISTORY]: 4,
  [SOURCES.REVIEW_PUBLIC]: 4,
  [SOURCES.STAFF_VISIBLE]: 3,
  [SOURCES.INVOICE]: 2,
  [SOURCES.MANUAL]: 1,
  [SOURCES.OCR]: 1,
};

export function sourceRank(source?: string | null): number {
  if (source == null) return 0;
  return SOURCE_RANK[source] ?? 0;
}

export const DAY = 86_400_000;

/**
 * One minute in milliseconds. Here beside DAY rather than written out at the one
 * call site, because the claim window is measured in minutes now and a second
 * copy of 60_000 is a second thing that can be typed wrong.
 */
export const MINUTE = 60_000;

export function rank(state: string): number {
  return ORDER.indexOf(state as TaskStateName);
}
