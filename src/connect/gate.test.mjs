// THE GATE OVER A SHOP'S PAGE, CHECKED UNDER NODE.
//
// The gate decides one thing: what is on screen while a shop's own sign in page
// is loading, and whether the shop's page is allowed to be seen at all. The whole
// reason it is a pure file with no React and no clock of its own is so that this
// check can put it through the moments a phone cannot be made to produce on
// demand: a shop that never answers, a shop that answers with a captcha, a clock
// that is not there, a page that posts something we never asked for.
//
// SO THE TABLES BELOW ARE EXHAUSTIVE ON PURPOSE. Every combination of the signals
// is listed and asserted, not a sample of them, because the failure this gate
// exists to stop is exactly the one nobody thought to try: some fourth thing the
// shop served getting through the cover and onto a person's screen.
//
// THE THREE BUGS THE OWNER FOUND ON A REAL PHONE on 5 September 2026 each have
// their own section, named after what he saw, so a change that brings one back
// fails with the symptom rather than with a rule number.
//
// NOTHING HERE TYPES ANYTHING INTO A SHOP'S PAGE, and nothing here can, because
// the gate has no way to. The facts are only ever a yes, a no, a path, or the
// words the shop itself printed.
import {
  ASK_THE_SHOP_AGAIN,
  A_DEAD_VIEW_SPOKE,
  BECAUSE_NOTHING_YET,
  BECAUSE_THEY_ARE_IN,
  BECAUSE_THE_SHOP_SAID_SO,
  BECAUSE_THE_SIGN_IN_IS_UP,
  BECAUSE_THE_SIGN_IN_WENT,
  BECAUSE_TIME_RAN_OUT,
  CANNOT_TELL,
  FAILED,
  NOT_A_SIGN_IN_VISIT,
  THEY_ARE_ALREADY_IN,
  THE_SHOP_REALLY_WILL_NOT_OPEN,
  THE_SIGN_IN_IS_UP,
  WE_ARE_ASKING_THEM,
  shopViewMayExist,
  shouldActOnFailure,
  whatDecidedIt,
  HOW_OFTEN_IT_LOOKS_MS,
  LOOKS_IN_A_ROW_BEFORE_WE_ASK,
  OPENING_UP,
  SHOP,
  SHOP_HAS_THIS_LONG_MS,
  SIGNED_IN_NOW,
  SIGNED_IN_SHOWS_FOR_MS,
  THEY_SAY_THEY_ARE_IN,
  isAPayingPage,
  isForTheGate,
  isTheShopsOwnSignInPage,
  pathOf,
  ranOutOfTime,
  shopMayBeSeen,
  shopViewKey,
  whatIsOnScreen,
  whatThePageShows,
  whatTheShopSaid,
  whatWeSay,
} from './gate.js';
import {
  DID_NOT_OPEN, EVERY_SENTENCE, I_HAVE_SIGNED_IN, NOT_SURE, OPENING, SIGNED_IN, TRY_AGAIN,
} from './gateWords.js';
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
  ok(whatIsOnScreen() === OPENING_UP, 'with no signals at all, our own loading screen is up');
  ok(whatIsOnScreen({}) === OPENING_UP, 'an empty set of signals is the same as none');
  ok(whatIsOnScreen({ startedAt: OPENED_AT, now: OPENED_AT }) === OPENING_UP,
    'and the moment it was asked to open is still the loading screen');
  ok(shopMayBeSeen(whatIsOnScreen()) === false,
    'so at the first moment the shop may not be seen');
}

console.log('\n=== 2. every combination of every signal, and the clock ===');
{
  // FOUR SIGNALS AND A CLOCK. Sixteen combinations of the signals, each of them
  // both in time and out of time, so thirty two rows and not one left to
  // judgement. The order of authority the gate keeps, top first:
  //
  //   they are in       the job is done, nothing else matters
  //   it will not open  the shop said so out loud
  //   the sign in has gone   our own screen, and a question
  //   the sign in is up the one and only thing that uncovers the shop
  //   the clock ran out
  //   otherwise         our own loading screen
  const rows = [];
  for (const up of [false, true]) {
    for (const gone of [false, true]) {
      for (const areIn of [false, true]) {
        for (const willNot of [false, true]) {
          for (const late of [false, true]) {
            const want = areIn ? SIGNED_IN_NOW
              : willNot ? FAILED
                : gone ? CANNOT_TELL
                  : up ? SHOP
                    : late ? FAILED : OPENING_UP;
            rows.push([up, gone, areIn, willNot, late, want]);
          }
        }
      }
    }
  }
  ok(rows.length === 32, 'thirty two rows, which is every combination and not a sample');
  let wrong = 0;
  for (const [up, gone, areIn, willNot, late, want] of rows) {
    const got = whatIsOnScreen({
      signInIsUp: up,
      signInIsGone: gone,
      theyAreIn: areIn,
      itWillNotOpen: willNot,
      startedAt: OPENED_AT,
      now: late ? OUT_OF_TIME : STILL_IN_TIME,
    });
    if (got !== want) {
      wrong += 1;
      console.log(`       up=${up} gone=${gone} in=${areIn} willNot=${willNot} late=${late}`
        + ` wanted ${want} got ${got}`);
    }
  }
  ok(wrong === 0, 'and every one of the thirty two answers is the one the order of authority gives');

  // The two that must never happen, said again on their own, because they are the
  // ones that put a shop's page in front of somebody.
  let uncovered = 0;
  for (const [up, gone, areIn, willNot, late] of rows) {
    const got = whatIsOnScreen({
      signInIsUp: up, signInIsGone: gone, theyAreIn: areIn, itWillNotOpen: willNot,
      startedAt: OPENED_AT, now: late ? OUT_OF_TIME : STILL_IN_TIME,
    });
    if (shopMayBeSeen(got) && !up) uncovered += 1;
  }
  ok(uncovered === 0, 'the shop is never uncovered unless its own sign in is up');
}

console.log('\n=== 3. the sign in beats the clock, which it did not before ===');
{
  // A SHOP THAT TOOK SIXTEEN SECONDS HAS STILL ANSWERED. The old order asked the
  // clock first, so a slow shop showed "The shop did not open" over its own
  // working sign in page, for ever, because nothing ever moved the clock back.
  const slow = whatIsOnScreen({
    signInIsUp: true, startedAt: OPENED_AT, now: OPENED_AT + 16_000,
  });
  ok(slow === SHOP, 'a shop whose sign in arrived after the wait is still shown');
  ok(shopMayBeSeen(slow) === true, 'and the person really can see it');
  ok(whatIsOnScreen({ signInIsGone: true, startedAt: OPENED_AT, now: OPENED_AT + 600_000 })
    === CANNOT_TELL,
  'and a sign in ten minutes long ends in the question, not in "it did not open"');
  ok(whatIsOnScreen({ startedAt: OPENED_AT, now: OUT_OF_TIME }) === FAILED,
    'but a shop that answered nothing at all still fails at fifteen seconds');
}

console.log('\n=== 4. the wait, and where the number comes from ===');
{
  ok(SHOP_HAS_THIS_LONG_MS === 15000, 'the shop gets fifteen seconds');
  ok(PAGE_TIMEOUT_MS === SHOP_HAS_THIS_LONG_MS,
    'which is the same wait livecheck gives a shop page');
  ok(LIST_TIMEOUT_MS === SHOP_HAS_THIS_LONG_MS,
    'and the same wait orderhistory gives a shop page');
  ok(ranOutOfTime(OPENED_AT, STILL_IN_TIME) === false, 'one millisecond short is not out of time');
  ok(ranOutOfTime(OPENED_AT, OUT_OF_TIME) === true, 'and the fifteenth second is');
  for (const bad of [null, undefined, NaN, Infinity, '1000', {}, []]) {
    ok(ranOutOfTime(bad, OUT_OF_TIME) === false, `a start of ${String(bad)} is never out of time`);
    ok(ranOutOfTime(OPENED_AT, bad) === false, `a now of ${String(bad)} is never out of time`);
  }
}

console.log('\n=== 5. BUG ONE. Try again really asks the shop again ===');
{
  // THE OWNER'S OWN WORDS: "IT STAYED ON THE FAILURE SCREEN. He tapped it several
  // more times. Nothing ever happened." Try again asked the web view to reload,
  // and a view whose load failed holds no page, so reload had nothing to fetch.
  // The remedy is a new view, and a new view is a changed key.
  ok(shopViewKey(0) !== shopViewKey(1), 'a second attempt is a different view from the first');
  ok(shopViewKey(1) !== shopViewKey(2), 'and a third is different from the second');
  ok(shopViewKey(2) !== shopViewKey(3), 'and a fourth from the third');
  const seen = new Set();
  for (let n = 0; n < 50; n += 1) seen.add(shopViewKey(n));
  ok(seen.size === 50, 'fifty attempts are fifty different views, so tapping never stops working');
  ok(shopViewKey(7) === shopViewKey(7), 'and the same attempt is always the same view');
  for (const bad of [null, undefined, NaN, Infinity, 'two', {}]) {
    ok(shopViewKey(bad) === shopViewKey(0), `an unreadable count of ${String(bad)} is the first view`);
  }
  ok(typeof shopViewKey(3) === 'string' && shopViewKey(3).length > 0,
    'and a key is always something a view can really be built under');
}

console.log('\n=== 6. is this the shop own sign in page ===');
{
  // Every one of these was opened in a real browser with a real iPhone user agent.
  const signInPages = [
    ['/ap/signin', 'where Amazon really lands from its own sign in address'],
    ['/ap/cvf/request', 'Amazon own second step, the code'],
    ['/ap/challenge', 'Amazon own second step, the challenge'],
    ['/ap/mfa', 'Amazon own second step, the extra check'],
    ['/ap/forgotpassword', 'Amazon own forgotten password page'],
    ['/gp/sign-in.html', 'the address Fayr opens for Amazon'],
    ['/login', 'Flipkart and Myntra'],
    ['/login?ret=%2F', 'and with the shop own parameters on it'],
    ['/auth', 'Meesho and Instamart'],
    ['/signin', 'the other spelling'],
    ['/sign-in', 'and the other other spelling'],
  ];
  for (const [path, why] of signInPages) {
    ok(isTheShopsOwnSignInPage(path) === true, `${path} is a sign in page (${why})`);
  }
  const notSignInPages = [
    ['/', 'a shop own home page'],
    ['/my-account', 'Flipkart own account page, which offers a way in but is not one'],
    ['/account/orders', 'Zepto own orders page'],
    ['/orders', 'Meesho own orders page'],
    ['/my/orders', 'Myntra own orders page'],
    ['/gp/css/order-history', 'Amazon own order list'],
    ['/loginhelp', 'a word that merely starts with the same letters'],
    ['/apple-watch', 'a shopping page that starts with the same two letters as Amazon portal'],
    ['/ap', 'the portal name with nothing under it'],
    ['/checkout', 'a checkout'],
    ['/product/authentic-leather-bag', 'a product whose name contains auth'],
  ];
  for (const [path, why] of notSignInPages) {
    ok(isTheShopsOwnSignInPage(path) === false, `${path} is NOT a sign in page (${why})`);
  }
  for (const bad of [null, undefined, 0, {}, []]) {
    ok(isTheShopsOwnSignInPage(bad) === false, `${String(bad)} is not a sign in page`);
  }
  ok(isTheShopsOwnSignInPage('login') === true, 'a path with no leading slash is still read');
}

console.log('\n=== 7. the path out of an address ===');
{
  ok(pathOf('https://www.amazon.in/ap/signin?openid.mode=x') === '/ap/signin',
    'the query is not part of the path');
  ok(pathOf('https://www.flipkart.com/') === '/', 'a bare shop address is the root');
  ok(pathOf('https://www.flipkart.com') === '/', 'and so is one with no slash at all');
  ok(pathOf('https://blinkit.com/#top') === '/', 'and a marker on the page is not part of it');
  for (const bad of [null, undefined, 42, {}, 'not an address', 'ftp://x/y']) {
    ok(pathOf(bad) === null, `${String(bad)} has no path we can read`);
  }
  ok(isTheShopsOwnSignInPage(pathOf('https://www.amazon.in/ap/cvf/verify')) === true,
    'and the two together answer Amazon second step correctly');
}

console.log('\n=== 8. a paying page is left completely alone ===');
{
  for (const path of ['/checkout', '/cart', '/payment', '/pay', '/order-payment']) {
    ok(isAPayingPage(path) === true, `${path} is a paying page`);
  }
  ok(isAPayingPage('/') === false, 'a home page is not');
  ok(isAPayingPage('/cartoons') === false, 'and neither is a page that merely starts with cart');
  ok(whatThePageShows({ path: '/checkout', signOutIsThere: true, signInWasUp: true }) === null,
    'and nothing at all is said about one, even when it shows a way out');
}

console.log('\n=== 9. BUG TWO. what a shop own page is really showing ===');
{
  // ── the two signs that always meant somebody is in ────────────────────────
  ok(whatThePageShows({ signOutIsThere: true, path: '/' }) === 'in',
    'a shop showing its own way out is a shop that let them in');
  ok(whatThePageShows({ greeting: 'Hello, Manisha Dahiya Orders', path: '/' }) === 'in',
    'and so is a shop greeting somebody by name');

  // ── AND THE GREETING THAT IS NOT A NAME, which used to say they were in ───
  ok(whatThePageShows({ greeting: 'Hello, sign in Account & Lists', path: '/' }) !== 'in',
    'Amazon "Hello, sign in" is a shop saying nobody is signed in');
  ok(whatThePageShows({ greeting: 'Hello, Guest', path: '/' }) !== 'in',
    'and so is "Hello, Guest"');
  ok(whatThePageShows({ greeting: 'Hello, there', path: '/' }) !== 'in',
    'and so is "Hello, there"');

  // ── the sign in being up ──────────────────────────────────────────────────
  ok(whatThePageShows({ fieldIsThere: true, path: '/' }) === 'up',
    'a box asking for a number is the sign in being up');
  ok(whatThePageShows({ path: '/login' }) === 'up',
    'and so is being on the shop own sign in address, which is the only signal Flipkart gives');

  // ── THE THIRD SIGN, AND EVERY CONDITION ON IT ─────────────────────────────
  const gone = {
    signInWasUp: true, fieldIsThere: false, signInControlIsThere: false,
    signOutIsThere: false, greeting: '', path: '/', isAPuzzle: false, looksInARow: 2,
  };
  ok(whatThePageShows(gone) === 'gone',
    'the sign in was up, it has gone, and the page offers no way back in');
  ok(whatThePageShows({ ...gone, signInWasUp: false }) === null,
    'but not when the sign in was never up in the first place');
  ok(whatThePageShows({ ...gone, path: '/login' }) === 'up',
    'and not while still on the shop own sign in page');
  ok(whatThePageShows({ ...gone, path: '/ap/cvf/request' }) === 'up',
    'and not in the middle of Amazon two step sign in');
  ok(whatThePageShows({ ...gone, fieldIsThere: true }) === 'up',
    'and not while a sign in box is still on screen');
  ok(whatThePageShows({ ...gone, isAPuzzle: true }) === null,
    'and never on a puzzle asking whether they are a person');
  ok(whatThePageShows({ ...gone, signInControlIsThere: true }) === null,
    'and never while the shop is offering a way in');
  ok(whatThePageShows({ ...gone, looksInARow: 1 }) === null,
    'and never on one look, so a page halfway through being rebuilt cannot count');
  ok(whatThePageShows({ ...gone, looksInARow: undefined }) === null,
    'and never when nobody counted the looks at all');
  ok(whatThePageShows({ ...gone, looksInARow: 5 }) === 'gone',
    'and still after five looks, because two is a floor and not a window');

  // ── THE REAL PAGES, MEASURED ON 6 SEPTEMBER 2026 ─────────────────────────
  // Flipkart own account page, signed out: it really does print "Log In". This
  // is what keeps somebody who backed out of the sign in from being read as in.
  ok(whatThePageShows({
    signInWasUp: true, signInControlIsThere: true, path: '/my-account', looksInARow: 9,
  }) === null, 'Flipkart own account page offers a way in, so nothing is said about it');
  // Zepto own orders page, signed out: it really does print "Login".
  ok(whatThePageShows({
    signInWasUp: true, signInControlIsThere: true, path: '/account/orders', looksInARow: 9,
  }) === null, 'Zepto own orders page offers a way in, so nothing is said about it');
  // Flipkart own home page, signed out OR signed in: no way in either way. This
  // is the page the owner was abandoned on, and it is why "gone" is a question
  // and never a claim that somebody is signed in.
  ok(whatThePageShows({
    signInWasUp: true, signInControlIsThere: false, path: '/', looksInARow: 2,
  }) === 'gone', 'Flipkart own home page ends in the question and not in a claim');
}

console.log('\n=== 10. every combination of the facts, and the rules that must hold ===');
{
  const greetings = ['', 'Hello, sign in Account & Lists', 'Hello, Manisha Dahiya'];
  const paths = ['/', '/login', '/checkout'];
  const every = [];
  for (const wasUp of [false, true]) {
    for (const field of [false, true]) {
      for (const wayIn of [false, true]) {
        for (const wayOut of [false, true]) {
          for (const puzzle of [false, true]) {
            for (const greeting of greetings) {
              for (const path of paths) {
                for (const looks of [1, 2]) {
                  every.push({
                    signInWasUp: wasUp, fieldIsThere: field, signInControlIsThere: wayIn,
                    signOutIsThere: wayOut, isAPuzzle: puzzle, greeting, path,
                    looksInARow: looks,
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  ok(every.length === 576, 'five hundred and seventy six combinations, which is all of them');

  const answers = every.map((f) => [f, whatThePageShows(f)]);
  const only = new Set(answers.map(([, a]) => a));
  ok([...only].every((a) => a === null || a === 'in' || a === 'up' || a === 'gone'),
    'and every answer is one of the three, or nothing');

  // THE RULES, EACH ONE STATED AS A THING THAT MUST NEVER HAPPEN.
  const never = [
    ['nothing at all is ever said about a puzzle', ([f, a]) => !(f.isAPuzzle && a !== null)],
    ['nothing at all is ever said about a paying page',
      ([f, a]) => !(isAPayingPage(f.path) && a !== null)],
    ['the sign in is never called gone while the shop offers a way in',
      ([f, a]) => !(a === 'gone' && f.signInControlIsThere)],
    ['the sign in is never called gone on the shop own sign in page',
      ([f, a]) => !(a === 'gone' && isTheShopsOwnSignInPage(f.path))],
    ['the sign in is never called gone when it was never up',
      ([f, a]) => !(a === 'gone' && !f.signInWasUp)],
    ['the sign in is never called gone on one look',
      ([f, a]) => !(a === 'gone' && f.looksInARow < LOOKS_IN_A_ROW_BEFORE_WE_ASK)],
    ['the sign in is never called gone while its own box is on screen',
      ([f, a]) => !(a === 'gone' && f.fieldIsThere)],
    ['nobody is ever called signed in without a way out or a real name',
      ([f, a]) => !(a === 'in' && !f.signOutIsThere && !/Manisha/.test(f.greeting))],
    ['a way out always means signed in, unless the page is one we leave alone',
      ([f, a]) => !(f.signOutIsThere && !f.isAPuzzle && !isAPayingPage(f.path) && a !== 'in')],
    ['a sign in box always means the sign in is up, unless they are already in',
      ([f, a]) => !(f.fieldIsThere && !f.isAPuzzle && !isAPayingPage(f.path)
        && a !== 'up' && a !== 'in')],
  ];
  for (const [why, holds] of never) {
    const broken = answers.filter((row) => !holds(row));
    if (broken.length > 0) console.log(`       first breach: ${JSON.stringify(broken[0])}`);
    ok(broken.length === 0, `${why} (across all ${answers.length})`);
  }
}

console.log('\n=== 11. the facts a shop page sends, turned into signals ===');
{
  const facts = (o) => ({ __fayrPage: o });
  // OUR OWN MEMORY IS THE SECOND ARGUMENT, and it is not in the message on
  // purpose: a shop's page that reloads gets a new script with no memory of the
  // page before it, so the memory has to be ours. See whatTheShopSaid.
  const said = (o, weSawASignIn = false) => whatTheShopSaid(facts(o), weSawASignIn);
  ok(isForTheGate(facts({ path: '/' })) === true, 'a message carrying page facts is ours');
  for (const notOurs of [
    null, undefined, 'up', 3, {}, { ok: true }, { __fayrPage: 'up' }, { __fayrPage: null },
    { items: [] }, { ok: false, error: 'Fetch failed.' },
  ]) {
    ok(isForTheGate(notOurs) === false,
      `${JSON.stringify(notOurs) ?? String(notOurs)} is not the gate business`);
  }

  const up = said({ fieldIsThere: true, path: '/login' });
  ok(up.signInIsUp === true, 'a sign in that is up says so');
  ok(up.theyAreIn === false, 'and does not say anybody is in');
  ok(up.signInIsGone === false, 'and does not say the sign in has gone');
  ok(up.accountName === null, 'and carries no name');

  const inNow = said({
    signOutIsThere: true, greeting: 'Hello, Manisha Dahiya Orders', path: '/',
  });
  ok(inNow.theyAreIn === true, 'a shop showing its own way out says they are in');
  ok(inNow.signInIsUp === false,
    'AND SAYS NO SIGN IN IS UP, because a shop greeting somebody shows them none');
  ok(inNow.signInIsGone === false, 'and does not say the sign in has gone');
  ok(inNow.accountName === 'Manisha Dahiya', 'and carries the name the shop printed');

  const goneNow = said({ path: '/', looksInARow: 2 }, true);
  ok(goneNow.signInIsGone === true, 'a sign in that has gone says so');
  ok(goneNow.signInIsUp === false, 'and says no sign in is up');
  ok(goneNow.theyAreIn === false, 'AND NEVER SAYS ANYBODY IS SIGNED IN');
  ok(goneNow.accountName === null, 'and carries no name');

  ok(said({ path: '/', isAPuzzle: true }, true) === null,
    'a puzzle is given no answer at all');
  ok(said({ path: '/' }) === null,
    'and neither is an ordinary shopping page nothing has happened on');
  ok(whatTheShopSaid({ ok: true, items: [] }) === null,
    'and a reader own result is never mistaken for one of ours');
  ok(whatTheShopSaid(null) === null, 'and nothing at all is given nothing at all');
  ok(said({ greeting: 'Hello, sign in', path: '/' }) === null,
    'and Amazon own "Hello, sign in" says nothing, because it is a shop saying nobody is in');

  // AND THE MEMORY IS OURS ALONE. A shop's own page claiming a sign in was up is
  // not enough: only our own side can say that, so a page asserting it is ignored.
  ok(said({ signInWasUp: true, path: '/', looksInARow: 9 }) === null,
    'a shop page saying for itself that a sign in was up is not believed');
  ok(said({ signInWasUp: false, path: '/', looksInARow: 9 }, true).signInIsGone === true,
    'and our own memory is what decides it, even against the page');
}

console.log('\n=== 12. what we say, and the controls under it ===');
{
  const opening = whatWeSay(OPENING_UP);
  ok(opening.sentence === OPENING, 'the loading screen says the loading sentence');
  ok(opening.controls.length === 0, 'and offers nothing to tap, because there is nothing to do');

  const failed = whatWeSay(FAILED);
  ok(failed.sentence === DID_NOT_OPEN, 'the failure says it did not open');
  ok(failed.controls.length === 1, 'and offers exactly one control');
  const onFailure = failed.controls[0] ?? { label: null, does: null };
  ok(onFailure.label === TRY_AGAIN, 'whose words are try again');
  ok(onFailure.does === ASK_THE_SHOP_AGAIN, 'and which asks the shop again');

  const asking = whatWeSay(CANNOT_TELL);
  ok(asking.sentence === NOT_SURE, 'the question says what we do and do not know');
  ok(!/signed in\.|you are signed in/i.test(asking.sentence),
    'AND NEVER CLAIMS THEY ARE SIGNED IN, because that is the thing we cannot tell');
  ok(asking.controls.length === 2, 'and offers two controls, one for each thing that may have happened');
  // READ THROUGH A HOLE THAT CANNOT THROW. Reading controls[1] straight would
  // CRASH this whole file the moment a control went missing, and a file that
  // crashes never reaches its own summary: every section after this one would
  // silently not run at all. That really happened once, and it hid twelve
  // worthless mutation results.
  const control = (at) => asking.controls[at] ?? { label: null, does: null };
  ok(control(0).label === I_HAVE_SIGNED_IN, 'the first is their own answer');
  ok(control(0).does === THEY_SAY_THEY_ARE_IN, 'and it records that they said so');
  ok(control(1).label === TRY_AGAIN, 'the second goes back to the shop');
  ok(control(1).does === ASK_THE_SHOP_AGAIN, 'and asks it again from nothing');

  const signedIn = whatWeSay(SIGNED_IN_NOW);
  ok(signedIn.sentence === SIGNED_IN, 'the signed in line says they are signed in');
  ok(signedIn.controls.length === 0, 'and offers nothing, because the screen is closing');

  ok(whatWeSay(SHOP) === null, 'and over the shop own page we say nothing at all');
  for (const bad of [undefined, null, '', 'nonsense', 0, {}, []]) {
    ok(whatWeSay(bad) === null, `${JSON.stringify(bad) ?? String(bad)} is given no words`);
  }

  // Every word on screen comes from the one file our side reads from disk.
  const said = [OPENING, DID_NOT_OPEN, TRY_AGAIN, SIGNED_IN, NOT_SURE, I_HAVE_SIGNED_IN];
  ok(new Set(said).size === 6, 'the six things a person can read are six different things');
  for (const one of said) {
    ok(EVERY_SENTENCE.includes(one), `"${one}" is in the one file our side reads`);
  }
  ok(EVERY_SENTENCE.length === 6, 'and the file holds those six and nothing else');
}

console.log('\n=== 13. BUG THREE. how often the page is looked at ===');
{
  ok(HOW_OFTEN_IT_LOOKS_MS === 300, 'the page is looked at every three hundred milliseconds');
  ok(HOW_OFTEN_IT_LOOKS_MS < 1500,
    'which is faster than the tap script, because this one only reads and never clicks');
  ok(HOW_OFTEN_IT_LOOKS_MS >= 100,
    'and not so fast that a heaviest page eleven milliseconds is a real share of the time');
  ok(SIGNED_IN_SHOWS_FOR_MS > HOW_OFTEN_IT_LOOKS_MS,
    'and the signed in line is up for longer than a look, so it is really seen');
  ok(SIGNED_IN_SHOWS_FOR_MS < 2000, 'and it is a breath, not a wait');
  ok(LOOKS_IN_A_ROW_BEFORE_WE_ASK === 2, 'and a sign in must be gone for two looks in a row');
}

console.log('\n=== 14. TEST THREE. the dying view last word, which is why Try again did nothing ===');
{
  // THE OWNER FOUND THIS ON A REAL PHONE ON 7 SEPTEMBER 2026, with the 5 September
  // Try again fix already in: airplane mode on, tap connect, get the failure,
  // airplane mode off, wait, tap Try again ONCE, and the same sentence came back.
  //
  // A view being torn down can still deliver one last failure, and a failure with
  // no attempt on it cannot be told from a failure about the attempt happening
  // now. The stamp is the whole answer, and every combination of it is here
  // because no phone can be made to produce a dead view speaking on demand.
  const live = { toSignIn: true, fromAttempt: 1, attemptNow: 1 };

  ok(shouldActOnFailure(live).act === true,
    'a failure from the view on screen right now is acted on, and the failure screen comes up');
  ok(shouldActOnFailure(live).why === THE_SHOP_REALLY_WILL_NOT_OPEN,
    'and it says so, so a log can never leave anybody guessing why it acted');

  ok(shouldActOnFailure({ ...live, fromAttempt: 0 }).act === false,
    'A FAILURE STAMPED WITH AN EARLIER ATTEMPT IS IGNORED. That is the dead view '
    + 'talking about a network that no longer exists, and acting on it puts the '
    + 'failure screen back over a shop that is loading perfectly well');
  ok(shouldActOnFailure({ ...live, fromAttempt: 0 }).why === A_DEAD_VIEW_SPOKE,
    'and it says which of the reasons it was, because an ignored event nobody can '
    + 'explain is how this survived two days');

  // Every stamp against every attempt, and only the matching pair may act.
  for (let stamped = 0; stamped <= 4; stamped += 1) {
    for (let onScreen = 0; onScreen <= 4; onScreen += 1) {
      const answer = shouldActOnFailure({ toSignIn: true, fromAttempt: stamped, attemptNow: onScreen });
      const shouldAct = stamped === onScreen;
      ok(answer.act === shouldAct,
        `a failure stamped ${stamped} while attempt ${onScreen} is on screen is `
        + `${shouldAct ? 'acted on' : 'ignored'}`);
    }
  }

  // A MISSING STAMP IS NOT A MATCH. Wiring one of the two handlers up and
  // forgetting to pass the attempt must not read as "current".
  ok(shouldActOnFailure({ toSignIn: true, attemptNow: 1 }).act === false,
    'a failure that carries no attempt at all is ignored, so a handler wired '
    + 'without the stamp fails loudly instead of quietly trusting everything');
  ok(shouldActOnFailure({ toSignIn: true, fromAttempt: 0, attemptNow: 0 }).act === true,
    'and the very first attempt, which is nought, still works');

  // The three that were already true before today, still true.
  ok(shouldActOnFailure({ ...live, theyAreIn: true }).why === THEY_ARE_ALREADY_IN,
    'somebody already signed in is never thrown away by a late failure');
  ok(shouldActOnFailure({ ...live, signInIsUp: true }).why === THE_SIGN_IN_IS_UP,
    'and a shop showing its own sign in plainly did open, whatever else it says');
  ok(shouldActOnFailure({ ...live, signInIsGone: true }).why === WE_ARE_ASKING_THEM,
    'and a question already on screen is not replaced by a sentence that is no longer true');
  ok(shouldActOnFailure({ ...live, toSignIn: false }).why === NOT_A_SIGN_IN_VISIT,
    'and a reading visit is not gated at all, so nothing here touches it');
  ok(shouldActOnFailure().act === false,
    'and asked nothing at all it acts on nothing');
}

console.log('\n=== 15. TEST THREE. while the failure is up, the shop view does not exist ===');
{
  // COVERING A DEAD VIEW IS NOT ENOUGH, because a covered view is still alive and
  // can still speak. The certain fix is that there is nothing there to speak: tap
  // Try again and a view is built from nothing.
  ok(shopViewMayExist(true, FAILED) === false,
    'ON A SIGN IN VISIT, the shop view is gone while the screen says it did not open');
  ok(shopViewMayExist(true, OPENING_UP) === true, 'it exists while the shop is opening');
  ok(shopViewMayExist(true, SHOP) === true, 'it exists when the shop own sign in is up, which is the point');
  ok(shopViewMayExist(true, CANNOT_TELL) === true,
    'and it stays while we are asking them, because the answer may still be yes '
    + 'and throwing the page away would take their sign in with it');
  ok(shopViewMayExist(true, SIGNED_IN_NOW) === true,
    'and it stays once they are in, because the cookies are in it');

  // A READING VISIT IS UNTOUCHED, in every state there is.
  for (const state of [OPENING_UP, SHOP, FAILED, CANNOT_TELL, SIGNED_IN_NOW]) {
    ok(shopViewMayExist(false, state) === true,
      `A READING VISIT KEEPS ITS VIEW IN ${state}. Unmounting there would reload the `
      + 'page and drop the shop session, which is the whole reason it stays mounted '
      + 'under the results screen');
  }
  ok(shopViewMayExist(undefined, FAILED) === true,
    'and anything that is not plainly a sign in visit is treated as a reading one, '
    + 'because that is the path that works today');
}

console.log('\n=== 16. TEST THREE. which of the five inputs decided it ===');
{
  // "The shop did not open" ARRIVES BY TWO ROADS and they look identical on a
  // phone: the shop saying so, and our own fifteen seconds running out. The owner
  // had been left guessing which one he was looking at.
  ok(whatDecidedIt({ itWillNotOpen: true }) === BECAUSE_THE_SHOP_SAID_SO,
    'the shop saying it could not open is one reason');
  ok(whatDecidedIt({ startedAt: OPENED_AT, now: OUT_OF_TIME }) === BECAUSE_TIME_RAN_OUT,
    'and our own clock running out is a DIFFERENT reason with the same sentence');
  ok(whatIsOnScreen({ itWillNotOpen: true })
    === whatIsOnScreen({ startedAt: OPENED_AT, now: OUT_OF_TIME }),
    'and both really do put the identical screen up, which is why naming them apart matters');

  ok(whatDecidedIt({ theyAreIn: true }) === BECAUSE_THEY_ARE_IN, 'being in is its own reason');
  ok(whatDecidedIt({ signInIsGone: true }) === BECAUSE_THE_SIGN_IN_WENT,
    'the sign in going away is its own reason');
  ok(whatDecidedIt({ signInIsUp: true }) === BECAUSE_THE_SIGN_IN_IS_UP,
    'the sign in being up is its own reason');
  ok(whatDecidedIt() === BECAUSE_NOTHING_YET, 'and nothing known yet is its own reason');

  // THE TWO CAN NEVER DISAGREE, and this is the check that says so. Every
  // combination of the four signals against in and out of time: the reason named
  // must be an input that is actually true, and it must be the one whatIsOnScreen
  // acted on.
  const STATE_OF = {
    [BECAUSE_THEY_ARE_IN]: SIGNED_IN_NOW,
    [BECAUSE_THE_SHOP_SAID_SO]: FAILED,
    [BECAUSE_THE_SIGN_IN_WENT]: CANNOT_TELL,
    [BECAUSE_THE_SIGN_IN_IS_UP]: SHOP,
    [BECAUSE_TIME_RAN_OUT]: FAILED,
    [BECAUSE_NOTHING_YET]: OPENING_UP,
  };
  const IS_REALLY_TRUE = {
    [BECAUSE_THEY_ARE_IN]: (f) => f.theyAreIn === true,
    [BECAUSE_THE_SHOP_SAID_SO]: (f) => f.itWillNotOpen === true,
    [BECAUSE_THE_SIGN_IN_WENT]: (f) => f.signInIsGone === true,
    [BECAUSE_THE_SIGN_IN_IS_UP]: (f) => f.signInIsUp === true,
    [BECAUSE_TIME_RAN_OUT]: (f) => f.now - f.startedAt >= SHOP_HAS_THIS_LONG_MS,
    [BECAUSE_NOTHING_YET]: () => true,
  };
  let agreed = 0;
  let named = 0;
  for (const theyAreIn of [false, true]) {
    for (const itWillNotOpen of [false, true]) {
      for (const signInIsGone of [false, true]) {
        for (const signInIsUp of [false, true]) {
          for (const now of [STILL_IN_TIME, OUT_OF_TIME]) {
            const facts = {
              theyAreIn, itWillNotOpen, signInIsGone, signInIsUp, startedAt: OPENED_AT, now,
            };
            const why = whatDecidedIt(facts);
            if (STATE_OF[why] === whatIsOnScreen(facts)) agreed += 1;
            if (IS_REALLY_TRUE[why](facts)) named += 1;
          }
        }
      }
    }
  }
  ok(agreed === 32,
    `THE REASON AND THE SCREEN AGREE IN ALL 32 COMBINATIONS (${agreed}). They cannot `
    + 'drift, because whatIsOnScreen is a lookup over this same answer rather than a '
    + 'second copy of the same five questions in the same order');
  ok(named === 32,
    `AND THE REASON NAMED IS ALWAYS AN INPUT THAT IS REALLY TRUE (${named}). A log `
    + 'that blames an input which was false is worse than no log at all');
}

console.log('\n=== 17. TEST THREE. three Try agains in a row are three different views ===');
{
  // The owner asked for three taps to work three times. The key is the only thing
  // that makes a view new, so three taps must be three keys.
  const keys = [0, 1, 2, 3].map((n) => shopViewKey(n));
  ok(new Set(keys).size === 4,
    `four attempts are four different views (${keys.join(', ')}), and a repeated key `
    + 'would be the same view asked to try harder, which is what did nothing at all');

  // AND EACH ONE GETS ITS OWN FIFTEEN SECONDS, counted from its own moment. A
  // second attempt that inherited the first one moment would be out of time the
  // instant it began.
  const tapped = [OPENED_AT, OPENED_AT + 20_000, OPENED_AT + 41_000];
  for (const at of tapped) {
    ok(whatIsOnScreen({ startedAt: at, now: at }) === OPENING_UP,
      `an attempt asked at ${at - OPENED_AT}ms in starts on the loading screen, not on the failure`);
    ok(whatIsOnScreen({ startedAt: at, now: at + SHOP_HAS_THIS_LONG_MS - 1 }) === OPENING_UP,
      'and is still waiting a millisecond before its own fifteen seconds are up');
    ok(whatIsOnScreen({ startedAt: at, now: at + SHOP_HAS_THIS_LONG_MS }) === FAILED,
      'and only then gives up, on its own clock and not on the first one');
  }
  // THE TRAP THIS RULES OUT: a second attempt that kept the first askedAt.
  ok(whatIsOnScreen({ startedAt: OPENED_AT, now: OPENED_AT + 20_000 }) === FAILED,
    'because an attempt still holding the FIRST moment would be failed before it '
    + 'began, which is exactly what a Try again that forgot to move the clock does');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
