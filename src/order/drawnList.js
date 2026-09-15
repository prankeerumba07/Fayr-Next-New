// READING A LIST THE SHOP DRAWS ITSELF, AFTER IT HAS DRAWN IT.
//
// ── WHAT WENT WRONG, AND IT IS NOT A SELECTOR ──────────────────────────────
//
// From the owner's own device, 15 September 2026, signed in and on the right
// page:
//
//   list    status=200 bytes=374234 landed=/your-orders/orders looked=false
//   numbers slots=0 shaped=0 opening=0
//   shape   words order-card=0 yourorders=2 orderCard=0 order-info=0
//                 a-box-group=0 your-orders=8
//
// Three hundred and seventy four kilobytes, and not one order on it. Three runs
// across an hour came back 374862, 374257 and 374234 bytes with the same counts
// each time, which is not what a page that changes with the account looks like.
//
// THE ORDERS ARE NOT IN THE MARKUP AMAZON SENDS ANY MORE. Its own code draws
// them after the document arrives. A fetch downloads the markup as sent and runs
// none of that code, so it downloads a frame with nothing in it — and the one
// thing that used to survive, the order number sitting in each card's own
// attribute, is gone with the cards.
//
// AND THERE IS NO OLDER PAGE TO GO BACK TO. Checked, not assumed:
// /gp/css/order-history now answers 302 with return_to pointing at
// /your-orders/orders. The address we used to read has been retired into this
// one.
//
// ── SO THE VIEW GOES TO THE PAGE, INSTEAD OF FETCHING IT ───────────────────
//
// The web view is pointed at the order list itself rather than at the shop's
// front page. Amazon's own code then runs, exactly as it does for the person
// when they open their orders, and this waits for it and reads what it drew.
//
// FAYR STILL TYPES NOTHING. There is no click in this file, no form, no submit,
// no focus, no scroll and no puzzle. It opens a page the person is already
// signed in to, waits, counts, and reads. Every one of those words is checked
// against this file's own source next door.
//
// ── IT WAITS FOR THE ORDERS, IT DOES NOT GUESS A DELAY ─────────────────────
//
// A fixed pause is a guess that is too long on a good day and too short on a bad
// one. This looks several times a second and stops the moment the page holds
// still, and it SAYS WHICH HAPPENED — `drew=true` means the orders appeared,
// `drew=false waited=7500` means they never did. Those are different problems
// and they used to be the same silence.
//
// ── AND IT GUESSES NO MARKER ───────────────────────────────────────────────
//
// The two things it counts while waiting are not new guesses about Amazon's
// markup. One is the attribute this project has always read. The other is a link
// to an order's own page, and the word in it comes off the address
// src/order/detailLook.js already builds. They are a HINT about whether the page
// has finished, and being wrong about them costs waiting time and nothing else:
// what is actually harvested is decided separately, in detailLook's ladder, and
// what the rows are really marked with is reported by src/order/rowShape.js for
// a person to read. No selector is written from a guess in this change.

import {
  HOW_OFTEN_IT_LOOKS_MS, LOOKS_IN_A_ROW_BEFORE_WE_ASK,
} from '../connect/gate.js';
import {
  GAP_BETWEEN_FETCHES_MS, MOST_DETAIL_PAGES, howThisShopNamesAnOrder,
} from './detailLook.js';
import {
  buildOrderListScript, landedPath, orderListPageFor, readDetailOutcome, readListOutcome,
  readPageRefusal,
} from '../orderhistory.js';

/**
 * WHICH SHOPS DRAW THEIR OWN LIST, so the screen never has to know a shop's name.
 *
 * ── A SECOND LIST, AND NOT THE ONE NEXT DOOR, ON PURPOSE ───────────────────
 *
 * detailLook.js already says SHOPS_READ_ONE_ORDER_AT_A_TIME = ['amazon'], and it
 * is tempting to reuse it: one shop, one cause, today. But they are two
 * different facts — "its list has to be drawn before it can be read" and "its
 * list is worth only the order numbers" — and the day one of them stops being
 * true, sharing a list means the other changes silently with it.
 */
/*
 * ── AND IT IS NOW THE MARKER MAP'S OWN KEYS, WHICH IS STILL NOT THAT LIST ──
 *
 * The argument above is unchanged and it is about the file NEXT DOOR. Inside
 * THIS file, "its list has to be drawn" and "here is what to count while it
 * draws" are not two facts — you cannot wait for a draw without knowing what you
 * are waiting for — so a shop cannot be in one and missing from the other.
 */
export const SHOPS_WHOSE_LIST_THE_PAGE_DRAWS = ['amazon', 'zepto'];

/**
 * HOW LONG THE PAGE MAY TAKE TO DRAW BEFORE WE STOP WAITING FOR IT.
 *
 * ── BORROWED FROM A BOUND THAT HAS ALREADY BEEN ARGUED ─────────────────────
 *
 * Not a new number. This is the span of wall clock the project has ALREADY
 * written down as "time this screen spends not fetching, and it fits": the five
 * politeness gaps between six order pages. detailLook.test.mjs asserts that span
 * is under half the screen's whole ceiling, in those words, and it has been
 * green since it was written. Waiting for a page to draw is the other kind of
 * time spent not fetching, so it is given the same room and no more.
 *
 * THE LINK IS BUDGETARY AND NOT CAUSAL, said plainly rather than dressed up: the
 * gap exists to be polite to a shop and a look at the page we already have is
 * not impolite to anybody. What makes it defensible is the size, not the origin,
 * and the size is checked against the screen's ceiling next door.
 *
 * AND IT ONLY EVER BITES ON A PAGE THAT NEVER DRAWS. A page that draws in two
 * seconds is read in two seconds; the poll stops the moment the orders are
 * there. So being generous here costs nothing on a good day and buys a slow
 * phone on a bad one. The first real `waited=` off a device is what should
 * replace this with a measured number.
 */
export const DRAW_DEADLINE_MS = GAP_BETWEEN_FETCHES_MS * (MOST_DETAIL_PAGES - 1);

/**
 * HOW OFTEN IT LOOKS. The app's own answer to that question, not a second one.
 *
 * src/connect/gate.js measures this against the heaviest page Fayr opens and
 * writes the arithmetic down: about a millisecond a look, under four hundredths
 * of the time available. THAT MEASUREMENT WAS TAKEN ON A LIGHTER PAGE THAN THIS
 * ONE — a sign in page of five hundred nodes, against an order list of some
 * thousands — so it is quoted as a precedent rather than as a proof. What keeps
 * it cheap here is that each look COUNTS things and walks nothing: two selector
 * counts and a node count, where the watcher next door reads a box off every
 * candidate it finds.
 */
export const LOOK_AGAIN_MS = HOW_OFTEN_IT_LOOKS_MS;

/**
 * HOW MANY LOOKS IN A ROW MUST AGREE BEFORE THE PAGE COUNTS AS DRAWN.
 *
 * The app's existing rule for "a page halfway through changing is not a page
 * that has changed", taken from the gate rather than written again. A list
 * caught at its first card would be read with one order on it.
 */
export const STEADY_LOOKS_BEFORE_WE_READ = LOOKS_IN_A_ROW_BEFORE_WE_ASK;

/**
 * A SECOND AXE, for a phone whose clock steps while the look is running.
 *
 * Arithmetic on the two above and nothing else. The deadline is the real limit;
 * this is what stops a poll running forever if Date.now goes backwards.
 */
export const MOST_LOOKS = Math.ceil(DRAW_DEADLINE_MS / LOOK_AGAIN_MS);

/**
 * THE SHORTEST SPAN IN WHICH A PAGE COULD POSSIBLY READ AS DRAWN.
 *
 * Two looks, one interval apart: this app's own rule that a page halfway through
 * changing is not a page that has changed, multiplied by how often it looks.
 * Arithmetic on two numbers already argued for, and not a new floor of its own.
 *
 * BELOW THIS, OPENING ONE MORE PAGE IS GUARANTEED WASTE. Not likely to be —
 * guaranteed: however fast the shop is, the page cannot be called drawn in the
 * time left, so the only possible outcome is a deadline, a shell handed to the
 * server, and one more request asked of a shop for nothing. The loop stops here
 * instead of starting a page it has already lost.
 */
export const LEAST_A_DRAW_CAN_TAKE_MS = LOOK_AGAIN_MS * STEADY_LOOKS_BEFORE_WE_READ;

/**
 * WHICH SHOPS' ORDER PAGES HAVE TO BE DRAWN, WHICH IS NOT THE LIST QUESTION.
 *
 * ── AND AMAZON IS THE LIVING PROOF THEY ARE DIFFERENT FACTS ───────────────
 *
 * Amazon DRAWS ITS LIST and SENDS ITS ORDER PAGES WHOLE. That is the whole
 * reason its orders are fetched one page at a time from inside the page already
 * open, and the reason the gap between those fetches exists at all.
 *
 * So this is a third list, deliberately, for the reason written at the top of
 * this file about the second one. Sharing one would turn Amazon's fetches into
 * navigations the day somebody added a shop — six page loads instead of six
 * fetches, past the ceiling, and its politeness gaps silently gone with them.
 */
export const SHOPS_WHOSE_ORDER_PAGES_ARE_DRAWN = ['zepto'];

/** Whether this shop's order pages have to be drawn before they can be read. */
export function theOrderPagesAreDrawn(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  return SHOPS_WHOSE_ORDER_PAGES_ARE_DRAWN.indexOf(key) !== -1;
}

/**
 * WHAT EACH DRAWN SHOP IS COUNTING WHILE IT WAITS, and not one of these is a
 * new guess.
 *
 * AMAZON. A link to an order's own page — the word `orderID=` comes off the
 * address detailLook.js builds — and the order card attribute this project has
 * always read.
 *
 * ZEPTO. An overlay anchor to the order's own page, `/order/` coming off the
 * same file's address for the same reason: the word we count with cannot be a
 * different word from the one we ask with.
 *
 * If a shop's markers are all wrong the poll waits out its deadline and the
 * report says so; nothing is harvested from either.
 */
export const WHAT_EACH_SHOP_DRAWS = {
  amazon: {
    link: `a[href*="${howThisShopNamesAnOrder('amazon').param}"]`,
    // ── AND THE CARD MARKER IS THE ORDER CARD'S OWN SLOT, NOT ANY SLOT ──────
    //
    // MEASURED ON THE OWNER'S DEVICE, 15 SEPTEMBER 2026, 22:25. The bare
    // attribute matched FIFTY-SIX things on his orders page and not one of them
    // was an order:
    //
    //   list    drew=true settled=false waited=2763 looks=3 rows=0/56
    //                                               nodes=816/1257
    //   numbers slots=0 marked=0 linked=0 shaped=1 opening=1 how=shape
    //
    // Amazon's own NAVIGATION carries data-csa-c-slot-id — nav_cs_electronics,
    // nav_cs_books, fifty-odd of them — and the navigation is in the markup from
    // the first paint. So the poll counted fifty-six "rows" before a single
    // order existed, saw that number hold still for two looks, and declared the
    // page drawn after 2.7 seconds. The page was still growing: 816 nodes when
    // it started, 1257 when it gave up, and readyState was not even complete.
    //
    // ONE order number survived, found by its bare shape, so one order page was
    // opened out of a list of many and the campaign's order was never looked at.
    // The read did not fail. It was cut off before it began.
    //
    // THE PREFIX IS NOT A NEW GUESS. It is the same one detailLook.js has always
    // harvested from — data-csa-c-slot-id="amzn1.yourorders.order-card.<number>"
    // — asked as a selector instead of as a regular expression. A nav slot is
    // named nav_cs_* and can never match it.
    card: '[data-csa-c-slot-id^="amzn1.yourorders.order-card"]',
  },
  zepto: {
    // MEASURED, 15 September 2026: eight of these on the owner's own list page
    // and NONE AT ALL on the shop's front page, which is the whole test of a
    // marker. `^=` and not `*=` because `^=` is what was measured.
    //
    // THE ANCHORS ARE EMPTY. The link sits OVER the card rather than around it,
    // so there is not one word inside it. It is a marker and nothing else, and
    // nothing is ever read out of it here.
    link: `a[href^="${howThisShopNamesAnOrder('zepto').param}"]`,
    // AND THERE IS NO SECOND MARKER, WRITTEN AS null RATHER THAN AS A SELECTOR
    // THAT HAPPENS TO MATCH NOTHING. `rows` below is the two counts ADDED, so a
    // second selector picked to count zero is a guess that can start counting
    // something — and the day it does, `rows` doubles and the poll reads a
    // half-drawn page as a finished one. Every class on that page is a build
    // hash, so there was never an honest second one to write.
    card: null,
  },
};

/** What this shop's drawn rows are counted by, or null when its list is not drawn. */
export function whatThisShopDraws(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(WHAT_EACH_SHOP_DRAWS, key)
    ? WHAT_EACH_SHOP_DRAWS[key]
    : null;
}

/** Whether this shop draws its own list of orders. */
export function theListIsDrawn(platformKey) {
  return whatThisShopDraws(platformKey) != null;
}

/**
 * A NAME FOR ONE ANSWER, so a page cannot answer for us.
 *
 * ── WHY THIS IS NOT OPTIONAL ANY MORE ──────────────────────────────────────
 *
 * The web view used to sit on a shop's front page and fetch. It now sits ON the
 * page, with whatever the shop chose to put in it, and react-native-webview
 * hands every postMessage from every frame to one handler with no note of who
 * sent it. Without a name on our own answer, anything on that page could post
 * `{"ok":true,"status":200,"html":"..."}` and have it read as the shop's own
 * order list and sent to the server as evidence — which is the forged-evidence
 * loophole, entered from the inside.
 *
 * Pure, and the randomness is passed IN rather than taken here, so a check can
 * ask for two different tags without a clock or a dice.
 */
export function anAnswerTag(seq, noise) {
  const n = Number.isFinite(Number(noise)) ? Math.abs(Number(noise)) : 0;
  const s = Number.isFinite(Number(seq)) ? Math.abs(Math.trunc(Number(seq))) : 0;
  return `look-${s.toString(36)}-${Math.floor(n * 1e9).toString(36)}`;
}

/** Is this answer ours, or did the page write it? Nothing else is read first. */
export function isOurAnswer(payload, tag) {
  if (payload == null || typeof payload !== 'object') return false;
  if (typeof tag !== 'string' || tag === '') return false;
  return payload.tag === tag;
}

/**
 * THE FACTS THE PAGE REPORTED, EVERY ONE OF THEM MADE SAFE FIRST.
 *
 * A page can put anything at all in these. They end up on a log line, so every
 * one is coerced here rather than trusted: a number that is not finite reads
 * nought, and anything that is not exactly true reads false.
 */
export function drawFacts(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const count = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
  return {
    drew: p.drew === true,
    settled: p.settled === true,
    waited: count(p.waited),
    looks: count(p.looks),
    linked: count(p.linked),
    marked: count(p.marked),
    nodesFirst: count(p.nodesFirst),
    nodesNow: count(p.nodesNow),
  };
}

/**
 * THE STATUS A DRAWN PAGE CANNOT KNOW ABOUT ITSELF, PUT IN FROM OUR SIDE.
 *
 * A fetch is handed the shop's status code. A page that has been NAVIGATED to
 * cannot see its own: there is nothing in the document that says 503. So the web
 * view tells us instead — it reports an error status for the main frame — and
 * this is where that gets put back into the answer, on our side, where it can be
 * checked.
 *
 * WHAT `200` REALLY MEANS HERE, said exactly: "no failing response was seen for
 * this navigation". That is true and it is weaker than a fetch's 200, and the
 * difference is written down rather than smoothed over.
 *
 * A FETCHED ANSWER IS PASSED STRAIGHT THROUGH. Its status came from the shop and
 * nothing here may overwrite it.
 */
export function answerWithStatus(payload, seen) {
  if (payload == null || typeof payload !== 'object') return payload;
  if (payload.fromTheDrawnPage !== true) return payload;
  const status = Number.isFinite(Number(seen)) ? Math.trunc(Number(seen)) : 0;
  return { ...payload, status };
}

/**
 * THE SCRIPT THAT WAITS FOR THE SHOP TO DRAW ITS LIST, AND THEN READS IT.
 *
 * ── A STRING, AND NEVER A FUNCTION TURNED INTO ONE ─────────────────────────
 *
 * Hermes does not give back the source of a function, so sharing code with a
 * page by stringifying it silently ships nothing. Every injected script in this
 * project is written out as text for that reason.
 *
 * ── WHAT IT SENDS, AND IT IS THE SAME ENVELOPE AS THE FETCH ────────────────
 *
 * { ok, status, html, url } plus the facts about the wait. Identical in shape to
 * what buildOrderListScript posts, which is why every reader on our side —
 * readPageRefusal, landedPath, the refusal vocabulary, the sign in wall test —
 * goes on working unchanged and goes on being a pure function over a string.
 *
 * `outerHTML` AND NEVER innerText. Two reasons and both matter. Serialising the
 * document escapes any `<` and `>` that were in the words on the page, which is
 * the whole foundation of the shape reporter's promise that it never reads
 * outside a tag. And innerText forces the page to lay itself out, every look, on
 * the page we are waiting for.
 *
 * ── IT STOPS EARLY WHEN IT IS SOMEWHERE ELSE ───────────────────────────────
 *
 * Amazon asks for a FRESH password for this page — measured: its redirect
 * carries openid.pape.max_auth_age=0, where an order's own page asks 3600. So
 * landing on a sign in wall instead of the list is the ordinary case, not an
 * edge one, and sitting out the whole deadline in front of one would waste most
 * of the screen's budget.
 *
 * SO IT REPORTS A FACT AND DECIDES NOTHING. "This is not the path I was sent to
 * and this document has finished loading." What that MEANS is worked out on our
 * side by the one existing vocabulary, SIGN_IN_PATH, in orderhistory's
 * wantsASignIn. There is no second idea of what a sign in page looks like in
 * here.
 */
export function buildDrawnListScript({
  beganAt, tag, wantedPath, counts,
} = {}) {
  const startedAt = Number.isFinite(Number(beganAt)) ? Math.trunc(Number(beganAt)) : 0;
  const name = JSON.stringify(String(tag == null ? '' : tag));
  const wanted = JSON.stringify(String(wantedPath == null ? '' : wantedPath));
  // WHAT THIS SHOP IS COUNTED BY, WRITTEN AS THE COUNT ITSELF.
  //
  // A shop with no second marker gets the literal 0 rather than a selector that
  // matches nothing, so `rows` below is honestly one count and not two.
  //
  // AND A SHOP THIS FILE DOES NOT KNOW GETS 0 AND 0, WHICH IS LOUD. The poll
  // then waits out its whole deadline and the line reads drew=false rows=0/0 —
  // rather than quietly counting Amazon's markers on somebody else's page, which
  // is the one way this could go wrong without anybody noticing.
  const pair = counts != null && typeof counts === 'object' ? counts : {};
  const countOf = (sel) => (typeof sel === 'string' && sel !== ''
    ? `howMany(${JSON.stringify(sel)})`
    : '0');
  return `
(function(){
  if (window.__fayrLooking) return;
  window.__fayrLooking = true;
  var sent = false, ticker = null, looks = 0, steady = -1, same = 0, first = -1;
  function stop(){ if (ticker !== null) { clearInterval(ticker); ticker = null; } }
  function send(o){
    if (sent) return; sent = true; stop();
    o.tag = ${name};
    o.fromTheDrawnPage = true;
    o.ok = true;
    o.status = 0;
    try { o.html = document.documentElement ? document.documentElement.outerHTML : ''; } catch(e){ o.html = ''; }
    try { o.url = String(location.href); } catch(e){ o.url = ''; }
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){}
  }
  function howMany(sel){ try { return document.querySelectorAll(sel).length; } catch(e){ return 0; } }
  function howBig(){ try { return document.getElementsByTagName("*").length; } catch(e){ return 0; } }
  function look(){
    looks = looks + 1;
    var linked = ${countOf(pair.link)};
    var marked = ${countOf(pair.card)};
    var rows = linked + marked;
    var now = howBig();
    if (first < 0) first = now;
    var waited = Date.now() - ${startedAt};
    var settled = false, elsewhere = false;
    try { settled = document.readyState === "complete"; } catch(e){}
    try { elsewhere = ${wanted} !== "" && location.pathname !== ${wanted}; } catch(e){}
    if (rows > 0 && rows === steady) { same = same + 1; } else { steady = rows; same = 1; }
    var drew = rows > 0 && same >= ${STEADY_LOOKS_BEFORE_WE_READ};
    var out = waited >= ${DRAW_DEADLINE_MS} || looks >= ${MOST_LOOKS};
    if (drew || out || (elsewhere && settled)) {
      send({ drew: drew, settled: settled, waited: waited, looks: looks,
             linked: linked, marked: marked, nodesFirst: first, nodesNow: now });
    }
  }
  look();
  if (!sent) { ticker = setInterval(look, ${LOOK_AGAIN_MS}); }
})();
true;`;
}

/**
 * WHAT ONE LOOK AT A DRAWN LIST ENDED IN.
 *
 * The refusals come from readPageRefusal, shared with the fetched list and with
 * each order's own page, so there is ONE idea of what a dead end, a 503, a
 * puzzle and a sign in wall are across all three. A second one is how two of
 * them end up disagreeing.
 *
 * `blocks` IS ALWAYS EMPTY AND THAT IS DELIBERATE. A shop whose list is drawn is
 * read for its order numbers and nothing else; the screen opens each order's own
 * page for the text. Cutting a megabyte of drawn page into blocks nobody reads
 * is four passes and a split, on a phone, for nothing.
 */
export function readDrawnOutcome(answer) {
  const {
    html, whyNot, wantsSignIn, answered, landed,
  } = readPageRefusal(answer);
  if (!answered || whyNot != null || wantsSignIn === true) {
    return {
      looked: false, blocks: [], whyNot, wantsSignIn, landed,
    };
  }
  // IT ONLY COUNTS AS LOOKED IF THE PAGE ACTUALLY DREW. A page that ran out of
  // time has a full document on it and nothing of the person's in it, and
  // calling that "we looked" is how "we found nothing" and "we never saw it"
  // became one silence in the first place.
  const drew = answer && typeof answer === 'object' && answer.drew === true;
  return {
    looked: drew === true && html !== '', blocks: [], whyNot, wantsSignIn, landed,
  };
}

/**
 * HOW THIS SHOP'S LIST IS OPENED: where to point the view, and what to run in it.
 *
 * Null when there is no list page for this shop at all, which is not a failure —
 * it means "we could not look", and the person is asked instead.
 *
 * THE SCREEN NEVER LEARNS A SHOP'S NAME FROM THIS. It gets an address and a
 * script and a flag, and the waiting screen is forbidden from writing a shop's
 * name anywhere in it.
 */
/**
 * THE SCRIPT THAT WAITS FOR ONE ORDER'S OWN PAGE TO DRAW, AND THEN READS IT.
 *
 * ── WHY THERE IS A SECOND ONE OF THESE ─────────────────────────────────────
 *
 * The list poller waits for ROWS and hands back the markup. An order's own page
 * has no rows to count, and what the server reads off it is its WORDS.
 *
 * ── AND WHY IT GOES THERE RATHER THAN FETCHING ─────────────────────────────
 *
 * Measured on the owner's own account, 15 September 2026, and all four of the
 * cheaper ways are ruled out rather than untried: a fetch of a Zepto order page
 * comes back a shell with nothing in it; a same-origin frame hydrates, draws the
 * header, and never shows the order body at either position tried; the server
 * rendered answer carries neither the order number nor any product name; and the
 * data address answers 401 for a token that is in no storage this app can read.
 * So the view goes to the page, exactly as it goes to the list.
 *
 * ── innerText, AND THE FILE NEXT DOOR SAYS NEVER innerText ────────────────
 *
 * It says never innerText FOR THE LIST, and both of its reasons are answered
 * here rather than waved past.
 *
 * THE FIRST IS ESCAPING: a serialised document cannot carry a stray `<`, which
 * is what the shape report's promise rests on. So this posts `html` AS WELL, and
 * every refusal, the status, the landing and the shape reports all go on reading
 * that, unchanged. The words are an addition and not a replacement.
 *
 * THE SECOND IS COST: innerText makes the page lay itself out. So it is read
 * ONCE, in send(), and never in a look. What a look watches is textContent's
 * LENGTH, which reads off the tree and lays nothing out.
 *
 * AND IT IS THE TEXT THE SERVER IS ALREADY PROVEN AGAINST. parseOrderText was
 * written and checked against this exact page's own words. Handing it markup to
 * cut up instead would be a second reader of the same page.
 *
 * ── AND ITS CLOCK IS ITS OWN ──────────────────────────────────────────────
 *
 * `beganAt` is the moment THIS page was opened, never the moment the look began.
 * Sharing the look's start would put the second order page already past its
 * deadline at its first look — which reads as "it never drew" about a page
 * nobody ever waited for.
 */
export function buildDrawnOrderScript({
  beganAt, tag, wantedPath, deadlineMs,
} = {}) {
  const startedAt = Number.isFinite(Number(beganAt)) ? Math.trunc(Number(beganAt)) : 0;
  const name = JSON.stringify(String(tag == null ? '' : tag));
  const wanted = JSON.stringify(String(wantedPath == null ? '' : wantedPath));
  // WHAT IS LEFT OF THE LOOK, AND NEVER MORE THAN ONE PAGE'S SHARE. A page may
  // be given LESS than the standing deadline when the look is nearly over, and
  // never more, so a slow first page cannot eat the whole ceiling by itself.
  const asked = Number.isFinite(Number(deadlineMs)) && Number(deadlineMs) > 0
    ? Math.trunc(Number(deadlineMs))
    : DRAW_DEADLINE_MS;
  const deadline = Math.min(asked, DRAW_DEADLINE_MS);
  const mostLooks = Math.ceil(deadline / LOOK_AGAIN_MS);
  return `
(function(){
  if (window.__fayrReading) return;
  window.__fayrReading = true;
  var sent = false, ticker = null, looks = 0, steady = -1, same = 0, first = -1;
  function stop(){ if (ticker !== null) { clearInterval(ticker); ticker = null; } }
  function send(o){
    if (sent) return; sent = true; stop();
    o.tag = ${name};
    o.fromTheDrawnPage = true;
    o.ok = true;
    o.status = 0;
    try { o.html = document.documentElement ? document.documentElement.outerHTML : ''; } catch(e){ o.html = ''; }
    try { o.text = document.body ? document.body.innerText : ''; } catch(e){ o.text = ''; }
    try { o.url = String(location.href); } catch(e){ o.url = ''; }
    try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){}
  }
  function howMuch(){ try { return document.body ? document.body.textContent.length : 0; } catch(e){ return 0; } }
  function howBig(){ try { return document.getElementsByTagName("*").length; } catch(e){ return 0; } }
  function look(){
    looks = looks + 1;
    var chars = howMuch();
    var now = howBig();
    if (first < 0) first = now;
    var waited = Date.now() - ${startedAt};
    var settled = false, elsewhere = false;
    try { settled = document.readyState === "complete"; } catch(e){}
    try { elsewhere = ${wanted} !== "" && location.pathname !== ${wanted}; } catch(e){}
    if (chars > 0 && chars === steady) { same = same + 1; } else { steady = chars; same = 1; }
    var wrote = settled && chars > 0 && same >= ${STEADY_LOOKS_BEFORE_WE_READ};
    var out = waited >= ${deadline} || looks >= ${mostLooks};
    if (wrote || out || (elsewhere && settled)) {
      send({ drew: wrote, settled: settled, waited: waited, looks: looks,
             linked: 0, marked: 0, nodesFirst: first, nodesNow: now });
    }
  }
  look();
  if (!sent) { ticker = setInterval(look, ${LOOK_AGAIN_MS}); }
})();
true;`;
}

/**
 * HOW ONE ORDER'S OWN PAGE IS OPENED FOR THIS SHOP: where to point the view, or
 * what to run where it already is.
 *
 * A SHOP WHOSE ORDER PAGES ARE SENT WHOLE is fetched from inside the page
 * already open, exactly as before — one page load for a whole look, which is the
 * promise that makes six order pages fit inside the ceiling at all. Its address
 * is null because there is nowhere to go.
 *
 * A SHOP WHOSE ORDER PAGES ARE DRAWN cannot be fetched: there is nothing in what
 * comes back. That one goes there.
 *
 * THE SCREEN STILL NEVER LEARNS A SHOP'S NAME. It gets an address or no address,
 * a script, and the same flag it already reads.
 */
export function openOneOrderWith(platformKey, url, beganAt, tag, number, deadlineMs) {
  if (!theOrderPagesAreDrawn(platformKey)) {
    return {
      uri: null, script: buildOrderListScript(url, tag), drawn: false, tag, number,
    };
  }
  return {
    uri: String(url || ''),
    script: buildDrawnOrderScript({
      beganAt, tag, wantedPath: landedPath(url), deadlineMs,
    }),
    drawn: true,
    tag,
    number,
  };
}

export function openTheListWith(platformKey, startUrl, beganAt, tag) {
  const list = orderListPageFor(platformKey);
  if (list == null) return null;
  if (!theListIsDrawn(platformKey)) {
    return {
      uri: String(startUrl || ''),
      script: buildOrderListScript(list, tag),
      drawn: false,
      tag,
    };
  }
  return {
    uri: list,
    script: buildDrawnListScript({
      beganAt, tag, wantedPath: landedPath(list), counts: whatThisShopDraws(platformKey),
    }),
    drawn: true,
    tag,
  };
}

/**
 * ONE ANSWER, READ BY WHICHEVER READER THE STEP IT CAME FROM CALLS FOR.
 *
 * The choice lives here rather than in the screen so there is one place that
 * decides it and one place to check. A drawn page and a fetched page are read
 * differently in exactly one respect — whether "we looked" means the page drew
 * or means it had orders written on it — and everything else about them is the
 * same shared reader.
 */
/**
 * WHERE WE LANDED, WITH THE ORDER'S OWN ID TAKEN OUT OF IT.
 *
 * ── AND WHY THIS IS NOT PARANOIA ──────────────────────────────────────────
 *
 * A fetched order page keeps its number in the QUERY, and landedPath already
 * drops the query, so this never came up. A drawn one carries the number in the
 * PATH — and `landed=` is precisely the field somebody copies into a message
 * when a look goes wrong.
 *
 * An order id is a strong identifier tied to somebody's account, and maskNumbers
 * cannot hide one that is mostly letters. So it comes out HERE, at the reader
 * every landing passes through, rather than being remembered at a call site.
 */
export function landedWithoutTheOrder(path, orderNumber) {
  if (typeof path !== 'string' || path === '') return path;
  if (typeof orderNumber !== 'string' || orderNumber === '') return path;
  return path.split(orderNumber).join('<order>');
}

/**
 * ONE ORDER'S OWN PAGE, READ BY WHICHEVER READER THE STEP IT CAME FROM CALLS FOR.
 *
 * The refusals, the status, the landing and "did the shop answer at all" all
 * come from readPageRefusal, shared with the list and with the fetched order
 * page, so there is ONE idea of a dead end across all three. The only thing that
 * differs is where the TEXT comes from: a fetched page is markup and gets cut
 * up, a drawn one has already handed us its words.
 *
 * IT DISPATCHES ON THE STEP AND NEVER ON THE SHOP. The step knows how it was
 * opened; asking the shop again here would be a second answer to a question
 * already settled, and the two could disagree.
 */
export function readDetailStep(step, answer) {
  if (!(step && step.drawn === true)) return readDetailOutcome(answer);
  const {
    whyNot, wantsSignIn, answered, landed,
  } = readPageRefusal(answer);
  const where = landedWithoutTheOrder(landed, step.number);
  if (!answered || whyNot != null || wantsSignIn === true) {
    return {
      looked: false, text: '', whyNot, wantsSignIn, landed: where,
    };
  }
  // AND A PAGE THAT NEVER DREW IS NOT A PAGE WE READ, for the reason the list
  // says the same thing: there is a whole document here and nothing of the
  // person's in it, and calling that "we looked" is how "we found nothing" and
  // "we never saw it" became one silence for five days.
  const drew = answer && typeof answer === 'object' && answer.drew === true;
  const text = answer && typeof answer.text === 'string' ? answer.text : '';
  return {
    looked: drew === true && text !== '', text, whyNot, wantsSignIn, landed: where,
  };
}

export function readListStep(step, answer) {
  return step && step.drawn === true
    ? readDrawnOutcome(answer)
    : readListOutcome(answer);
}
