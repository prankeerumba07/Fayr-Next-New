import type { Evidence, EvidenceReview } from './evidence.types';
import {
  DAY,
  BLOCKERS,
  STATES,
  rank,
  sourceRank,
  type TaskStateName,
} from './states';
import type { EngineTask } from './task-state';
import { windowDaysFor, type ReturnPolicy } from './return-policy';

/**
 * The atomic, idempotent task state machine — ported semantics-for-semantics
 * from src/taskflow.js. It is PURE: no database, no clock beyond an injected
 * `at`. The NestJS TaskService hydrates an EngineTask, calls transition(), and
 * persists the result.
 *
 *   idempotent: an event `key` is applied at most once; replays are no-ops.
 *   atomic:     the next task is built in full and only then returned; a rejected
 *               or invalid transition returns the ORIGINAL task untouched.
 */
export type EngineEvent =
  | { type: 'EVIDENCE'; evidence: Evidence; key?: string; at?: number }
  | { type: 'CONFIRM_ORDER'; key?: string; at?: number }
  | { type: 'MARK_REVIEWED'; key?: string; at?: number }
  | { type: 'START_HOLD'; key?: string; at?: number }
  | { type: 'VISIBILITY_CHECK'; published: boolean; key?: string; at?: number }
  | {
      type: 'RELEASE_REFUND';
      policy?: ReturnPolicy;
      key?: string;
      at?: number;
    };

export interface TransitionResult {
  task: EngineTask;
  changed: boolean;
  rejected?: boolean;
  reason: string | null;
}

interface HandlerOutput {
  patch?: Partial<EngineTask>;
  to?: TaskStateName;
  reason?: string;
  reject?: string;
}

export function transition(
  task: EngineTask,
  event: EngineEvent,
): TransitionResult {
  const at = event.at ?? Date.now();

  if (event.key && task.applied[event.key]) {
    return {
      task,
      changed: false,
      reason: `duplicate event ignored (${event.key})`,
    };
  }
  if (task.state === STATES.REFUNDED) {
    return { task, changed: false, reason: 'task is REFUNDED (terminal)' };
  }

  const out = handle(task, event, at);
  if (out.reject) {
    return { task, changed: false, rejected: true, reason: out.reject };
  }

  const to = out.to ?? task.state;
  if (rank(to) < 0) {
    return {
      task,
      changed: false,
      rejected: true,
      reason: `illegal target ${to}`,
    };
  }

  const next: EngineTask = {
    ...task,
    ...(out.patch ?? {}),
    state: to,
    applied: event.key ? { ...task.applied, [event.key]: at } : task.applied,
    history: task.history.concat([
      {
        from: task.state,
        to,
        at,
        type: event.type,
        reason: out.reason ?? null,
      },
    ]),
  };

  return {
    task: next,
    changed: to !== task.state || out.patch != null,
    reason: out.reason ?? null,
  };
}

function handle(
  task: EngineTask,
  event: EngineEvent,
  at: number,
): HandlerOutput {
  switch (event.type) {
    case 'EVIDENCE':
      return onEvidence(task, event.evidence);
    case 'CONFIRM_ORDER':
      return onConfirmOrder(task);
    case 'MARK_REVIEWED':
      return onMarkReviewed(task);
    case 'START_HOLD':
      return onStartHold(task);
    case 'VISIBILITY_CHECK':
      return onVisibilityCheck(task, event.published === true, at);
    case 'RELEASE_REFUND':
      return onReleaseRefund(task, at, event.policy);
    default:
      return { reject: 'unknown event' };
  }
}

/** Evidence from a fetch. Drives CLAIMED → PURCHASED → DELIVERED. */
function onEvidence(task: EngineTask, evidence: Evidence): HandlerOutput {
  const e = evidence ?? {};
  if (e.blocker) {
    // A task that stalled must carry WHY (and the probe, so it's diagnosable
    // without reproducing), never a blank card.
    return {
      patch: {
        blocker: e.blocker,
        blockerReason: e.reason ?? null,
        probe: e.probe ?? null,
        review: e.review ?? task.review,
      },
      to: task.state,
      reason: e.blocker,
    };
  }

  const patch: Partial<EngineTask> = { blocker: null, blockerReason: null };
  if (e.review) patch.review = e.review;
  // Order & delivery carry a `source`: a LOWER-authority source (e.g. an
  // OCR-read screenshot) must never overwrite a fact a HIGHER-authority source
  // (DKIM/scraper order read) already established — otherwise a later OCR
  // upload-time delivery could clobber an earlier, verified delivery date and
  // move the return window. Keep the incumbent unless the incoming source ranks
  // at least as high.
  if (e.order) patch.order = preferByAuthority(task.order, e.order);
  if (e.delivery) patch.delivery = preferByAuthority(task.delivery, e.delivery);
  if (e.returned != null) patch.returned = e.returned;

  let to = task.state;
  if (rank(to) < rank(STATES.PURCHASED) && e.order) to = STATES.PURCHASED;
  if (rank(to) < rank(STATES.DELIVERED) && e.delivery) to = STATES.DELIVERED;
  return { patch, to, reason: 'evidence applied' };
}

/**
 * Choose between an incumbent sourced fact and an incoming one: keep the
 * incumbent when the incoming source ranks strictly LOWER (see sourceRank);
 * otherwise take the incoming (same-or-higher authority — preserves the prior
 * last-write-wins among equal-tier sources).
 */
function preferByAuthority<T extends { source?: string | null }>(
  incumbent: T | null,
  incoming: T,
): T {
  if (incumbent && sourceRank(incoming.source) < sourceRank(incumbent.source)) {
    return incumbent;
  }
  return incoming;
}

/** The user confirming "this is my order" — a human gate on real fetched values. */
function onConfirmOrder(task: EngineTask): HandlerOutput {
  if (!task.order) {
    return { reject: 'nothing to confirm: no order evidence' };
  }
  return {
    patch: { orderConfirmed: true },
    to: task.state,
    reason: 'user confirmed order',
  };
}

function onMarkReviewed(task: EngineTask): HandlerOutput {
  if (rank(task.state) < rank(STATES.DELIVERED)) {
    return { reject: 'cannot mark reviewed before delivery is verified' };
  }
  return { patch: {}, to: STATES.REVIEWED, reason: 'user marked reviewed' };
}

/** Entering the hold requires the review to be publicly visible NOW. */
function onStartHold(task: EngineTask): HandlerOutput {
  if (task.state !== STATES.REVIEWED) {
    return { reject: `cannot start hold from ${task.state}` };
  }
  if (!task.review || task.review.published !== true) {
    return {
      patch: {
        blocker: BLOCKERS.REVIEW_NOT_PUBLIC,
        blockerReason: 'Review is not publicly visible yet.',
      },
      to: task.state,
      reason: 'not public',
    };
  }
  return {
    patch: { blocker: null, blockerReason: null },
    to: STATES.HOLDING,
    reason: 'hold started',
  };
}

/**
 * A periodic permalink re-check during HOLDING (loophole 3). If the review
 * vanished, the task REGRESSES to REVIEWED so it cannot refund. The window is
 * anchored to the delivery date, so resuming later doesn't restart the clock.
 */
function onVisibilityCheck(
  task: EngineTask,
  published: boolean,
  at: number,
): HandlerOutput {
  const checks = task.visibilityChecks.concat([{ at, published }]);
  if (task.state !== STATES.HOLDING) {
    return {
      patch: {
        visibilityChecks: checks,
        review: withPublished(task.review, published),
      },
      to: task.state,
      reason: 'recorded',
    };
  }
  if (!published) {
    return {
      patch: {
        visibilityChecks: checks,
        review: withPublished(task.review, false),
        blocker: BLOCKERS.REVIEW_NOT_PUBLIC,
        blockerReason: 'Review is no longer publicly visible.',
      },
      to: STATES.REVIEWED,
      reason: 'review disappeared during hold',
    };
  }
  return {
    patch: {
      visibilityChecks: checks,
      review: withPublished(task.review, true),
    },
    to: task.state,
    reason: 'still public',
  };
}

function onReleaseRefund(
  task: EngineTask,
  at: number,
  policy?: ReturnPolicy,
): HandlerOutput {
  const elig = refundEligibility(task, at, policy);
  if (!elig.eligible) {
    return { reject: elig.reasons.join('; ') };
  }
  return {
    patch: { blocker: null, blockerReason: null },
    to: STATES.REFUNDED,
    reason: 'refund released',
  };
}

function withPublished(
  review: EvidenceReview | null,
  published: boolean,
): EvidenceReview | null {
  return review ? { ...review, published } : review;
}

export interface RefundEligibility {
  eligible: boolean;
  reasons: string[];
  windowEndsAt: number | null;
}

/**
 * The refund gate. Releases ONLY if: window elapsed AND published still true AND
 * NOT returned. Returns every failing reason so a held refund is explainable.
 */
export function refundEligibility(
  task: EngineTask,
  now: number,
  policy?: ReturnPolicy,
): RefundEligibility {
  const reasons: string[] = [];
  if (task.state !== STATES.HOLDING) {
    reasons.push(`state is ${task.state}, expected HOLDING`);
  }
  if (!task.review || task.review.published !== true) {
    reasons.push('review is not publicly visible');
  }
  if (task.returned === true) {
    reasons.push('order was returned or cancelled');
  }
  if (task.returned == null) {
    reasons.push('return status unknown (no readable order data)');
  }

  const w = windowEnd(task, policy);
  if (w == null) {
    reasons.push('no delivery date, so the return window cannot be computed');
  } else if (now < w) {
    reasons.push(
      `return window ends ${new Date(w).toISOString().slice(0, 10)}`,
    );
  }

  return { eligible: reasons.length === 0, reasons, windowEndsAt: w };
}

/**
 * Anchored to DELIVERY, not to when the hold started — so a task that regressed
 * and resumed does not restart its clock.
 */
export function windowEnd(
  task: EngineTask,
  policy?: ReturnPolicy,
): number | null {
  if (!task.delivery || task.delivery.at == null) return null;
  const days = windowDaysFor(policy, task.category);
  return task.delivery.at + days * DAY;
}

/** Re-check cadence during HOLDING — the only thing between a deleted review and a paid refund. */
export function shouldRecheckVisibility(
  task: EngineTask,
  now: number,
  intervalMs?: number,
): boolean {
  if (task.state !== STATES.HOLDING) return false;
  const every = intervalMs ?? DAY;
  const last = task.visibilityChecks.length
    ? task.visibilityChecks[task.visibilityChecks.length - 1].at
    : 0;
  return now - last >= every;
}
