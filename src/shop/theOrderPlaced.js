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
//     -> Fayr runs the order read it already has (LookingForItScreen)
//     -> THE SERVER decides whether an order matched this campaign
//     -> and only the server's answer moves the task
//
// Nothing in this file, and nothing in src/shop/, reads an order. The read is
// built, measured and working for Zepto — drawnList.js, detailLook.js,
// orderhistory.js and the server's own parseOrderText, with both of the owner's
// real Zepto order pages as fixtures — and none of it is touched.
//
// ── THE TWO MISTAKES DO NOT COST THE SAME, SO THIS LEANS SHY ────────────────
//
// A MISSED order costs one extra tap. "Did you buy it?" is still on the journey,
// still works, and has not been touched for any shop.
//
// A FALSE order sends somebody into a read for a purchase that never happened.
// That ends in "we could not find it" and looks broken.
//
// So a page has to POSITIVELY say so, the rule that recognises a page which is
// an order but NOT a new one runs first, and anything unrecognised answers
// CANNOT_TELL. There is no rule here that guesses upward.
//
// ── AND EVERY MARK IT READS IS A GUESS, LABELLED AS ONE ─────────────────────
//
// The phrases and paths live per shop in insideFayr.js, where their own comment
// says plainly that nobody has measured Zepto's confirmation page. Phase 1's log
// is what corrects them: one real purchase writes the real title and the real
// address to the console, and the table is rewritten from that.

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
 * THE PATH OF AN ADDRESS, lower case, with the query and the fragment kept.
 *
 * Kept because a shop is as likely to say `?status=success` as `/success`, and
 * dropping the query would throw away half the places the answer can live.
 *
 * A regex, and its own rather than src/connect/gate.js's `pathOf`: everything
 * under src/connect is frozen, and the shopping flow having its own small copy
 * is better than it depending on a file it must never cause a change to.
 */
export function pathOfAddress(url) {
  if (typeof url !== 'string') return null;
  const found = url.match(/^https?:\/\/[^/?#]+(\/[^\s]*)?$/i);
  if (!found) return null;
  return (found[1] || '/').toLowerCase();
}

/**
 * DID THIS PAGE JUST PLACE AN ORDER?
 *
 * `key`   the shop, so the marks come from that shop's own row.
 * `page`  `{ title, url }` — the two things the web view already reports.
 *
 * Answers `{ said, because }`. The rules are in this order and the order is
 * load-bearing:
 *
 *  1. AN ORDER THAT IS ALREADY KNOWN IS NOT A NEW ONE. The order list and an
 *     order's own page are checked first, because Zepto's own order page prints
 *     "Order Placed at" — measured, on the owner's real order — so the words
 *     appear on a page that is not a purchase.
 *  2. THE ADDRESS, if it carries one of this shop's confirmation marks.
 *  3. THE TITLE, if it carries one of this shop's confirmation phrases.
 *  4. OTHERWISE, CANNOT TELL. Never a guess in either direction.
 */
export function whatTheOrderPageSays(key, page) {
  const marks = orderMarksFor(key);
  const at = page || {};
  const say = (said, because) => ({ said, because });

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

  if (path != null && (marks.notAFreshOrder || []).some((m) => path.indexOf(m) >= 0)) {
    return say(NOT_PLACED, BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN);
  }
  if (path != null && (marks.pathSays || []).some((m) => path.indexOf(m) >= 0)) {
    return say(PLACED, BECAUSE_ORDER.THE_ADDRESS_SAYS_SO);
  }
  if ((marks.titleSays || []).some((m) => title.indexOf(m) >= 0)) {
    return say(PLACED, BECAUSE_ORDER.THE_TITLE_SAYS_SO);
  }
  return say(CANNOT_TELL, BECAUSE_ORDER.NOTHING_SAYS_SO);
}
