// Defensive normalizer. The three platforms' internal JSON schemas are
// undocumented and change without notice, so instead of hard-coding paths we
// deep-scan the payload for objects that "look like" a review or an order and
// pull out product name / date / rating / review text wherever they sit.
//
// The raw JSON is always kept and viewable in the UI so the mapping can be
// refined once real responses are seen on-device.

const PRODUCT_KEYS = [
  'productname', 'producttitle', 'product_title', 'stylename', 'style_name',
  'title', 'name', 'brand',
];
const DATE_KEYS = [
  'reviewdate', 'orderdate', 'order_date', 'createdat', 'created_at', 'created',
  'createdon', 'submittedat', 'submitted_at', 'date', 'orderdatetime', 'placedon',
];
const RATING_KEYS = [
  'rating', 'ratingvalue', 'rating_value', 'overallrating', 'starrating',
  'stars', 'star', 'ratingcount',
];
const TEXT_KEYS = [
  'reviewtext', 'review_text', 'reviewbody', 'reviewdescription', 'review',
  'comment', 'comments', 'description', 'body', 'content', 'text', 'message',
  'reviewmessage',
];
const IMAGE_KEYS = ['imageurl', 'image_url', 'image', 'productimage', 'thumbnail', 'imageUrl'];
const TITLE_KEYS = ['reviewtitle', 'review_title', 'headline', 'subject', 'summary'];

function lc(obj) {
  const m = {};
  for (const k of Object.keys(obj)) m[k.toLowerCase()] = obj[k];
  return m;
}

function pickString(low, keys) {
  for (const k of keys) {
    const v = low[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    // Nested object exposing a .name / .title (e.g. product: { title })
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = lc(v);
      for (const ik of ['title', 'name', 'value', 'text']) {
        if (typeof inner[ik] === 'string' && inner[ik].trim()) return inner[ik].trim();
      }
    }
  }
  return null;
}

function pickRating(low) {
  for (const k of RATING_KEYS) {
    const v = low[k];
    if (typeof v === 'number' && v > 0 && v <= 5) return v;
    if (typeof v === 'string' && /^\d(\.\d+)?$/.test(v.trim())) {
      const n = parseFloat(v);
      if (n > 0 && n <= 5) return n;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = lc(v);
      for (const ik of ['value', 'rating', 'stars']) {
        if (typeof inner[ik] === 'number' && inner[ik] > 0 && inner[ik] <= 5) return inner[ik];
      }
    }
  }
  return null;
}

function formatDate(raw) {
  if (raw == null) return null;
  let d;
  if (typeof raw === 'number') {
    // seconds vs milliseconds epoch
    d = new Date(raw < 1e12 ? raw * 1000 : raw);
  } else if (typeof raw === 'string') {
    if (/^\d+$/.test(raw)) {
      const n = parseInt(raw, 10);
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
      d = new Date(raw);
    }
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return typeof raw === 'string' ? raw : null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Coerce ms-epoch numbers, numeric strings, or human date text ("Reviewed in
// India on 26 June 2026") into a millisecond timestamp, or null.
export function toEpoch(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return n < 1e12 ? n * 1000 : n;
    }
    // "Reviewed in India on 26 June 2026" -> take the part after " on "
    const m = s.match(/on\s+(.+)$/i);
    const candidate = m ? m[1] : s;
    const t = Date.parse(candidate);
    return isNaN(t) ? null : t;
  }
  return null;
}

function pickEpoch(low, keys) {
  for (const k of keys) {
    if (low[k] != null && low[k] !== '' && low[k] !== '0') {
      const e = toEpoch(low[k]);
      if (e) return e;
    }
  }
  return null;
}

const DAY = 86400000;

// Given a normalized item, derive the return/verification timeline. Uses the
// delivery date as the return-window anchor, falling back to order date, then
// review date. Return period is platform-provided (Myntra) or defaults to 30d.
export function timelineOf(item) {
  const now = Date.now();
  const orderDate = item.orderDate || null;
  const deliveryDate = item.deliveryDate || null;
  const reviewDate = item.reviewDate || null;
  const periodDays = item.returnPeriodDays && item.returnPeriodDays > 0 ? item.returnPeriodDays : 30;

  const anchor = deliveryDate || orderDate || reviewDate;
  const returnClosesAt = anchor ? anchor + periodDays * DAY : null;
  const returnClosed = returnClosesAt ? now >= returnClosesAt : false;
  const returned = item.returned === true;

  let verdict; // 'eligible' | 'in_window' | 'returned' | 'unknown'
  if (returned) verdict = 'returned';
  else if (!anchor) verdict = 'unknown';
  else if (!returnClosed) verdict = 'in_window';
  else verdict = 'eligible';

  return {
    orderDate, deliveryDate, reviewDate,
    periodDays, returnClosesAt, returnClosed, returned,
    returnStatus: item.returnStatus || null,
    verdict,
  };
}

// Walk the whole payload; collect nodes that carry review/order signal.
export function extractItems(raw) {
  const items = [];
  const seen = new Set();

  function visit(node, depth) {
    if (!node || depth > 16) return;
    if (Array.isArray(node)) {
      for (const el of node) visit(el, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    const low = lc(node);
    const rating = pickRating(low);
    const text = pickString(low, TEXT_KEYS);
    const product = pickString(low, PRODUCT_KEYS);
    const dateKey = DATE_KEYS.find((k) => low[k] != null);
    const date = dateKey ? formatDate(low[dateKey]) : null;

    // Node qualifies if it looks like a review (rating or text) or an order
    // (product + date). Avoids grabbing every stray object.
    const isReviewLike = rating != null || (text && text.length > 1);
    const isOrderLike = product && date;

    if (isReviewLike || isOrderLike) {
      const item = {
        product: product || null,
        date,
        rating,
        title: pickString(low, TITLE_KEYS),
        text: text && text.length > 1 ? text : null,
        image: pickString(low, IMAGE_KEYS),
        asin: typeof low.asin === 'string' ? low.asin : null,
        verified: low.verified === true,
        // Timeline fields (platform scripts set these where available)
        orderDate: pickEpoch(low, ['orderdate', 'createdon', 'placedon']),
        deliveryDate: pickEpoch(low, ['deliverydate', 'delivereddate', 'deliveredon']),
        reviewDate: pickEpoch(low, ['reviewdate', 'reviewedon', 'updatedat']),
        returnPeriodDays:
          Number(low.returnperioddays || low.returnperiod) > 0
            ? Number(low.returnperioddays || low.returnperiod)
            : null,
        returned: low.returned === true ? true : low.returned === false ? false : null,
        returnStatus: typeof low.returnstatus === 'string' ? low.returnstatus : null,
        approved: low.approved === true ? true : low.approved === false ? false : null,
        published: low.published === true ? true : low.published === false ? false : null,
        reviewStatus: typeof low.reviewstatus === 'string' ? low.reviewstatus : null,
        productId:
          low.productid || low.asin || low.styleid || low.styleId || low.pid || null,
        orderId:
          low.orderid || low.storeorderid || low.order_id || null,
        productUrl:
          typeof low.producturl === 'string' ? low.producturl : null,
        // Kept for cross-verification against a screenshot/task amount. Raw as
        // captured ("₹604", paise, or a number); verify.js normalizes it.
        amount:
          low.amount != null ? low.amount
            : low.grandtotalamount != null ? low.grandtotalamount
            : low.total != null ? low.total
            : low.orderamount != null ? low.orderamount
            : null,
      };
      // Include orderId so two distinct orders of the same product on the same
      // day (e.g. one delivered + one returned) don't collapse into one card.
      const sig = [item.product, item.date, item.rating, item.text, item.asin, item.orderId].join('|');
      if (!seen.has(sig)) {
        seen.add(sig);
        items.push(item);
      }
    }

    for (const k of Object.keys(node)) visit(node[k], depth + 1);
  }

  visit(raw, 0);
  return items;
}
