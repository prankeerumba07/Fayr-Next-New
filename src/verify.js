// Cross-verification: compare an "expected" purchase/review record - supplied
// by the user's task or read off an uploaded screenshot (via OCR later) -
// against the items we scraped from the marketplace, and report per-field
// matches. Where scraping can read a field, this becomes an automatic check on
// the user's screenshot (catching doctored proof); where it can't, the field
// is flagged UNVERIFIABLE so the screenshot/recording stands as sole evidence.
//
// The expected record uses plain fields: { product, orderId, amount, rating,
// orderDate, deliveryDate }. All are optional - only provided fields are
// checked.

import { timelineOf, toEpoch } from './extract.js';

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// 0..1 token-overlap of expected product tokens found in the candidate name.
export function productScore(expected, candidate) {
  const e = norm(expected);
  const c = norm(candidate);
  if (!e || !c) return 0;
  if (c.includes(e) || e.includes(c)) return 1;
  const toks = e.split(' ').filter((w) => w.length > 2);
  if (!toks.length) return 0;
  const hits = toks.filter((w) => c.includes(w)).length;
  return hits / toks.length;
}

// Pull a rupee amount out of "₹604", "604.00", "1,299", or a number. Sources
// normalize paise->rupees themselves (see platforms.js), so this just parses.
export function parseAmount(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[₹,\s]/g, '');
  const m = s.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function amountsMatch(expected, actual, tolerance = 1) {
  const e = parseAmount(expected);
  const a = parseAmount(actual);
  if (e == null || a == null) return null; // can't compare
  return Math.abs(e - a) <= tolerance;
}

function idMatch(expected, actual) {
  const e = norm(expected);
  const a = norm(actual);
  if (!e || !a) return null;
  return a.includes(e) || e.includes(a);
}

// Pick the scraped item that best corresponds to the expected product/order.
export function bestMatch(expected, items) {
  let best = null;
  let bestScore = -1;
  for (const it of items || []) {
    let score = productScore(expected.product, `${it.product || ''} ${it.title || ''}`);
    if (expected.orderId && idMatch(expected.orderId, it.orderId) === true) score += 1; // strong signal
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  // Require a confident product match (>=0.5) or an order-id hit (which alone
  // pushes score past 1); a stray shared word like "Max" shouldn't count.
  return best && bestScore >= 0.5 ? best : null;
}

// Per-field verdicts + an overall status for one expected/item pair.
// field.status: 'match' | 'mismatch' | 'unverifiable'
export function verifyItem(expected, item) {
  const fields = [];
  const push = (field, status, exp, act) => fields.push({ field, status, expected: exp, actual: act });

  if (expected.product != null && expected.product !== '') {
    const s = productScore(expected.product, `${item ? item.product : ''} ${item ? item.title : ''}`);
    push('product', s >= 0.6 ? 'match' : 'mismatch', expected.product, item ? item.product : null);
  }

  if (expected.orderId != null && expected.orderId !== '') {
    const m = item ? idMatch(expected.orderId, item.orderId) : null;
    push('orderId', item && item.orderId ? (m ? 'match' : 'mismatch') : 'unverifiable', expected.orderId, item ? item.orderId : null);
  }

  if (expected.amount != null && expected.amount !== '') {
    const actAmt = item ? item.amount : null;
    const m = amountsMatch(expected.amount, actAmt);
    push('amount', m == null ? 'unverifiable' : m ? 'match' : 'mismatch', expected.amount, actAmt);
  }

  if (expected.rating != null && expected.rating !== '') {
    const exp = Number(expected.rating);
    const act = item ? item.rating : null;
    // scraped rating should equal (or, if you accept "at least", meet) the claim
    push('rating', act == null ? 'unverifiable' : Number(act) === exp ? 'match' : 'mismatch', exp, act);
  }

  if (expected.orderDate != null && expected.orderDate !== '') {
    const exp = toEpoch(expected.orderDate);
    const act = item ? item.orderDate : null;
    const ok = exp != null && act != null ? Math.abs(exp - act) <= 2 * 86400000 : null;
    push('orderDate', ok == null ? 'unverifiable' : ok ? 'match' : 'mismatch', expected.orderDate, act);
  }

  if (expected.deliveryDate != null && expected.deliveryDate !== '') {
    const exp = toEpoch(expected.deliveryDate);
    const act = item ? item.deliveryDate : null;
    const ok = exp != null && act != null ? Math.abs(exp - act) <= 2 * 86400000 : null;
    push('deliveryDate', ok == null ? 'unverifiable' : ok ? 'match' : 'mismatch', expected.deliveryDate, act);
  }

  if (expected.rated === true) {
    // "the user has rated/reviewed AND it's visible on the order" - true only
    // when we actually scraped a rating/approved marker off the live order.
    const visible = item ? (item.rating != null || item.approved === true) : false;
    push('rated', item ? (visible ? 'match' : 'mismatch') : 'unverifiable', true, visible);
  }

  const timeline = item ? timelineOf(item) : null;
  const anyMismatch = fields.some((f) => f.status === 'mismatch');
  const anyMatch = fields.some((f) => f.status === 'match');

  let verdict; // 'verified' | 'mismatch' | 'insufficient' | 'no_match'
  if (!item) verdict = 'no_match';
  else if (anyMismatch) verdict = 'mismatch';
  else if (anyMatch) verdict = 'verified';
  else verdict = 'insufficient';

  return { item, fields, timeline, verdict };
}

// Top-level: find the matching scraped item and verify it.
export function verify(expected, items) {
  const item = bestMatch(expected || {}, items || []);
  return verifyItem(expected || {}, item);
}
