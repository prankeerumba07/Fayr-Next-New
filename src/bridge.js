// Bridge: my verified logic layer <-> the FayrAppV3 web prototype's model.
//
// The prototype (FayrAppV3.jsx) is a React-DOM design build. It tracks a task as
// an integer `step` (1..9) inside `enrolled[campaignId]`, auto-advanced by
// setTimeout, and reads a static CAMPAIGNS array. There is no real fetch, no
// real order data, and no state machine - every "verification" is a timer.
//
// This module makes the LOGIC real without touching the prototype's renderer:
//   - taskForCampaign(c)  : a real taskflow task from a prototype campaign
//   - stateToStep(task)   : maps the real state back onto the prototype's `step`
//                           integer, so all ~55 screens that read `.step` keep
//                           working unchanged
//   - refundPaise(c)      : the REAL per-item refund (integer paise), replacing
//                           the prototype's pre-baked `maxBack` rupee number
//   - events / apply      : drive real transition()s off the existing buttons
//   - simulatedEvidence   : synthesise structurally-real evidence for the
//                           browser, since the native WebView fetch can't run there
//
// Everything here is plain JS (no RN, no DOM), so it runs in the browser
// prototype AND in Node tests. The one thing it deliberately does NOT do is
// invent a fetch: in the browser, evidence is simulated; on device, the real
// ConnectScreen fetch produces it via readAmazonEvidence.

import {
  createTask, transition, readAmazonEvidence, refundEligibility,
  createPolicy, windowEnd, STATES, SOURCES, DAY,
} from './taskflow.js';
import { toPaise, percentOfPaise, formatPaise } from './money.js';

export const POLICY = createPolicy();

// A prototype campaign carries no ASIN or category (see CAMPAIGNS in
// FayrAppV3.jsx): { id, product, marketplace, pct, maxBack, examplePay, ... }.
// Category is absent, so the return window falls back to the policy default.
export function taskForCampaign(c) {
  return createTask({
    id: 'task_' + c.id,
    platform: c.marketplace,
    asin: c.asin || null,
    product: c.product,
    category: c.category || null,
  });
}

// The REAL refund: a percentage of the ITEM price, in integer paise. The
// prototype ships `maxBack` (a pre-computed rupee number) and credits the wallet
// with it flat via `w + c.maxBack` - which also means the wallet is in RUPEES.
// This is the 100x boundary: never feed paise into that wallet without dividing,
// and never feed a float. examplePay is an integer rupee value, which toPaise
// accepts directly.
export function refundPaise(c) {
  const item = toPaise(c.examplePay);
  if (item == null) return null;
  const pct = Number(c.pct);
  return Number.isInteger(pct) ? percentOfPaise(item, pct) : null;
}

// Display string in rupees, e.g. 40410 -> "404.10". For the prototype's rupee
// wallet, the whole-rupee amount is refundRupeesWhole().
export function refundRupeesStr(c) {
  const p = refundPaise(c);
  return p == null ? null : formatPaise(p);
}

// Whole rupees to add to the prototype's integer-rupee wallet. Floors - we never
// credit a fraction of a rupee to a wallet that can't represent one.
export function refundRupeesWhole(c) {
  const p = refundPaise(c);
  return p == null ? null : Math.floor(p / 100);
}

// Real taskflow state -> the prototype's 9-step integer. Keeping `step` as the
// derived surface means every existing consumer (Home, MyProducts, ProgressRow,
// TaskStatus, continueStep) keeps working while the truth underneath is a real
// state machine.
//
//   prototype steps: 1 buy · 2 order-proof · 3 order-verified(+refund tracked)
//                    · 4 delivered · 5 review-submitted · 6 return-window
//                    · 7 refund-confirmed(withdraw) · 8 reward-confirmed · 9 paid
//
// There is no "bought but unverified" signal in taskflow - verification IS the
// order evidence arriving - so CLAIMED maps to 1 (buy) and jumps to 3 the moment
// real order evidence lands. That is honest to the product's verification model.
export function stateToStep(task, now, policy) {
  const n = now == null ? Date.now() : now;
  const p = policy || POLICY;
  switch (task.state) {
    case STATES.CLAIMED:   return 1;
    case STATES.PURCHASED: return 3;
    case STATES.DELIVERED: return 4;
    case STATES.REVIEWED:  return 5;
    case STATES.HOLDING:
      // Window closed + still public + not returned -> the "Refund Confirmed"
      // stage with the Withdraw action. Otherwise still inside the hold.
      return refundEligibility(task, n, p).eligible ? 7 : 6;
    case STATES.REFUNDED:  return 9;
    default:               return 1;
  }
}

// The single mutation entry point, same guarantees as taskflow.transition:
// atomic + idempotent. The prototype holds `task` in useState and swaps in
// res.task.
export function apply(task, event) {
  return transition(task, event);
}

// Evidence keyed the same way ConnectScreen keys it, so re-applying is a no-op.
function evidenceEvent(evidence, at) {
  return {
    type: 'EVIDENCE',
    key: `evidence:${evidence.order ? evidence.order.id : evidence.blocker || 'none'}`,
    evidence,
    at: at == null ? Date.now() : at,
  };
}

// Structurally-real evidence for the browser, where the native fetch can't run.
// Shaped exactly like a readAmazonEvidence() success return, so the state
// machine can't tell it from the real thing - only the SOURCE differs. Pass
// `deliveryAt` to advance past DELIVERED; omit it to stall at PURCHASED with a
// "no delivery date" gap, exactly as an unreadable delivery line would.
export function simulatedEvidence(c, opts) {
  const o = opts || {};
  const item = toPaise(c.examplePay);
  const orderDate = o.orderAt == null ? Date.now() - 10 * DAY : o.orderAt;
  return {
    blocker: null,
    review: {
      reviewId: 'sim_r_' + c.id,
      asin: c.asin || null,
      product: c.product,
      rating: o.rating == null ? 5 : o.rating,
      published: o.published !== false,
      verified: true,
      reviewDate: o.reviewAt == null ? orderDate + DAY : o.reviewAt,
      reviewDateSource: 'simulated',
    },
    order: {
      id: o.orderId || 'SIM-' + c.id,
      date: orderDate,
      dateRaw: null,
      itemPaise: item,
      orderTotalPaise: item,
      amountSource: 'simulated',
      itemAmountAmbiguous: false,
      product: c.product,
      source: SOURCES.ORDER_DETAILS,
    },
    delivery: o.deliveryAt == null ? null : { at: o.deliveryAt, raw: null, source: SOURCES.ORDER_DETAILS },
    returned: o.returned === true,
  };
}

// Event builders for the prototype's existing buttons. Each returns an event to
// hand to apply(task, event).
export const events = {
  // Browser path: synthesised evidence.
  simulated: (c, opts) => evidenceEvent(simulatedEvidence(c, opts), opts && opts.at),
  // Device path: a real fetched payload run through readAmazonEvidence.
  fromFetch: (raw, target, at) => evidenceEvent(readAmazonEvidence(raw, target || {}), at),
  confirmOrder: (at) => ({ type: 'CONFIRM_ORDER', key: 'confirm', at: at == null ? Date.now() : at }),
  markReviewed: (at) => ({ type: 'MARK_REVIEWED', key: 'reviewed', at: at == null ? Date.now() : at }),
  startHold: (at) => ({ type: 'START_HOLD', key: 'hold', at: at == null ? Date.now() : at }),
  // The HOLDING re-check. On device/server this is a real permalink fetch; in the
  // browser the prototype supplies the boolean.
  visibility: (published, at) => ({ type: 'VISIBILITY_CHECK', key: `vis:${at == null ? Date.now() : at}`, published: published === true, at: at == null ? Date.now() : at }),
  release: (at, policy) => ({ type: 'RELEASE_REFUND', key: 'release', policy: policy || POLICY, at: at == null ? Date.now() : at }),
};

// Everything the prototype's TaskStatus needs to render truthfully, derived from
// the real task. `step` keeps the existing timeline working; the rest lets it
// stop lying (real window end, real block reasons) when we wire the UI.
export function view(task, c, now, policy) {
  const n = now == null ? Date.now() : now;
  const p = policy || POLICY;
  const elig = refundEligibility(task, n, p);
  return {
    step: stateToStep(task, n, p),
    state: task.state,
    refundPaise: refundPaise(c),
    refundRupees: refundRupeesWhole(c),
    refundDisplay: refundRupeesStr(c), // "404.10" — exact, for display

    windowEndsAt: windowEnd(task, p),
    eligible: elig.eligible,
    blockedReasons: elig.reasons,
    blocker: task.blocker,
    blockerReason: task.blockerReason,
    order: task.order,
    delivery: task.delivery,
    review: task.review,
    returned: task.returned,
  };
}
