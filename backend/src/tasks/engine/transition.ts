import type { Evidence, EvidenceReview } from './evidence.types';
import {
  DAY,
  BLOCKERS,
  SOURCES,
  STATES,
  rank,
  sourceRank,
  type TaskStateName,
} from './states';
import type { EngineTask } from './task-state';
import { windowDaysFor, type ReturnPolicy } from './return-policy';
import { watchingTheReviewIsWorthIt } from './rating-mutability';
import { checkTheRating } from './rating-value';

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
  /**
   * Diagnostics that should be SAVED even though nothing changed — set only on a
   * duplicate-key no-op. A probe is information about the last attempt, not task
   * state, so refreshing it is safe and must not count as a transition: the
   * caller updates these fields WITHOUT writing an event row, so a user
   * re-fetching ten times gets ten fresh diagnostics and zero log growth.
   */
  diagnostics?: {
    probe: unknown;
    blockerReason: string | null;
    /**
     * Refreshed alongside the reason, NOT left behind. Omitting it produced a
     * self-contradicting record on 2026-08-12: a Nike task showed
     * blocker `order_unreadable` from an earlier attempt next to a reason from a
     * later one ("No matching review found"), which are mutually exclusive paths.
     */
    blocker: string | null;
  };
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
      // Carry the newest diagnostics out even though the event is a no-op. The
      // alternative — what this used to do — was to discard them, which meant a
      // task that had already recorded a miss could never report a fresher one.
      ...(event.type === 'EVIDENCE'
        ? {
            diagnostics: {
              probe: event.evidence.probe ?? null,
              blockerReason: event.evidence.reason ?? null,
              blocker: event.evidence.blocker ?? null,
            },
          }
        : {}),
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
      return onStartHold(task, at);
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
        // Through the SAME authority check as the success path below. This branch
        // used to replace the review wholesale, which was a second route straight
        // past it: an Amazon read that failed at the ORDER stage still carries a
        // review, and it would have silently undone a visibility verdict that
        // outranks it.
        review: e.review ? preferReview(task.review, e.review) : task.review,
      },
      to: task.state,
      reason: e.blocker,
    };
  }

  // A miss (nothing matched) is deliberately NOT a blocker — the task WAITS
  // rather than stalls (see readQuickCommerceEvidence / orderApiMiss in
  // src/taskflow.js). But it still carries diagnostics: `reason`, the human
  // sentence saying WHICH miss it was, and `probe`, the scraper's counters.
  // Both used to be dropped right here, on the one path every miss takes — so
  // "why did this check find nothing" was invisible backend-side even though
  // the device sent it and the DTO accepted it. Carry them. A successful read
  // arrives with neither, so both self-clear instead of going stale.
  const patch: Partial<EngineTask> = {
    blocker: null,
    blockerReason: e.reason ?? null,
    probe: e.probe ?? null,
  };
  // `published` is a PAYOUT SIGNAL, so the review is merged by authority too —
  // see preferReview. For every review written before `publishedSource` existed
  // this is a no-op (rank 0 vs rank 0 keeps last-write-wins), which is deliberate:
  // nothing that released yesterday behaves differently today.
  if (e.review) patch.review = preferReview(task.review, e.review);
  // Order & delivery carry a `source`: a LOWER-authority source (e.g. an
  // OCR-read screenshot) must never overwrite a fact a HIGHER-authority source
  // (DKIM/scraper order read) already established — otherwise a later OCR
  // upload-time delivery could clobber an earlier, verified delivery date and
  // move the return window. Keep the incumbent unless the incoming source ranks
  // at least as high.
  if (e.order) patch.order = preferByAuthority(task.order, e.order);
  if (e.delivery) patch.delivery = preferByAuthority(task.delivery, e.delivery);
  if (e.returned != null) patch.returned = e.returned;
  // ── AND THE FIRST NUMBER WE EVER SAW, KEPT — 22 SEPTEMBER 2026 ──────────
  //
  // Written once and never moved, for the same reason holdStartedAt is: a value
  // that follows the latest reading is not a baseline, and a claimant who can
  // move the baseline can move the rating under it. `?? ` is the whole rule.
  //
  // It is taken from the MERGED review rather than the incoming one, so a
  // lower-authority source cannot set a baseline that preferReview then refused
  // to accept as the current value.
  if (patch.review?.rating != null && task.ratingFirstSeen == null) {
    patch.ratingFirstSeen = patch.review.rating;
  }

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

/**
 * The same rule for a review, ranked on `publishedSource` rather than `source`,
 * because `published` is the only fact on a review that money depends on.
 *
 * Both directions matter and each has cost real product behaviour:
 *   - a device read that never looked at a public page must not undo a Fayr
 *     reviewer who did (Meesho emits published:false on EVERY fetch, so without
 *     this the eyes-on-page confirmation would survive until the user next
 *     pressed Fetch);
 *   - a machine that DID fetch the page must be able to overturn that reviewer,
 *     or the confirmation becomes a hand-operated way to disarm the
 *     deleted-review countermeasure.
 */
function preferReview(
  incumbent: EvidenceReview | null,
  incoming: EvidenceReview,
): EvidenceReview {
  if (
    incumbent &&
    sourceRank(incoming.publishedSource) <
      sourceRank(incumbent.publishedSource)
  ) {
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
function onStartHold(task: EngineTask, at: number): HandlerOutput {
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
    // ── AND THE MOMENT THE WATCH BEGAN IS WRITTEN DOWN ────────────────────
    //
    // WRITTEN ONCE AND NEVER MOVED. A task that regresses out of HOLDING and
    // comes back keeps the first instant, for the same reason windowEnd keeps
    // the delivery: a clock that restarts is a clock a claimant can reset by
    // making the review vanish and reappear. `?? at` is the whole of that rule.
    patch: {
      blocker: null,
      blockerReason: null,
      holdStartedAt: task.holdStartedAt ?? at,
    },
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

/**
 * Apply a VISIBILITY_CHECK verdict to the review.
 *
 * Stamped as a MACHINE read, because that is what it is: this event is only ever
 * reached after the scheduler has fetched the review's public permalink (see
 * SchedulerService.runTick, which skips any task without one and treats a
 * transient fetch failure as "no answer" rather than "not visible"). Stamping it
 * is what lets the re-check overturn a staff eye-witness — the loophole-3
 * countermeasure has to be the strongest thing in the system, not a peer of
 * somebody's recollection.
 *
 * The staff observation fields are cleared with it: a machine has now answered
 * the question, so leaving "a person saw it at this URL on Tuesday" beside the
 * newer verdict would produce a record that contradicts itself.
 */
function withPublished(
  review: EvidenceReview | null,
  published: boolean,
): EvidenceReview | null {
  return review
    ? {
        ...review,
        published,
        publishedSource: SOURCES.REVIEW_PUBLIC,
        visibleUrl: null,
        visibleCheckedAt: null,
      }
    : review;
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

  // ── AND THE WATCH ON THE REVIEW, WHICH IS A DIFFERENT CLOCK ──────────────
  //
  // MEASURED, on the owner's own completed Cadbury journey, 22 September 2026:
  //
  //   deliveredAt   09:30:00
  //   windowEndsAt  09:32:00   the two-minute hold, anchored to DELIVERY
  //   review seen   09:37:44   already five minutes past the window
  //   refund        09:38:00   sixteen seconds after the review
  //
  // The hold had expired before the review existed. His review was never held
  // at all, and no re-check could have happened inside a window already over.
  // He asked for the anchor to start from the review, and he is right.
  //
  // BOTH CLOCKS, AND THE LATER OF THE TWO — never one instead of the other.
  // They answer different questions and both must be satisfied:
  //
  //   windowEnd      when may this no longer be sent back?  runs from DELIVERY,
  //                  because that is genuinely when a return window starts. On
  //                  Amazon it is the shop's own printed date.
  //   this one       how long have we watched the review?   runs from the review,
  //                  because a watch that starts before the thing it watches is
  //                  not a watch.
  //
  // IT CAN ONLY EVER LENGTHEN A HOLD. Taking the later of two instants is the
  // same rule windowEnd already applies to the shop's stated date, and for the
  // same reason: the worst this can do is make somebody wait, never pay early.
  //
  // NULL IS NOT A FAILURE. A task written before holdStartedAt existed has none
  // to satisfy, and its refund falls due exactly when it did before — this
  // change moves no refund that was already computed.
  //
  // ── AND NOT AT ALL WHERE THE RATING CANNOT CHANGE — 22 SEPTEMBER 2026 ────
  //
  // The owner measured the three quick-commerce apps: "On ZEPTO, once the user
  // gives a review and rating, they cannot edit it or remove it later." If it
  // cannot change, watching it protects nothing, and a hold that protects
  // nothing is not a safeguard — it is a delay with a safeguard's name on it,
  // paid for by somebody waiting for their own money. Loophole 3 is
  // structurally absent on that shop and this clock says so by not running.
  //
  // THE OTHER CLOCK STILL RUNS. windowEnd is untouched and still holds every
  // Zepto task for its three hours, because the risk it answers is different
  // and real: the owner's own Cadbury order was CANCELLED after delivery. What
  // is being skipped is the watch on the review, not the hold.
  if (task.holdStartedAt != null && watchingTheReviewIsWorthIt(task.platform)) {
    const holdMs = typeof policy?.holdMs === 'number' && Number.isFinite(policy.holdMs)
      ? policy.holdMs
      : null;
    if (holdMs != null) {
      const watchedUntil = task.holdStartedAt + holdMs;
      if (now < watchedUntil) {
        reasons.push(
          `the review has been watched for ${Math.round((now - task.holdStartedAt) / 1000)}s `
          + `of the required ${Math.round(holdMs / 1000)}s`,
        );
      }
    }
  }

  // ── AND THE RATING THEY ACTUALLY GAVE — 22 SEPTEMBER 2026 ────────────────
  //
  // Until now the only question asked about a review was `published === true`,
  // meaning "a rating exists". The owner measured that on Blinkit and Instamart
  // a rating can be EDITED but never DELETED, so that boolean is PERMANENTLY
  // TRUE on those shops and can never fail. A check that cannot fail is a green
  // tick that means nothing.
  //
  // The NUMBER can fail, two ways, and both are real:
  //   below what the campaign asked   the person did not do the thing the offer
  //                                   was for. minRating has been on the
  //                                   campaign all along and NOTHING read it.
  //   lower than when we first saw it loophole 3, in the only shape Blinkit
  //                                   permits.
  //
  // AND WHERE THE SHOP HIDES THE NUMBER THIS HOLDS NOTHING. Instamart never
  // exposes a star count anywhere Fayr can read — its own reader in platforms.js
  // says so and sets rating null. Refusing to pay for that would punish every
  // honest person there for Swiggy's choice. It is recorded as unverifiable and
  // the refund proceeds on the evidence that does exist, which is exactly how
  // the scheduler already treats an unverified quick-commerce release.
  const rating = checkTheRating({
    platform: task.platform,
    minRating: policy?.minRating ?? null,
    firstSeen: task.ratingFirstSeen ?? null,
    now: task.review?.rating ?? null,
  });
  if (rating.holdsTheRefund) reasons.push(rating.because);

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
  // ── A HOLD MEASURED IN HOURS, WHERE DAYS ARE THE WRONG UNIT — Phase 8B-b ──
  //
  // Zepto, Blinkit and Instamart cannot be sent back to, so the operator's day
  // table holds somebody's money against a risk that does not exist on those
  // shops. policyForWindowDays decides which campaigns get this and puts the
  // answer on the policy; see QUICK_COMMERCE_HOLD_HOURS for the owner's words
  // and for why an operator-set window is asked first and wins outright.
  //
  // ANCHORED TO THE SAME INSTANT AS THE DAY TABLE — the delivery the shop's own
  // page stated, and not the review, not the claim, not when the hold started.
  // A task that regressed and resumed does not restart its clock, and that is
  // as true of three hours as it is of seven days.
  const holdMs = typeof policy?.holdMs === 'number' && Number.isFinite(policy.holdMs)
    ? policy.holdMs
    : null;
  const days = windowDaysFor(policy, task.category);
  const fromThePolicyTable = holdMs != null
    ? task.delivery.at + holdMs
    : task.delivery.at + days * DAY;

  // ── AND THE SHOP'S OWN WORD, WHEN ITS PAGE STATED ONE ────────────────────
  //
  // return-policy.ts says of itself that "no marketplace exposes a return-window
  // end date, so this is the OPERATOR's policy table". That is true of six of
  // the seven. Amazon prints it on the order page in words — "Return window
  // closed on 19 June 2026" — and it is read now.
  //
  // THE LATER OF THE TWO, ALWAYS, AND NEVER THE EARLIER. Two reasons, and either
  // alone would be enough.
  //
  // THE FIRST IS WHERE THIS NUMBER COMES FROM. It is text off a page, posted by
  // a device nobody can attest. Taking the earlier of the two would let whatever
  // sent it SHORTEN its own hold, which is the one thing a claimant would want
  // to do and the one thing the hold exists to prevent. Taking the later means
  // the worst a forged value can do is hold somebody's own refund longer.
  //
  // THE SECOND IS THAT THE TABLE IS A FLOOR BY DESIGN. It is the operator's
  // policy, maintained by hand, and it is what the person was told when they
  // claimed. A shop that happens to print a shorter window does not shorten
  // what Fayr promised to wait.
  const theShopSaid = task.delivery.returnWindowEndsAt ?? null;
  if (theShopSaid == null || !Number.isFinite(theShopSaid)) return fromThePolicyTable;
  return theShopSaid > fromThePolicyTable ? theShopSaid : fromThePolicyTable;
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
