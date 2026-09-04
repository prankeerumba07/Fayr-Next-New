// THE GATE OVER A SHOP'S PAGE, CHECKED UNDER NODE.
//
// The gate decides one thing: what is on screen while a shop's own sign in page
// is loading, and whether the shop's page is allowed to be seen at all. The whole
// reason it is a pure file with no React and no clock of its own is so that this
// check can put it through the moments a phone cannot be made to produce on
// demand: a shop that never answers, a shop that answers with a captcha, a clock
// that is not there, a page that posts something we never asked for.
//
// SO THE TABLE BELOW IS EXHAUSTIVE ON PURPOSE. Every combination of the four
// signals is listed and asserted, not a sample of them, because the failure this
// gate exists to stop is exactly the one nobody thought to try: some fourth thing
// the shop served getting through the cover and onto a person's screen.
//
// NOTHING HERE TYPES ANYTHING INTO A SHOP'S PAGE, and nothing here can, because
// the gate has no way to. The signals are only ever a yes or a no, and the one
// piece of text that goes in is the greeting the shop printed itself.
import {
  FAILED,
  OPENING_UP,
  SHOP,
  SHOP_HAS_THIS_LONG_MS,
  SIGNED_IN_NOW,
  SIGNED_IN_SHOWS_FOR_MS,
  isForTheGate,
  ranOutOfTime,
  shopMayBeSeen,
  whatIsOnScreen,
  whatTheShopSaid,
  whatWeSay,
} from './gate.js';
import { DID_NOT_OPEN, EVERY_SENTENCE, OPENING, SIGNED_IN, TRY_AGAIN } from './gateWords.js';
import { PAGE_TIMEOUT_MS } from '../livecheck.js';
import { LIST_TIMEOUT_MS } from '../orderhistory.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

// One fixed moment to count the wait from, so no test here depends on the real
// clock. The shop was asked to open at OPENED_AT and every "now" below is that
// moment plus however long we want to have passed.
const OPENED_AT = 1_000_000;
const STILL_IN_TIME = OPENED_AT + SHOP_HAS_THIS_LONG_MS - 1;
const OUT_OF_TIME = OPENED_AT + SHOP_HAS_THIS_LONG_MS;

console.log('=== 1. nothing known yet ===');
{
  // The first moment: the button has just been tapped, the shop has been asked to
  // open, and nothing at all has come back. Our own loading screen is up and the
  // shop's page is covered.
  ok(whatIsOnScreen() === OPENING_UP, 'with no signals at all, our own loading screen is up');
  ok(whatIsOnScreen({}) === OPENING_UP, 'an empty set of signals is the same as none');
  ok(whatIsOnScreen({ startedAt: OPENED_AT, now: OPENED_AT }) === OPENING_UP,
    'and the moment it was asked to open is still the loading screen');
  ok(shopMayBeSeen(whatIsOnScreen()) === false,
    'so at the first moment the shop may not be seen');
}

console.log('\n=== 2. every combination of the four signals ===');
{
  // FOUR SIGNALS, SIXTEEN COMBINATIONS, ALL OF THEM LISTED. The two states that
  // uncover or close the screen are the ones a shop must never be able to reach by
  // accident, so each row says what is on screen and why, and there is no row this
  // check leaves to judgement.
  //
  // The order of authority the gate keeps, top first:
  //   they are in     the job is done, nothing else matters
  //   it will not open  or the fifteen seconds ran out
  //   the sign in is up the one and only thing that uncovers the shop
  //   otherwise       our own loading screen
  const table = [
    // signInIsUp, theyAreIn, itWillNotOpen, ran out of time, what is on screen
    [false, false, false, false, OPENING_UP, 'still loading, nothing back yet'],
    [false, false, false, true, FAILED, 'the shop had its fifteen seconds and said nothing'],
    [false, false, true, false, FAILED, 'the shop said it could not open'],
    [false, false, true, true, FAILED, 'it said it could not open and the time ran out too'],
    [false, true, false, false, SIGNED_IN_NOW, 'in already, before any sign in was seen'],
    [false, true, false, true, SIGNED_IN_NOW, 'in already, and a slow clock does not undo it'],
    [false, true, true, false, SIGNED_IN_NOW, 'in already, and a failure does not undo it'],
    [false, true, true, true, SIGNED_IN_NOW, 'in already, and nothing at all undoes it'],
    [true, false, false, false, SHOP, 'the shop own sign in is up, so the cover comes off'],
    [true, false, false, true, FAILED, 'a sign in that only arrives after the time is too late'],
    [true, false, true, false, FAILED, 'a sign in is up but the shop says it could not open'],
    [true, false, true, true, FAILED, 'could not open and too late, sign in or no sign in'],
    [true, true, false, false, SIGNED_IN_NOW, 'being in beats the sign in being up'],
    [true, true, false, true, SIGNED_IN_NOW, 'being in beats the sign in and the clock'],
    [true, true, true, false, SIGNED_IN_NOW, 'being in beats the sign in and the failure'],
    [true, true, true, true, SIGNED_IN_NOW, 'being in beats every other signal at once'],
  ];
  ok(table.length === 16, 'all sixteen combinations are listed, not a sample of them');
  let sawTheShop = 0;
  for (const [signInIsUp, theyAreIn, itWillNotOpen, timedOut, wanted, why] of table) {
    const got = whatIsOnScreen({
      signInIsUp,
      theyAreIn,
      itWillNotOpen,
      startedAt: OPENED_AT,
      now: timedOut ? OUT_OF_TIME : STILL_IN_TIME,
    });
    ok(got === wanted, `${why} (${got})`);
    if (got === SHOP) sawTheShop += 1;
  }
  // THE POINT OF THE WHOLE TABLE. Out of sixteen ways the signals can land, there
  // is exactly ONE in which a person sees the shop's own page, and it is the one
  // where its sign in is up and nothing has gone wrong.
  ok(sawTheShop === 1, 'exactly one of the sixteen uncovers the shop page');
}

console.log('\n=== 3. being in wins over everything ===');
{
  // A person who is already signed in at the shop must not be shown a failure
  // screen. This is a real moment, not a theoretical one: they signed in on a
  // previous visit, the cookie is still good, and the shop greets them instead of
  // ever serving a sign in page.
  ok(whatIsOnScreen({ theyAreIn: true }) === SIGNED_IN_NOW,
    'being in on its own closes the screen');
  ok(whatIsOnScreen({ theyAreIn: true, itWillNotOpen: true }) === SIGNED_IN_NOW,
    'being in beats the shop saying it could not open');
  ok(whatIsOnScreen({ theyAreIn: true, startedAt: 0, now: 9_000_000_000 }) === SIGNED_IN_NOW,
    'being in beats a start time far in the past');
  ok(whatIsOnScreen({
    signInIsUp: false,
    theyAreIn: true,
    itWillNotOpen: true,
    startedAt: 0,
    now: 9_000_000_000,
  }) === SIGNED_IN_NOW, 'being in beats a failure and a dead clock together');
}

console.log('\n=== 4. it will not open wins over waiting ===');
{
  // When the shop itself says it could not load, there is nothing to wait for. The
  // failure sentence and the one button go up immediately rather than after the
  // person has watched a loading screen for the rest of the fifteen seconds.
  ok(whatIsOnScreen({ itWillNotOpen: true }) === FAILED,
    'a shop that said it could not open fails at once, with no clock at all');
  ok(whatIsOnScreen({ itWillNotOpen: true, signInIsUp: false }) === FAILED,
    'and it does not matter that no sign in was ever seen');
  ok(whatIsOnScreen({ itWillNotOpen: true, startedAt: OPENED_AT, now: OPENED_AT }) === FAILED,
    'it fails in the very first moment, long before the time is up');
  ok(whatIsOnScreen({ itWillNotOpen: true, startedAt: OPENED_AT, now: STILL_IN_TIME }) === FAILED,
    'it fails with one moment of the wait still left');
  ok(shopMayBeSeen(whatIsOnScreen({ itWillNotOpen: true, signInIsUp: true })) === false,
    'and a failed shop page is never uncovered, even with a sign in up');
}

console.log('\n=== 5. the fifteen seconds, counted exactly ===');
{
  ok(ranOutOfTime(OPENED_AT, OPENED_AT + SHOP_HAS_THIS_LONG_MS) === true,
    'exactly fifteen seconds is out of time');
  ok(ranOutOfTime(OPENED_AT, OPENED_AT + SHOP_HAS_THIS_LONG_MS - 1) === false,
    'one moment before fifteen seconds is not');
  ok(ranOutOfTime(OPENED_AT, OPENED_AT + SHOP_HAS_THIS_LONG_MS + 1) === true,
    'and past fifteen seconds stays out of time');
  ok(ranOutOfTime(OPENED_AT, OPENED_AT) === false, 'the first moment is not out of time');

  // A MISSING CLOCK MUST NEVER FAIL A WORKING SHOP. If we cannot tell how long it
  // has been, the honest answer is that the time has not run out, because saying
  // otherwise would put a failure screen over a sign in page that was loading
  // perfectly well.
  const cannotTell = [
    ['nothing at all', null, null],
    ['no start time', null, OPENED_AT],
    ['no now', OPENED_AT, null],
    ['a start time that is not set', undefined, OPENED_AT],
    ['a now that is not set', OPENED_AT, undefined],
    ['a start time in words', 'just now', OPENED_AT],
    ['a now in words', OPENED_AT, 'later'],
    ['a start time that is not a number', NaN, OPENED_AT],
    ['a now that is not a number', OPENED_AT, NaN],
    ['a start time with no end', -Infinity, OPENED_AT],
    ['a now with no end', OPENED_AT, Infinity],
    ['an object for a clock', { at: OPENED_AT }, OPENED_AT],
  ];
  for (const [what, startedAt, now] of cannotTell) {
    ok(ranOutOfTime(startedAt, now) === false, `${what} can never run out of time`);
  }
  ok(whatIsOnScreen({ signInIsUp: true, startedAt: null, now: null }) === SHOP,
    'so a shop whose sign in is up with no clock at all is still shown');
  ok(ranOutOfTime() === false, 'and called with nothing at all it is still not out of time');
}

console.log('\n=== 6. the shop page is uncovered for one state only ===');
{
  ok(shopMayBeSeen(SHOP) === true, 'the shop own sign in may be seen');
  ok(shopMayBeSeen(OPENING_UP) === false, 'a loading shop may not');
  ok(shopMayBeSeen(FAILED) === false, 'a failed shop may not');
  ok(shopMayBeSeen(SIGNED_IN_NOW) === false, 'and a shop we are already in may not');
  // Anything that is not one of the four is treated as not allowed. A state we do
  // not recognise must never be the one that uncovers a shop page.
  const junk = [undefined, null, '', 'Shop', 'SHOP', 'shopping', 0, 1, true, false, {}, [], { state: SHOP }, NaN];
  for (const value of junk) {
    ok(shopMayBeSeen(value) === false, `${JSON.stringify(value) || String(value)} does not uncover the shop`);
  }
}

console.log('\n=== 7. what our own screen says ===');
{
  // THE SENTENCES ARE IMPORTED, NEVER RETYPED. If a word in gateWords.js changes,
  // this check follows it, and the plain language check on our side is still the
  // one thing judging whether the new words are simple enough.
  const opening = whatWeSay(OPENING_UP);
  ok(opening.sentence === OPENING, 'the loading screen says the opening sentence');
  ok(opening.button === null, 'and there is nothing to tap while it loads');

  const failed = whatWeSay(FAILED);
  ok(failed.sentence === DID_NOT_OPEN, 'the failure screen says the did not open sentence');
  ok(failed.button === TRY_AGAIN, 'and it is the only screen with a button');

  const signedIn = whatWeSay(SIGNED_IN_NOW);
  ok(signedIn.sentence === SIGNED_IN, 'the signed in screen says the signed in sentence');
  ok(signedIn.button === null, 'and offers nothing to tap, because it closes itself');

  ok(whatWeSay(SHOP) === null, 'over the shop own page we say nothing at all');

  // Three of our own states, three sentences, and all three of them different. Two
  // states sharing a sentence would mean a person could not tell them apart.
  const said = [opening.sentence, failed.sentence, signedIn.sentence];
  ok(new Set(said).size === 3, 'the three sentences are three different sentences');
  ok(said.every((s) => EVERY_SENTENCE.includes(s)),
    'and every one of them is in the one file our side reads');
  ok(EVERY_SENTENCE.includes(TRY_AGAIN), 'so is the button, so the same rule reads it');

  // Nothing we do not recognise gets a sentence. A screen with no state has no
  // words rather than made up ones.
  for (const value of [undefined, null, '', 'nonsense', 0, {}, []]) {
    ok(whatWeSay(value) === null, `${JSON.stringify(value) || String(value)} is given no words`);
  }
  ok(SIGNED_IN_SHOWS_FOR_MS > 0 && SIGNED_IN_SHOWS_FOR_MS < SHOP_HAS_THIS_LONG_MS,
    'the signed in line is up for a breath, not for a wait');
}

console.log('\n=== 8. what the shop own page said, turned into signals ===');
{
  const up = whatTheShopSaid({ __fayrSignIn: 'up' });
  ok(up.signInIsUp === true, 'a sign in that is up says so');
  ok(up.theyAreIn === false, 'and it does not claim anybody is signed in');
  ok(up.accountName === null, 'and it carries no name');

  // A greeting is only ever believed alongside 'in'. A shop greeting somebody by
  // name while still showing them a sign in field is not something a real shop
  // does, so the name is dropped rather than believed.
  const upWithName = whatTheShopSaid({ __fayrSignIn: 'up', __fayrGreeting: 'Hello, Prakash Orders' });
  ok(upWithName.signInIsUp === true, 'a sign in with a greeting attached is still a sign in');
  ok(upWithName.theyAreIn === false, 'and still nobody is signed in');
  ok(upWithName.accountName === null, 'and the name is dropped, because no shop greets a stranger');

  const inWithName = whatTheShopSaid({ __fayrSignIn: 'in', __fayrGreeting: 'Hello, Prakash Orders' });
  ok(inWithName.theyAreIn === true, 'a page greeting somebody by name means they are in');
  ok(inWithName.accountName === 'Prakash',
    'and the name is read out of the greeting, with the page furniture left behind');
  // THE ONE THIS CHECK USED TO MISS, and it was a live trap. Being in and having a
  // sign in on screen are DIFFERENT THINGS: a shop greeting somebody by name is
  // showing them no sign in at all. Saying otherwise was harmless only because
  // being in is tested first in whatIsOnScreen. Reorder those two lines, or read
  // this one field on its own, and the gate would uncover a shop's already signed
  // in pages, which are somebody's orders and their saved cards.
  ok(inWithName.signInIsUp === false,
    'and it does NOT claim a sign in is on screen, because a greeting is not one');
  const inNoName = whatTheShopSaid({ __fayrSignIn: 'in' });
  ok(inNoName.signInIsUp === false, 'the same with no greeting at all');
  ok(inNoName.theyAreIn === true, '  and they are still in');

  // THE ONE THAT MATTERS MOST. "Hello, sign in" is a shop saying nobody is here.
  // It must never become a name, because that name goes on the card afterwards.
  const noName = whatTheShopSaid({ __fayrSignIn: 'in', __fayrGreeting: 'Hello, sign in' });
  ok(noName.theyAreIn === true, 'the page still said they are in');
  ok(noName.accountName === null, 'but a greeting with no name in it gives no name');

  const noGreeting = whatTheShopSaid({ __fayrSignIn: 'in' });
  ok(noGreeting.theyAreIn === true, 'being in does not depend on a greeting arriving');
  ok(noGreeting.accountName === null, 'and no greeting means no name');

  // ANYTHING WE DID NOT ASK FOR IS IGNORED OUTRIGHT. A shop's own page can post
  // whatever it likes at our screen, and none of it may reach the gate.
  const junk = [
    ['nothing at all', null],
    ['not set', undefined],
    ['a number', 42],
    ['a string', 'string'],
    ['an empty list', []],
    ['an empty object', {}],
    ['a signal we do not know', { __fayrSignIn: 'maybe' }],
    ['the reader own result', { ok: true }],
    ['a signal that is not words', { __fayrSignIn: true }],
    ['a signal that is a number', { __fayrSignIn: 1 }],
    ['a greeting with no signal', { __fayrGreeting: 'Hello, Prakash Orders' }],
  ];
  for (const [what, message] of junk) {
    ok(whatTheShopSaid(message) === null, `${what} tells the gate nothing`);
  }
}

console.log('\n=== 9. whose message is this anyway ===');
{
  // THE FAILURE THIS ONE STOPS. The connect screen already has a message handler
  // for the reader's own results, and that handler treats anything without `ok` as
  // a failed read. A gate message reaching it would print the words for a failure
  // on a screen where nothing failed, so the two are told apart here, first.
  ok(isForTheGate({ __fayrSignIn: 'up' }) === true, 'a sign in that is up is the gate business');
  ok(isForTheGate({ __fayrSignIn: 'in' }) === true, 'so is a page saying they are in');
  ok(isForTheGate({ __fayrSignIn: 'maybe' }) === true,
    'and so is a signal we do not know, so it is swallowed here and not shown as a failure');
  ok(isForTheGate({ __fayrSignIn: 'in', __fayrGreeting: 'Hello, Prakash Orders' }) === true,
    'a greeting alongside it changes nothing');

  const notOurs = [
    ['a good read', { ok: true, raw: {} }],
    ['a failed read', { ok: false, error: 'x' }],
    ['a clear', { __fayrClear: true }],
    ['nothing at all', null],
    ['not set', undefined],
    ['a number', 42],
    ['a string', 'string'],
    ['an empty list', []],
    ['an empty object', {}],
    ['a signal that is not words', { __fayrSignIn: true }],
    ['a signal that is a number', { __fayrSignIn: 0 }],
    ['a signal that is missing', { __fayrSignIn: null }],
    ['a greeting on its own', { __fayrGreeting: 'Hello, Prakash Orders' }],
  ];
  for (const [what, message] of notOurs) {
    ok(isForTheGate(message) === false, `${what} is left for the reader own handler`);
  }
}

console.log('\n=== 10. the three waits are one wait ===');
{
  // THE SAME FIFTEEN SECONDS IN THREE FILES, PINNED TOGETHER HERE. All three are a
  // web view being handed a shop's own page and being given a fair chance to load
  // it, so they must agree. If they drift, a shop that is judged too slow to sign
  // in at is still judged fast enough to read orders from, and the reason a person
  // saw one screen and not the other becomes unexplainable.
  //
  // So nobody can move one and leave the others behind: change one and this fails.
  ok(PAGE_TIMEOUT_MS === SHOP_HAS_THIS_LONG_MS,
    `the live check wait is the gate wait (${PAGE_TIMEOUT_MS})`);
  ok(LIST_TIMEOUT_MS === SHOP_HAS_THIS_LONG_MS,
    `the order list wait is the gate wait (${LIST_TIMEOUT_MS})`);
  ok(PAGE_TIMEOUT_MS === LIST_TIMEOUT_MS, 'and the other two agree with each other');
  ok(SHOP_HAS_THIS_LONG_MS === 15000, 'and the one wait is fifteen seconds');
}

console.log('\n=== 11. the gate writes no sentence of its own ===');
{
  // Every word a person reads on this screen lives in gateWords.js, in one file,
  // because our side's own plain language check opens that file from disk and reads
  // it. A sentence invented in the gate would never be read by that check, so the
  // owner's rule about simple words would quietly stop covering it.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./gate.js', import.meta.url), 'utf8');
  // Drop the comment lines first. They are long and plain English on purpose, and
  // they are not words anybody reads on a phone. Block comment lines go too, or
  // an apostrophe in the prose would be read as the start of a sentence.
  const code = source
    .split('\n')
    .filter((l) => {
      const line = l.trim();
      return !(line.startsWith('//') || line.startsWith('/*') || line.startsWith('*'));
    })
    .join('\n');
  const sentences = (code.match(/'[^'\n]*'|"[^"\n]*"/g) || []).filter((s) => {
    const inner = s.slice(1, -1);
    return (inner.match(/[a-z]+/g) || []).length >= 4;
  });
  ok(sentences.length === 0, `no sentence in the gate (found ${JSON.stringify(sentences)})`);
  // And the state names really are the short words they look like, not sentences
  // that slipped under the count above.
  for (const state of [OPENING_UP, SHOP, FAILED, SIGNED_IN_NOW]) {
    ok(typeof state === 'string' && !state.includes(' '),
      `the state name ${state} is one word, not something to read`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
