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
  OCR: 'ocr',
} as const;

export type SourceName = (typeof SOURCES)[keyof typeof SOURCES];

/**
 * Evidence authority for merge decisions: a lower-authority source must never
 * overwrite a fact a higher-authority source already established. Deliberately
 * COARSE for now — `ocr` (tier-3, staff-approved screenshot) is the LOWEST and
 * ranks below everything; all other sources rank equal, preserving their
 * existing last-write-wins behaviour among themselves. Refine into finer tiers
 * (DKIM > scraping) when that distinction actually gates a merge.
 */
export function sourceRank(source?: string | null): number {
  return source === SOURCES.OCR ? 0 : 1;
}

export const DAY = 86_400_000;

export function rank(state: string): number {
  return ORDER.indexOf(state as TaskStateName);
}
