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
  MANUAL: 'manual',
  INVOICE: 'invoice',
  OCR: 'ocr',
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
];

/**
 * ASSERTED — a person typed it, or a picture/PDF they chose implied it. Anyone
 * can type "I paid ₹5,000", and a doctored screenshot extracts perfectly
 * cleanly, so these are supporting evidence only and always need a human.
 */
export const ASSERTED_SOURCES: readonly SourceName[] = [
  SOURCES.INVOICE,
  SOURCES.MANUAL,
  SOURCES.OCR,
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
 *   4  dkim           — signed by the marketplace; the user cannot forge it
 *   3  order-details  — scraped from the account's own pages, on-device
 *   3  order-history  — ditto (peers: a re-fetch should still update)
 *   2  invoice        — a document the USER chose to upload
 *   1  manual         — a number the USER typed
 *   1  ocr            — a screenshot the USER chose
 *   0  unknown        — never ties with anything real
 *
 * `ocr` and `manual` sit level deliberately: both are entirely user-chosen, and
 * neither should be able to overwrite the other's staff-approved value.
 */
const SOURCE_RANK: Record<string, number> = {
  [SOURCES.DKIM]: 4,
  [SOURCES.ORDER_DETAILS]: 3,
  [SOURCES.ORDER_HISTORY]: 3,
  [SOURCES.INVOICE]: 2,
  [SOURCES.MANUAL]: 1,
  [SOURCES.OCR]: 1,
};

export function sourceRank(source?: string | null): number {
  if (source == null) return 0;
  return SOURCE_RANK[source] ?? 0;
}

export const DAY = 86_400_000;

export function rank(state: string): number {
  return ORDER.indexOf(state as TaskStateName);
}
