// THE SHOPPING SESSION'S RUNNING COMMENTARY — AND IT IS THE MEASURING INSTRUMENT.
//
// ── WHY THIS FILE IS AS MUCH THE POINT AS THE SCREEN IS ─────────────────────
//
// Three shops are meant to be shopped inside Fayr, and exactly one of them has
// ever been read: Zepto, by hand, into ZEPTO-BRIEF.md. Blinkit and Instamart
// appear in no order-reading map in the app, and every later phase is blocked on
// facts nobody has: which addresses their pages really have, what they title
// them, whether they refuse a web view, and which address their checkout hands
// to a payment app.
//
// Transcribing that by hand is how the Zepto brief was made, it took a day, and
// it went stale in a fortnight. So the screen writes it down instead. Running
// the flow once on each shop produces the list, in order, with times on it.
//
// ── WHAT IT WRITES, AND IT IS FOUR THINGS ───────────────────────────────────
//
//   the session it is           the shop, the campaign, the product, where it landed
//   every navigation            the full address and the page's own title
//   every address refused       the scheme, and the full address
//   going to pay, and coming back, with how long they were gone
//
// ── NOT ONE WORD OF THIS IS FOR A PERSON USING FAYR ─────────────────────────
//
// These are developer words on a developer's console. The thing that keeps them
// there is structural rather than a promise, exactly as in src/order/lookLog.js:
// there is ONE call to console.log in this file, it is inside say(), and it
// always puts TAG in front — so every line this file can emit begins with a
// bracket, and none of them can be mistaken for something a screen says.
//
// ── NO PERSONAL DATA, AND ONE KNOWN RISK WRITTEN DOWN RATHER THAN HIDDEN ────
//
// No delivery address, no card, no page text, no page markup, no order number.
// An address and a title, and that is all.
//
// THE RISK IS THE ADDRESSES THEMSELVES. Addresses are logged IN FULL and on
// purpose — learning their shapes is the entire reason this exists, and a
// trimmed address teaches nothing. But a shop is free to put something personal
// in one: an email in a query string, a postcode, a delivery pin. Nobody has
// read these three shops' addresses closely enough to promise otherwise.
//
// Two things are true about that. It is off in any build a person gets, so the
// only eyes on it are the ones running the flow deliberately. And every line
// goes through maskNumbers as its LAST act, which takes out runs of eight or
// more digits, so the one thing that has actually leaked from a log in this
// project before — the owner's own mobile number, out of a shop's own greeting,
// see src/maskNumbers.js — cannot leak from this one.
//
// What that does NOT catch is an email or a written address. If a shop turns out
// to put one in a URL we will find it in this log, which is better than guessing
// about it now, and it is dealt with then rather than pretended about here.
//
// ── AND IT IS OFF IN A REAL BUILD ──────────────────────────────────────────
//
// Guarded on __DEV__, read defensively so this module also loads under node,
// where this file's own checks call the pure half of it directly.

import { maskNumbers } from '../maskNumbers.js';

/** The one prefix, so a whole session can be found in a busy window by searching. */
export const TAG = '[fayr-shop]';

/**
 * Is the commentary on? Only in development, and never in a build a person gets.
 *
 * `typeof` first because __DEV__ is the phone's word, not node's, and the checks
 * for this file run under node.
 */
export function shopLogIsOn() {
  // eslint-disable-next-line no-undef
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * THE CLOCK READING, to the millisecond.
 *
 * Every question asked of this log is a question about order and duration — did
 * the refusal come before or after the navigation, how long was the round trip
 * to the payment app — and seconds would hide both.
 *
 * Its own copy rather than lookLog.js's, because lookLog.js says at the top of
 * itself that it is temporary and comes out when the order read is proven, and a
 * file that outlives it must not import from it.
 */
export function stamp(at) {
  const when = typeof at === 'number' && Number.isFinite(at) ? new Date(at) : new Date();
  const two = (n) => String(n).padStart(2, '0');
  const three = String(when.getMilliseconds()).padStart(3, '0');
  return `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}.${three}`;
}

/**
 * ONE LINE, BUILT AND NOT PRINTED, so the shape of it can be checked under node.
 */
export function shopLine(what, detail, at) {
  const tail = detail == null || detail === '' ? '' : ` ${detail}`;
  // MASKED HERE, AT THE ONE PLACE EVERY LINE PASSES THROUGH, as the last act
  // before the line exists. The whole assembled line goes through it, not just
  // `detail`, so it cannot matter which argument a future caller puts a shop's
  // own answer into.
  return maskNumbers(`${TAG} ${stamp(at)} ${what}${tail}`);
}

/** The only place this file writes anything anywhere. */
function say(line) {
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * Say one line, if the commentary is on. Answers whether it said anything, so a
 * check can prove the guard works without reading the console.
 */
export function logShop(what, detail, at) {
  if (!shopLogIsOn()) return false;
  say(shopLine(what, detail, at));
  return true;
}

/**
 * A VALUE THAT IS MISSING SAYS SO, rather than saying "undefined".
 *
 * Every detail below is read by a person scanning a console, and `campaign=
 * undefined` reads as a bug in the log where `campaign=none` reads as a fact
 * about the session.
 */
function orNone(value) {
  if (value == null) return 'none';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? 'none' : text;
}

/**
 * THE FIRST LINE OF A SESSION: which shop, which campaign, which product, and
 * where it landed.
 *
 * The product NAME is in here, and it is the only piece of Fayr's own data in
 * this whole file. It is not personal — it is a campaign's product, the same
 * string the bar across the top of the screen shows — and without it a log of
 * addresses cannot be read against the offer it was collected for.
 */
export function sessionDetail({ shop, campaignId, productName, keyword, land, url }) {
  // THE KEYWORD IS IN HERE, INCLUDING WHEN THERE ISN'T ONE, because a run whose
  // bar sat on "no search phrase has been written" all session is a different
  // story from one where ops had filled it in, and the log must not leave a
  // reader guessing which of the two they are looking at.
  return `shop=${orNone(shop)} campaign=${orNone(campaignId)} `
    + `landed=${orNone(land)} product="${orNone(productName)}" `
    + `keyword="${orNone(keyword)}" at=${orNone(url)}`;
}

/**
 * A NAVIGATION: the full address, and the page's own title.
 *
 * The title is the shop's own word for the page, which is the one thing that
 * tells an order page from a product page from a checkout without reading any of
 * the page. It is quoted because titles have spaces in them and an unquoted one
 * would run into the next field.
 */
export function navigationDetail({ url, title }) {
  return `url=${orNone(url)} title="${orNone(title)}"`;
}

/**
 * AN ADDRESS THE VIEW DID NOT LOAD: its scheme first, then the whole thing.
 *
 * The scheme is pulled out in front even though it is also inside the address,
 * because the scheme is the answer being collected — which payment apps these
 * three checkouts actually reach for — and putting it first means the whole list
 * can be read off a console without parsing anything.
 *
 * `topFrame` is recorded because a payment step can live in a frame inside the
 * page rather than in the page itself, and those two want different handling in
 * a later phase. Nothing decides anything on it today.
 */
export function refusedDetail({ url, scheme, topFrame }) {
  return `scheme=${orNone(scheme)} topFrame=${topFrame === true ? 'yes' : 'no'} `
    + `url=${orNone(url)}`;
}

/**
 * WHAT WE MADE OF A PAGE, AND WHICH RULE MADE IT.
 *
 * ── THIS LINE IS WHAT MAKES THE MATCHER TUNABLE ────────────────────────────
 *
 * Not one threshold in theRightProduct.js has met a real Zepto title. Without
 * the rule name and the numbers beside the title, a run would produce a list of
 * verdicts with no way to tell a rule that is too keen from a rule that is too
 * shy, and the only way to improve it would be to imagine harder.
 *
 * With them, a run produces exactly the table somebody needs: this title, this
 * answer, this rule, this many of the product's words out of that many. A rule
 * firing on the wrong pages is then obvious at a glance.
 *
 * THE TITLE IS THE ONLY THING FROM THE PAGE, as everywhere else in this file.
 * Never the markup, never the page text, never what the person searched for.
 */
export function verdictDetail({ title, verdict, because, share, matched, of, ofItsOwn }) {
  const part = typeof share === 'number' && Number.isFinite(share)
    ? String(Math.round(share * 100) / 100)
    : 'none';
  return `said=${orNone(verdict)} rule="${orNone(because)}" `
    + `share=${part} words=${orNone(matched)}/${orNone(of)} own=${orNone(ofItsOwn)} `
    + `title="${orNone(title)}"`;
}

/**
 * WHAT WE MADE OF A PAGE AS AN ORDER, AND WHICH RULE MADE IT.
 *
 * ── THIS IS THE LINE THAT CORRECTS THE GUESS ───────────────────────────────
 *
 * Not one phrase or path in insideFayr.js's order table came off a real Zepto
 * confirmation page. This line is how one real purchase replaces all of them:
 * it carries the exact title and the exact address of every page judged, beside
 * the answer and the rule, so afterwards the table is rewritten from what Zepto
 * actually wrote rather than from what this project expected it to write.
 *
 * A title and an address, as everywhere else in this file. Never the page.
 */
export function orderDetail({ said, because, title, url }) {
  return `said=${orNone(said)} rule="${orNone(because)}" `
    + `title="${orNone(title)}" url=${orNone(url)}`;
}

/**
 * WHAT THE SHOP'S OWN PAGE JUST SHOWED ABOUT SIGNING IN.
 *
 * Three yes-or-no answers and never the greeting they were read out of. The
 * greeting on a signed-in page is somebody's own NAME, and a name in a console
 * line is the one thing this file is careful about everywhere else —
 * maskNumbers is the last act of every line for the same reason. Whether a name
 * was found is worth knowing; the name itself is not ours to print.
 */
export function signInDetail({ signInIsUp, theyAreIn, signInIsGone, accountName }) {
  return `signInIsUp=${signInIsUp === true} theyAreIn=${theyAreIn === true} `
    + `signInIsGone=${signInIsGone === true} greetedByName=${typeof accountName === 'string' && accountName !== ''}`;
}

/**
 * THEY SIGNED IN, HERE, WITHOUT LEAVING THE SHOP.
 *
 * Its own line because it is the moment the whole of Task 3 exists for: before
 * this, signing in meant a second web view on a page nobody can buy anything
 * on. If a real run shows this line and no [fayr-gate] line anywhere near it,
 * that is the connect screen having been made unnecessary for this shop, which
 * is the thing to look for.
 */
export function signInRecordedDetail({ shop, campaignId, name }) {
  return `shop=${orNone(shop)} campaign=${orNone(campaignId)} `
    + `greetedByName=${typeof name === 'string' && name !== ''}`;
}

/**
 * A PAGE ON A SHOP NOBODY HAS EVER WATCHED PLACE AN ORDER.
 *
 * ── THIS LINE IS THE MEASUREMENT, AND IT IS WHY IT IS LOUD ─────────────────
 *
 * Blinkit and Instamart joined the in-app list on 18 September 2026 with empty
 * order tables, because nobody has seen either shop's confirmation page. There
 * is no way to fill those in from a desk. There is one way to fill them in at
 * all: somebody buys something on one of them inside this screen, and this line
 * writes down the real title and the real address of every page on the way.
 *
 * The owner's first real Blinkit run IS the measurement, and this is the form it
 * arrives in.
 */
export function untaughtShopDetail({ shop, title, url }) {
  return `shop=${orNone(shop)} NOBODY HAS MEASURED THIS SHOP'S ORDER PAGE — `
    + `if this page is the one that says an order was placed, its title and `
    + `address are the two things insideFayr.js needs: `
    + `title="${orNone(title)}" url=${orNone(url)}`;
}

/**
 * THE HAND-OFF: the shop screen is finished and the read that already exists
 * takes over.
 *
 * Worth its own line because it is the moment this flow stops being a screen
 * showing a shop and becomes a claim on somebody's money being checked. If a
 * run ever shows two of these for one purchase, the once-only guard has failed
 * and the log is where that is visible.
 */
export function handoffDetail({ to, campaignId }) {
  return `to=${orNone(to)} campaign=${orNone(campaignId)}`;
}

/**
 * HOW LONG THEY WERE GONE, in words a console can be scanned for.
 *
 * `null` is not zero. It means they came back and the clock could not say how
 * long — see comingBackFromPaying in insideFayr.js.
 *
 * AND IT SAYS NOTHING ABOUT WHETHER THEY PAID, because this flow does not know
 * and must not appear to. Somebody who cancelled at GPay and came back produces
 * exactly this line, and so does somebody who paid.
 */
export function cameBackDetail({ awayMs }) {
  if (awayMs == null) return 'away=unknown (the clock could not say)';
  const seconds = Math.round(awayMs / 100) / 10;
  return `away=${seconds}s`;
}
