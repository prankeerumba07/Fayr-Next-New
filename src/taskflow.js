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
import { productScore, matchOrderByNameAmount } from './verify.js';
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
  ORDER_DETAILS: 'order-details', // Amazon: scraped from the HTML detail page (verified)
  ORDER_HISTORY: 'order-history', // Flipkart/Myntra: their authenticated JSON order API
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

  // toEpoch now anchors human dates to UTC midnight (see parseHumanDate in
  // extract.js - Date.parse is engine-dependent and Hermes rejects these
  // formats outright), so the year must be read in UTC too. Mixing the two is a
  // real bug in either direction: read locally off a UTC-midnight value and an
  // order placed 1 Jan 2027 reports 2026 in any timezone behind UTC.
  const orderYear = new Date(orderEpoch).getUTCFullYear();
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
    // Say WHICH failure this is. "Unreadable" covers several very different
    // causes and they need different actions - the probe counts (privacy-safe,
    // always present) tell them apart.
    const p = (raw && raw.__probe) || {};
    let reason = "Amazon's order page returned no readable content for this order.";
    if (p.ordersListSignin === true || p.pagesSigninRedirect > 0) {
      reason = 'Amazon asked for a fresh password to read your orders.';
    } else if (p.orderIdsFound === 0) {
      reason = "Couldn't read your Amazon order list, so we have no orders to check.";
    } else if (p.targetAsinInAnyOrder === false && p.pagesServerRendered > 0) {
      reason = `This product wasn't in your ${p.ordersProbed} most recent Amazon orders.`;
    } else if (p.pagesServerRendered === 0 && p.ordersProbed > 0) {
      reason = `Amazon returned no readable content for any of your ${p.ordersProbed} recent orders.`;
    }
    return {
      blocker: p.ordersListSignin === true || p.pagesSigninRedirect > 0
        ? BLOCKERS.RECONNECT
        : BLOCKERS.ORDER_UNREADABLE,
      reason,
      probe: p,
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
// ORDER-FIRST readers: Flipkart and Myntra.
//
// Amazon's order data is scraped from HTML detail pages and is anchored to a
// review (readAmazonEvidence picks a review first, then joins order facts). The
// product's whole flow, though, starts at PURCHASE - which happens BEFORE any
// review exists. These two platforms expose a structured, authenticated JSON
// order API, so we can surface the campaign product's order the moment it lands
// in the account's order history, with NO review yet. That order evidence is
// what advances CLAIMED -> PURCHASED -> DELIVERED automatically, replacing the
// "upload a screenshot of your order / your delivery" step entirely. The review
// permalink check (the payout signal) still comes later, unchanged.
//
// Both consume a payload the platform script emits target-filtered (only the
// campaign product's order ever leaves the WebView - see platforms.js):
//   { order: <matched order|null>, review: <matched review|null>,
//     orderProbe: { ordersFetched, authFailed, ordersCount, targetFound } }

// Not-a-failure: no order yet just means the user hasn't bought it (or it hasn't
// posted to their order history). The task stays CLAIMED and the UI waits - it
// does NOT block. A blocker is reserved for a genuine read failure.
function orderApiMiss(probe, platformName, reviewFacts) {
  const fetched = probe && probe.ordersFetched === true;
  return {
    blocker: null,
    reason: fetched
      ? `This product isn't in your ${platformName} orders yet.`
      : `Couldn't read your ${platformName} orders.`,
    review: reviewFacts || null,
    order: null,
    delivery: null,
    returned: null,
    probe: probe || null,
  };
}

export function readFlipkartEvidence(raw, target) {
  const t = target || {};
  const probe = (raw && raw.orderProbe) || {};
  if (probe.authFailed === true) {
    return { blocker: BLOCKERS.RECONNECT, reason: 'Flipkart asked you to sign in again to read your orders.', review: null, order: null, delivery: null, returned: null };
  }
  const review = (raw && raw.review) || null;
  const reviewFacts = review ? {
    reviewId: review.reviewid || null,
    asin: null,
    product: review.productname || t.product || null,
    rating: review.rating != null ? Number(review.rating) : null,
    // VERIFIED: the reviews fetch resolves this from Flipkart's own moderation
    // status ("approved") - see platforms.js. Here it is passed through only.
    published: review.published === true,
    verified: review.verified === true,
    reviewDate: toEpoch(review.reviewdate),
    reviewDateSource: review.reviewdate ? 'flipkart-api' : null,
  } : null;

  const order = (raw && raw.order) || null;
  if (!order) return orderApiMiss(probe, 'Flipkart', reviewFacts);

  return {
    blocker: null,
    review: reviewFacts,
    order: {
      id: order.orderId || null,
      date: toEpoch(order.orderDate),
      dateRaw: order.orderDate == null ? null : String(order.orderDate),
      // REFUNDABLE figure. Flipkart exposes the item's OWN paid price
      // (moneyDataBag.itemSellingPrice), verified 2026-07-15 - never orderAmount,
      // which is the order total and can bundle unrelated items. Whole rupees.
      itemPaise: toPaise(order.itemAmount),
      orderTotalPaise: toPaise(order.orderAmount),
      amountSource: order.itemAmount != null ? 'flipkart-itemSellingPrice' : null,
      itemAmountAmbiguous: false,
      product: order.productName || (review && review.productname) || t.product || null,
      // How this order was matched to the campaign (name + amount, no id). The
      // "is this your order?" screen shows this so a weak/ambiguous/amount-off
      // match is confirmed carefully rather than trusted blindly.
      match: matchInfo(probe),
      source: SOURCES.ORDER_HISTORY,
    },
    delivery: order.deliveryDate == null ? null : {
      at: toEpoch(order.deliveryDate),
      raw: String(order.deliveryDate),
      source: SOURCES.ORDER_HISTORY,
    },
    returned: order.returned === true,
  };
}

// The confidence of a name+amount match, passed through from the WebView matcher
// so the human-confirm step can warn. score: 0..1 name overlap; amountOk: true /
// false / null(no amount to check); ambiguous: 2+ near-equal candidates.
function matchInfo(probe) {
  const p = probe || {};
  return {
    score: p.matchScore != null ? p.matchScore : null,
    amountOk: p.amountOk != null ? p.amountOk : null,
    ambiguous: p.ambiguous === true,
    candidateCount: p.candidateCount != null ? p.candidateCount : null,
  };
}

export function readMyntraEvidence(raw, target) {
  const t = target || {};
  const probe = (raw && raw.orderProbe) || {};
  if (probe.authFailed === true) {
    return { blocker: BLOCKERS.RECONNECT, reason: 'Myntra asked you to sign in again to read your orders.', review: null, order: null, delivery: null, returned: null };
  }
  const review = (raw && raw.review) || null;
  const order = (raw && raw.order) || null;
  const reviewFacts = review ? {
    reviewId: review.reviewid || null,
    asin: null,
    product: review.name || t.product || null,
    rating: review.rating != null ? Number(review.rating) : null,
    published: review.published === true,
    // A Myntra review can only exist on a styleId the account actually bought
    // (the ratings API is keyed off the user's own orders), so a present review
    // is inherently a verified purchase.
    verified: true,
    reviewDate: toEpoch(review.reviewedon),
    reviewDateSource: review.reviewedon ? 'myntra-api' : null,
  } : null;

  if (!order) return orderApiMiss(probe, 'Myntra', reviewFacts);

  return {
    blocker: null,
    review: reviewFacts,
    order: {
      id: order.orderid || null,
      date: toEpoch(order.createdon),
      dateRaw: order.createdon == null ? null : String(order.createdon),
      // Myntra's per-item PAID price is NOT located yet: getOrders exposes `mrp`
      // (the LIST price, >= paid), so emitting it as the refundable figure would
      // over-refund. itemPaise stays null - the purchase and delivery still
      // verify; only the refund amount waits on the paid-price capture (the
      // __sample probe in platforms.js). Degrade honestly, never guess money.
      itemPaise: null,
      orderTotalPaise: null,
      mrpPaise: toPaise(order.mrp),
      amountSource: 'mrp_only_needs_capture',
      itemAmountAmbiguous: true,
      product: order.name || t.product || null,
      match: matchInfo(probe),
      source: SOURCES.ORDER_HISTORY,
    },
    delivery: order.deliverydate == null ? null : {
      at: toEpoch(order.deliverydate),
      raw: String(order.deliverydate),
      source: SOURCES.ORDER_HISTORY,
    },
    returned: order.returned === true,
  };
}

// ---------------------------------------------------------------------------
// QUICK-COMMERCE order-first reader: Zepto, Blinkit, Instamart.
//
// These three parse their order data out of the authenticated API responses the
// discovery hook captured while you browsed Orders (see platforms.js), and emit
// a FLAT reviews[] - one entry per product, each already carrying the order
// facts (orderid, orderdate, deliverydate, amount, image, returned, status).
//
// Unlike Amazon/Flipkart/Myntra the campaign match can't run inside the WebView
// (those scripts emit EVERY order so the ConnectScreen list can show them all),
// so we match the campaign product HERE, on-device, by NAME + AMOUNT - the same
// matchOrderByNameAmount the others use - and surface only that one order.
//
// HONEST LIMITS (degrade, never guess):
//   - The amount these expose is the ORDER TOTAL, not the item's own paid price
//     (quick-commerce web doesn't break it out). So it's stored as
//     orderTotalPaise for display; itemPaise stays null and the refund maths
//     waits on a per-item price - exactly like Myntra.
//   - "Rated" is per-ORDER (one star for the whole delivery) and there is no
//     public per-product review permalink to re-check, so a rated order is the
//     only review signal these platforms give.
//   - Instamart web exposes neither an order amount nor a product image; those
//     render as honest gaps, not blanks.
function readQuickCommerceEvidence(raw, target, platformName) {
  const t = target || {};
  const reviews = (raw && raw.reviews) || [];

  // Candidates in the shape matchOrderByNameAmount expects, each keeping a
  // back-reference to the full review entry so we can read the order facts off
  // the winner.
  const candidates = reviews.map((r) => ({
    product: r.productname || null,
    amount: r.amount != null ? r.amount : null,
    orderDate: r.orderdate != null ? r.orderdate : null,
    _r: r,
  }));

  const m = t.product
    ? matchOrderByNameAmount({ product: t.product, amount: t.amount }, candidates)
    : { order: null, score: 0, amountOk: null, ambiguous: false, candidateCount: 0 };
  const picked = m.order && m.order._r ? m.order._r : null;

  if (!picked) {
    // Not a hard failure. Either the purchase isn't in the captured orders yet,
    // or nothing was captured (Orders list not loaded / not logged in). Mirror
    // orderApiMiss so the task WAITS rather than blocks.
    return {
      blocker: null,
      reason: reviews.length
        ? `This product isn't in your ${platformName} orders yet.`
        : `Couldn't read your ${platformName} orders — open the Orders list, then Fetch.`,
      review: null, order: null, delivery: null, returned: null,
    };
  }

  const rated = picked.orderrated === true || picked.rating != null;
  const reviewFacts = rated ? {
    reviewId: null,
    asin: null,
    product: picked.productname || t.product || null,
    rating: picked.rating != null ? Number(picked.rating) : null,
    // Quick-commerce has no public per-product review permalink to fetch, so the
    // order's own rating marker is the visibility signal these platforms expose.
    published: true,
    verified: true,
    reviewDate: null,
    reviewDateSource: `${platformName.toLowerCase()}-order-rating`,
  } : null;

  return {
    blocker: null,
    review: reviewFacts,
    order: {
      id: picked.orderid || null,
      date: toEpoch(picked.orderdate),
      dateRaw: picked.orderdate == null ? null : String(picked.orderdate),
      // No per-item price on quick-commerce web -> itemPaise null, refund waits.
      itemPaise: null,
      // ORDER TOTAL (rupees, possibly fractional). Pass as a STRING: toPaise
      // rejects non-integer numbers on purpose, and the string path handles the
      // paise fraction correctly.
      orderTotalPaise: picked.amount == null ? null : toPaise(String(picked.amount)),
      amountSource: picked.amount != null ? `${platformName.toLowerCase()}-order-total` : null,
      itemAmountAmbiguous: true,
      product: picked.productname || t.product || null,
      // Extra order-detail fields the quick-commerce scripts already carry.
      image: picked.imageurl || null,
      statusText: picked.statuscode || picked.returnstatus || null,
      match: {
        score: m.score != null ? m.score : null,
        amountOk: m.amountOk != null ? m.amountOk : null,
        ambiguous: m.ambiguous === true,
        candidateCount: m.candidateCount != null ? m.candidateCount : null,
      },
      source: SOURCES.ORDER_HISTORY,
    },
    delivery: picked.deliverydate == null ? null : {
      at: toEpoch(picked.deliverydate),
      raw: String(picked.deliverydate),
      source: SOURCES.ORDER_HISTORY,
    },
    returned: picked.returned === true,
  };
}

// One entry point: pick the reader for the platform. ConnectScreen calls this
// so a new platform is a one-line addition here, not a branch in the screen.
export function readEvidence(platform, raw, target) {
  switch (String(platform || '').toLowerCase()) {
    case 'amazon': return readAmazonEvidence(raw, target);
    case 'flipkart': return readFlipkartEvidence(raw, target);
    case 'myntra': return readMyntraEvidence(raw, target);
    case 'zepto': return readQuickCommerceEvidence(raw, target, 'Zepto');
    case 'blinkit': return readQuickCommerceEvidence(raw, target, 'Blinkit');
    case 'instamart': return readQuickCommerceEvidence(raw, target, 'Instamart');
    default:
      return { blocker: null, reason: `Order reading isn't wired for ${platform} yet.`, review: null, order: null, delivery: null, returned: null };
  }
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
      return {
        patch: {
          blocker: e.blocker,
          blockerReason: e.reason || null,
          // Persist the probe counts: a task that stalled must carry the reason
          // it stalled, or the only way to diagnose it is to reproduce it.
          probe: e.probe || null,
          review: e.review || task.review,
        },
        to: task.state,
        reason: e.blocker,
      };
    }
    // A miss is NOT a blocker - the task waits rather than stalls (orderApiMiss,
    // readQuickCommerceEvidence). It still carries WHY: `reason` (the sentence)
    // and `probe` (the scraper counters). Both used to be dropped here, so a
    // miss reached the backend carrying nothing to diagnose it with. Keep them;
    // a successful read carries neither, so they self-clear. Mirrored in
    // backend/src/tasks/engine/transition.ts - keep the two in step.
    const patch = {
      blocker: null,
      blockerReason: e.reason || null,
      probe: e.probe || null,
    };
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
