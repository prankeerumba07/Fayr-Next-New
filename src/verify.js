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

// Match a campaign against the account's order history by NAME + AMOUNT.
//
// A Fayr campaign knows only the product NAME and the expected AMOUNT - the user
// lands on the marketplace home page, searches, and buys the product themselves,
// so there is no product id to register up front. So:
//   - NAME is the primary key. The campaign name is short ("boAt Airdopes 141");
//     the marketplace title is long and verbose. productScore checks how many of
//     the campaign's tokens appear in the order's title, which is exactly the
//     right direction for that shape.
//   - AMOUNT corroborates and catches a cheaper look-alike/variant. It is a
//     SECONDARY signal, not a hard gate, because marketplace prices drift: a
//     small difference is tolerated, a large one flags the match for the user.
//
// Returns the single best candidate plus the flags the human-confirm step needs.
// It never silently commits: a shaky or ambiguous match is surfaced so the "is
// this your order?" screen can warn instead of auto-verifying the wrong order.
//
// The WebView scripts (src/platforms.js) run a compact PORT of this same
// algorithm so that only the matched order leaves the page (data minimisation);
// keep the two in sync. This copy is the tested spec.
export function matchOrderByNameAmount(target, orders, opts) {
  const o = opts || {};
  const nameThreshold = o.nameThreshold != null ? o.nameThreshold : 0.6;
  // Tolerance = an absolute floor OR a percentage, whichever is larger, so it
  // survives small price drift without waving through a different-priced variant.
  const absTol = o.absTolerance != null ? o.absTolerance : 2;    // ₹2
  const pctTol = o.pctTolerance != null ? o.pctTolerance : 0.05; // 5%
  const wantName = target && target.product;
  const wantAmt = parseAmount(target && target.amount);

  const kept = [];
  for (const it of orders || []) {
    const name = it && (it.product || it.name || it.title || it.productName);
    const score = productScore(wantName, name);
    if (score < nameThreshold) continue;
    // Amount from the item's PAID price only - never a list price (mrp), which
    // would compare paid-vs-list and wrongly read as a mismatch.
    const amt = parseAmount(
      it.itemAmount != null ? it.itemAmount : it.amount != null ? it.amount : null
    );
    let amountOk = null;
    if (wantAmt != null && amt != null) {
      amountOk = Math.abs(wantAmt - amt) <= Math.max(absTol, wantAmt * pctTol);
    }
    kept.push({ order: it, score, amount: amt, amountOk });
  }
  if (!kept.length) {
    return { order: null, score: 0, amount: null, amountOk: null, ambiguous: false, candidateCount: 0 };
  }

  // Prefer amount-confirmed candidates; then highest name score; then most
  // recent. So a right-priced match always beats a same-name wrong-priced one.
  kept.sort((a, b) => {
    const aAmt = a.amountOk === true ? 1 : 0;
    const bAmt = b.amountOk === true ? 1 : 0;
    if (aAmt !== bAmt) return bAmt - aAmt;
    if (b.score !== a.score) return b.score - a.score;
    return (orderRecency(b.order) || 0) - (orderRecency(a.order) || 0);
  });
  const best = kept[0];
  // Ambiguous = 2+ candidates we genuinely can't separate on the strong signals
  // (near-equal name AND not amount-rejected). The caller must route ambiguity to
  // the human rather than auto-confirm.
  const near = kept.filter((k) => k.score >= best.score - 0.15 && k.amountOk !== false);
  return {
    order: best.order,
    score: best.score,
    amount: best.amount,
    amountOk: best.amountOk,
    ambiguous: near.length >= 2,
    candidateCount: kept.length,
  };
}

function orderRecency(it) {
  if (!it) return null;
  const v = it.orderDate != null ? it.orderDate
    : it.createdon != null ? it.createdon
    : it.createdOn != null ? it.createdOn : null;
  return toEpoch(v);
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
