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
import { normalizeQuantity, payableQuantity } from './quantity.js';

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
  // Set by the BACKEND, never by this reader: the order is real and readable, it
  // simply predates the claim (or postdates the purchase deadline). Kept separate
  // from ORDER_UNREADABLE so the screen can say "this is a rule" and offer no
  // screenshot — no picture can change a date. See backend order-window.ts.
  ORDER_OUT_OF_WINDOW: 'order_out_of_window',
};

// Where a fact came from. Never let an unsourced value into the flow.
export const SOURCES = {
  ORDER_DETAILS: 'order-details', // Amazon: scraped from the HTML detail page (verified)
  ORDER_HISTORY: 'order-history', // Flipkart/Myntra: their authenticated JSON order API
  DKIM: 'dkim',                   // fallback for gap 1
  MANUAL: 'manual',               // last resort, user-entered
  // WHO settled "is this review publicly visible" - a MACHINE did. Either the
  // public review permalink was fetched (Amazon) or the marketplace stated its
  // own moderation verdict (Flipkart says "approved"). Distinct from the order
  // sources because it answers a different question, and it is the field the
  // backend ranks when deciding whether a Fayr reviewer may fill the gap by eye.
  // Mirrored in backend/src/tasks/engine/states.ts - keep the two in step.
  REVIEW_PUBLIC: 'review-public',
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
    // WHY nothing matched. Four separate causes all produced the identical
    // record - "No matching review found" with probe:null - and cost four
    // sessions of guesswork. They are only distinguishable from these counts:
    //
    //   fetchError:'no_campaign_target' -> the script FAILED CLOSED on a missing
    //     campaign ASIN and returned zero reviews before any name was scored
    //     (platforms.js: `if (!targetAsin && !debug)`). Nothing to do with names.
    //   reviewsSeen:0 with no fetchError -> the reviews page itself read empty.
    //   namesResolved < reviewsSeen -> reviews came back but their permalinks
    //     never yielded a product title, so productScore had nothing to compare
    //     (a review with no name scores 0.00 no matter what the campaign says).
    //   bestScore just under the bar -> a genuine name mismatch, the ONLY case
    //     where changing the campaign productName can help.
    return {
      blocker: null,
      reason: 'No matching review found for this task.',
      review: null,
      order: null,
      delivery: null,
      probe: amazonReviewProbe(raw, t, reviews),
    };
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
    // A MACHINE reached that verdict, by fetching the public page. Recorded so a
    // Fayr reviewer's eye-witness cannot overrule it later: a person remembering
    // a page is weaker evidence than a fetch of that page, and treating them as
    // peers would make the deleted-review countermeasure overridable by hand.
    publishedSource: SOURCES.REVIEW_PUBLIC,
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
  // What the page said about units, and what may be COMPUTED from it — which are
  // not the same thing. See payableQuantity in quantity.js.
  const qty = payableQuantity({
    quantity: normalizeQuantity(review.quantity),
    source: review.quantitysource || null,
    reason: review.quantityreason || null,
  });
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
      // HOW MANY UNITS. Read from the item's OWN container on the order-details
      // page, and only when that container LABELS the number ("Qty: 3") — see
      // src/quantity.js for everything deliberately refused, and platforms.js
      // statedQuantityIn for the reading. Null means the page did not say, and
      // the refund then refuses rather than assuming one unit (chargedAmount.js).
      // Amazon shows no label at all on a single-unit order, so null is the
      // ORDINARY answer here, not a failure.
      quantity: qty.quantity,
      // What the page STATED, when that is more than one unit. Never computed
      // with — the amount above could be a per-unit price or a line total, and we
      // cannot yet tell which, so a human decides. This is here so that human can
      // see the number instead of having to open the order themselves.
      quantityObserved: qty.observed,
      // Why the quantity is what it is, kept for the staff screen and the audit
      // trail: 'label-qty' / 'label-quantity' when read, otherwise the reason
      // nothing was ('not-stated', 'picker', 'conflicting', 'implausible',
      // 'multi-unit-amount-unclear').
      quantitySource: qty.source,
      quantityReason: qty.reason,
      // Audit only. Deliberately NOT called `amount` so nothing can reach for it
      // by habit and pay out the wrong number.
      orderTotalPaise: toPaise(review.orderamount),
      amountSource: review.amountsource || null,
      // A walk that escaped the item row, or a row holding several amounts,
      // means the item price is not trustworthy - surface it rather than pay it.
      itemAmountAmbiguous: review.itemamountambiguous === true,
      product: review.name || null,
      // Already in the payload and previously discarded: the reviews list carries
      // a product thumbnail, and the order-history graft adds a return status.
      // The Task screen has always rendered both — Amazon just never filled them,
      // which read as "Amazon shows less than quick-commerce" when in fact the
      // data was there. No scraper change needed.
      image: review.imageurl || null,
      statusText: review.returnstatus || null,
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
// Diagnostic for an Amazon review miss. Pure counts and one truncated sample -
// deliberately no review text, no order ids, nothing about products other than
// the campaign's (the ASIN filter in platforms.js is a PRIVACY boundary, and a
// probe must not become the leak it was added to explain).
function amazonReviewProbe(raw, target, reviews) {
  const list = reviews || [];
  let bestScore = 0;
  let bestCandidate = null;
  let namesResolved = 0;
  for (const r of list) {
    const name = r && r.name;
    if (name) namesResolved++;
    if (!target || !target.product) continue;
    const s = productScore(target.product, name);
    if (s > bestScore) {
      bestScore = s;
      bestCandidate = String(name).slice(0, 80);
    }
  }
  return {
    // The script's own fail-closed signal, which used to be discarded entirely.
    fetchError: (raw && raw.error) || null,
    targetAsinSet: !!(target && target.asin),
    targetProductSet: !!(target && target.product),
    // POST-filter — what actually arrived for matching.
    reviewsSeen: list.length,
    // PRE-filter counts, which separate two failures that otherwise look
    // identical: reviewsFound 0 = the account's reviews page read empty;
    // reviewsFound > 0 with asinOnlyCount 0 = reviews WERE read and the
    // exact-ASIN filter discarded every one (Amazon's per-variant ASINs).
    reviewsFound: raw && typeof raw.reviewsFound === 'number' ? raw.reviewsFound : null,
    asinOnlyCount: raw && typeof raw.asinOnlyCount === 'number' ? raw.asinOnlyCount : null,
    nameFallbackUsed: raw && raw.nameFallbackUsed === true,
    // What the script says it SURFACED after its campaign filter, when present.
    surfacedCount: raw && typeof raw.count === 'number' ? raw.count : null,
    namesResolved,
    bestScore: Math.round(bestScore * 100) / 100,
    bestCandidate,
    nameThreshold: 0.6,
  };
}

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
    // Flipkart states its own publication verdict, so a machine has settled it
    // and no staff check is needed - or permitted - on this platform.
    publishedSource: SOURCES.REVIEW_PUBLIC,
    verified: review.verified === true,
    reviewDate: toEpoch(review.reviewdate),
    reviewDateSource: review.reviewdate ? 'flipkart-api' : null,
  } : null;

  const order = (raw && raw.order) || null;
  if (!order) return orderApiMiss(probe, 'Flipkart', reviewFacts);

  // What the records said about units, and what may be COMPUTED from it — see
  // payableQuantity in quantity.js for why those differ.
  const fkQty = payableQuantity({
    quantity: normalizeQuantity(order.quantity),
    source: order.quantitySource || null,
    reason: order.quantityReason || null,
  });
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
      // HOW MANY UNITS. Flipkart states its orders as unit RECORDS, so this comes
      // from a record stating its own count — never from counting the records,
      // because one record could itself hold three units. Which field carries it
      // is still unverified (no multi-unit Flipkart order has been captured), so
      // in practice this reads null today and the refund holds for a human.
      quantity: fkQty.quantity,
      quantityObserved: fkQty.observed,
      quantitySource: fkQty.source,
      quantityReason: fkQty.reason,
      orderTotalPaise: toPaise(order.orderAmount),
      amountSource: order.itemAmount != null ? 'flipkart-itemSellingPrice' : null,
      // More than one unit record for this product in this order means the money
      // above came from whichever record was read LAST, which is arbitrary. That
      // makes the AMOUNT doubtful, not just the count — so it is flagged, which
      // routes it to a person instead of being paid.
      itemAmountAmbiguous: (order.unitRecords || 0) > 1,
      product: order.productName || (review && review.productname) || t.product || null,
      // Flipkart's posted order already carries returnStatus and statusKey; only
      // `returned` was ever read. statusKey is the fallback because it is present
      // on a normal order too, where returnStatus is null. Flipkart exposes no
      // per-order thumbnail, so image stays honestly absent rather than faked.
      statusText: order.returnStatus || order.statusKey || null,
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
// MEESHO reader.
//
// Meesho gives us less than any other marketplace, and the reader's whole job is
// to be honest about which parts are missing rather than to fill them in.
//
// WHAT THE PAYLOAD ACTUALLY CONTAINS (platforms.js, from orders.json):
//   - the purchase: order number, sub-order number, product name, order date;
//   - the STAR the user gave (`review.current_rating >= 1` means they rated it);
//   - the review TEXT and any photos, but only when the app's rating call
//     happened to be captured in the same session — on the web it usually is not.
//
// WHAT IT DOES NOT CONTAIN, and is therefore never invented here:
//   - ANY amount. Not a per-item price, not even an order total. Meesho is the
//     only marketplace that gives us no money figure at all, so the refund cannot
//     be computed and waits for a person to state what one unit cost.
//   - a delivery DATE. `statusmessage` says "Delivered", which is a status and not
//     a date, and the return window is anchored to a date. So no delivery is
//     emitted and none is guessed from the words.
//   - a review PERMALINK. Nothing can re-check public visibility later, which is
//     the countermeasure to a review deleted after payout. Recorded as a real
//     limit of this marketplace, not worked around.
//
// THE ONE JUDGEMENT CALL, stated plainly: `approved: true` arrives hard-coded on
// every rated sub-order in the payload. It means "the user gave a star", NOT "a
// review is publicly visible" — and public visibility is what Fayr pays for. So
// it is deliberately NOT read as the payout signal. A star with real review TEXT
// behind it is the review Meesho shows a shopper, and counts. A bare star does
// not: a star is not a review, and paying for one would pay for something no
// other shopper can read.
export function readMeeshoEvidence(raw, target) {
  const t = target || {};
  const reviews = (raw && raw.reviews) || [];
  const totalSubOrders = raw && raw.totalSubOrders != null ? Number(raw.totalSubOrders) : 0;

  // platforms.js emits ONLY rated sub-orders, so an empty list is ambiguous
  // between "nothing was read" and "nothing is rated yet". totalSubOrders is what
  // separates them, and the two need different sentences.
  if (!reviews.length) {
    return {
      blocker: null,
      reason: totalSubOrders > 0
        ? 'Your Meesho order is there but not rated yet. Rate it in the Meesho app, then fetch again.'
        : 'Couldn’t read your Meesho orders — open the Orders list, then Fetch.',
      review: null, order: null, delivery: null, returned: null,
    };
  }

  // Match by NAME ONLY. Every other marketplace matches on name + amount, but
  // Meesho exposes no amount to compare, so passing one would let the matcher
  // report an amount check it never actually ran.
  const candidates = reviews.map((r) => ({
    product: r.productname || null,
    orderDate: r.orderdate != null ? r.orderdate : null,
    _r: r,
  }));
  const m = t.product
    ? matchOrderByNameAmount({ product: t.product, amount: null }, candidates)
    : { order: null, score: 0, amountOk: null, ambiguous: false, candidateCount: 0 };
  const picked = m.order && m.order._r ? m.order._r : null;

  if (!picked) {
    return {
      blocker: null,
      reason: 'This product isn’t in your rated Meesho orders yet.',
      review: null, order: null, delivery: null, returned: null,
    };
  }

  // A real comment (or review photos) is the difference between "they rated it"
  // and "there is a review a shopper can read".
  const hasText = typeof picked.reviewtext === 'string' && picked.reviewtext.trim().length > 0;
  const mediaCount = Number.isFinite(Number(picked.mediacount)) ? Number(picked.mediacount) : 0;
  const isPublicReview = hasText || mediaCount > 0;

  const review = {
    reviewId: picked.suborderid ? String(picked.suborderid) : null,
    asin: null,
    product: picked.productname || t.product || null,
    rating: picked.rating != null ? Number(picked.rating) : null,
    published: isPublicReview,
    // DELIBERATELY UNSOURCED, in both directions. Nothing here looked at a public
    // page: Meesho shows the star on the order and keeps the words inside its own
    // app, so `published` is a reading of the payload rather than a check of the
    // page. Leaving the verdict unsourced is what lets a Fayr reviewer fill it by
    // eye - a null is a gap a person may fill, a source is a machine's answer they
    // may not overrule.
    publishedSource: null,
    // "Verified" means the marketplace itself vouches the reviewer bought it.
    // Meesho only lets you rate something you ordered, so the rating IS attached
    // to a real purchase.
    verified: true,
    reviewDate: null,
    reviewDateSource: 'meesho-orders-json',
  };

  return {
    blocker: null,
    // Said even on the good path, because "we can see the star but not the
    // review" is the ordinary Meesho outcome and the user deserves to know why
    // their task is waiting.
    reason: isPublicReview
      ? null
      : 'We can see your Meesho star but not the review itself — Meesho only shows '
        + 'the words in its app. A person at Fayr will check the product page.',
    review,
    order: {
      id: picked.orderid || null,
      date: toEpoch(picked.orderdate),
      dateRaw: picked.orderdate == null ? null : String(picked.orderdate),
      // NO amount of any kind. Meesho publishes none, so the refund holds for a
      // staff amount decision rather than guessing from the campaign price.
      itemPaise: null,
      quantity: null,
      quantityObserved: null,
      quantitySource: null,
      quantityReason: 'not-stated',
      orderTotalPaise: null,
      amountSource: null,
      itemAmountAmbiguous: false,
      product: picked.productname || t.product || null,
      image: picked.imageurl || null,
      // "Delivered" / "Order placed" — a status, shown as one, never read as a date.
      statusText: picked.statusmessage || null,
      match: {
        score: m.score != null ? m.score : null,
        // Null, not false: no amount existed to check, and false would read as
        // "the price disagreed" on a screen that warns about exactly that.
        amountOk: null,
        ambiguous: m.ambiguous === true,
        candidateCount: m.candidateCount != null ? m.candidateCount : null,
      },
      source: SOURCES.ORDER_HISTORY,
    },
    // Meesho gives a status word, not a delivery date, and the return window is
    // anchored to a date. Emitting null keeps the window honest.
    delivery: null,
    // Nothing in the payload reports a return, so this stays UNKNOWN rather than
    // asserting "not returned", which the refund gate would take as proven.
    returned: null,
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
    // Read off the marketplace's own order record, so it is machine-settled and
    // never waits on a person. NOTE this is weaker than it looks: the marker says
    // the account rated the item, not that anything is publicly readable - the
    // difference is recorded in the security document rather than papered over.
    publishedSource: SOURCES.ORDER_HISTORY,
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
    case 'meesho': return readMeeshoEvidence(raw, target);
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
    // Diagnostics survive a duplicate. A probe describes the LAST ATTEMPT, not
    // task state, so refreshing it is safe — and discarding it (what this used to
    // do) meant a task that had already recorded one miss could never report a
    // fresher one. Mirrors the backend's TransitionResult.diagnostics.
    const out = { task, changed: false, reason: `duplicate event ignored (${ev.key})` };
    if (ev.type === 'EVIDENCE' && ev.evidence) {
      out.diagnostics = {
        probe: ev.evidence.probe || null,
        blockerReason: ev.evidence.reason || null,
        // Moves WITH the reason. Leaving it stale produced a self-contradicting
        // record: blocker order_unreadable next to "No matching review found".
        blocker: ev.evidence.blocker || null,
      };
    }
    return out;
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
