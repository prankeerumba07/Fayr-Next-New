// The four user-driven task transitions, and the rules about them that are worth
// testing. Pure — no expo, no RN — so it runs under plain `node` while both
// tasksApi (which needs the URL) and taskStore (which needs the routing rules)
// import the same single definition.
//
// These are NOT evidence. They carry no payload: the action IS the URL, the
// backend runs the same state machine, and it returns the authoritative task.
import { STATES } from '../taskflow.js';

/** Event type → the POST /tasks/:id/<path> route that performs it. */
export const ACTION_PATHS = Object.freeze({
  CONFIRM_ORDER: 'confirm-order',
  MARK_REVIEWED: 'reviewed',
  START_HOLD: 'start-hold',
  RELEASE_REFUND: 'release-refund',
});

export function isTaskAction(type) {
  return Object.prototype.hasOwnProperty.call(ACTION_PATHS, type);
}

const RANKS = [
  STATES.CLAIMED, STATES.PURCHASED, STATES.DELIVERED,
  STATES.REVIEWED, STATES.HOLDING, STATES.REFUNDED,
];

/**
 * Should this action be SKIPPED because the authoritative task already reflects
 * it? Guards only what needs guarding:
 *
 *   MARK_REVIEWED   — the route takes no idempotency key, and a repeat from
 *                     REVIEWED is ACCEPTED by the engine (its only gate is
 *                     "not before DELIVERED"). So a second tap re-sets the same
 *                     state and writes a duplicate audit row. Guard it.
 *   START_HOLD      — no guard needed: the engine rejects it from any state
 *                     except REVIEWED, so a repeat 409s instead of applying.
 *   RELEASE_REFUND  — no guard needed, and it is the one that moves money:
 *                     REFUNDED is terminal in transition(), attemptRelease
 *                     short-circuits to 'already', and the engine event carries
 *                     `release:<taskId>` so a replay hits the applied-key set.
 *   CONFIRM_ORDER   — NOW guarded. It used to be unguarded because TaskResponse
 *                     exposed no `orderConfirmed`, leaving nothing authoritative
 *                     to test — and a guard that silently never fires is worse
 *                     than none. That gap was not theoretical: on 2026-08-10 a
 *                     Zepto task logged TWO CONFIRM_ORDER events 909ms apart,
 *                     the only duplicate (taskId,key) pair in the whole DB,
 *                     because the route takes no idempotency key either. The
 *                     field is now returned on `order`, so the guard reads a
 *                     real server fact rather than guessing.
 */
export function alreadyApplied(type, authoritative) {
  if (!authoritative || !authoritative.state) return false;
  if (type === 'MARK_REVIEWED') {
    return RANKS.indexOf(authoritative.state) >= RANKS.indexOf(STATES.REVIEWED);
  }
  if (type === 'CONFIRM_ORDER') {
    // Strictly true-only: an absent field means "this server doesn't tell us",
    // which must never be read as "already confirmed".
    return authoritative.order != null && authoritative.order.orderConfirmed === true;
  }
  return false;
}
