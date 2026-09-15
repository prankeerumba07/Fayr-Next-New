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
  A_LINK_TO_AN_ORDER, AN_ORDER_CARD, DRAW_DEADLINE_MS, LOOK_AGAIN_MS, MOST_LOOKS,
  SHOPS_WHOSE_LIST_THE_PAGE_DRAWS, STEADY_LOOKS_BEFORE_WE_READ, anAnswerTag,
  answerWithStatus, buildDrawnListScript, drawFacts, isOurAnswer, openTheListWith,
  readDrawnOutcome, readListStep, theListIsDrawn,
} from './drawnList.js';
import { ORDER_LIST_PAGES } from '../orderhistory.js';
import { A_DEAD_END, A_PUZZLE, TOO_MANY_ASKS } from '../connect/shopRefusing.js';
import { GAP_BETWEEN_FETCHES_MS, MOST_DETAIL_PAGES } from './detailLook.js';
import { HOW_OFTEN_IT_LOOKS_MS, LOOKS_IN_A_ROW_BEFORE_WE_ASK } from '../connect/gate.js';

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
});

console.log('\nwhich shops draw their own list, and which are fetched exactly as before');

it('AMAZON, and only Amazon, because only its list is drawn', () => {
  deepEqual(SHOPS_WHOSE_LIST_THE_PAGE_DRAWS, ['amazon']);
  ok(theListIsDrawn('amazon'));
  ok(theListIsDrawn('AMAZON'), 'however it is spelled');
  for (const other of ['meesho', 'zepto', 'flipkart', 'blinkit', 'instamart', 'myntra']) {
    ok(!theListIsDrawn(other), `${other} is not read this way`);
  }
  for (const junk of [null, undefined, '', 5, {}, 'ebay']) {
    ok(!theListIsDrawn(junk), `${String(junk)} is not a shop`);
  }
});

it('a drawn shop is pointed AT its list, and a fetched one at its front door', () => {
  const drawn = openTheListWith('amazon', 'https://www.amazon.in/', 1000, 't');
  equal(drawn.uri, ORDER_LIST_PAGES.amazon, 'the view goes to the list itself');
  equal(drawn.drawn, true);
  ok(drawn.script.includes('setInterval'), 'and it waits for the page to draw');
  ok(!drawn.script.includes('fetch('), 'it does not fetch the page it is standing on');

  for (const [key, front] of [['meesho', 'https://www.meesho.com/'], ['zepto', 'https://www.zepto.com/']]) {
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
  for (const typing of [
    '.click(', '.focus(', '.blur(', '.submit(', '.value', 'dispatchEvent',
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
