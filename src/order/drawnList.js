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
  GAP_BETWEEN_FETCHES_MS, MOST_DETAIL_PAGES, ORDER_ID_PARAM,
} from './detailLook.js';
import {
  buildOrderListScript, landedPath, orderListPageFor, readListOutcome, readPageRefusal,
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
export const SHOPS_WHOSE_LIST_THE_PAGE_DRAWS = ['amazon'];

/** Whether this shop draws its own list of orders. */
export function theListIsDrawn(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  return SHOPS_WHOSE_LIST_THE_PAGE_DRAWS.indexOf(key) !== -1;
}

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
 * WHAT THE PAGE IS COUNTING WHILE IT WAITS, and neither one is a new guess.
 *
 * A link to an order's own page — the word `orderID=` comes off the address
 * detailLook.js builds — and the order card attribute this project has always
 * read. If both are wrong the poll waits out its deadline and the report says so;
 * nothing is harvested from either.
 */
export const A_LINK_TO_AN_ORDER = `a[href*="${ORDER_ID_PARAM}"]`;
export const AN_ORDER_CARD = '[data-csa-c-slot-id]';

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
export function buildDrawnListScript({ beganAt, tag, wantedPath } = {}) {
  const startedAt = Number.isFinite(Number(beganAt)) ? Math.trunc(Number(beganAt)) : 0;
  const name = JSON.stringify(String(tag == null ? '' : tag));
  const wanted = JSON.stringify(String(wantedPath == null ? '' : wantedPath));
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
    var linked = howMany(${JSON.stringify(A_LINK_TO_AN_ORDER)});
    var marked = howMany(${JSON.stringify(AN_ORDER_CARD)});
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
    script: buildDrawnListScript({ beganAt, tag, wantedPath: landedPath(list) }),
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
export function readListStep(step, answer) {
  return step && step.drawn === true
    ? readDrawnOutcome(answer)
    : readListOutcome(answer);
}
