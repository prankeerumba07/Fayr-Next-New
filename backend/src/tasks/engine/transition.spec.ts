import { computeRefundPaise } from './money';
import {
  DEFAULT_RETURN_POLICY,
  policyForWindowDays,
  windowDaysFor,
} from './return-policy';
import { DAY, STATES } from './states';
import { createTask, type EngineTask } from './task-state';
import {
  refundEligibility,
  shouldRecheckVisibility,
  transition,
  windowEnd,
  type EngineEvent,
} from './transition';

/**
 * Pure unit tests for the ported state machine — no DB, no wall clock. They pin
 * the proven behavior from src/taskflow.js: the forward progression, the HOLDING
 * clawback regression, the refund gate, idempotency, and atomicity.
 */

const T0 = Date.UTC(2026, 6, 1); // fixed base clock

function fresh(): EngineTask {
  return createTask({
    id: 't1',
    platform: 'amazon',
    category: 'electronics', // 10-day window
    asin: 'A1',
    product: 'boAt Rockerz',
  });
}

function drive(task: EngineTask, events: EngineEvent[]): EngineTask {
  return events.reduce((t, e) => transition(t, e).task, task);
}

const orderEvidence: EngineEvent = {
  type: 'EVIDENCE',
  at: T0,
  evidence: {
    order: { id: 'o1', itemPaise: 129900n, source: 'order-details' },
    returned: false,
  },
};
const deliveryEvidence: EngineEvent = {
  type: 'EVIDENCE',
  at: T0,
  evidence: {
    delivery: { at: T0, source: 'order-details' },
    review: { published: true, product: 'boAt Rockerz' },
  },
};

describe('transition — forward progression', () => {
  it('advances CLAIMED → PURCHASED → DELIVERED → REVIEWED → HOLDING', () => {
    let t = fresh();
    expect(t.state).toBe(STATES.CLAIMED);

    t = transition(t, orderEvidence).task;
    expect(t.state).toBe(STATES.PURCHASED);
    expect(t.order?.itemPaise).toBe(129900n);
    expect(t.returned).toBe(false);

    t = transition(t, deliveryEvidence).task;
    expect(t.state).toBe(STATES.DELIVERED);
    expect(t.review?.published).toBe(true);

    t = transition(t, { type: 'MARK_REVIEWED', at: T0 }).task;
    expect(t.state).toBe(STATES.REVIEWED);

    t = transition(t, { type: 'START_HOLD', at: T0 }).task;
    expect(t.state).toBe(STATES.HOLDING);
  });

  it('records a blocker without advancing, keeping prior state', () => {
    const t = transition(fresh(), {
      type: 'EVIDENCE',
      at: T0,
      evidence: { blocker: 'reconnect_account', reason: 'Reconnect Amazon' },
    });
    expect(t.task.state).toBe(STATES.CLAIMED);
    expect(t.task.blocker).toBe('reconnect_account');
    expect(t.task.blockerReason).toBe('Reconnect Amazon');
  });
});

// A miss is the ONLY outcome that leaves a task where it was, so it is the one
// outcome that has to explain itself. These used to be silently dropped: the
// Instamart dinner-set miss (2026-08-08) reached the backend with probe null
// and no reason, and the only way left to tell "orders read, no match" from
// "couldn't read orders at all" was the POST's Content-Length.
describe('transition — a non-blocking miss keeps its diagnostics', () => {
  const missEvidence = {
    type: 'EVIDENCE' as const,
    at: T0,
    key: 'evidence:none:_',
    evidence: {
      blocker: null,
      reason: "This product isn't in your Instamart orders yet.",
      probe: { ordersFetched: true, ordersCount: 7, targetFound: false },
    },
  };

  it('persists reason and probe without blocking or advancing', () => {
    const t = transition(fresh(), missEvidence).task;
    expect(t.state).toBe(STATES.CLAIMED);
    expect(t.blocker).toBeNull();
    expect(t.blockerReason).toBe(
      "This product isn't in your Instamart orders yet.",
    );
    expect(t.probe).toEqual({
      ordersFetched: true,
      ordersCount: 7,
      targetFound: false,
    });
  });

  it('distinguishes the two miss kinds by their stored reason', () => {
    const couldNotRead = transition(fresh(), {
      type: 'EVIDENCE',
      at: T0,
      evidence: {
        blocker: null,
        reason: "Couldn't read your Instamart orders.",
        probe: { ordersFetched: false },
      },
    }).task;
    expect(couldNotRead.blockerReason).toBe(
      "Couldn't read your Instamart orders.",
    );
    expect(couldNotRead.probe).toEqual({ ordersFetched: false });
  });

  it('a later successful read self-clears the stale reason and probe', () => {
    const missed = transition(fresh(), missEvidence).task;
    expect(missed.blockerReason).not.toBeNull();

    const found = transition(missed, orderEvidence).task;
    expect(found.state).toBe(STATES.PURCHASED);
    expect(found.blockerReason).toBeNull();
    expect(found.probe).toBeNull();
  });

  it('is still idempotent — a replayed miss key is a no-op', () => {
    const once = transition(fresh(), missEvidence).task;
    const twice = transition(once, missEvidence);
    expect(twice.changed).toBe(false);
    expect(twice.task.history).toHaveLength(once.history.length);
  });
});

describe('transition — evidence source authority (OCR is the lowest tier)', () => {
  const EARLIER = T0;
  const LATER = T0 + 5 * DAY;

  it('a lower-tier OCR delivery cannot override an earlier higher-tier delivery date', () => {
    const t = drive(fresh(), [
      orderEvidence,
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { delivery: { at: EARLIER, source: 'order-details' } },
      },
      // An OCR screenshot approved later, timestamped at its upload time (LATER):
      {
        type: 'EVIDENCE',
        at: LATER,
        evidence: { delivery: { at: LATER, source: 'ocr' } },
      },
    ]);
    expect(t.delivery?.at).toBe(EARLIER); // the earlier, higher-tier date wins
    expect(t.delivery?.source).toBe('order-details');
  });

  it('a higher-tier delivery DOES correct an earlier OCR delivery', () => {
    const t = drive(fresh(), [
      orderEvidence,
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { delivery: { at: LATER, source: 'ocr' } },
      },
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { delivery: { at: EARLIER, source: 'order-details' } },
      },
    ]);
    expect(t.delivery?.at).toBe(EARLIER);
    expect(t.delivery?.source).toBe('order-details');
  });

  it('a lower-tier OCR order cannot wipe a higher-tier verified itemPaise', () => {
    const t = drive(fresh(), [
      orderEvidence, // order-details, itemPaise 129900n
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { order: { id: 'o1', itemPaise: null, source: 'ocr' } },
      },
    ]);
    expect(t.order?.itemPaise).toBe(129900n);
    expect(t.order?.source).toBe('order-details');
  });

  // The known limit of that carve-out, pinned so it cannot be mistaken for
  // safety it does not provide. sourceRank is BINARY — only 'ocr' ranks low, so
  // every scraper source ties and the incoming order replaces the incumbent
  // WHOLESALE. A second fetch of the same order therefore erases whatever
  // `match` the first one established.
  //
  // This used to matter for money: the refund gate read `match.amountOk`, so an
  // erased `amountOk: false` silently re-opened the auto-refund path. The gate
  // now recomputes the price question from the stored amounts at release time
  // (chargedDisagreesWithCampaign), which is why this is documented as a
  // limitation rather than a hole. `ambiguous` is the part that is still only
  // device-sourced and still erasable — see the assertion below.
  it('an equal-authority re-fetch REPLACES the stored match, erasing it', () => {
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          order: {
            id: 'o1',
            itemPaise: 129900n,
            source: 'order-history',
            match: { score: 1, amountOk: false, ambiguous: true, candidateCount: 2 },
          },
        },
      },
      // The same order read again — a purchase-only fetch followed by a
      // purchase+delivery fetch mints a DIFFERENT idempotency key, so this
      // applies rather than being deduped away.
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { order: { id: 'o1', itemPaise: 129900n, source: 'order-history' } },
      },
    ]);
    expect(t.order?.match ?? null).toBeNull();
    // The amounts DO survive, which is what the release-time price check reads —
    // so the money decision no longer depends on the erased field.
    expect(t.order?.itemPaise).toBe(129900n);
  });
});

describe('transition — guards & atomicity', () => {
  it('rejects MARK_REVIEWED before delivery, leaving the task untouched', () => {
    const before = fresh();
    const res = transition(before, { type: 'MARK_REVIEWED', at: T0 });
    expect(res.rejected).toBe(true);
    expect(res.changed).toBe(false);
    expect(res.task).toBe(before); // original returned unchanged
  });

  it('rejects CONFIRM_ORDER when there is no order', () => {
    const res = transition(fresh(), { type: 'CONFIRM_ORDER', at: T0 });
    expect(res.rejected).toBe(true);
  });

  it('blocks START_HOLD when the review is not published', () => {
    const t = drive(fresh(), [
      orderEvidence,
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { delivery: { at: T0, source: 'order-details' } },
      },
      { type: 'MARK_REVIEWED', at: T0 },
    ]);
    const res = transition(t, { type: 'START_HOLD', at: T0 });
    expect(res.task.state).toBe(STATES.REVIEWED); // did not enter HOLDING
    expect(res.task.blocker).toBe('review_not_public');
  });

  it('is idempotent: a repeated event key is a no-op', () => {
    const t1 = transition(fresh(), { ...orderEvidence, key: 'ev-1' });
    expect(t1.changed).toBe(true);
    const t2 = transition(t1.task, { ...orderEvidence, key: 'ev-1' });
    expect(t2.changed).toBe(false);
    expect(t2.reason).toMatch(/duplicate/);
  });

  it('treats REFUNDED as terminal', () => {
    const holding = drive(fresh(), [
      orderEvidence,
      deliveryEvidence,
      { type: 'MARK_REVIEWED', at: T0 },
      { type: 'START_HOLD', at: T0 },
    ]);
    const refunded = transition(holding, {
      type: 'RELEASE_REFUND',
      at: T0 + 11 * DAY,
    }).task;
    expect(refunded.state).toBe(STATES.REFUNDED);

    const after = transition(refunded, { type: 'MARK_REVIEWED', at: T0 });
    expect(after.changed).toBe(false);
    expect(after.reason).toMatch(/terminal/);
  });
});

describe('transition — HOLDING clawback (loophole 3)', () => {
  const holding = () =>
    drive(fresh(), [
      orderEvidence,
      deliveryEvidence,
      { type: 'MARK_REVIEWED', at: T0 },
      { type: 'START_HOLD', at: T0 },
    ]);

  it('regresses HOLDING → REVIEWED when a review disappears mid-hold', () => {
    const res = transition(holding(), {
      type: 'VISIBILITY_CHECK',
      published: false,
      at: T0 + 2 * DAY,
    });
    expect(res.task.state).toBe(STATES.REVIEWED);
    expect(res.task.blocker).toBe('review_not_public');
    expect(res.task.review?.published).toBe(false);
    expect(res.task.visibilityChecks).toHaveLength(1);
  });

  it('stays in HOLDING when the review is still public', () => {
    const res = transition(holding(), {
      type: 'VISIBILITY_CHECK',
      published: true,
      at: T0 + 2 * DAY,
    });
    expect(res.task.state).toBe(STATES.HOLDING);
    expect(res.task.visibilityChecks).toHaveLength(1);
  });
});

describe('refund gate', () => {
  const holding = () =>
    drive(fresh(), [
      orderEvidence,
      deliveryEvidence,
      { type: 'MARK_REVIEWED', at: T0 },
      { type: 'START_HOLD', at: T0 },
    ]);

  it('releases only after the window elapses, published, not returned', () => {
    const t = holding();
    // Before the 10-day window ends → rejected, with the window date as a reason.
    const early = transition(t, { type: 'RELEASE_REFUND', at: T0 + 5 * DAY });
    expect(early.rejected).toBe(true);
    expect(early.reason).toMatch(/return window ends/);

    // After the window → REFUNDED.
    const done = transition(t, { type: 'RELEASE_REFUND', at: T0 + 11 * DAY });
    expect(done.task.state).toBe(STATES.REFUNDED);
  });

  it('lists every failing reason', () => {
    const elig = refundEligibility(fresh(), T0); // CLAIMED, no review, unknown returned, no delivery
    expect(elig.eligible).toBe(false);
    expect(elig.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expected HOLDING'),
        'review is not publicly visible',
        expect.stringContaining('return status unknown'),
        expect.stringContaining('return window cannot be computed'),
      ]),
    );
  });

  it('refuses to release a returned order', () => {
    const returned = transition(holding(), {
      type: 'EVIDENCE',
      at: T0,
      evidence: { returned: true },
    }).task;
    const res = transition(returned, {
      type: 'RELEASE_REFUND',
      at: T0 + 11 * DAY,
    });
    expect(res.rejected).toBe(true);
    expect(res.reason).toMatch(/returned or cancelled/);
  });
});

describe('return-window policy', () => {
  it('resolves days from the category table', () => {
    expect(windowDaysFor(DEFAULT_RETURN_POLICY, 'electronics')).toBe(10);
    expect(windowDaysFor(DEFAULT_RETURN_POLICY, 'apparel')).toBe(15);
    expect(windowDaysFor(DEFAULT_RETURN_POLICY, 'grocery')).toBe(0);
    expect(windowDaysFor(DEFAULT_RETURN_POLICY, 'home')).toBe(7); // default
  });

  it('a campaign override wins regardless of category', () => {
    const policy = policyForWindowDays(3);
    expect(windowDaysFor(policy, 'apparel')).toBe(3);
    expect(windowDaysFor(policy, 'anything')).toBe(3);
  });

  it('anchors the window to the delivery date', () => {
    const t = drive(fresh(), [orderEvidence, deliveryEvidence]);
    expect(windowEnd(t)).toBe(T0 + 10 * DAY); // electronics = 10 days from delivery
    expect(windowEnd(fresh())).toBeNull(); // no delivery → no window
  });
});

describe('computeRefundPaise', () => {
  it('applies the payout percent with an integer floor', () => {
    expect(computeRefundPaise(129900n, 100, null)).toBe(129900n);
    expect(computeRefundPaise(74900n, 90, null)).toBe(67410n);
    expect(computeRefundPaise(999n, 33, null)).toBe(329n); // 329.67 floored
  });

  it('caps the payout', () => {
    expect(computeRefundPaise(74900n, 90, 60000n)).toBe(60000n); // 67410 capped to 60000
    expect(computeRefundPaise(10000n, 100, 60000n)).toBe(10000n); // under the cap
  });
});

describe('shouldRecheckVisibility', () => {
  it('is true only in HOLDING and only after the interval', () => {
    const holding = drive(fresh(), [
      orderEvidence,
      deliveryEvidence,
      { type: 'MARK_REVIEWED', at: T0 },
      { type: 'START_HOLD', at: T0 },
    ]);
    expect(shouldRecheckVisibility(holding, T0 + 2 * DAY)).toBe(true);
    expect(shouldRecheckVisibility(fresh(), T0 + 2 * DAY)).toBe(false);
  });
});

/**
 * A duplicate-key EVIDENCE no-op must still surface the newest diagnostics.
 * Live bug 2026-08-12: every Amazon miss keyed to `evidence:none:_`, so a task
 * that had already missed once could never record why it missed again — the
 * short-circuit returned before the handler ran and the probe was discarded.
 */
describe('duplicate evidence refreshes diagnostics', () => {
  const evid = (probe: unknown, reason: string) => ({
    type: 'EVIDENCE' as const,
    key: 'evidence:none:nonames',
    evidence: { reason, probe } as never,
  });

  it('reports no state change but carries the newest probe', () => {
    const first = transition(
      fresh(),
      evid({ reviewsSeen: 12, namesResolved: 0 }, 'No matching review found for this task.'),
    );
    expect(first.changed).toBe(true);

    const dup = transition(
      first.task,
      evid({ reviewsSeen: 14, namesResolved: 0 }, 'No matching review found for this task.'),
    );
    expect(dup.changed).toBe(false);
    expect(dup.reason).toMatch(/duplicate event ignored/);
    expect(dup.diagnostics).toBeDefined();
    expect((dup.diagnostics!.probe as { reviewsSeen: number }).reviewsSeen).toBe(14);
    expect(dup.diagnostics!.blockerReason).toBe('No matching review found for this task.');
    expect(dup.task.state).toBe(first.task.state);
  });

  it('does NOT invent diagnostics for a duplicate non-evidence action', () => {
    const first = transition(fresh(), evid({ reviewsSeen: 1, namesResolved: 0 }, 'x'));
    const dupAction = transition(first.task, {
      type: 'MARK_REVIEWED',
      key: 'evidence:none:nonames',
    });
    expect(dupAction.changed).toBe(false);
    expect(dupAction.diagnostics).toBeUndefined();
  });
});
