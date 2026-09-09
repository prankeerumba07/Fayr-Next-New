// RECOGNISING WHAT AMAZON IS ACTUALLY SAYING, SO THE READ CAN REPORT IT HONESTLY.
//
// Every case in here was MEASURED from the owner's log of 9 September 2026, after
// the app asked Amazon for its sign in page a second time inside four minutes:
//
//   19:06     Amazon connect SUCCEEDED
//   19:10     asked again, for a second campaign
//             a page whose whole body was "Click the button below to continue shopping"
//             HTTP 503 on /gp/sign-in.html
//             https://www.amazon.in/errors_page/validateCaptcha
//
// Three different-looking answers, one meaning: slow down. Nothing in the app
// recognised any of the three as that.
//
// AND THE THING THIS FILE IS REALLY DEFENDING is the difference between "we could
// not find your order" and "the shop is not letting us look right now". Those send
// a person to two different places, and only one of them is about their money.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  A_DEAD_END, A_PUZZLE, SLOW_DOWN_CODES, TOO_MANY_ASKS,
  theShopIsRefusing, whyTheShopIsRefusing,
} from './shopRefusing.js';
import {
  CANNOT_TELL, FAILED, HOLD_CANNOT_TELL_MS, OPENING_UP, SHOP, SIGNED_IN_NOW,
  holdBackCannotTell, whatIsOnScreen,
} from './gate.js';
import { IS_A_DEAD_END, PAYING_PATH } from './pageQuestions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

console.log('=== 1. AMAZON OWN PUZZLE ADDRESS, WHICH DID NOT MATCH ===');
{
  // The list had Flipkart's spelling, `errors/validateCaptcha`. Amazon's is
  // `errors_page/validateCaptcha`, one word apart, and the pattern is anchored at
  // the start of the path so it could not have matched further along either.
  const paying = new RegExp(PAYING_PATH);
  ok(paying.test('/errors_page/validateCaptcha') === true,
    'AMAZON OWN ADDRESS NOW MATCHES, measured from his log');
  ok(paying.test('/errors/validateCaptcha') === true,
    'and Flipkart own still does, because both shops are real');
  // AND IT CANNOT MATCH A REAL SHOP PAGE.
  for (const ordinary of [
    '/', '/gp/sign-in.html', '/ap/signin', '/dp/B0F16X1NQ7',
    '/your-orders/orders', '/errors_page', '/errors', '/s?k=shoes',
    '/gp/your-account/order-details',
  ]) {
    ok(paying.test(ordinary) === false,
      `${ordinary} is an ordinary address and is left alone`);
  }
  // TWO REAL ADDRESSES, NOT A FAMILY OF THEM. FOUND BY BREAKING THE CODE: the
  // one-pattern version `errors[_a-z]*\/validateCaptcha` matches both real ones
  // and every check above still passed. A pattern that matches addresses nobody
  // has seen is a pattern nobody can check, and it would quietly start treating
  // some future page as a puzzle.
  for (const noShopHasThis of [
    '/errorspage/validateCaptcha', '/errors_pages/validateCaptcha',
    '/errorpage/validateCaptcha', '/error/validateCaptcha',
    '/errors_page_x/validateCaptcha',
  ]) {
    ok(paying.test(noShopHasThis) === false,
      `${noShopHasThis} is an address no shop has, and is NOT matched`);
  }
}

console.log('\n=== 2. THE DEAD END PAGE, MATCHED ON WHAT IT SAYS ===');
{
  // The address was plain "/" both times, so there is nothing in it to match on.
  // The body is the only evidence there is. This runs the real injected question
  // against a made up page, the way gate.test.mjs already does.
  const asks = new Function(
    'document',
    `${IS_A_DEAD_END}; return fayrIsADeadEnd();`,
  );
  const page = (text) => ({ body: { innerText: text } });

  ok(asks(page('Click the button below to continue shopping')) === true,
    'THE EXACT PAGE AMAZON SENT is recognised');
  ok(asks(page('  \n Click the button below to Continue Shopping \n ')) === true,
    'and the same page with different spacing and capitals');
  ok(asks(page('Continue shopping')) === true,
    'and the shortest form of it');

  // AND IT CANNOT MATCH A REAL SHOP PAGE. Two conditions together, and the
  // length is what makes it safe: a real Amazon page carrying those words
  // somewhere in it runs to thousands of characters.
  // ── EACH CONDITION ISOLATED, BECAUSE THE TWO BRANCHES OVERLAP ────────────
  //
  // FOUND BY BREAKING THE CODE. The first writing of this section tested pages
  // that BOTH branches agreed about, so either branch could be deleted and every
  // check stayed green: the exact-phrase page is also under 120 characters, so
  // the short-form branch caught it too.

  // ONLY THE EXACT PHRASE CAN MATCH THIS: it carries the whole sentence, and it
  // is over 120 characters so the short-form branch cannot see it.
  const onlyTheExactPhrase =
    'Click the button below to continue shopping. '
    + 'We are sorry for the interruption and hope to have you back very soon indeed.';
  ok(onlyTheExactPhrase.length > 120 && onlyTheExactPhrase.length < 400,
    '  (a page only the exact-phrase branch can match)');
  ok(asks(page(onlyTheExactPhrase)) === true,
    'THE EXACT SENTENCE is recognised even when the page says more besides');

  // ONLY THE LENGTH CAN SAVE THIS ONE: a long page that really does carry the
  // sentence. An Amazon help page explaining the interruption would.
  const longPageWithThePhrase =
    `Help and Customer Service
Click the button below to continue shopping if you reached this page by mistake.
${'Browse our departments and find what you need today. '.repeat(12)}`;
  ok(longPageWithThePhrase.length > 400, '  (a long page carrying the sentence)');
  ok(asks(page(longPageWithThePhrase)) === false,
    'A LONG PAGE IS NOT THE DEAD END even when it carries the exact sentence, '
    + 'because the page Amazon sent was one sentence and nothing else');

  const realPage = `Your Orders
Order placed 12 August 2026  Total 1,299.00  Delivered
Wireless Earbuds with Charging Case, Black
Buy it again   View your item   Write a product review
Continue shopping for more deals in Electronics
${'Recommended for you. '.repeat(60)}`;
  ok(asks(page(realPage)) === false,
    'A REAL ORDERS PAGE saying "continue shopping" in it is NOT the dead end');
  ok(realPage.length > 400, '  (and it is over the length the rule refuses at)');
  ok(asks(page('')) === false, 'an empty page is not the dead end');
  ok(asks(page('   \n  ')) === false, 'and neither is whitespace');
  ok(asks(page('Sign in\nPassword\nContinue')) === false,
    'and a sign in page is not, even though it says Continue');

  // ── AND ITS OWN ERROR ANSWERS FALSE ──────────────────────────────────────
  //
  // ALSO FOUND BY BREAKING THE CODE. This was written as asks({}), which never
  // reaches the catch at all: `document.body && document.body.innerText || ""`
  // reads an absent body as the empty string quite happily. So the catch could be
  // flipped to `return true` and nothing noticed. A document that THROWS is what
  // reaches it.
  ok(asks(null) === false,
    'A PAGE IT CANNOT READ AT ALL answers false, because being wrong towards '
    + '"the shop is fine" costs one attempt and being wrong the other way stops '
    + 'somebody who had no problem');
  const angry = { get body() { throw new Error('cross origin'); } };
  ok(asks(angry) === false, 'and so does a page that refuses to be read');
  ok(asks({}) === false, 'and a page with no body at all is simply not the dead end');
}

console.log('\n=== 3. THE THREE FACES, AND WHICH ONE IT WAS ===');
{
  ok(whyTheShopIsRefusing({ isAPuzzle: true }) === A_PUZZLE, 'the puzzle by its words');
  ok(whyTheShopIsRefusing({ onAPuzzlePath: true }) === A_PUZZLE, 'the puzzle by its address');
  ok(whyTheShopIsRefusing({ statusCode: 503 }) === TOO_MANY_ASKS,
    'THE 503 AMAZON REALLY SENT, on its own sign in address');
  ok(whyTheShopIsRefusing({ statusCode: 429 }) === TOO_MANY_ASKS,
    'and the same message said properly');
  ok(whyTheShopIsRefusing({ isADeadEnd: true }) === A_DEAD_END, 'and the dead end page');
  ok(theShopIsRefusing({ statusCode: 503 }) === true, 'and the yes-or-no form agrees');

  // NOTHING WRONG IS NULL, and null is what lets the read say "we could not find
  // your order" honestly when that is really what happened.
  for (const fine of [
    {}, { statusCode: 200 }, { statusCode: 404 }, { statusCode: null },
    { isADeadEnd: false, isAPuzzle: false }, undefined,
  ]) {
    ok(whyTheShopIsRefusing(fine) === null,
      `${JSON.stringify(fine) ?? String(fine)}: the shop is not refusing`);
    ok(theShopIsRefusing(fine) === false, '  and the yes-or-no form agrees');
  }
  // A MISSING PAGE IS NOT RATIONING. Calling it that would hide a real fault of
  // ours behind "try again in a few minutes" for ever.
  ok(!SLOW_DOWN_CODES.includes(404), '404 is deliberately not a slow-down code');
  ok(!SLOW_DOWN_CODES.includes(500), 'and neither is 500');
  ok(SLOW_DOWN_CODES.includes(503) && SLOW_DOWN_CODES.includes(429),
    'and the two that are, are the two the shops actually send');
}

console.log('\n=== 4. THE ORDER IS THE ORDER OF CERTAINTY ===');
{
  // The puzzle first, because the page states the reason out loud. The dead end
  // last, because it is the only one inferred from prose.
  ok(whyTheShopIsRefusing({ isAPuzzle: true, statusCode: 503, isADeadEnd: true })
    === A_PUZZLE, 'all three at once answers the puzzle');
  ok(whyTheShopIsRefusing({ statusCode: 503, isADeadEnd: true })
    === TOO_MANY_ASKS, 'a code and a dead end answers the code');
  ok(whyTheShopIsRefusing({ isADeadEnd: true, statusCode: 200 })
    === A_DEAD_END, 'and the dead end answers only when nothing surer did');
}

console.log('\n=== 5. "WE CANNOT TELL" IS HELD BACK, AND THE NUMBER IS HIS ===');
{
  // 19:07:14 the cannot-tell screen appeared; 19:07:16 the gate worked out he was
  // signed in. TWO SECONDS. He was interrupted before we knew the answer.
  ok(HOLD_CANNOT_TELL_MS === 3000,
    'three seconds: the measured two second gap plus one second of margin');
  const at = (ms) => holdBackCannotTell({ gate: CANNOT_TELL, since: 0, now: ms });
  ok(at(0) === OPENING_UP, 'the instant it becomes true, the cover stays on');
  ok(at(2000) === OPENING_UP, 'AT THE MEASURED GAP it is still held back');
  ok(at(2999) === OPENING_UP, 'a millisecond before the hold is up');
  ok(at(3000) === CANNOT_TELL, 'and at three seconds it is shown');
  ok(at(9000) === CANNOT_TELL, 'and stays shown');
}

console.log('\n=== 6. AND IT CAN NEVER DELAY THE FAILED SCREEN ===');
{
  // THE OWNER ASKED FOR THIS IN THOSE WORDS. Somebody whose shop genuinely will
  // not open must not be made to wait three more seconds to be told so.
  for (const other of [FAILED, SIGNED_IN_NOW, SHOP, OPENING_UP, null]) {
    ok(holdBackCannotTell({ gate: other, since: 0, now: 0 }) === other,
      `${String(other)} is shown at once, never held`);
  }
  // `undefined` comes back as null, because that is the argument's own default,
  // and null is what the screen already means by "there is no gate here" — this
  // whole answer is null whenever the visit was not a sign in visit.
  ok(holdBackCannotTell({ gate: undefined, since: 0, now: 0 }) === null,
    'no gate at all answers no gate, and is certainly not held');
  ok(holdBackCannotTell() === null, 'and asked nothing at all, it answers nothing');
  // AND FAILED ARRIVES BY TWO ROADS. Both must be immediate.
  const shopSaidSo = whatIsOnScreen({ itWillNotOpen: true, startedAt: 0, now: 0 });
  ok(shopSaidSo === FAILED, 'the shop saying so reaches the failed screen');
  ok(holdBackCannotTell({ gate: shopSaidSo, since: 0, now: 0 }) === FAILED,
    '  and it is not held');
  const clockRanOut = whatIsOnScreen({ startedAt: 0, now: 999999 });
  ok(clockRanOut === FAILED, 'and our own clock running out reaches it too');
  ok(holdBackCannotTell({ gate: clockRanOut, since: 0, now: 0 }) === FAILED,
    '  and that is not held either');

  // IT IS WRITTEN AS ONE EQUALITY, NOT A LIST OF SCREENS TO HOLD.
  // A list is a thing somebody adds to; this cannot be added to by accident.
  const gateSrc = read('src/connect/gate.js');
  const held = gateSrc.slice(gateSrc.indexOf('export function holdBackCannotTell'));
  // FROM THE END OF THE SIGNATURE, and this is the second time today a slice
  // like this was wrong. The signature runs over three lines and ends `} = {}) {`,
  // so cutting at the first `\n}` cut the body off BEFORE the guard being checked
  // and the check passed on an empty string. Found by breaking the code.
  const opens = held.indexOf('} = {}) {');
  const body = held.slice(opens, held.indexOf('\n}', opens));
  ok(body.includes('return gate;'), 'the body was really found');
  ok(/if \(gate !== CANNOT_TELL\) return gate;/.test(body),
    'anything that is not the cannot-tell screen returns untouched, first thing');
  ok(!body.includes('FAILED'),
    'and the failed screen is not so much as mentioned inside it');
}

console.log('\n=== 7. and a hold with nothing to measure from never holds for ever ===');
{
  for (const noStart of [null, undefined, 'now', NaN, {}]) {
    ok(holdBackCannotTell({ gate: CANNOT_TELL, since: noStart, now: 0 }) === CANNOT_TELL,
      `no recorded start (${JSON.stringify(noStart) ?? String(noStart)}): shown rather than held for ever`);
  }
  ok(holdBackCannotTell({ gate: CANNOT_TELL, since: 5000, now: 0 }) === CANNOT_TELL,
    'and a clock that went backwards is not a reason to keep somebody waiting');
  ok(holdBackCannotTell({ gate: CANNOT_TELL, since: 0, now: 1000, holdMs: 500 })
    === CANNOT_TELL, 'and the hold length can be handed in, so it can be walked');
}

console.log('\n=== 8. THE SCREEN USES IT, AND COMES BACK BY ITSELF ===');
{
  const screen = read('src/ConnectScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/const gate = holdBackCannotTell\(\{/.test(code),
    'what is drawn is the held-back answer, not the raw one');
  ok(/gate: gateSays, since: cannotTellSince\.current, now: nowIs,/.test(code),
    'and it is given when the cannot-tell began');
  ok(/if \(gateSays === CANNOT_TELL\) \{\s*if \(cannotTellSince\.current == null\)/.test(code),
    'the moment is recorded once, the first time it becomes true');
  ok(/\} else \{\s*cannotTellSince\.current = null;/.test(code),
    'AND CLEARED when the gate says anything else, so a later one gets its own '
    + 'three seconds rather than inheriting a start from minutes ago');
  // WITHOUT A TIMER THE COVERED PAGE WOULD SIT THERE. The gate's inputs have
  // already settled, so nothing else would wake the screen.
  ok(/const left = HOLD_CANNOT_TELL_MS - \(Date\.now\(\) - began\);/.test(code),
    'and the screen wakes itself when the hold is up');
  ok(/setTimeout\(\(\) => setNowIs\(Date\.now\(\)\), left \+ 50\)/.test(code),
    'by the same shape as the fifteen second clock beside it');
}

console.log('\n=== 9. AND FAYR STILL NEVER TOUCHES A PUZZLE ===');
{
  // This file RECOGNISES one. Nothing here reads it, answers it, or looks inside
  // it, and a puzzle is the page where breaking that rule would be most tempting.
  const src = read('src/connect/shopRefusing.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const wayIn of [
    /\.value\s*=/, /dispatchEvent/, /\.submit\(/, /requestSubmit/,
    /document\./, /querySelector/, /\bfetch\s*\(/, /XMLHttpRequest/,
    /injectJavaScript/, /^import /m,
  ]) {
    ok(!code.match(wayIn), `it cannot ${String(wayIn)}`);
  }
  ok(!/console\./.test(code), 'and it writes nothing anywhere');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
