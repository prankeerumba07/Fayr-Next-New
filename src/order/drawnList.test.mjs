// READING A LIST THE SHOP DRAWS ITSELF: WHAT IT WAITS FOR, AND WHAT IT REFUSES.
//
// ── THE FINDING THIS EXISTS FOR ────────────────────────────────────────────
//
// Amazon's order list is drawn by its own code after the document arrives. A
// fetch downloads the markup as sent and runs none of it, so it downloads a
// frame with nothing in it: 374 kilobytes, signed in, and not one order. Three
// runs across an hour on the owner's own device said exactly the same thing.
//
// So the view goes TO the page now instead of fetching it, waits for the shop to
// draw, and reads what was drawn.
//
// ── WHICH MEANS THREE NEW WAYS TO BE WRONG, AND ALL THREE ARE CHECKED ──────
//
//   IT COULD WAIT FOR EVER. There is a deadline, it is derived from a span this
//   project has already argued fits, and it says which of "the orders appeared"
//   and "they never did" happened.
//   IT COULD LET THE PAGE ANSWER FOR US. The view now sits on the shop's own
//   page, and every frame on it can post into the one handler. An answer has to
//   carry this look's own name or it is counted and dropped.
//   IT COULD TYPE SOMETHING. It never may. There is no click, no form, no
//   submit, no focus and no scroll in the script, and this walks its source
//   looking for each one.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  DRAW_DEADLINE_MS, LEAST_A_DRAW_CAN_TAKE_MS, LOOK_AGAIN_MS, MOST_LOOKS,
  PRESS_BUYS_MS, PRESS_DEADLINE_MS,
  SHOPS_WHOSE_LIST_THE_PAGE_DRAWS, SHOPS_WHOSE_ORDER_PAGES_ARE_DRAWN,
  STEADY_LOOKS_BEFORE_WE_READ, WHAT_EACH_SHOP_DRAWS, anAnswerTag,
  answerWithStatus, buildDrawnListScript, buildDrawnOrderScript, drawFacts, isOurAnswer,
  landedWithoutTheOrder, openOneOrderWith, openTheListWith, readDetailStep,
  readDrawnOutcome, readListStep, theListIsDrawn, theOrderPagesAreDrawn, whatThisShopDraws,
} from './drawnList.js';
import { ORDER_LIST_PAGES } from '../orderhistory.js';
import { A_DEAD_END, A_PUZZLE, TOO_MANY_ASKS } from '../connect/shopRefusing.js';
import { GAP_BETWEEN_FETCHES_MS, MOST_DETAIL_PAGES } from './detailLook.js';
import { HOW_OFTEN_IT_LOOKS_MS, LOOKS_IN_A_ROW_BEFORE_WE_ASK } from '../connect/gate.js';
import { PRESSES_AT_MOST } from '../shop/loadMore.js';

const { ok, equal, deepEqual } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const withoutComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const SCRIPT = buildDrawnListScript({
  beganAt: 1700000000000, tag: 'look-abc', wantedPath: '/your-orders/orders',
  counts: whatThisShopDraws('amazon'),
});

console.log('\nwhich shops draw their own list, and which are fetched exactly as before');

it('the two whose lists are drawn, and nobody else', () => {
  // ZEPTO JOINED ON 15 SEPTEMBER 2026, measured on the owner's own account: its
  // list is drawn by the page's own code exactly as Amazon's is.
  deepEqual(SHOPS_WHOSE_LIST_THE_PAGE_DRAWS, ['amazon', 'zepto']);
  ok(theListIsDrawn('amazon'));
  ok(theListIsDrawn('AMAZON'), 'however it is spelled');
  ok(theListIsDrawn('zepto'));
  ok(theListIsDrawn('ZEPTO'), 'however it is spelled');
  for (const other of ['meesho', 'flipkart', 'blinkit', 'instamart', 'myntra']) {
    ok(!theListIsDrawn(other), `${other} is not read this way`);
  }
  for (const junk of [null, undefined, '', 5, {}, 'ebay']) {
    ok(!theListIsDrawn(junk), `${String(junk)} is not a shop`);
  }
  // AND THE LIST IS THE MARKER MAP'S OWN KEYS, so a shop cannot be waited for
  // without anybody having said what to wait for.
  deepEqual(SHOPS_WHOSE_LIST_THE_PAGE_DRAWS, Object.keys(WHAT_EACH_SHOP_DRAWS));
});

it('and each drawn shop is counted by its OWN marker, never by another shop\'s', () => {
  const amazon = whatThisShopDraws('amazon');
  const zepto = whatThisShopDraws('zepto');
  // AMAZON, UNCHANGED. Both markers, and the link's word still comes off the
  // address detailLook.js builds rather than being typed here.
  equal(amazon.link, 'a[href*="orderID="]');
  // ── THE ORDER CARD'S OWN SLOT, AND NOT ANY SLOT ─────────────────────────
  //
  // MEASURED, 15 SEPTEMBER 2026, 22:25, on the owner's real orders page: the
  // bare attribute matched FIFTY-SIX nodes and not one was an order. Amazon's
  // navigation carries it too — nav_cs_books, nav_cs_electronics — and the
  // navigation is there from the first paint. The poll counted those fifty-six
  // as rows, watched them hold still, and called a page drawn 2.7 seconds in
  // while it was still growing from 816 nodes to 1257. One order number
  // survived, by its bare shape, so ONE order page was opened out of many.
  equal(amazon.card, '[data-csa-c-slot-id^="amzn1.yourorders.order-card"]');
  ok(amazon.card.includes('amzn1.yourorders.order-card'),
    'and the prefix is the one detailLook.js already harvests from, not a new guess');
  ok(!/\[data-csa-c-slot-id\]/.test(amazon.card),
    'AND NEVER THE BARE ATTRIBUTE, which is what the shop own menu wears');
  // ZEPTO. MEASURED: eight of these on his list page, none on the front page.
  equal(zepto.link, 'a[href^="/order/"]');
  // AND NO SECOND MARKER, AS null RATHER THAN A SELECTOR THAT MATCHES NOTHING.
  // `rows` is the two counts ADDED, so a selector picked to count zero is a guess
  // that can start counting something and silently double the row count.
  equal(zepto.card, null);
  // AND A SHOP THAT DOES NOT DRAW HAS NO MARKERS AT ALL.
  for (const other of ['meesho', 'flipkart', '', null, undefined, 'ebay']) {
    equal(whatThisShopDraws(other), null);
  }
});

it('and what each shop counts is what really goes into its own script', () => {
  const forAmazon = buildDrawnListScript({
    beganAt: 1, tag: 't', wantedPath: '/p', counts: whatThisShopDraws('amazon'),
  });
  ok(forAmazon.includes('var linked = howMany("a[href*=\\"orderID=\\"]");'),
    'Amazon counts its order links, exactly as it always did');
  ok(forAmazon.includes(
    'var marked = howMany("[data-csa-c-slot-id^=\\"amzn1.yourorders.order-card\\"]");',
  ), 'and its order cards, by the slot an ORDER wears and not the one its menu does');
  ok(!forAmazon.includes('howMany("[data-csa-c-slot-id]")'),
    'and the bare attribute is gone from the script, not merely unused');

  const forZepto = buildDrawnListScript({
    beganAt: 1, tag: 't', wantedPath: '/p', counts: whatThisShopDraws('zepto'),
  });
  ok(forZepto.includes('var linked = howMany("a[href^=\\"/order/\\"]");'),
    'Zepto counts its own overlay anchors');
  ok(forZepto.includes('var marked = 0;'),
    'AND COUNTS ITS MISSING SECOND MARKER AS A LITERAL ZERO, not as a selector');
  ok(!forZepto.includes('data-csa-c-slot-id'),
    'and Amazon\'s marker is nowhere in another shop\'s script');
  ok(!forZepto.includes('orderID='),
    'nor Amazon\'s word');

  // ── AND A SHOP NOBODY DESCRIBED COUNTS NOTHING, WHICH IS LOUD ────────────
  //
  // Not Amazon's markers quietly applied to somebody else's page. The poll then
  // waits out its whole deadline and the line reads drew=false rows=0/0, which
  // is a thing somebody can see.
  const forNobody = buildDrawnListScript({ beganAt: 1, tag: 't', wantedPath: '/p' });
  ok(forNobody.includes('var linked = 0;') && forNobody.includes('var marked = 0;'),
    'a shop with no markers counts zero of both rather than borrowing');
  ok(!forNobody.includes('howMany("'), 'and asks the page for nothing at all');
});

it('a drawn shop is pointed AT its list, and a fetched one at its front door', () => {
  const drawn = openTheListWith('amazon', 'https://www.amazon.in/', 1000, 't');
  equal(drawn.uri, ORDER_LIST_PAGES.amazon, 'the view goes to the list itself');
  equal(drawn.drawn, true);
  ok(drawn.script.includes('setInterval'), 'and it waits for the page to draw');
  ok(!drawn.script.includes('fetch('), 'it does not fetch the page it is standing on');

  const drawnZepto = openTheListWith('zepto', 'https://www.zepto.com/', 1000, 't');
  equal(drawnZepto.uri, ORDER_LIST_PAGES.zepto, 'and so is Zepto');
  equal(drawnZepto.drawn, true);
  ok(drawnZepto.script.includes('setInterval'));
  ok(!drawnZepto.script.includes('fetch('), 'it does not fetch the page it is standing on');

  for (const [key, front] of [['meesho', 'https://www.meesho.com/']]) {
    const step = openTheListWith(key, front, 1000, 't');
    equal(step.uri, front, `${key} still mounts on its front door`);
    equal(step.drawn, false);
    ok(step.script.includes('fetch('), `${key} still fetches its list`);
    ok(step.script.includes(ORDER_LIST_PAGES[key]), 'and fetches the right address');
    ok(!step.script.includes('setInterval'), 'with no loop in it, exactly as before');
  }
});

it('and a shop whose list we cannot read at all gets nothing rather than a guess', () => {
  for (const key of ['flipkart', 'blinkit', 'instamart', 'myntra']) {
    equal(openTheListWith(key, 'https://x/', 1000, 't'), null, `${key} has no list page`);
  }
  for (const junk of [null, undefined, '', 5, 'ebay']) {
    equal(openTheListWith(junk, 'https://x/', 1000, 't'), null);
  }
});

console.log('\nthe wait: bounded, and derived rather than invented');

it('the deadline is a span this project has already argued fits', () => {
  equal(DRAW_DEADLINE_MS, GAP_BETWEEN_FETCHES_MS * (MOST_DETAIL_PAGES - 1));
  // AND IT REALLY DOES FIT. Read off the screen's own source rather than
  // imported, because that file pulls in the whole of React Native.
  const screen = read('./LookingForItScreen.js');
  const ceiling = Number((screen.match(/MOST_TIME_MS = (\d+)/) || [])[1]);
  ok(Number.isFinite(ceiling) && ceiling > 0, 'the screen still states its ceiling');
  ok(DRAW_DEADLINE_MS * 2 <= ceiling,
    `waiting for a page to draw may have at most half the look: ${DRAW_DEADLINE_MS} of ${ceiling}`);
  // AND IT LEAVES ROOM FOR THE THING THE WAIT IS FOR. One order's own page has
  // to be opened after it, inside the same ceiling.
  ok(ceiling - DRAW_DEADLINE_MS >= DRAW_DEADLINE_MS,
    'there is at least as long again left for the order page');
});

it('and it looks as often as this app has already decided it may look', () => {
  equal(LOOK_AGAIN_MS, HOW_OFTEN_IT_LOOKS_MS, 'the app’s own measured interval');
  equal(STEADY_LOOKS_BEFORE_WE_READ, LOOKS_IN_A_ROW_BEFORE_WE_ASK,
    'and its own rule for "a page halfway through changing is not finished"');
  equal(MOST_LOOKS, Math.ceil(DRAW_DEADLINE_MS / LOOK_AGAIN_MS));
  ok(MOST_LOOKS > 1, 'a second axe that lets the deadline do the work');
});

it('THE SCRIPT SAYS WHICH HAPPENED, which is the whole point of the wait', () => {
  ok(SCRIPT.includes('drew:'), 'it reports whether the orders appeared');
  ok(SCRIPT.includes('waited:'), 'and how long it waited');
  ok(SCRIPT.includes('looks:'), 'and how many times it looked');
  ok(SCRIPT.includes(String(DRAW_DEADLINE_MS)), 'the deadline is really in it');
  ok(SCRIPT.includes(String(LOOK_AGAIN_MS)), 'and so is the interval');
  ok(SCRIPT.includes(`>= ${STEADY_LOOKS_BEFORE_WE_READ}`), 'and the steady rule');
});

it('it sends once, stops its own clock, and cannot be injected twice', () => {
  equal((SCRIPT.match(/postMessage/g) || []).length, 1, 'one way out and no more');
  ok(/if \(sent\) return; sent = true;/.test(SCRIPT), 'it sends once whatever happens');
  ok(SCRIPT.includes('clearInterval'), 'and stops looking when it has');
  ok(SCRIPT.includes('__fayrLooking'), 'a second injection does nothing');
});

it('it serialises the page and never reads the words on it', () => {
  ok(SCRIPT.includes('outerHTML'), 'the markup, escaped by the browser as it goes');
  ok(!SCRIPT.includes('innerText'), 'never innerText');
  ok(!SCRIPT.includes('textContent'), 'and never textContent');
});

it('the name on the answer is quoted, so a page cannot break out through it', () => {
  // CHECKED EXACTLY, and it had to be. The first writing of this asked only
  // whether a backslash-quote was anywhere in the script — and one always is,
  // because the selector the poll counts with has quotes inside it. It passed
  // with the quoting taken out. So the test is now what the line actually says.
  const nasty = '"); alert(1); ("';
  const script = buildDrawnListScript({ beganAt: 0, tag: nasty, wantedPath: '/' });
  ok(script.includes(`o.tag = ${JSON.stringify(nasty)}`),
    'the tag is written as JSON and not pasted in');
  ok(!script.includes('o.tag = "");'), 'nothing in it can close the string and run');
  const path = buildDrawnListScript({ beganAt: 0, tag: 't', wantedPath: nasty });
  ok(path.includes(JSON.stringify(nasty)), 'and so is the path we were sent to');
  ok(!path.includes('= "");'), 'which cannot break out either');
  // AND A LOOK WITH NO NAME SAYS SO rather than writing `undefined` into a page.
  ok(buildDrawnListScript({ beganAt: 0 }).includes('o.tag = ""'));
});

it('FAYR TYPES NOTHING INTO THE SHOP’S PAGE, and this walks the script for it', () => {
  // The standing rule, and until now nothing checked it for this folder at all:
  // the plain-language check on the backend holds a FIXED list of five files and
  // none of them is here. A page script in this folder carrying a click passed
  // every check in the project.
  //
  // ── ONE TAP IS NOW ALLOWED, AND ONLY IN ONE SCRIPT ───────────────────────
  //
  // 18 September 2026. The owner's read found nothing on a live Zepto account
  // that had the order on it: the list loads eight at a time behind a "Load
  // More" button and the order was sixty rows back. Reaching it means pressing
  // that button, and pressing is a tap.
  //
  // THE RULE IS NARROWED AND NOT DROPPED. `.click(` leaves the forbidden list
  // for the ORDER LIST script of a shop whose button has been measured, and
  // stays forbidden everywhere else. Every other shape on the list — typing into
  // a field, submitting a form, synthesising an event, moving somebody's page —
  // is still refused for every script this file builds, and the checks
  // immediately below pin the tap to exactly one control.
  //
  // SCRIPT here is AMAZON'S, and it is unchanged: the whole press mechanism is
  // ABSENT from the script of a shop with no measured button, not switched off
  // inside it, and the check after next proves the two scripts are identical
  // character for character.
  for (const typing of [
    '.focus(', '.blur(', '.submit(', '.value', 'dispatchEvent',
    'document.forms', 'execCommand', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'scrollTo', 'scrollIntoView', 'requestSubmit',
  ]) {
    ok(!SCRIPT.includes(typing), `the script contains "${typing}", which is typing or tapping`);
  }
  // AND IT CARRIES NOTHING BACK THAT BELONGS TO THE PERSON.
  for (const secret of [
    'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB',
    'token', 'Bearer', 'password', 'authorization',
  ]) {
    ok(!SCRIPT.includes(secret), `the script contains "${secret}"`);
  }
});

console.log('\n"load more", and the one tap in the whole folder');

const PRESSING = buildDrawnListScript({
  beganAt: 1700000000000, tag: 'look-abc', wantedPath: '/account/orders',
  counts: whatThisShopDraws('zepto'), platformKey: 'zepto',
});

it('A SHOP WITH NO MEASURED BUTTON GETS A SCRIPT WITH NO TAP IN IT AT ALL', () => {
  // The strongest form of "Amazon behaves exactly as it does today": not a
  // promise about what its script does, but the same script.
  const asItWas = buildDrawnListScript({
    beganAt: 1700000000000, tag: 'look-abc', wantedPath: '/your-orders/orders',
    counts: whatThisShopDraws('amazon'),
  });
  equal(
    buildDrawnListScript({
      beganAt: 1700000000000, tag: 'look-abc', wantedPath: '/your-orders/orders',
      counts: whatThisShopDraws('amazon'), platformKey: 'amazon',
    }),
    asItWas,
    'Amazon\'s script with the key is the same script it was without one',
  );
  for (const gone of ['.click(', 'textContent', 'loadMoreWords', 'presses', 'pressTime']) {
    ok(!asItWas.includes(gone), `a shop that cannot press has no "${gone}" in its script`);
  }
  for (const shop of ['meesho', 'flipkart', 'blinkit', 'instamart', '', null, undefined]) {
    const other = buildDrawnListScript({
      beganAt: 1, tag: 't', wantedPath: '/p', counts: whatThisShopDraws('amazon'), platformKey: shop,
    });
    ok(!other.includes('.click('), `and neither does ${String(shop)}`);
  }
});

it('THE ONE TAP IS THE MEASURED BUTTON, AND THERE IS EXACTLY ONE OF IT', () => {
  equal((PRESSING.match(/\.click\(/g) || []).length, 1, 'one tap in the whole script');
  ok(PRESSING.includes('try { more.click(); } catch(e){}'),
    'and it is the element theLoadMoreButton handed back, wrapped so it cannot throw');
  ok(PRESSING.includes('var more = theLoadMoreButton();'),
    'which is the only thing that is ever tapped');
  // EVERY OTHER SHAPE ON THE ORIGINAL LIST IS STILL REFUSED HERE.
  for (const typing of [
    '.focus(', '.blur(', '.submit(', '.value', 'dispatchEvent',
    'document.forms', 'execCommand', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
    'scrollTo', 'scrollIntoView', 'requestSubmit',
  ]) {
    ok(!PRESSING.includes(typing), `the pressing script contains "${typing}"`);
  }
  for (const secret of [
    'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB',
    'token', 'Bearer', 'password', 'authorization',
  ]) {
    ok(!PRESSING.includes(secret), `the pressing script contains "${secret}"`);
  }
});

it('THE WORDS IT READS ARE A BUTTON\'S LABEL AND THEY NEVER LEAVE THE PAGE', () => {
  // The rule above says this script serialises the page and does not read it.
  // Finding a button by its words is reading, so it is allowed exactly once and
  // pinned to the place that does it.
  equal((PRESSING.match(/textContent/g) || []).length, 1, 'read in one place only');
  ok(PRESSING.includes('function theLoadMoreButton(){'), 'and that place is the button finder');
  ok(!PRESSING.includes('innerText'), 'still never innerText');
  // AND NOTHING IT READ IS SENT. The only things added to the answer are counts
  // and one yes-or-no, every one of which is about the pressing itself.
  const sent = (PRESSING.match(/send\(\{[\s\S]*?\}\);/) || [''])[0];
  ok(sent.includes('presses: presses'), 'how many times it pressed');
  ok(sent.includes('rowsBeforeEachPress: rowsBefore'), 'and what the list held before each');
  ok(sent.includes('rowsAtTheEnd: rows'), 'and where it ended up');
  ok(!sent.includes('textContent') && !sent.includes('loadMoreWords'),
    'and not one word read off the page');
});

it('IT ONLY EVER TAPS SOMETHING THAT IS ALREADY A CONTROL', () => {
  ok(PRESSING.includes('document.querySelectorAll(\'button, a, [role="button"]\')'),
    'buttons, links and things the page itself calls buttons');
  ok(PRESSING.includes("if (el.querySelector && el.querySelector('*')) continue;"),
    'and never a card that merely CONTAINS the words');
  ok(PRESSING.includes('if (t === loadMoreWords[j]) return el;'),
    'the whole label has to be the words, not contain them');
  ok(PRESSING.includes('"load more"'), 'and the words are the measured ones');
});

it('THE PRESSING STOPS, AND ALL THREE WAYS ARE REALLY IN THE SCRIPT', () => {
  ok(PRESSING.includes(`presses < ${PRESSES_AT_MOST}`), 'the limit, as the named constant');
  ok(PRESSING.includes('if (more !== null)'), 'the button being gone');
  ok(PRESSING.includes('&& !out &&'), 'and the deadline, which no press can outlive');
  // AND A PRESS PUTS THE STEADY COUNTERS BACK, or the next look would still see
  // the old rows holding still and press again at once, seven times over.
  ok(PRESSING.includes('steady = -1; same = 0;'), 'a press means waiting for the page again');
  ok(PRESSING.includes('rowsBefore.push(rows);'), 'and the count before it is kept');
});

it('AND PRESSING BUYS ITS OWN TIME, NEVER THE DRAWING\'S', () => {
  equal(PRESS_BUYS_MS, LEAST_A_DRAW_CAN_TAKE_MS + GAP_BETWEEN_FETCHES_MS,
    'one settle and one politeness gap a press, both already argued for');
  equal(PRESS_DEADLINE_MS, PRESSES_AT_MOST * PRESS_BUYS_MS);
  ok(PRESSING.includes(`${DRAW_DEADLINE_MS} + pressTime`),
    'the deadline grows by what has been pressed and not by what might be');
  ok(PRESSING.includes(`${MOST_LOOKS} + pressLooks`), 'and so does the second axe');
  ok(!SCRIPT.includes('pressTime'),
    'while a shop that cannot press has the arithmetic it always had');
});

console.log('\nand a page cannot answer for us');

it('AN ANSWER HAS TO CARRY THIS LOOK’S OWN NAME', () => {
  ok(isOurAnswer({ tag: 'look-1' }, 'look-1'), 'ours is ours');
  ok(!isOurAnswer({ tag: 'look-2' }, 'look-1'), 'another look’s is not');
  ok(!isOurAnswer({}, 'look-1'), 'and neither is one with no name on it');
  ok(!isOurAnswer({ tag: 0 }, '0'), 'nothing is coerced into matching');
  ok(!isOurAnswer({ tag: 'look-1' }, ''), 'an empty name matches nothing');
  ok(!isOurAnswer({ tag: '' }, ''), 'not even an empty one');
  for (const junk of [null, undefined, 'a string', 5, []]) {
    ok(!isOurAnswer(junk, 'look-1'), `${String(junk)} is not an answer`);
  }
  // THE ONE THAT MATTERS: the page writing a whole plausible answer.
  ok(!isOurAnswer({ ok: true, status: 200, html: '<html>bought it</html>' }, 'look-1'),
    'a page writing a perfectly shaped answer is still not ours');
});

it('and two looks never share a name', () => {
  const a = anAnswerTag(1, 0.123456);
  const b = anAnswerTag(2, 0.123456);
  const c = anAnswerTag(1, 0.987654);
  ok(a !== b && a !== c && b !== c, `${a} ${b} ${c}`);
  ok(typeof anAnswerTag(null, undefined) === 'string', 'junk still gives a name');
  ok(anAnswerTag(1, 0.5).length > 4, 'and it is not empty');
});

console.log('\nwhat the page reported is made safe before anything reads it');

it('every number the page sent is coerced, and every flag must be exactly true', () => {
  const junk = drawFacts({
    drew: 'yes', settled: 1, waited: {}, looks: '7', linked: null,
    marked: NaN, nodesFirst: Infinity, nodesNow: '12.9',
  });
  equal(junk.drew, false, 'a string is not true');
  equal(junk.settled, false, 'and neither is a one');
  equal(junk.waited, 0, 'an object reads nought rather than [object Object]');
  equal(junk.looks, 7, 'a number written as words still counts');
  equal(junk.linked, 0);
  equal(junk.marked, 0);
  equal(junk.nodesFirst, 0, 'and infinity is not a count');
  equal(junk.nodesNow, 12);
  for (const nothing of [null, undefined, 'x', 5]) {
    equal(drawFacts(nothing).drew, false, `${String(nothing)} reports nothing drawn`);
  }
});

it('a drawn page is given the status the view saw, and a fetched one keeps its own', () => {
  const drawn = { fromTheDrawnPage: true, ok: true, status: 0, html: '<b>x</b>' };
  equal(answerWithStatus(drawn, 200).status, 200, 'the view says what the page could not');
  equal(answerWithStatus(drawn, 503).status, 503, 'including when the shop refused');
  equal(answerWithStatus(drawn, 'junk').status, 0, 'and junk is not a status');
  // A FETCHED ANSWER'S STATUS CAME FROM THE SHOP. Nothing here may overwrite it.
  const fetched = { ok: false, status: 0, html: '', url: '' };
  deepEqual(answerWithStatus(fetched, 200), fetched, 'a fetched answer passes straight through');
  const real = { ok: true, status: 503, html: '' };
  deepEqual(answerWithStatus(real, 200), real, 'even when it is a refusal');
  equal(answerWithStatus(null, 200), null);
});

console.log('\nand a drawn page is read by the one shared reader');

it('THE REFUSALS ARE THE SAME THREE THE OTHER TWO READERS KNOW', () => {
  const at = (answer) => readDrawnOutcome(answer).whyNot;
  equal(at({ ok: true, status: 503, html: '', drew: true }), TOO_MANY_ASKS);
  equal(at({
    ok: true, status: 200, drew: true,
    html: '<html><body>Click the button below to continue shopping</body></html>',
  }), A_DEAD_END);
  equal(at({ ok: true, status: 200, drew: true, html: '<html>Enter the characters you see</html>' }),
    A_PUZZLE);
  // A SECOND VOCABULARY IS HOW TWO READERS END UP DISAGREEING. It comes from
  // readPageRefusal, shared with the fetched list and each order's own page.
  ok(/readPageRefusal/.test(withoutComments(read('./drawnList.js'))),
    'it really does share the one reader');
});

it('a sign in wall is still a sign in wall, and it still says which page', () => {
  const wall = readDrawnOutcome({
    ok: true, status: 200, drew: false, html: '<html>x</html>',
    url: 'https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0',
  });
  equal(wall.wantsSignIn, true);
  equal(wall.landed, '/ap/signin', 'the path only, never the query, which carries tokens');
  equal(wall.looked, false);
  // AND THE SHOP'S NEWER ONE. Measured on 15 September: signed out, the list
  // redirects here.
  const claim = readDrawnOutcome({
    ok: true, status: 200, drew: false, html: '<html>x</html>',
    url: 'https://www.amazon.in/ax/claim?arb=1',
  });
  equal(claim.wantsSignIn, true);
  equal(claim.landed, '/ax/claim');
});

it('A PAGE THAT NEVER DREW IS NOT A PAGE WE LOOKED AT', () => {
  // The distinction the five silent days turned on. There IS a whole document
  // here and there is nothing of the person's on it, and calling that "we
  // looked" is how "we found nothing" and "we never saw it" became one answer.
  const never = readDrawnOutcome({
    ok: true, status: 200, drew: false, html: '<html><body>a shell</body></html>',
    url: 'https://www.amazon.in/your-orders/orders',
  });
  equal(never.looked, false, 'it ran out of time and says so');
  equal(never.whyNot, null, 'and that is not the shop refusing');
  equal(never.landed, '/your-orders/orders', 'and we were on the right page all along');

  const drew = readDrawnOutcome({
    ok: true, status: 200, drew: true, html: '<html><body>orders</body></html>',
    url: 'https://www.amazon.in/your-orders/orders',
  });
  equal(drew.looked, true, 'a page that drew is a page we looked at');
  deepEqual(drew.blocks, [], 'and it is read for its numbers, not cut into blocks');
});

it('and nothing at all is not an answer', () => {
  for (const nothing of [null, undefined, {}, 'x', 5]) {
    const out = readDrawnOutcome(nothing);
    equal(out.looked, false, `${String(nothing)} is not a page`);
    equal(out.landed, null, 'and it says nothing rather than something');
  }
});

it('the step decides which reader, so there is one place that chooses', () => {
  const drawnStep = { drawn: true };
  const fetchedStep = { drawn: false };
  const answer = {
    ok: true, status: 200, drew: true, html: '<html>x</html>',
    url: 'https://www.amazon.in/your-orders/orders',
  };
  equal(readListStep(drawnStep, answer).looked, true, 'the drawn reader asks whether it drew');
  // The fetched reader asks a different question of the same answer: are there
  // orders written on it. There are not.
  equal(readListStep(fetchedStep, answer).looked, false);
  equal(readListStep(null, answer).looked, false, 'no step reads as the fetched one');
});

console.log('\nand one ORDER page, for a shop that draws those too');

it('the list being drawn and the ORDER PAGES being drawn are different facts', () => {
  // ── AND ONE SHOP IS THE LIVING PROOF OF IT ────────────────────────────────
  //
  // Amazon DRAWS ITS LIST and SENDS ITS ORDER PAGES WHOLE. That is the whole
  // reason its orders are fetched one at a time from inside the page already
  // open, and the reason the politeness gap between those fetches exists.
  // Sharing one list would turn those fetches into navigations: six page loads
  // instead of six fetches, past the ceiling, and the gap silently gone.
  deepEqual(SHOPS_WHOSE_ORDER_PAGES_ARE_DRAWN, ['zepto']);
  ok(theListIsDrawn('amazon'), 'Amazon draws its list');
  ok(!theOrderPagesAreDrawn('amazon'), 'AND SENDS ITS ORDER PAGES WHOLE');
  ok(theListIsDrawn('zepto') && theOrderPagesAreDrawn('zepto'), 'Zepto draws both');
  for (const other of ['meesho', 'flipkart', 'blinkit', 'instamart', 'myntra',
    '', null, undefined, 7]) {
    ok(!theOrderPagesAreDrawn(other), `${String(other)} does not draw its order pages`);
  }
});

it('a shop that sends its pages whole is still FETCHED, from where it already is', () => {
  const one = openOneOrderWith('amazon', 'https://www.amazon.in/gp/x?orderID=408-5094957-4481129',
    5000, 'tag-1', '408-5094957-4481129');
  equal(one.drawn, false);
  equal(one.uri, null, 'THERE IS NOWHERE TO GO: it runs where the view already is');
  ok(one.script.includes('fetch('), 'and it fetches, exactly as it always did');
  ok(!one.script.includes('setInterval'), 'with no waiting loop in it');
  equal(one.number, '408-5094957-4481129');
});

it('and a shop that draws them is GONE TO, and waited for', () => {
  const url = 'https://www.zepto.com/order/01a0397a-bbb4-7cd7-b611-0e68227a15f1?isArchived=false';
  const one = openOneOrderWith('zepto', url, 5000, 'tag-2', '01a0397a-bbb4-7cd7-b611-0e68227a15f1');
  equal(one.drawn, true);
  equal(one.uri, url, 'the view is pointed at the order own page');
  ok(!one.script.includes('fetch('),
    'AND IT DOES NOT FETCH THE PAGE IT IS STANDING ON, which is what came back empty');
  ok(one.script.includes('setInterval'), 'it waits for the page to draw');
});

it('the order page hands back its WORDS as well as its markup, and never instead', () => {
  const script = buildDrawnOrderScript({ beganAt: 1, tag: 'n', wantedPath: '/order/x' });
  // ── THE ONE THAT WOULD HAVE BEEN SILENT ─────────────────────────────────
  //
  // readPageRefusal answers `answered` only when the status is not nought, and a
  // page cannot see its own status. Without this flag answerWithStatus passes
  // the payload straight through, the nought stands, every order page reads as
  // "nothing on this page", and the loop runs to the end and asks for a
  // photograph. That is the shape of the five silent days.
  ok(script.includes('o.fromTheDrawnPage = true;'),
    'THE ANSWER SAYS IT CAME FROM A DRAWN PAGE, so our side can put the status back');
  ok(script.includes('o.text = document.body ? document.body.innerText : \'\';'),
    'it hands back the words, which is what the server reads');
  ok(script.includes('o.html = document.documentElement ? document.documentElement.outerHTML : \'\';'),
    'AND THE MARKUP AS WELL, because every refusal and the byte count still read that');
  ok(script.includes('o.url = String(location.href);'), 'and where it ended up');

  // ── innerText IS READ ONCE, AND NEVER IN A LOOK ─────────────────────────
  //
  // It makes the page lay itself out. What a look watches is textContent length,
  // which reads off the tree and lays nothing out.
  const send = script.slice(script.indexOf('function send('), script.indexOf('function howMuch('));
  const look = script.slice(script.indexOf('function look()'));
  ok(send.includes('innerText'), 'the words are taken in send');
  ok(!look.includes('innerText'), 'AND NEVER IN A LOOK, because laying out on a timer is a cost');
  ok(script.includes('document.body.textContent.length'),
    'what a look watches is a length off the tree');

  // AND IT WAITS FOR THE PAGE TO BE FINISHED, not merely steady. On a list a
  // steady row count is enough; on a page whose whole content IS the thing being
  // waited for, a shell steady at nothing would read as done at the second look.
  ok(/var wrote = settled && chars > 0 && same >= 2;/.test(script),
    'a page is only read when it has settled AND held its text');

  // AND ITS GUARD IS ITS OWN NAME. Two scripts sharing one would let whichever
  // ran first lock the other out of a document it had already touched.
  ok(script.includes('window.__fayrReading'), 'it has its own re-entry guard');
  ok(!script.includes('__fayrLooking'), 'and never the list poller one');
});

it('and an order page is handed what is LEFT of the look, never more', () => {
  const short = buildDrawnOrderScript({ beganAt: 1, tag: 'n', wantedPath: '/p', deadlineMs: 2400 });
  ok(short.includes(`waited >= 2400`), 'a page near the end of a look gets only what is left');
  ok(short.includes('looks >= 8'), 'and its look count follows its own deadline');
  const greedy = buildDrawnOrderScript({ beganAt: 1, tag: 'n', wantedPath: '/p', deadlineMs: 999999 });
  ok(greedy.includes(`waited >= ${DRAW_DEADLINE_MS}`),
    'AND NEVER MORE THAN THE STANDING DEADLINE, so one slow page cannot eat the ceiling');
  const plain = buildDrawnOrderScript({ beganAt: 1, tag: 'n', wantedPath: '/p' });
  ok(plain.includes(`waited >= ${DRAW_DEADLINE_MS}`), 'and asked for nothing, it gets the standing one');
  // AND THE FLOOR UNDER OPENING ONE MORE AT ALL IS DERIVED, not typed.
  equal(LEAST_A_DRAW_CAN_TAKE_MS, LOOK_AGAIN_MS * STEADY_LOOKS_BEFORE_WE_READ);
  ok(LEAST_A_DRAW_CAN_TAKE_MS < DRAW_DEADLINE_MS, 'and it is a floor, not a second deadline');
});

it('the order id never reaches a line, and it is taken out at the reader', () => {
  // ── WHY THIS IS NOT PARANOIA ─────────────────────────────────────────────
  //
  // A fetched order page keeps its number in the QUERY and landedPath drops the
  // query, so this never came up. A drawn one carries it in the PATH — and
  // `landed=` is exactly the field somebody copies into a message when a look
  // goes wrong. maskNumbers cannot hide an id that is mostly letters.
  const id = '01a0397a-bbb4-7cd7-b611-0e68227a15f1';
  equal(landedWithoutTheOrder(`/order/${id}`, id), '/order/<order>');
  equal(landedWithoutTheOrder(`/order/${id}/again/${id}`, id), '/order/<order>/again/<order>');
  equal(landedWithoutTheOrder('/order/other', id), '/order/other', 'and nothing else is touched');
  for (const junk of [null, undefined, 7, '']) {
    equal(landedWithoutTheOrder(junk, id), junk);
    equal(landedWithoutTheOrder('/order/x', junk), '/order/x');
  }
  // AND THROUGH THE READER, WHICH IS WHERE EVERY LANDING PASSES.
  const step = { drawn: true, number: id };
  const answer = {
    ok: true, status: 200, drew: true, text: 'Order #SOSIJGGRL26770', html: '<html></html>',
    url: `https://www.zepto.com/order/${id}?isArchived=false`,
  };
  const read = readDetailStep(step, answer);
  equal(read.landed, '/order/<order>');
  ok(!read.landed.includes(id), 'THE ID IS NOT IN THE LANDING, whatever else is');
  equal(read.looked, true);
  equal(read.text, 'Order #SOSIJGGRL26770');
});

it('and a page that never drew is not a page we read', () => {
  const id = '01a0397a-bbb4-7cd7-b611-0e68227a15f1';
  const step = { drawn: true, number: id };
  const shell = {
    ok: true, status: 200, drew: false, text: '', html: '<html></html>',
    url: `https://www.zepto.com/order/${id}`,
  };
  equal(readDetailStep(step, shell).looked, false,
    'a whole document with nothing of the person in it is not a page we looked at');
  const drewButEmpty = { ...shell, drew: true };
  equal(readDetailStep(step, drewButEmpty).looked, false, 'and neither is one with no words');
  // ── AND THE ONE THAT MATTERS: WORDS, BUT NEVER DRAWN ────────────────────
  //
  // This is the shape a shell really arrives in. It is not empty — it carries
  // the shop's own chrome, a header, a menu, a footer — so a reader that asked
  // only "were there any words" would call it a page we read, hand that chrome
  // to the server as an order, and report looked=true about a page that never
  // showed the order at all. THE DRAW IS THE EVIDENCE, not the length.
  const chromeOnly = { ...shell, drew: false, text: 'Zepto\nHome\nCart\nAccount' };
  equal(readDetailStep(step, chromeOnly).looked, false,
    'A PAGE THAT NEVER DREW IS NOT A PAGE WE READ, however many words are on it');
  equal(readDetailStep(step, { ...chromeOnly, drew: true }).looked, true,
    'and the same words once it really drew are a page we read');
  // AND A STATUS OF NOUGHT IS STILL NOT AN ANSWER, which is what the flag is for.
  equal(readDetailStep(step, { ...shell, status: 0, drew: true, text: 'x' }).looked, false);
  // AND THE READER DISPATCHES ON THE STEP, never on the shop. A fetched step
  // goes to the reader it always went to, whatever the shop does elsewhere.
  const fetched = readDetailStep({ drawn: false, number: id }, {
    ok: true, status: 200, html: '<html><body>Order # 408-5094957-4481129</body></html>', url: 'https://x/',
  });
  ok(Object.prototype.hasOwnProperty.call(fetched, 'text'), 'a fetched step is read as it always was');
});


console.log('\na redirect INTO the page we asked for is not somewhere else');

it('THE REDIRECT GUARD, ON A PAGE THAT REALLY IS DRAWN', () => {
  // MEASURED on the owner's account, 16 September 2026, on the profile page:
  // asked for /gp/profile/, landed on /gp/profile/amzn1.account.<id>, so
  // `elsewhere` was true and `elsewhere && settled` sent at once — bypassing
  // `drew`, the half that waits for the rows. That page turned out not to be
  // drawn at all, but the guard was still wrong, and it is wrong the same way
  // for any drawn page a shop redirects into a longer path.
  // THE REVIEWS PAGE NO LONGER GOES THROUGH HERE — measured the same evening,
  // it answers 400 when navigated to and 200 when fetched, so it is fetched and
  // this guard never sees it. The ORDERS LIST and the ORDER SEARCH are drawn,
  // both land where they were sent, and a shop that starts redirecting either of
  // them to a longer path must not silently stop waiting for it.
  const step = openTheListWith('amazon', 'https://www.amazon.in', 1700000000000, 'look-1');
  ok(step.drawn === true, 'the orders list really is a drawn page');
  ok(/var inside =/.test(step.script),
    'the script works out what counts as INSIDE the page it asked for');
  ok(/location\.pathname\.indexOf\(inside\) !== 0/.test(step.script),
    'and a path that contains the one we asked for is NOT elsewhere');
});

it('and the rule itself, on every shape that matters', () => {
  // The same expression the script runs, asked here where it can be walked.
  const elsewhere = (wanted, path) => {
    const inside = wanted === ''
      ? ''
      : (wanted.charAt(wanted.length - 1) === '/' ? wanted : `${wanted}/`);
    return wanted !== '' && path !== wanted && path.indexOf(inside) !== 0;
  };

  // THE REDIRECT. The page, named more fully by the shop. Worth waiting for.
  equal(elsewhere('/gp/profile/', '/gp/profile/amzn1.account.AH2TEC'), false);
  equal(elsewhere('/gp/profile/', '/gp/profile/'), false);
  equal(elsewhere('/your-orders/orders', '/your-orders/orders/page/2'), false);

  // WHAT THE GUARD IS ACTUALLY FOR, and it still catches all of it: the shop
  // taking us somewhere that is not the page, where waiting buys nothing.
  equal(elsewhere('/gp/profile/', '/ap/signin'), true);
  equal(elsewhere('/your-orders/search', '/ap/signin'), true);
  equal(elsewhere('/your-orders/orders', '/'), true);

  // AND THE SLASH IS NOT COSMETIC. Without it this would be satisfied by a
  // different page whose name merely starts the same way.
  equal(elsewhere('/your-orders/orders', '/your-orders/orders-archive'), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
