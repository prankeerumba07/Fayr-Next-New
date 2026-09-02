// LOOKING AT THE SHOP'S OWN LIST OF RECENT ORDERS, ON THE PHONE.
//
// WHY THIS IS ON THE PHONE AND CANNOT BE ANYWHERE ELSE. The person is signed in
// to the shop inside Fayr's own web view, and that sign in lives on the device.
// The design says so itself at fayr-design.browser.jsx:2284. A server holds no
// such sign in and cannot open anybody's list of orders, so an address on the
// server that claimed to read one would be a promise nothing could keep.
//
// THE PHONE LOOKS. THE SERVER JUDGES AND REMEMBERS. That split is the whole
// design of this feature, and it is why this file stops where it does:
//
//   HERE   fetch the shop's own list of recent orders, from inside the web view
//          the person is already signed in to, and cut the page into one piece of
//          text per order.
//   THERE  read each piece into an order, decide whether it is the campaign's
//          product at the campaign's price, and keep the answer.
//          backend/src/ocr/order-text.ts and order-comparison.ts.
//
// AND THE READING RULES LIVE IN ONE PLACE ONLY. It would have been easy to read
// the fields here as well and hand the server a finished order. That would be two
// copies of one rule, in two languages, both deciding things about somebody's
// money, and they would eventually disagree. So this file knows only WHERE ONE
// ORDER STOPS AND THE NEXT BEGINS. It does not know what an order number means,
// what a price means, or what a match is.
//
// THE TRANSPORT IS THE ONE THAT ALREADY EXISTS. src/livecheck.js opens a page by
// running a fetch INSIDE the web view, with the person's own sign in, and posting
// the result back once through window.ReactNativeWebView.postMessage. This uses
// the same shape, the same single attempt, and the same timeout. Nothing about a
// shop's protections is touched: it is the request that person's own browser
// makes, from their own device.
//
// ONE ATTEMPT ONLY. If the list does not come back, the answer is "we could not
// look", and the journey carries on by asking the person instead. No retry, no
// second user agent, no waiting and trying again. That is what pushing against a
// shop's limits looks like, and the honest answer costs nothing here because
// there is a way forward that does not need the shop at all.
//
// src/platforms.js AND src/ConnectScreen.js ARE NOT TOUCHED BY THIS FILE. It
// imports PLATFORMS to read a shop's name and nothing else.

import { PLATFORMS } from './platforms.js';

/**
 * How many orders back to look. The owner's number.
 *
 * Enough that somebody who bought two or three other things since claiming is
 * still found, and small enough that this is one short read of one page.
 */
export const MOST_RECENT_ORDERS = 20;

/** How long to wait for the list before giving up on it. Same as livecheck. */
export const LIST_TIMEOUT_MS = 15000;

/**
 * THE ONE PAGE PER SHOP WHOSE TEXT LISTS RECENT ORDERS.
 *
 * A SECOND COPY OF AN ADDRESS, SAID OUT LOUD. src/platforms.js knows these too,
 * but it knows them buried inside its injected scripts rather than as data, and
 * it is frozen, so there was no way to read them out of it. This is therefore a
 * duplicate and it is a real cost: change a shop's address and there are two
 * places to change. When platforms.js is next opened, the right fix is for it to
 * state its order list address as a field, and for this map to be deleted.
 *
 * WHY SOME SHOPS ARE NOT HERE, said plainly rather than left as a silence:
 *
 *   flipkart   its orders come from a private data address that answers with a
 *              structured payload, not a page of text. Reading it would mean
 *              copying that request and the shape of its answer out of the frozen
 *              file, which is a second scraper, and the owner said not to build
 *              one.
 *   blinkit    the same, and worse: its list is only filled in after its own app
 *              has run in the page, so there is nothing to fetch.
 *   instamart  its own page is a personal details page, not a list of orders.
 *   myntra     dormant. Its code is preserved and deliberately left alone.
 *
 * A shop that is not here is not a failure. It means "we could not look", and the
 * person is asked instead, which is a path that always works.
 */
export const ORDER_LIST_PAGES = {
  amazon: 'https://www.amazon.in/your-orders/orders?_encoding=UTF8',
  meesho: 'https://www.meesho.com/orders',
  zepto: 'https://www.zepto.com/account/orders',
};

/** The address of one shop's order list, or null when we cannot look there. */
export function orderListPageFor(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  if (!PLATFORMS[key]) return null;
  return Object.prototype.hasOwnProperty.call(ORDER_LIST_PAGES, key)
    ? ORDER_LIST_PAGES[key]
    : null;
}

/**
 * The script that fetches one order list, from inside the web view the person is
 * already signed in to.
 *
 * Exactly the shape of every script in platforms.js and livecheck.js: it posts
 * one JSON string back through window.ReactNativeWebView.postMessage, and it
 * posts once whatever happens. It reads and nothing else. No clicking, no form,
 * no second request.
 */
export function buildOrderListScript(url) {
  const safeUrl = JSON.stringify(String(url));
  return `
(function(){
  var sent = false;
  function send(o){
    if (sent) return; sent = true;
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){}
  }
  var done = setTimeout(function(){ send({ ok:false, status:0, html:'', error:'timed out' }); }, ${LIST_TIMEOUT_MS});
  try {
    fetch(${safeUrl}, { credentials: 'include', redirect: 'follow' })
      .then(function(r){ return r.text().then(function(t){ return { status: r.status, html: t }; }); })
      .then(function(p){ clearTimeout(done); send({ ok:true, status:p.status, html:p.html }); })
      .catch(function(e){ clearTimeout(done); send({ ok:false, status:0, html:'', error:String((e&&e.message)||e) }); });
  } catch(e){ clearTimeout(done); send({ ok:false, status:0, html:'', error:String((e&&e.message)||e) }); }
})();
true;`;
}

/** The handful of written out characters a shop page really uses. */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rupee: '₹', hellip: '…', middot: '·', ndash: '-', mdash: '-',
};

/** Turn "&amp;" and "&#8377;" back into the character a person would see. */
function unwrite(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/**
 * A fetched page as the lines a person would see on it.
 *
 * PURE, and the reason it is: this is the half of the reading that can be checked
 * without a phone, and it is the half most likely to be wrong.
 */
export function pageToLines(html) {
  if (typeof html !== 'string' || html === '') return [];
  const text = html
    // Anything that is instructions rather than words on the page.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Every tag becomes a line break, so two things that were on two lines on the
    // screen do not become one sentence here.
    .replace(/<[^>]*>/g, '\n');
  return unwrite(text)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

/**
 * WHERE ONE ORDER STOPS AND THE NEXT BEGINS.
 *
 * A list of orders repeats itself: every row starts by naming the order, either
 * by its number or by the day it was placed. These are those openings, and they
 * are the only thing this file claims to understand. What any of it MEANS is the
 * server's business.
 */
const ORDER_MARKERS = [
  // The order's own number. Written several ways by several shops.
  ['number', /^order\s*(?:id|no\.?|number)\b/i],
  ['number', /^order\s*#/i],
  // The day it was placed. Amazon prints this as a heading ABOVE the number, and
  // that is exactly why the rule below counts kinds rather than markers.
  ['date', /^order\s+placed\b/i],
  ['date', /^placed\s+on\b/i],
  ['date', /^ordered\s+on\b/i],
];

/** Which kind of opening this line is, or null for an ordinary line. */
function markerKind(line) {
  for (const [kind, pattern] of ORDER_MARKERS) {
    if (pattern.test(line)) return kind;
  }
  return null;
}

/**
 * One fetched order list, cut into one piece of text per order.
 *
 * NEWEST FIRST, and not because this sorts them: every shop lists its orders
 * newest first on its own page, and the page's own order is kept. Sorting here
 * would need a date, and reading a date is the server's job.
 *
 * Anything above the first order is the page's own furniture and is dropped.
 * Nothing past MOST_RECENT_ORDERS is kept.
 */
export function readOrderBlocks(html) {
  const lines = pageToLines(html);

  // HOW A NEW ORDER IS RECOGNISED, and why it is not simply "the next opening".
  //
  // One order row carries SEVERAL openings: a Zepto row prints its number and
  // then the day, and an Amazon card prints the day and then the number. Cutting
  // at every opening would turn two orders into four, and cutting only at the
  // number would leave Amazon's date sitting at the bottom of the order ABOVE the
  // one it belongs to — which is the worst possible mistake here, because it
  // hands the server one order's date beside another order's price.
  //
  // So an order may carry ONE opening OF EACH KIND. A second opening of a kind
  // already seen is the next order. That reads both layouts correctly and has no
  // guessed number in it.
  const blocks = [];
  let current = [];
  let seen = new Set();
  const close = () => {
    const block = current.join('\n').trim();
    if (block !== '' && seen.size > 0) blocks.push(block);
    current = [];
    seen = new Set();
  };

  for (const line of lines) {
    const kind = markerKind(line);
    if (kind !== null) {
      if (seen.has(kind)) close();
      // Everything above the FIRST opening is the page's own furniture: its
      // heading, its menu, its footer. It belongs to no order and is dropped.
      if (seen.size === 0) current = [];
      seen.add(kind);
    }
    current.push(line);
  }
  close();
  // THE CAP, ONCE AND IN ONE PLACE. It used to be applied twice, in the loop and
  // again here, and the check for it passed with one of the two removed — which
  // is exactly the kind of second copy that makes a check useless.
  return blocks.slice(0, MOST_RECENT_ORDERS);
}

/**
 * What one look at a shop's list ended in.
 *
 * `status` is what the shop's own server answered; 0 means nothing answered. The
 * shapes deliberately mirror livecheck's readPageOutcome, because they are two
 * looks at the same kind of thing.
 *
 * A SIGN IN WALL IS NOT AN ERROR TO SHOW ANYBODY. It is simply "we could not
 * look", and the journey then asks the person, which always works. Nothing about
 * it is ever put in front of them, because the screen that is waiting on this is
 * not allowed to mention the shop at all.
 */
export function readListOutcome(answer) {
  const a = answer && typeof answer === 'object' ? answer : {};
  const status = Number.isFinite(a.status) ? Number(a.status) : 0;
  if (a.ok !== true || status === 0 || status >= 400) {
    return { looked: false, blocks: [] };
  }
  const blocks = readOrderBlocks(typeof a.html === 'string' ? a.html : '');
  return { looked: blocks.length > 0, blocks };
}
