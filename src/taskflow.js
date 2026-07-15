// Fayr task flow: CLAIMED -> PURCHASED -> DELIVERED -> REVIEWED -> HOLDING -> REFUNDED
//
// This module owns the money decision, so it is built on VERIFIED fields only.
// Every field below was proven against real captured Amazon payloads on
// 2026-07-15; where a field is not verified, the flow degrades honestly (states
// stall with a stated reason and a fallback) rather than inventing a value.
//
// Verified for Amazon (see src/platforms.js amazon.fetchScript):
//   orderid/orderdate/orderamount/product  <- /gp/your-account/order-details
//   deliverydate                           <- same, but DAY+MONTH ONLY, no year
//   published                              <- review permalink returns HTTP 200
//   returned                               <- detail page, proven against real
//                                             "This order has been cancelled." /
//                                             "Refunded ... refund has been issued"
//
// Known gaps this module handles EXPLICITLY (do not paper over them):
//   1. ~2 of 6 order-detail pages come back empty (78/256 chars). Those orders
//      yield NO order data -> fall back to DKIM, never render blanks.
//   2. The orders LIST can redirect to ap/signin?openid.pape.max_auth_age=0
//      (Amazon forcing a fresh password) -> surface "reconnect your account".
//   3. The return window is NOT fetchable from any platform. It is a policy
//      table the operator maintains, per category.

import { toEpoch } from './extract.js';
import { productScore } from './verify.js';
import { toPaise } from './money.js';

export const DAY = 86400000;

export const STATES = {
  CLAIMED: 'CLAIMED',
  PURCHASED: 'PURCHASED',
  DELIVERED: 'DELIVERED',
  REVIEWED: 'REVIEWED',
  HOLDING: 'HOLDING',
  REFUNDED: 'REFUNDED',
};

// Ordered so we can reason about regressions (HOLDING -> REVIEWED is allowed
// when a review disappears mid-hold).
const ORDER = [
  STATES.CLAIMED, STATES.PURCHASED, STATES.DELIVERED,
  STATES.REVIEWED, STATES.HOLDING, STATES.REFUNDED,
];

// Why a task cannot advance. These are surfaced to the user verbatim - a task
// that is stuck must SAY why, because the alternative (a blank order card) is
// what we are explicitly avoiding.
export const BLOCKERS = {
  RECONNECT: 'reconnect_account',       // gap 2: signin redirect
  ORDER_UNREADABLE: 'order_unreadable', // gap 1: empty detail page -> DKIM
  NO_DELIVERY_DATE: 'no_delivery_date',
  REVIEW_NOT_PUBLIC: 'review_not_public',
  RETURNED: 'returned',
};

// Where a fact came from. Never let an unsourced value into the flow.
export const SOURCES = {
  ORDER_DETAILS: 'order-details', // verified
  DKIM: 'dkim',                   // fallback for gap 1
  MANUAL: 'manual',               // last resort, user-entered
};

// ---------------------------------------------------------------------------
// Gap 3: the return window is a POLICY TABLE, not a fetched fact.
// No marketplace exposes a return-window end date, so this is the operator's
// number and must be maintained deliberately. Days are counted from DELIVERY.
export const DEFAULT_RETURN_POLICY = {
  defaultDays: 7,
  byCategory: {
    electronics: 10,
    apparel: 15,
    furniture: 10,
    grocery: 0, // non-returnable -> refund can release as soon as delivered+reviewed
  },
};

export function createPolicy(overrides) {
  const o = overrides || {};
  return {
    defaultDays: o.defaultDays != null ? o.defaultDays : DEFAULT_RETURN_POLICY.defaultDays,
    byCategory: Object.assign({}, DEFAULT_RETURN_POLICY.byCategory, o.byCategory || {}),
  };
}

export function windowDaysFor(policy, category) {
  const p = policy || DEFAULT_RETURN_POLICY;
  const key = String(category || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(p.byCategory, key)
    ? p.byCategory[key]
    : p.defaultDays;
}

// ---------------------------------------------------------------------------
// Amazon's detail page gives delivery as "5 June" - DAY AND MONTH ONLY, no year
// (while orderdate is a full "2 June 2026"). Resolving it naively against the
// current year silently produces windows a year wrong. Derive the year from the
// order date, and roll over when the delivery month precedes the order month
// (ordered 28 December, delivered 3 January -> next year).
export function resolveDeliveryDate(deliveryRaw, orderRaw) {
  if (!deliveryRaw) return null;
  const s = String(deliveryRaw).trim();

  // Already carries a 4-digit year -> parse as-is.
  if (/\b\d{4}\b/.test(s)) return toEpoch(s);

  const orderEpoch = toEpoch(orderRaw);
  if (orderEpoch == null) return null; // no anchor -> refuse to guess

  // Date.parse("2 June 2026") yields LOCAL midnight, so read the year locally
  // too. Using getUTCFullYear here is a real bug: an order placed 1 Jan 2027 IST
  // is 2026-12-31T18:30Z and would report year 2026.
  const orderYear = new Date(orderEpoch).getFullYear();
  const first = toEpoch(`${s} ${orderYear}`);
  if (first == null) return null;

  // Delivery can never precede the order. If it appears to, the delivery fell
  // in the FOLLOWING year (Dec -> Jan rollover).
  if (first < orderEpoch) {
    const rolled = toEpoch(`${s} ${orderYear + 1}`);
    return rolled == null ? null : rolled;
  }
  return first;
}

// ---------------------------------------------------------------------------
// Read a fetched Amazon payload into flow evidence. Returns what is KNOWN and,
// just as importantly, what is MISSING and why - the caller renders the gap,
// not a blank.
export function readAmazonEvidence(raw, target) {
  const t = target || {};
  const sample = (raw && raw.__amazonOrdersSample) || {};
  const probes = sample.orderDetailProbe || [];

  // Gap 2: a signin redirect anywhere means the session is no longer trusted
  // for order data. This is NOT "no orders" - it needs a human.
  const listSignin = /ap\/signin/i.test(String(sample.finalUrl || ''));
  const probeSignin = probes.some((p) => p && p.signinRedirect === true);
  if (listSignin || probeSignin) {
    return { blocker: BLOCKERS.RECONNECT, reason: 'Amazon asked for a fresh password to read your orders.', review: null, order: null, delivery: null };
  }

  const reviews = (raw && raw.reviews) || [];
  const review = pickReview(reviews, t);
  if (!review) {
    return { blocker: null, reason: 'No matching review found for this task.', review: null, order: null, delivery: null };
  }

  const reviewFacts = {
    reviewId: review.reviewid || null,
    asin: review.asin || null,
    product: review.name || null,
    rating: review.rating != null ? Number(review.rating) : null,
    // VERIFIED: an independent HTTP fetch of the public permalink. This is the
    // only signal that held in every capture, including runs where the orders
    // page failed entirely.
    published: review.published === true,
    verified: review.verified === true,
    // ANTI-REPLAY control: proves the review post-dates the order, which is what
    // stops a claim on a product reviewed years ago. Verified 2026-07-15 (the
    // selector was fixed to read textContent; the element's own text is
    // truncated). Only ever a real date - the parser refuses a value with no
    // 4-digit year, so a bare "Reviewed in India " can't pass as one.
    reviewDate: toEpoch(review.reviewdate),
    reviewDateSource: review.reviewdatesource || null,
  };

  // Gap 1: an empty detail page yields no ordersource. Report it as unreadable
  // so the caller routes to DKIM - do not emit nulls that look like data.
  const hasOrder = review.ordersource === SOURCES.ORDER_DETAILS && review.orderid != null;
  if (!hasOrder) {
    return {
      blocker: BLOCKERS.ORDER_UNREADABLE,
      reason: "Amazon's order page returned no readable content for this order.",
      fallback: SOURCES.DKIM,
      review: reviewFacts,
      order: null,
      delivery: null,
      returned: null,
    };
  }

  const deliveryEpoch = resolveDeliveryDate(review.deliverydate, review.orderdate);
  return {
    blocker: null,
    review: reviewFacts,
    order: {
      id: review.orderid,
      date: toEpoch(review.orderdate),
      dateRaw: review.orderdate || null,
      // REFUNDABLE figure. Campaigns pay a percentage of the ITEM, so this must
      // be the item's own price line - never orderamount, which is the order
      // TOTAL: it folds in shipping/fees/discounts and Amazon merges carts, so
      // one order can bundle the campaign product with unrelated items. Proven:
      // order 408-1509645-3524313 totals 1326.00 but its two items are 388.00
      // and 938.00; refunding 90% of the total for the 388.00 item would pay
      // ~3.4x. Integer paise, string-parsed - see money.js.
      itemPaise: toPaise(review.itemamount),
      // Audit only. Deliberately NOT called `amount` so nothing can reach for it
      // by habit and pay out the wrong number.
      orderTotalPaise: toPaise(review.orderamount),
      amountSource: review.amountsource || null,
      // A walk that escaped the item row, or a row holding several amounts,
      // means the item price is not trustworthy - surface it rather than pay it.
      itemAmountAmbiguous: review.itemamountambiguous === true,
      product: review.name || null,
      source: SOURCES.ORDER_DETAILS,
    },
    delivery: deliveryEpoch == null ? null : {
      at: deliveryEpoch,
      raw: review.deliverydate || null,
      source: SOURCES.ORDER_DETAILS,
    },
    // VERIFIED against real "This order has been cancelled." / "Refunded ...
    // refund has been issued" evidence.
    returned: review.returned === true,
  };
}

function pickReview(reviews, target) {
  if (target.asin) {
    const hit = reviews.find((r) => r && r.asin === target.asin);
    if (hit) return hit;
  }
  if (target.reviewId) {
    const hit = reviews.find((r) => r && r.reviewid === target.reviewId);
    if (hit) return hit;
  }
  if (target.product) {
    let best = null;
    let bestScore = 0.6; // same confidence bar as verify.js
    for (const r of reviews) {
      const s = productScore(target.product, r && r.name);
      if (s >= bestScore) { bestScore = s; best = r; }
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
export function createTask(init) {
  const i = init || {};
  return Object.freeze({
    id: i.id,
    platform: i.platform || 'amazon',
    category: i.category || null,
    target: { asin: i.asin || null, reviewId: i.reviewId || null, product: i.product || null },
    state: STATES.CLAIMED,
    order: null,
    delivery: null,
    review: null,
    returned: null,
    blocker: null,
    blockerReason: null,
    // Visibility re-checks during HOLDING. Kept as a list so a deleted review
    // is auditable after the fact, not just a boolean that flipped.
    visibilityChecks: [],
    applied: {},   // idempotency keys
    history: [],
  });
}

// Each event carries a stable `key`. Re-applying a key is a no-op - that is
// what makes transition() idempotent under retries, replays and double taps.
const HANDLERS = {
  // Evidence from a fetch. Drives CLAIMED -> PURCHASED -> DELIVERED.
  EVIDENCE: (task, ev) => {
    const e = ev.evidence || {};
    if (e.blocker) {
      return { patch: { blocker: e.blocker, blockerReason: e.reason || null, review: e.review || task.review }, to: task.state, reason: e.blocker };
    }
    const patch = { blocker: null, blockerReason: null };
    if (e.review) patch.review = e.review;
    if (e.order) patch.order = e.order;
    if (e.delivery) patch.delivery = e.delivery;
    if (e.returned != null) patch.returned = e.returned;

    let to = task.state;
    if (rank(to) < rank(STATES.PURCHASED) && e.order) to = STATES.PURCHASED;
    if (rank(to) < rank(STATES.DELIVERED) && e.delivery) to = STATES.DELIVERED;
    return { patch, to, reason: 'evidence applied' };
  },

  // The user confirming "this is my order" is a human gate on real fetched
  // values. It cannot run without an order to confirm.
  CONFIRM_ORDER: (task) => {
    if (!task.order) return { reject: 'nothing to confirm: no order evidence' };
    return { patch: { orderConfirmed: true }, to: task.state, reason: 'user confirmed order' };
  },

  MARK_REVIEWED: (task) => {
    if (rank(task.state) < rank(STATES.DELIVERED)) return { reject: 'cannot mark reviewed before delivery is verified' };
    return { patch: {}, to: STATES.REVIEWED, reason: 'user marked reviewed' };
  },

  // Entering the hold requires the review to be publicly visible NOW.
  START_HOLD: (task) => {
    if (task.state !== STATES.REVIEWED) return { reject: `cannot start hold from ${task.state}` };
    if (!task.review || task.review.published !== true) {
      return { patch: { blocker: BLOCKERS.REVIEW_NOT_PUBLIC, blockerReason: 'Review is not publicly visible yet.' }, to: task.state, reason: 'not public' };
    }
    return { patch: { blocker: null, blockerReason: null }, to: STATES.HOLDING, reason: 'hold started' };
  },

  // A periodic permalink re-check during HOLDING. If the review vanished, the
  // task REGRESSES to REVIEWED so it cannot refund. The window is anchored to
  // the delivery date (not to when the hold began), so resuming later does not
  // penalise the user with a restarted clock.
  VISIBILITY_CHECK: (task, ev) => {
    const published = ev.published === true;
    const checks = task.visibilityChecks.concat([{ at: ev.at, published }]);
    if (task.state !== STATES.HOLDING) {
      return { patch: { visibilityChecks: checks, review: withPublished(task.review, published) }, to: task.state, reason: 'recorded' };
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
    return { patch: { visibilityChecks: checks, review: withPublished(task.review, true) }, to: task.state, reason: 'still public' };
  },

  RELEASE_REFUND: (task, ev) => {
    const elig = refundEligibility(task, ev.at, ev.policy);
    if (!elig.eligible) return { reject: elig.reasons.join('; ') };
    return { patch: { blocker: null, blockerReason: null }, to: STATES.REFUNDED, reason: 'refund released' };
  },
};

function withPublished(review, published) {
  return review ? Object.assign({}, review, { published }) : review;
}

function rank(state) {
  return ORDER.indexOf(state);
}

// The refund gate. Releases ONLY if: window elapsed AND published still true
// AND NOT returned. Always returns every failing reason, so a held refund can
// be explained rather than just refused.
export function refundEligibility(task, now, policy) {
  const reasons = [];
  if (task.state !== STATES.HOLDING) reasons.push(`state is ${task.state}, expected HOLDING`);
  if (!task.review || task.review.published !== true) reasons.push('review is not publicly visible');
  if (task.returned === true) reasons.push('order was returned or cancelled');
  if (task.returned == null) reasons.push('return status unknown (no readable order data)');

  const w = windowEnd(task, policy);
  if (w == null) reasons.push('no delivery date, so the return window cannot be computed');
  else if (now < w) reasons.push(`return window ends ${new Date(w).toISOString().slice(0, 10)}`);

  return { eligible: reasons.length === 0, reasons, windowEndsAt: w };
}

// Anchored to DELIVERY, not to when the hold started - so a task that regressed
// and resumed does not restart its clock.
export function windowEnd(task, policy) {
  if (!task.delivery || task.delivery.at == null) return null;
  const days = windowDaysFor(policy, task.category);
  return task.delivery.at + days * DAY;
}

// Re-check cadence during HOLDING. Cheap (one HTTP fetch) and it is the only
// thing standing between a deleted review and a paid refund.
export function shouldRecheckVisibility(task, now, intervalMs) {
  if (task.state !== STATES.HOLDING) return false;
  const every = intervalMs || DAY;
  const last = task.visibilityChecks.length
    ? task.visibilityChecks[task.visibilityChecks.length - 1].at
    : 0;
  return now - last >= every;
}

// ---------------------------------------------------------------------------
// ATOMIC + IDEMPOTENT.
//   idempotent: an event `key` is applied at most once; replays are no-ops.
//   atomic: the next task is built in full and only then swapped in. A rejected
//           or invalid transition returns the ORIGINAL task untouched - there is
//           no partially-applied state.
export function transition(task, event) {
  const ev = event || {};
  const at = ev.at != null ? ev.at : Date.now();

  if (ev.key && task.applied[ev.key]) {
    return { task, changed: false, reason: `duplicate event ignored (${ev.key})` };
  }
  const handler = HANDLERS[ev.type];
  if (!handler) return { task, changed: false, reason: `unknown event ${ev.type}` };
  if (task.state === STATES.REFUNDED) {
    return { task, changed: false, reason: 'task is REFUNDED (terminal)' };
  }

  const out = handler(task, Object.assign({}, ev, { at })) || {};
  if (out.reject) {
    return { task, changed: false, rejected: true, reason: out.reject };
  }

  const to = out.to || task.state;
  if (rank(to) < 0) return { task, changed: false, rejected: true, reason: `illegal target ${to}` };

  const next = Object.assign({}, task, out.patch || {}, {
    state: to,
    applied: ev.key ? Object.assign({}, task.applied, { [ev.key]: at }) : task.applied,
    history: task.history.concat([{ from: task.state, to, at, type: ev.type, reason: out.reason || null }]),
  });

  return { task: Object.freeze(next), changed: to !== task.state || !!out.patch, reason: out.reason || null };
}

// What the UI should render. Never returns blanks dressed as data: a missing
// field is reported as a gap with the action that resolves it.
export function describe(task, now, policy) {
  const gaps = [];
  if (task.blocker === BLOCKERS.RECONNECT) {
    gaps.push({ field: 'order', message: 'Reconnect your Amazon account', action: 'reconnect' });
  } else if (task.blocker === BLOCKERS.ORDER_UNREADABLE) {
    gaps.push({ field: 'order', message: "We couldn't read this order from Amazon. Connect your email so we can verify it from the order confirmation.", action: SOURCES.DKIM });
  }
  if (!task.delivery && !gaps.length) {
    gaps.push({ field: 'delivery', message: 'Delivery date not available yet', action: SOURCES.DKIM });
  }
  return {
    state: task.state,
    order: task.order,     // null means UNKNOWN - render the gap, not an empty card
    delivery: task.delivery,
    review: task.review,
    returned: task.returned,
    windowEndsAt: windowEnd(task, policy),
    refund: refundEligibility(task, now == null ? Date.now() : now, policy),
    gaps,
  };
}
