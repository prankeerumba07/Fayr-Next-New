// THE WHOLE PAGE, WRITTEN DOWN, FOR A SHOP NOBODY HAS EVER MEASURED.
//
// ── WHAT THIS IS FOR, AND IT IS ONE RUN ─────────────────────────────────────
//
// Blinkit and Instamart shop inside Fayr and have EMPTY order tables: nobody has
// seen either shop's confirmation page, so insideFayr.js guesses nothing about
// them and theOrderPlaced.js answers CANNOT_TELL for every page either one
// draws. Every later step is blocked on that — which page says an order was
// placed, what an order page calls a delivery, what word it uses for a rating,
// how its bill is laid out.
//
// Transcribing that by hand is how ZEPTO-BRIEF.md was made. It took a day and it
// went stale in a fortnight. So the screen writes it down instead: the owner buys
// one thing on each shop, inside Fayr, and this prints what every page on the way
// actually said.
//
// ── WHAT IT ADDS TO THE LINE ABOVE IT ───────────────────────────────────────
//
// shopLog.js already writes every navigation's ADDRESS and TITLE, and its
// untaught-shop line already shouts that nobody has measured this shop. Neither
// can teach a parser the words "delivered" or "rated", or what the bill block is
// called, because neither has ever seen the page's TEXT. This is the text.
//
// ── AND IT NEVER REACHES THE SERVER, AND NEVER LEAVES A REAL BUILD ──────────
//
// Nothing here posts anything anywhere. It is a console line and nothing else:
// the page's own text comes back over the web view's bridge exactly as the title
// already does, and it stops at console.log. The screen makes the same two calls
// to Fayr's side it made before this file existed, and there is a check that
// counts them.
//
// It is off unless __DEV__ is true, read defensively as shopLog.js reads it, so
// this module also loads under node where its own checks call the pure half of it
// directly. A person who has installed Fayr can never see a line of it.
//
// ── AND NOBODY'S DETAILS GO INTO IT ─────────────────────────────────────────
//
// A whole page's text is a different thing from an address and a title, and it
// has to be treated like one. A delivery address, a name, an email and a mobile
// number are all on an order page, and the first three are exactly what a shop
// prints beside "Delivered to".
//
// So: every line goes through maskNumbers as its LAST act, which is the rule
// this project already had and the reason src/maskNumbers.js exists at all; and
// before that through an email mask, because an order page carries one and
// maskNumbers has nothing to say about it. What is left is a name and a written
// address, and those are the thing being measured — the owner is measuring his
// OWN two orders, on his own phone, in a build only he has, and the whole point
// of the run is to see what the page says. That is stated here rather than
// pretended about. See the same passage at the top of shopLog.js.
//
// ONE call to console.log, inside say(), with TAG in front of every line, for the
// reason lookLog.js gives: it is what makes "nothing this file can emit could be
// mistaken for something a screen says" structural rather than a promise.

import { maskNumbers } from '../maskNumbers.js';
import { anybodyHasMeasured, shopsInsideFayr } from './insideFayr.js';

/** The one prefix, so a whole measurement can be found by searching one word. */
export const TAG = '[fayr-measure]';

/** No line of a page is longer than this. A page is cut into lines of it. */
export const AT_MOST_PER_LINE = 300;

/**
 * AND NO PAGE PRINTS MORE THAN THIS, in characters.
 *
 * A shop's page carries a footer, a menu, a category tree and a hundred product
 * cards. What is being measured is the top of it — the words that say what this
 * page IS — and eight thousand characters is more than enough of that and small
 * enough to scroll through in a terminal. What was cut is SAID, with the count,
 * so nobody reads a truncated page as a whole one.
 */
export const AT_MOST_PER_PAGE = 8000;

/**
 * Is the commentary on? Only in development, and never in a build a person gets.
 *
 * `typeof` first because __DEV__ is the phone's word, not node's, and the checks
 * for this file run under node.
 */
export function measureLogIsOn() {
  // eslint-disable-next-line no-undef
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * SHOULD THIS SHOP'S PAGES BE WRITTEN DOWN IN FULL?
 *
 * THREE THINGS, ALL OF THEM REQUIRED, and it is pure so all three are provable
 * under node without a phone:
 *
 *   THE SHOP SHOPS INSIDE FAYR    a shop whose pages this app never draws has no
 *                                 pages to measure, and Amazon is not measured
 *                                 either — it simply does not come here.
 *   NOBODY HAS MEASURED IT        the moment a real order page is written into
 *                                 insideFayr.js this stops, on its own, for that
 *                                 shop. Zepto is already measured and can never
 *                                 turn it on.
 *   IT IS A DEVELOPMENT BUILD     handed in rather than read, so the decision has
 *                                 no clock, no global and no phone in it.
 */
export function shouldMeasure(asked) {
  // NOT A DEFAULT PARAMETER. A default only fills in `undefined`, so
  // shouldMeasure(null) threw where shouldMeasure() did not — caught by this
  // file's own check on 20 September 2026. Anything that is not a question
  // answers no, which is the shy direction for a thing that prints a page.
  const a = asked && typeof asked === 'object' ? asked : {};
  const { key, dev } = a;
  if (dev !== true) return false;
  if (typeof key !== 'string' || key === '') return false;
  if (!shopsInsideFayr(key)) return false;
  return anybodyHasMeasured(key) === false;
}

/** The clock reading, to the millisecond. Its own copy, as shopLog.js keeps one. */
export function stamp(at) {
  const when = typeof at === 'number' && Number.isFinite(at) ? new Date(at) : new Date();
  const two = (n) => String(n).padStart(2, '0');
  const three = String(when.getMilliseconds()).padStart(3, '0');
  return `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}.${three}`;
}

/**
 * AN EMAIL ADDRESS, TAKEN OUT.
 *
 * maskNumbers says nothing about one, and an order page carries the buyer's.
 * Deliberately broad — a run of anything that is not a space, an at sign, then a
 * run of anything that is not a space with a dot in it — because the cost of
 * masking something that merely looks like an address is a word missing from a
 * measurement, and the cost of missing a real one is somebody's email in a log.
 *
 * NO LOOKBEHIND, for the reason maskNumbers gives: the phone runs Hermes.
 */
export const EMAIL_MASK = '<email>';
const AN_EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[A-Za-z]{2,}/g;

export function maskEmails(text) {
  if (typeof text !== 'string' || text === '') return '';
  return text.replace(AN_EMAIL, EMAIL_MASK);
}

/**
 * ONE LINE, BUILT AND NOT PRINTED, so the shape of it can be checked under node.
 *
 * THE TWO MASKS, IN THIS ORDER, AND maskNumbers IS LAST. The email mask first
 * because an address can carry digits that the number rule would otherwise eat
 * halfway through, leaving a masked fragment that still names a person; and the
 * number mask last because that is the rule the whole project already keeps, and
 * "last" is what makes it impossible for a future caller to put a page's answer
 * into an argument that skips it.
 */
export function measureLine(what, detail, at) {
  const tail = detail == null || detail === '' ? '' : ` ${detail}`;
  return maskNumbers(maskEmails(`${TAG} ${stamp(at)} ${what}${tail}`));
}

/** The only place this file writes anything anywhere. */
function say(line) {
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * A WHOLE PAGE, CUT INTO LINES A TERMINAL CAN HOLD.
 *
 * Answers the LINES rather than printing them, so a check can read what would be
 * printed without watching a console. Every line is a finished, masked, tagged
 * line, so there is nothing a caller has to remember to do to one.
 *
 * THE ADDRESS AND THE TITLE GO FIRST, in the same shape navigationDetail already
 * writes them, because a page of text with no address above it is a page nobody
 * can place.
 *
 * Blank runs are dropped. innerText on a shop's page is mostly empty lines, and a
 * measurement that is four fifths blank is a measurement nobody reads.
 */
export function measureBlock(page, at) {
  // Same reason as shouldMeasure above: a default parameter does not cover null,
  // and a page handed in as nothing must still produce a readable line.
  const { url, title, text } = page && typeof page === 'object' ? page : {};
  const lines = [];
  const orNone = (v) => {
    if (v == null) return 'none';
    const t = String(v).replace(/\s+/g, ' ').trim();
    return t === '' ? 'none' : t;
  };
  lines.push(measureLine('PAGE', `url=${orNone(url)} title="${orNone(title)}"`, at));

  const whole = typeof text === 'string' ? text : '';
  const kept = whole.slice(0, AT_MOST_PER_PAGE);
  const cut = whole.length - kept.length;

  let n = 0;
  for (const raw of kept.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line === '') continue;
    for (let i = 0; i < line.length; i += AT_MOST_PER_LINE) {
      n += 1;
      lines.push(measureLine(`TEXT ${n}`, line.slice(i, i + AT_MOST_PER_LINE), at));
    }
  }
  if (cut > 0) {
    lines.push(measureLine('TEXT', `... ${cut} more characters not shown`, at));
  }
  return lines;
}

/**
 * Write a page down, if the commentary is on. Answers how many lines it said, so
 * a check can prove the guard works without reading the console.
 */
export function logMeasure(page, at) {
  if (!measureLogIsOn()) return 0;
  const lines = measureBlock(page, at);
  for (const line of lines) say(line);
  return lines.length;
}

/** The one key a measurement report carries, so ShopScreen can tell it apart. */
export const MEASURE_REPORT_KEY = '__fayrMeasure';

/**
 * THE SCRIPT PUT INTO THE PAGE, and it is a STRING for the reason every script
 * in this project is one: Hermes compiles a function to bytecode and answers
 * toString() with a stub, so a stringified function reaches the page as nothing.
 *
 * IT READS AND IT POSTS, AND IT DOES NOTHING ELSE. It taps nothing, types
 * nothing, submits nothing, and reads no cookie, no storage and no token — the
 * same rule watchTheTitle.js keeps and the same one drawnList.test.mjs holds
 * every injected script to.
 *
 * IT SAYS THE SAME PAGE ONCE. A shop that re-renders on every scroll would
 * otherwise print its whole page again each time, and the measurement would be
 * unreadable. The address and the title are the key, exactly as the title
 * watcher's are.
 *
 * AND IT WAITS FOR THE PAGE TO SETTLE. A single-page shop swaps its body a
 * moment after the address changes, so reading on the instant of the change
 * would measure the page they just left.
 */
export function measureTheWholePageScript() {
  return String.raw`
(function(){
  try {
    if (window.__fayrMeasuring) return;
    window.__fayrMeasuring = true;
    var last = '';
    function tell(){
      try {
        var title = String(document.title || '');
        var url = String(location.href || '');
        var now = title + ' | ' + url;
        if (now === last) return;
        last = now;
        var text = '';
        try { text = String((document.body && document.body.innerText) || ''); } catch(e){}
        window.ReactNativeWebView.postMessage(JSON.stringify({ ${MEASURE_REPORT_KEY}: {
          title: title, url: url, text: text
        } }));
      } catch(e){}
    }
    function soon(){ setTimeout(tell, 900); }
    function wrap(name){
      try {
        var original = history[name];
        if (typeof original !== 'function') return;
        history[name] = function(){
          var out = original.apply(this, arguments);
          soon();
          return out;
        };
      } catch(e){}
    }
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', soon);
    window.addEventListener('hashchange', soon);
    window.addEventListener('load', soon);
    soon();
  } catch(e){}
})();
true;`;
}

/**
 * WHAT THE MEASURER SAID, or null when this message is not the measurer's.
 *
 * Every field is coerced, because a page can put anything at all in a message
 * and all three of these end up on a log line.
 */
export function whatTheMeasurerSaid(message) {
  if (message == null || typeof message !== 'object') return null;
  const said = message[MEASURE_REPORT_KEY];
  if (said == null || typeof said !== 'object') return null;
  return {
    title: typeof said.title === 'string' ? said.title : '',
    url: typeof said.url === 'string' ? said.url : '',
    text: typeof said.text === 'string' ? said.text : '',
  };
}
