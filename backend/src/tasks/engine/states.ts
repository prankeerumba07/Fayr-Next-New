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

/** Where a fact came from — never let an unsourced value into the flow. */
export const SOURCES = {
  ORDER_DETAILS: 'order-details',
  ORDER_HISTORY: 'order-history',
  DKIM: 'dkim',
  MANUAL: 'manual',
} as const;

export type SourceName = (typeof SOURCES)[keyof typeof SOURCES];

export const DAY = 86_400_000;

export function rank(state: string): number {
  return ORDER.indexOf(state as TaskStateName);
}
