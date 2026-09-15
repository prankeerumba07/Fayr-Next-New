// OPENING THE ORDER'S OWN PAGE, BECAUSE THE LIST PAGE DOES NOT SAY ENOUGH.
//
// ── WHAT WAS WRONG WITH LOOKING AT THE LIST ────────────────────────────────
//
// Amazon's list of orders is filled in by its own code after the page arrives.
// A fetch reads the markup as it was sent, and runs none of that code, so the
// list arrives as a set of empty frames. It was measured twice, fourteen minutes
// apart in one session: eight matched products, then none, with the dates gone
// the second time.
//
// ONE THING SURVIVES, and it is the reason this file exists. Each card carries
// the order's number in an ATTRIBUTE:
//
//   data-csa-c-slot-id="amzn1.yourorders.order-card.408-5094957-4481129"
//
// An attribute is in the markup as sent. So the list is worth exactly one thing:
// the order numbers. Everything else about an order is on the order's OWN page,
// at /gp/your-account/order-details, which Amazon renders on its server and
// which is the page the review-first read has always used and proven.
//
// ── WHAT THIS FILE KNOWS, AND WHAT IT REFUSES TO KNOW ──────────────────────
//
// It knows WHERE to look and HOW MANY TIMES. It does not know what an order
// number means beyond its shape, what a price is, or what a match is. That is
// the same line src/orderhistory.js draws and for the same reason written there:
// the reading rules live in ONE place, on the server, in
// backend/src/ocr/order-text.ts. Two copies of a money rule in two languages
// eventually disagree.
//
// So the loop that uses this file fetches a page and hands the TEXT to the
// server, which reads it and says whether it matched. The phone never decides.
//
// ── AND IT IS DELIBERATELY IMPOLITE TO NOBODY ──────────────────────────────
//
// Amazon rate-limits us; that is measured, not assumed. So there is a hard
// ceiling on how many of these pages one look may open, a real gap between two
// fetches, and any sign of the shop refusing stops the WHOLE look at once rather
// than continuing down the list. See MOST_DETAIL_PAGES and GAP_BETWEEN_FETCHES_MS.
//
// FAYR TYPES NOTHING INTO ANY OF THESE PAGES. It fetches and reads. There is no
// form, no click and no puzzle anywhere in this file.

// THE PURE STRING HALF OF THE SHAPE REPORTER, AND ONLY THAT HALF. Nothing in
// that file writes anything anywhere unless logPageShape is called, and this
// never calls it. Importing it here is what stops a THIRD copy of "take the
// page's own code out before reading it as markup" existing — there are already
// two, here and at pageToLines in src/orderhistory.js.
import { withoutCode } from './pageShape.js';

/**
 * HOW MANY ORDER PAGES ONE LOOK MAY OPEN. The owner's number.
 *
 * Six is enough that somebody who has bought a few other things since claiming
 * is still found, and small enough that a look is a handful of requests rather
 * than a crawl. The review-first read opens up to ten and is the thing that has
 * been blocked before, so this is deliberately below it.
 *
 * It is a ceiling on FETCHES, not on orders considered: the look stops the
 * moment one matches, so the ordinary case is one.
 */
export const MOST_DETAIL_PAGES = 6;

/**
 * THE GAP BETWEEN TWO FETCHES, in milliseconds.
 *
 * A real gap, not a token one. Six pages back to back is what a robot looks
 * like; six pages spread over eight seconds is what a person reading their own
 * orders looks like. It is also inside the twenty second ceiling the screen
 * already enforces, with the fetches themselves allowed for.
 *
 * Applied BETWEEN fetches and never before the first, so the ordinary case — one
 * order page, matched — waits for nothing.
 */
export const GAP_BETWEEN_FETCHES_MS = 1500;

/**
 * AN AMAZON INDIA ORDER NUMBER, and nothing else is accepted.
 *
 * Three digits, seven, seven — 408-5094957-4481129, which is the shape proven on
 * a real account. Anything else found in that attribute is IGNORED rather than
 * fetched: this value goes into an address, and an address built out of whatever
 * a page happened to contain is the one thing that must not happen here.
 */
export const ORDER_NUMBER_SHAPE = /^\d{3}-\d{7}-\d{7}$/;

/** Where an order's own page lives. The half before the number. */
export const AMAZON_ORDER_DETAIL_PAGE =
  'https://www.amazon.in/gp/your-account/order-details?orderID=';

/**
 * The attribute the order card carries, and the number inside it.
 *
 * Read off the MARKUP AS SENT, which is the whole point: the card's visible text
 * is filled in later by Amazon's own code and a fetch never sees it, but an
 * attribute is there from the start.
 *
 * Single or double quotes, because a page is written by whatever wrote it.
 */
const SLOT_ID_ATTRIBUTE =
  /data-csa-c-slot-id\s*=\s*["']amzn1\.yourorders\.order-card\.([^"']{1,64})["']/gi;

/**
 * EVERY ORDER NUMBER ON A FETCHED LIST PAGE, newest first, each one once.
 *
 * NEWEST FIRST BECAUSE THE PAGE IS. Nothing here sorts them: Amazon lists its
 * orders newest first and the page's own order is kept, exactly as
 * readOrderBlocks does. Sorting would need a date, and no date survives on this
 * page to sort by.
 *
 * PURE, and that is the point of it being here: this is the half of the read that
 * can be checked without a phone, and the half most likely to be wrong.
 */
export function harvestOrderNumbers(html) {
  if (typeof html !== 'string' || html === '') return [];
  const found = [];
  const seen = new Set();
  // A fresh expression each call. SAID HONESTLY: this is defensive rather than
  // load-bearing, and a mutation sharing the one above does not fail any check.
  // A global expression remembers where it stopped, but the loop below runs until
  // exec answers null, and answering null is what resets it — so the shared one
  // happens to be safe as this loop is written today. It stops being safe the
  // moment the loop can end early, which the guard below can already do on a page
  // with five hundred cards on it. A fresh one costs nothing and does not depend
  // on that reasoning staying true.
  const pattern = new RegExp(SLOT_ID_ATTRIBUTE.source, 'gi');
  let match = pattern.exec(html);
  let guard = 0;
  while (match !== null && guard < 500) {
    guard += 1;
    const number = String(match[1]).trim();
    if (ORDER_NUMBER_SHAPE.test(number) && !seen.has(number)) {
      seen.add(number);
      found.push(number);
    }
    match = pattern.exec(html);
  }
  return found;
}

/**
 * HOW MANY ORDER CARDS THE PAGE CARRIED AT ALL, whatever was written in them.
 *
 * ── THE ONE QUESTION harvestOrderNumbers CANNOT ANSWER ────────────────────
 *
 * An empty answer from harvestOrderNumbers has two completely different
 * meanings, and the screen cannot tell them apart today:
 *
 *   slots = 0   the page was not an orders page at all. A sign in wall, a dead
 *               end, a shell that arrived with nothing in it. The fix is about
 *               the session or the address.
 *   slots > 0   the cards were there and every id in them was refused. So the
 *               attribute still exists and the SHAPE has moved — a different
 *               prefix, a different number of digits, a new kind of card. The
 *               fix is one regular expression, and nothing is wrong with the
 *               session at all.
 *
 * Those are opposite problems with opposite fixes, and an afternoon went into
 * not being able to tell which one had happened. So the count is its own
 * question, deliberately asked WITHOUT the shape test.
 *
 * IT RETURNS A NUMBER AND NEVER THE TEXT IT MATCHED. That is the whole point of
 * it being a separate function rather than a length taken off a list of ids: an
 * order number is a strong identifier tied to somebody's account, and a count
 * answers the question without carrying one anywhere.
 */
export function countOrderCardSlots(html) {
  if (typeof html !== 'string' || html === '') return 0;
  // A fresh expression, for the reason recorded on the harvest above.
  const pattern = new RegExp(SLOT_ID_ATTRIBUTE.source, 'gi');
  let howMany = 0;
  let guard = 0;
  while (pattern.exec(html) !== null && guard < 500) {
    howMany += 1;
    guard += 1;
  }
  return howMany;
}

/**
 * AN ORDER NUMBER AS IT APPEARS IN THE MIDDLE OF A PAGE, rather than on its own.
 *
 * ORDER_NUMBER_SHAPE with its two anchors taken off, DERIVED and not retyped.
 * The day the shape changes — a fourth group, an eighth digit — every rung of
 * the ladder below, every address built by orderDetailPageFor and pagesToOpen
 * all change together, because there is one definition and everything else
 * points at it. A second copy typed out here is how those drift apart.
 */
export const ORDER_NUMBER_RUN = ORDER_NUMBER_SHAPE.source.replace(/^\^/, '').replace(/\$$/, '');

/**
 * HOW AN ORDER'S OWN PAGE NAMES THE ORDER IT IS SHOWING. Taken off the address
 * this file already builds, so it cannot be a different word from the one we
 * ask with.
 */
export const ORDER_ID_PARAM = AMAZON_ORDER_DETAIL_PAGE.slice(
  AMAZON_ORDER_DETAIL_PAGE.indexOf('?') + 1,
);

/**
 * THE WHOLE NUMBER AND NOT A PIECE OF A LONGER ONE.
 *
 * `\b` on both ends, which is enough here and is worth writing down why: a dash
 * is not a word character, so the boundaries fall where they should around the
 * two dashes, and a run sitting inside a longer digit string —
 * 1408-5094957-44811299 — has a word character on each side and matches nothing
 * at all. No lookbehind, which Hermes does not have.
 */
function everyRunIn(text) {
  const found = [];
  if (typeof text !== 'string' || text === '') return found;
  const pattern = new RegExp(`\\b${ORDER_NUMBER_RUN}\\b`, 'g');
  let match = pattern.exec(text);
  let guard = 0;
  while (match !== null && guard < 500) {
    guard += 1;
    found.push(match[0]);
    match = pattern.exec(text);
  }
  return found;
}

/**
 * ── RUNG TWO: THE NUMBER AMAZON ITSELF PUT IN A LINK TO THE ORDER ───────────
 *
 * A string that a page writes as the orderID of a link to an order's own page IS
 * an order number, by the page's own account. That is the strongest evidence
 * short of the card attribute itself, and it is not a guessed marker: the word
 * comes off the address THIS FILE ALREADY BUILDS.
 *
 * Still put through ORDER_NUMBER_SHAPE afterwards. A page that writes
 * `orderID=nonsense` gets nothing, because this value ends up in an address.
 */
export function harvestFromOrderLinks(html) {
  if (typeof html !== 'string' || html === '') return [];
  const found = [];
  const seen = new Set();
  const pattern = new RegExp(`${ORDER_ID_PARAM}(${ORDER_NUMBER_RUN})\\b`, 'gi');
  let match = pattern.exec(html);
  let guard = 0;
  while (match !== null && guard < 500) {
    guard += 1;
    const number = String(match[1]).trim();
    if (ORDER_NUMBER_SHAPE.test(number) && !seen.has(number)) {
      seen.add(number);
      found.push(number);
    }
    match = pattern.exec(html);
  }
  return found;
}

/**
 * ── RUNG THREE: THE NUMBER'S OWN SHAPE, WHICH NO MARKUP CHANGE CAN MOVE ─────
 *
 * ── AND WHY THIS IS NOT THE GUESS THE OWNER FORBADE ────────────────────────
 *
 * He said: do not guess a new marker, report what the rows are marked with
 * first. This guesses no marker at all. It does not ask what wraps the number,
 * what class the row has or what attribute holds it. It looks for THE NUMBER
 * ITSELF, in the shape this file has always meant by "an order number" —
 * ORDER_NUMBER_SHAPE, the same definition that decides whether an address may be
 * built at all. There is nothing here to be wrong about that was not already
 * load bearing.
 *
 * WHAT IT COSTS, SAID PLAINLY. A three seven seven run that is not somebody's
 * order is one wasted fetch and one wasted ask of the server, which declines it:
 * orderDetailPageFor still refuses anything off shape so no invented address is
 * ever opened, MOST_DETAIL_PAGES still caps it, and the server still decides
 * what matched. And a real order number from somewhere else on the page — a
 * "buy it again" rail — can push a real one past the sixth. That is why the
 * report exists and why `how` is on the line: a look that keeps coming back
 * `how=shape` is a look waiting for a proper selector.
 *
 * THE PAGE'S OWN CODE IS TAKEN OUT FIRST. A drawn page carries its orders twice,
 * once as markup and once inside the JSON its own script was handed, and a
 * number read out of the second is a number in a different order from the one a
 * person sees.
 */
export function harvestByShape(html) {
  const found = [];
  const seen = new Set();
  for (const number of everyRunIn(withoutCode(html))) {
    if (ORDER_NUMBER_SHAPE.test(number) && !seen.has(number)) {
      seen.add(number);
      found.push(number);
    }
  }
  return found;
}

/**
 * EVERY ORDER NUMBER A DRAWN PAGE OFFERS, BY THE STRONGEST EVIDENCE FIRST.
 *
 * ── A LADDER, AND THE ORDER OF IT IS THE WHOLE DESIGN ──────────────────────
 *
 *   slot   the card attribute this file has always read. Most precise thing we
 *          hold, and a drawn page may well still carry it — the answer to "did
 *          the old marker come back" has to keep being askable.
 *   link   the number Amazon wrote as the orderID of a link to the order.
 *   shape  the number's own shape, which survives any markup move at all.
 *
 * `how` says WHICH ONE ANSWERED, and that one word is the finding this whole
 * change exists to produce. `slot` means nothing moved. `link` means the cards
 * were rebuilt and the links were not. `shape` means we are reading a page
 * nothing in this file recognises any more.
 *
 * The counts are kept separately from the numbers because they are what goes in
 * a line: an order number is a strong identifier tied to somebody's account and
 * is never logged.
 */
export function harvestRendered(html) {
  const marked = harvestOrderNumbers(html);
  const linked = harvestFromOrderLinks(html);
  const shaped = harvestByShape(html);
  const numbers = [];
  const seen = new Set();
  for (const number of [...marked, ...linked, ...shaped]) {
    if (!seen.has(number)) { seen.add(number); numbers.push(number); }
  }
  let how = 'none';
  if (marked.length > 0) how = 'slot';
  else if (linked.length > 0) how = 'link';
  else if (shaped.length > 0) how = 'shape';
  return {
    numbers,
    how,
    marked: marked.length,
    linked: linked.length,
    shaped: shaped.length,
  };
}

/**
 * The address of one order's own page, or null when the number is not one.
 *
 * NULL RATHER THAN A GUESS. A number that is not an order number is not made
 * into an address and tried anyway — that would be a request to a shop for
 * something nobody asked for, on the strength of a string found in a page.
 */
export function orderDetailPageFor(orderNumber) {
  const number = typeof orderNumber === 'string' ? orderNumber.trim() : '';
  if (!ORDER_NUMBER_SHAPE.test(number)) return null;
  return `${AMAZON_ORDER_DETAIL_PAGE}${encodeURIComponent(number)}`;
}

/**
 * WHICH SHOPS ARE READ ONE ORDER PAGE AT A TIME.
 *
 * Amazon, and only Amazon, because Amazon is the only one whose list page is
 * empty frames. Every other shop's list really does carry its orders as text,
 * and reading them a page at a time would be more requests for the same answer.
 *
 * ── AND WHY THE ANSWER LIVES HERE RATHER THAN IN THE SCREEN ───────────────
 *
 * Because the waiting screen may not write a shop's name AT ALL — not in a
 * heading, not in a quiet line, and not in a comparison, since a name typed into
 * a screen is a name that ends up on one. There is a check that reads that
 * screen's source and holds every piece of text in it to that list, and it
 * caught this on the first run.
 *
 * So the screen asks a QUESTION and this file knows the answer, which is also
 * where the addresses already live.
 */
export const SHOPS_READ_ONE_ORDER_AT_A_TIME = ['amazon'];

/** Whether this shop's orders are read one page at a time. */
export function readsOrderPages(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  return SHOPS_READ_ONE_ORDER_AT_A_TIME.indexOf(key) !== -1;
}

/**
 * HOW MANY OF THE NUMBERS FOUND THIS LOOK WILL ACTUALLY OPEN.
 *
 * Named rather than written as a slice at the call site, because the ceiling is
 * the promise this file makes to Amazon and a promise spelled out in the middle
 * of a loop is a promise somebody edits by accident.
 */
export function pagesToOpen(orderNumbers) {
  const list = Array.isArray(orderNumbers) ? orderNumbers : [];
  return list
    .filter((n) => typeof n === 'string' && ORDER_NUMBER_SHAPE.test(n.trim()))
    .slice(0, MOST_DETAIL_PAGES);
}

/**
 * WHETHER TO WAIT BEFORE THIS FETCH, and how long.
 *
 * Zero before the first, the gap before every one after it. Its own function so
 * the "never before the first" half is checkable: the ordinary case is one order
 * page and it must not be made slower by a politeness gap that buys nothing.
 */
export function waitBeforeFetch(indexOfFetch) {
  const n = Number(indexOfFetch);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return GAP_BETWEEN_FETCHES_MS;
}
