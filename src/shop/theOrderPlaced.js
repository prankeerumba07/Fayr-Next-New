// DID THEY JUST PLACE AN ORDER? — FROM THE PAGE'S TITLE AND ADDRESS, NOTHING ELSE.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS EMPHATICALLY NOT ───────────────────────
//
// The design says Fayr notices the order with no tap: "Once they place the
// order, everything is inside our app ... so we know that the order has been
// completed. It will directly show Order placed."
//
// THIS IS A HINT AND IT IS NEVER EVIDENCE. The phone decides nothing about
// money and that rule is not bending here. What this answer does is pull a
// TRIGGER on a read that already exists:
//
//   the shop's page looks like an order was placed
//     -> the bar says so
//     -> the key in the address is told to our side, once
//     -> Fayr hands back to its own task page, which runs the order read
//        (LookingForItScreen) on THAT ONE ORDER'S page
//     -> THE SERVER decides whether the order matched this campaign
//     -> and only the server's answer moves the task
//
// Nothing in this file, and nothing in src/shop/, reads an order. The read is
// built, measured and working for Zepto — drawnList.js, detailLook.js,
// orderhistory.js and the server's own parseOrderText, with both of the owner's
// real Zepto order pages as fixtures — and none of it is touched.
//
// ── THE TWO MISTAKES DO NOT COST THE SAME, SO THIS LEANS SHY ────────────────
//
// A MISSED order costs one extra look: the read still runs when they leave the
// shop, exactly as Phase 7 left it, and the screenshot fallback is still there
// after a fruitless one.
//
// A FALSE order sends somebody into a read for a purchase that never happened.
// That ends in "we could not find it" and looks broken.
//
// So a page has to POSITIVELY say so, the rule that recognises a page which is
// an order but NOT a new one runs first, and anything unrecognised answers
// CANNOT_TELL. There is no rule here that guesses upward.
//
// ── AND THE MARKS ARE MEASURED NOW — 18 SEPTEMBER 2026 ──────────────────────
//
// Until Phase 8A every phrase and path in Zepto's table was a labelled guess.
// The owner then bought something inside this screen, and the log wrote down
// what the shop actually did: the confirmation is the ADDRESS /order/status/
// followed by the order's key, and the title never says anything at all. The
// table in insideFayr.js is rewritten from that, and this file learned one
// thing more — how to read the KEY out of the address, so the read that follows
// can open that one order's page instead of the list.

import { anybodyHasMeasured, orderMarksFor } from './insideFayr.js';

/** The three answers. Shaped after theRightProduct.js, which asks a similar question. */
export const PLACED = 'PLACED';
export const NOT_PLACED = 'NOT_PLACED';
export const CANNOT_TELL = 'CANNOT_TELL';

/** Which rule fired, in words, for the log — so a real run can correct the table. */
export const BECAUSE_ORDER = {
  SHOP_NOT_TAUGHT: 'this shop has not been taught what its order page looks like',
  NOTHING_MEASURED_YET: 'nobody has ever watched this shop place an order',
  NOTHING_TO_READ: 'there is no title and no address yet',
  AN_ORDER_ALREADY_KNOWN: 'an order’s own page or the order list, not a new order',
  THE_ADDRESS_SAYS_SO: 'the address says an order was placed',
  THE_TITLE_SAYS_SO: 'the title says an order was placed',
  NOTHING_SAYS_SO: 'nothing on this page says an order was placed',
};

/**
 * A TITLE, TIDIED, so a phrase can be looked for in it.
 *
 * The same shape as theRightProduct.js's own tidying and deliberately NOT
 * imported from it: that one also splits digits from letters, which is right for
 * comparing a product name to a title and pointless here, and a shared helper
 * that quietly grows a second caller's requirements is how two questions end up
 * answered by one compromise.
 */
export function tidyText(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * THE PATH OF AN ADDRESS, WITH ITS CASE KEPT, and the query and the fragment
 * kept too — or null when there is no web address to read one off.
 *
 * A regex, and its own rather than src/connect/gate.js's `pathOf`: everything
 * under src/connect is frozen, and the shopping flow having its own small copy
 * is better than it depending on a file it must never cause a change to.
 *
 * CASE KEPT, because this is what the order's KEY is read out of, and a key is
 * an address part: lower-casing it would change what the phone opens. The
 * lower-cased form the marks are matched against is pathOfAddress, below.
 */
export function pathKeepingCase(url) {
  if (typeof url !== 'string') return null;
  const found = url.match(/^https?:\/\/[^/?#]+(\/[^\s]*)?$/i);
  if (!found) return null;
  return found[1] || '/';
}

/**
 * THE PATH OF AN ADDRESS, lower case, with the query and the fragment kept.
 *
 * Kept because a shop is as likely to say `?status=success` as `/success`, and
 * dropping the query would throw away half the places the answer can live.
 */
export function pathOfAddress(url) {
  const path = pathKeepingCase(url);
  return path == null ? null : path.toLowerCase();
}

/**
 * DOES THIS MARK MATCH THIS PATH?
 *
 * A mark is a path FRAGMENT to recognise, never an address to open. Two kinds:
 *
 *   a string   matched anywhere in the path, as every mark was until Phase 8A
 *   a RegExp   tested against the path, for the one shape a fragment cannot
 *              say. Zepto's bare order page is "/order/ followed by anything
 *              that is not status/", and the fragment '/order/' alone is also
 *              the start of the confirmation — which is exactly how the guard
 *              against FALSE purchases swallowed the REAL one on 18 September
 *              2026. See insideFayr.js for the measured shapes.
 *
 * Anything that is neither matches nothing. A mark this file does not
 * understand must not become a match by accident.
 */
export function markMatches(mark, path) {
  if (typeof path !== 'string') return false;
  if (typeof mark === 'string') return mark !== '' && path.indexOf(mark) >= 0;
  if (mark instanceof RegExp) return mark.test(path);
  return false;
}

/**
 * THE ONLY SHAPE A KEY MAY HAVE, and it is the same rule theOrderPage.js applies
 * before putting one into an address: letters, digits, dot, underscore and dash.
 * A slash, a question mark or a space in it is not a key, and putting one in
 * raw would let a page steer the view somewhere else on the shop.
 */
export const AN_ORDER_KEY = /^[A-Za-z0-9._-]+$/;

/**
 * THE ORDER'S KEY, READ OUT OF THE ADDRESS, or null.
 *
 * ── TWO IDENTIFIERS, NEVER CONFUSED ────────────────────────────────────────
 *
 * MEASURED 18 SEPTEMBER 2026: Zepto's ADDRESS carries a UUID
 * (01a0b4d7-870c-7dca-b701-e038477c5106) and Zepto's PAGE prints an order number
 * (JKLIKGSNS48449). This reads the first and knows nothing of the second. The
 * key is where the phone LOOKS — it opens /order/<key> later, for the order
 * read, the delivery read and the review read — and the number is what the
 * server reads off the page and the refund gate compares. Neither goes in the
 * other's place, on either side.
 *
 * ── PATH FRAGMENTS ONLY, FROM THE SHOP'S OWN ROW ───────────────────────────
 *
 * `orderKeyFollows` on the shop's table says where the key sits. What follows
 * that fragment, up to the next slash, question mark or hash, is the key. There
 * is no default and no guess: a shop whose row names no fragment answers null,
 * which today is Blinkit and Instamart, whose tables are empty because nobody
 * has watched either place an order.
 *
 * Null for anything that is not a listed shop, anything that is not a web
 * address, a key that is empty, and a key that is not AN_ORDER_KEY.
 */
export function theOrderKeyInTheAddress(key, url) {
  const marks = orderMarksFor(key);
  if (marks == null) return null;
  const follows = typeof marks.orderKeyFollows === 'string' ? marks.orderKeyFollows : '';
  if (follows === '') return null;
  const path = pathKeepingCase(url);
  if (path == null) return null;
  const at = path.toLowerCase().indexOf(follows.toLowerCase());
  if (at < 0) return null;
  const rest = path.slice(at + follows.length);
  const id = rest.split(/[/?#]/)[0];
  if (id === '' || !AN_ORDER_KEY.test(id)) return null;
  return id;
}

/**
 * DID THIS PAGE JUST PLACE AN ORDER?
 *
 * `key`   the shop, so the marks come from that shop's own row.
 * `page`  `{ title, url }` — the two things the web view already reports.
 *
 * Answers `{ said, because, orderKey }`. `orderKey` is the key read out of the
 * address when the answer is PLACED and the shop's row says where it sits, and
 * null otherwise — never a key off a page that did not place an order. Callers
 * that read only `said` and `because` see exactly what they saw before.
 *
 * The rules are in this order and the order is load-bearing:
 *
 *  1. AN ORDER THAT IS ALREADY KNOWN IS NOT A NEW ONE. The order list and an
 *     order's own page are checked first, because Zepto's own order page prints
 *     "Order Placed at" — measured, on the owner's real order — so the words
 *     appear on a page that is not a purchase. Since 18 September 2026 the bare
 *     order page is written so it cannot swallow the confirmation; the ORDER
 *     of the rules is unchanged.
 *  2. THE ADDRESS, if it carries one of this shop's confirmation marks.
 *  3. THE TITLE, if it carries one of this shop's confirmation phrases.
 *  4. OTHERWISE, CANNOT TELL. Never a guess in either direction.
 */
export function whatTheOrderPageSays(key, page) {
  const marks = orderMarksFor(key);
  const at = page || {};
  const say = (said, because, orderKey) => ({
    said, because, orderKey: said === PLACED && orderKey != null ? orderKey : null,
  });

  if (marks == null) return say(CANNOT_TELL, BECAUSE_ORDER.SHOP_NOT_TAUGHT);

  // ── A SHOP NOBODY HAS WATCHED CANNOT BE SAID TO HAVE DONE ANYTHING ────────
  //
  // Blinkit and Instamart joined the in-app list on 18 September 2026 with
  // EMPTY order tables, because nobody has ever seen either shop's confirmation
  // page. This rule runs before every other one and answers CANNOT_TELL to all
  // of them.
  //
  // WHY IT IS ITS OWN RULE AND NOT LEFT TO FALL THROUGH. An empty table already
  // reaches NOTHING_SAYS_SO by matching nothing, so this looks redundant — and
  // it is not, for two reasons. The rule below it, notAFreshOrder, answers
  // NOT_PLACED, which is a CLAIM about a page; one future line in an empty
  // shop's table would start making that claim about pages nobody has read. And
  // the log needs to tell "we looked and this shop says nothing" apart from "we
  // have never been taught what to look for", because only the second is
  // something one real purchase can fix.
  if (!anybodyHasMeasured(key)) {
    return say(CANNOT_TELL, BECAUSE_ORDER.NOTHING_MEASURED_YET);
  }

  const title = tidyText(at.title);
  const path = pathOfAddress(at.url);
  if (title === '' && path == null) return say(CANNOT_TELL, BECAUSE_ORDER.NOTHING_TO_READ);

  if (path != null && (marks.notAFreshOrder || []).some((m) => markMatches(m, path))) {
    return say(NOT_PLACED, BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN);
  }
  if (path != null && (marks.pathSays || []).some((m) => markMatches(m, path))) {
    return say(PLACED, BECAUSE_ORDER.THE_ADDRESS_SAYS_SO, theOrderKeyInTheAddress(key, at.url));
  }
  if ((marks.titleSays || []).some((m) => title.indexOf(m) >= 0)) {
    return say(PLACED, BECAUSE_ORDER.THE_TITLE_SAYS_SO, theOrderKeyInTheAddress(key, at.url));
  }
  return say(CANNOT_TELL, BECAUSE_ORDER.NOTHING_SAYS_SO);
}
