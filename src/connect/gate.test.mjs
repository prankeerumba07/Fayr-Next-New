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
  BECAUSE_NOTHING_WAS_CONCLUSIVE,
  BECAUSE_THE_SHOP_WENT_QUIET,
  BECAUSE_TIME_RAN_OUT,
  CANNOT_TELL,
  FAILED,
  NOT_A_SIGN_IN_VISIT,
  THEY_ARE_ALREADY_IN,
  THE_SHOP_REALLY_WILL_NOT_OPEN,
  THE_SIGN_IN_IS_UP,
  THE_SIGN_IN_WAS_UP,
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
  UNCOVER_THE_SHOP,
  isAPayingPage,
  isForTheGate,
  isTheShopsOwnSignInPage,
  pathOf,
  ranOutOfTime,
  shopMayBeSeen,
  thePageHasSpoken,
  shopViewKey,
  whatIsOnScreen,
  whatThePageShows,
  whatTheShopSaid,
  whatWeSay,
} from './gate.js';
import {
  DID_NOT_OPEN, EVERY_SENTENCE, I_HAVE_SIGNED_IN, NOT_SURE, OPENING, SHOW_ME_THE_SHOP,
  SIGNED_IN, TRY_AGAIN,
} from './gateWords.js';
// THE ONE PLACE A REASON BECOMES WORDS. Read here so a reason added without words
// fails, rather than printing its own name at somebody trying to read a phone.
import { whyInWords } from './gateLog.js';
// THE QUESTION THE NEW RULE IN SECTION 9b RESTS ON. Its two guarantees — a WHOLE
// label and a control that is really on screen — are what keep a shopping page
// covered, so they are held to here rather than trusted. See that section.
import { A_WAY_IN, A_WAY_OUT, WHOLE_LABEL } from './pageQuestions.js';
import { SIGN_IN_PATH } from './pageQuestions.js';
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
  // FOUR SIGNALS, A MEMORY AND A CLOCK. Thirty two combinations of the signals,
  // each of them both in time and out of time, so SIXTY FOUR rows and not one
  // left to judgement. The order of authority the gate keeps, top first:
  //
  //   they are in       the job is done, nothing else matters
  //   it will not open  the shop said so out loud
  //   the sign in has gone   our own screen, and a question
  //   the sign in is up the one and only thing that uncovers the shop
  //   the clock ran out AND the shop never answered
  //   otherwise         our own loading screen
  //
  // THE FIFTH LINE GREW A CLAUSE ON 15 SEPTEMBER 2026 and this table grew with
  // it. It was thirty two rows while there were five inputs; a sixth input left
  // it walking half of what it claims to walk, which is the one thing a table
  // calling itself exhaustive must never do.
  const rows = [];
  for (const up of [false, true]) {
    for (const gone of [false, true]) {
      for (const areIn of [false, true]) {
        for (const willNot of [false, true]) {
          for (const answered of [false, true]) {
            for (const late of [false, true]) {
              const want = areIn ? SIGNED_IN_NOW
                : willNot ? FAILED
                  : gone ? CANNOT_TELL
                    : up ? SHOP
                      : (late && !answered) ? FAILED : OPENING_UP;
              rows.push([up, gone, areIn, willNot, answered, late, want]);
            }
          }
        }
      }
    }
  }
  ok(rows.length === 64, 'sixty four rows, which is every combination and not a sample');
  let wrong = 0;
  for (const [up, gone, areIn, willNot, answered, late, want] of rows) {
    const got = whatIsOnScreen({
      signInIsUp: up,
      signInIsGone: gone,
      theyAreIn: areIn,
      itWillNotOpen: willNot,
      shopHasAnswered: answered,
      startedAt: OPENED_AT,
      now: late ? OUT_OF_TIME : STILL_IN_TIME,
    });
    if (got !== want) {
      wrong += 1;
      console.log(`       up=${up} gone=${gone} in=${areIn} willNot=${willNot}`
        + ` answered=${answered} late=${late} wanted ${want} got ${got}`);
    }
  }
  ok(wrong === 0, 'and every one of the sixty four answers is the one the order of authority gives');

  // AND THE MEMORY MOVES EXACTLY ONE ANSWER AND NO OTHER. If it changed anything
  // but the clock's own row it would be a second rule wearing the first one's
  // name, and this counts the rows it is allowed to move: the eight where the
  // clock was the thing deciding, and not one more.
  let moved = 0;
  for (const [up, gone, areIn, willNot, answered, late] of rows) {
    if (answered) continue;
    const off = whatIsOnScreen({
      signInIsUp: up, signInIsGone: gone, theyAreIn: areIn, itWillNotOpen: willNot,
      shopHasAnswered: false, startedAt: OPENED_AT, now: late ? OUT_OF_TIME : STILL_IN_TIME,
    });
    const on = whatIsOnScreen({
      signInIsUp: up, signInIsGone: gone, theyAreIn: areIn, itWillNotOpen: willNot,
      shopHasAnswered: true, startedAt: OPENED_AT, now: late ? OUT_OF_TIME : STILL_IN_TIME,
    });
    if (off !== on) moved += 1;
  }
  ok(moved === 1,
    `THE MEMORY CHANGES EXACTLY ONE ROW OF THE THIRTY TWO (${moved}), and that row is `
    + 'the only one the clock ever decided: all four signals false and the fifteen '
    + 'seconds gone. Being in, the shop refusing, the sign in going away and the sign '
    + 'in being up are every one of them untouched by it. Counted rather than claimed '
    + '— the first number written here was eight, and this measured it as one');

  // The two that must never happen, said again on their own, because they are the
  // ones that put a shop's page in front of somebody.
  let uncovered = 0;
  for (const [up, gone, areIn, willNot, answered, late] of rows) {
    const got = whatIsOnScreen({
      signInIsUp: up, signInIsGone: gone, theyAreIn: areIn, itWillNotOpen: willNot,
      shopHasAnswered: answered, startedAt: OPENED_AT, now: late ? OUT_OF_TIME : STILL_IN_TIME,
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
    'and never while the shop is still offering a way in, so nothing is said');
  ok(whatThePageShows({ ...gone, looksInARow: 1 }) === null,
    'and never on one look, so a page halfway through being rebuilt cannot count');
  ok(whatThePageShows({ ...gone, looksInARow: undefined }) === null,
    'and never when nobody counted the looks at all');
  ok(whatThePageShows({ ...gone, looksInARow: 5 }) === 'gone',
    'and still after five looks, because two is a floor and not a window');

  // ── THE REAL PAGES, MEASURED ON 6 SEPTEMBER 2026 ─────────────────────────
  // Flipkart own account page, signed out: it really does print "Log In". Once a
  // sign in HAS been seen in this attempt, a page still printing a way in is a
  // page somebody has moved on to, and nothing is said about it.
  ok(whatThePageShows({
    signInWasUp: true, signInControlIsThere: true, path: '/my-account', looksInARow: 9,
  }) === null, 'Flipkart own account page, after a sign in was seen, is not called gone');
  // Zepto own orders page, signed out: it really does print "Login". THE PAIR
  // BELOW IS THE WHOLE RULE IN TWO LINES, and the only thing that differs
  // between them is whether a sign in had already been up in this attempt.
  ok(whatThePageShows({
    signInWasUp: false, signInControlIsThere: true, path: '/account/orders', looksInARow: 9,
  }) === 'up', 'Zepto own orders page, before any sign in was seen, IS the sign in being up');
  ok(whatThePageShows({
    signInWasUp: true, signInControlIsThere: true, path: '/account/orders', looksInARow: 9,
  }) === null, 'and after one was seen, it is a page moved on to, so nothing is said');
  // Flipkart own home page, signed out OR signed in: no way in either way. This
  // is the page the owner was abandoned on, and it is why "gone" is a question
  // and never a claim that somebody is signed in.
  ok(whatThePageShows({
    signInWasUp: true, signInControlIsThere: false, path: '/', looksInARow: 2,
  }) === 'gone', 'Flipkart own home page ends in the question and not in a claim');
}

console.log('\n=== 9b. BUG. A SHOP WHOSE SIGN IN IS A PANEL, AND THE COVER OVER IT ===');
{
  // ── THE OWNER'S OWN DEVICE, 15 SEPTEMBER 2026, 19:21 ──────────────────────
  //
  //   PAGE SAID {"fieldIsThere":false,"signInControlIsThere":true,
  //              "signOutIsThere":false,"path":"/account/orders",
  //              "greeting":"Please Login\nPlease login to check orders.\n\nLogin\n"}
  //   PAGE SAID — NO SIGNAL IN IT   weSawASignIn=false
  //   GATE opening -> failed because ranOutOfTime [15062ms of 15000]
  //
  // Three attempts, the same three lines each time. The shop was printing its own
  // way in and asking him in its own words to use it, and our cover stayed on
  // over it until the clock ran out. He could not get past it, ever, on that shop.
  const theShopSaidPleaseLogin = {
    fieldIsThere: false,
    signInControlIsThere: true,
    signOutIsThere: false,
    path: '/account/orders',
    greeting: 'Please Login\nPlease login to check orders.\n\nLogin\n',
    looksInARow: 1,
    signInWasUp: false,
    isAPuzzle: false,
  };
  ok(whatThePageShows(theShopSaidPleaseLogin) === 'up',
    'THE SHOP IS OFFERING ITS OWN WAY IN, WHICH IS ITS SIGN IN BEING UP');
  // ...and it does not have to have been up before, which is what made this
  // unreachable: the panel has never been on screen, so nothing had ever seen
  // one. The log line above says weSawASignIn=false on every one of the three
  // attempts, so this is the fact the shop actually presented.
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, signInWasUp: true }) === null,
    'and ONLY before one has been seen \u2014 see the Amazon storefront below for why');
  // AND AT THE NEXT STEP OF THE SAME SEQUENCE. Tapping Login opens the panel, a
  // box appears, and the older rule takes over and keeps the cover off.
  ok(whatThePageShows({
    ...theShopSaidPleaseLogin, fieldIsThere: true, signInWasUp: true,
  }) === 'up', 'and once the panel is open its box answers, whatever was seen before');
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, looksInARow: 9 }) === 'up',
    'and on every look, not only the first');
  // AND THE FACT HAS TO BE THE WORD true AND NOT MERELY SOMETHING TRUE-ISH.
  // This one crosses JSON.parse out of a shop's own page, so what arrives is
  // whatever that page chose to send. The string "false" is a true-ish thing.
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, signInControlIsThere: 'false' }) === null,
    'and the word "false" sent as text is not a control, whatever it would be to an if');
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, signInControlIsThere: 1 }) === null,
    'and neither is a one');
  // AND NOTHING RECORDED MEANS NOTHING SEEN, which is the sentence the rule is
  // written in. whatTheShopSaid hands this one down as a real true or false and
  // defaults it to false, so today the two readings agree; this holds them to
  // agreeing, because a rule that reads "before a sign in has been seen" must
  // not change its mind when nobody has written down that none was.
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, signInWasUp: undefined }) === 'up',
    'and a sign in nobody recorded is a sign in nobody saw');

  // ── AND THE PAGE THIS COVER EXISTS FOR STAYS COVERED ──────────────────────
  //
  // Amazon's own shopping home page, SIGNED OUT, as a real browser measured it
  // on 15 September 2026 carrying this app's own DESKTOP_UA at a phone's width:
  // it prints "Hello, sign in" at the top of itself AND it carries six separate
  // controls whose whole label is exactly "Sign in" with a real width and
  // height. Four of those are the "See personalized recommendations" card, which
  // is not hidden by anything \u2014 it is simply below the fold.
  //
  // THE `true` BELOW IS THE MEASUREMENT AND NOT A CONVENIENCE. It used to say
  // false here, read off device log samples of this page that were all SIGNED
  // IN, and while it said false the two checks under it were tautologies: they
  // asked whether a page with no control was uncovered. They are the reason the
  // first version of this rule nearly shipped.
  const amazonShopping = {
    fieldIsThere: false,
    signInControlIsThere: true,
    signOutIsThere: false,
    path: '/',
    greeting: '.in\nDeliver to\nAll\nEN\nHello, sign in\nAccount & Lists\n\nReturns\n'
      + '& Orders\nCart\nAll\n\nFresh\nMobiles\nAmazon Pay\nToday\u2019s Deals\nGift Ideas',
    looksInARow: 9,
    signInWasUp: false,
    isAPuzzle: false,
  };
  // Fayr opens Amazon on its own sign in address, which answers "up" on the
  // address alone before any other page of Amazon's can be reached \u2014 so by the
  // time this storefront is in front of anybody, a sign in has been seen.
  ok(whatThePageShows({ ...amazonShopping, signInWasUp: true }) !== 'up',
    'A SHOPPING PAGE CARRYING A WAY IN IS STILL NOT A SIGN IN, and the cover stays on');
  ok(whatThePageShows({ ...amazonShopping, signInWasUp: true }) === null,
    'it says nothing at all about it, which is what it said before');
  // AND THE RISK THAT IS LEFT, PINNED WHERE IT CAN BE SEEN RATHER THAN WRITTEN
  // UP AS SAFETY. Reached before any sign in has been seen, this storefront
  // WOULD be uncovered. Amazon is out of reach of that only because of where
  // Fayr opens it. If this line ever starts failing, that is what changed.
  ok(whatThePageShows({ ...amazonShopping, signInWasUp: false }) === 'up',
    'and the honest cost: reached first, a storefront printing a way in is uncovered');
  // AND THE WORDS ARE NOT THE SIGNAL, WHICH IS WHY. Both pages ask somebody to
  // sign in IN WORDS. Only one of them offers a control whose whole label is one.
  ok(/sign in/i.test(amazonShopping.greeting) && /login/i.test(theShopSaidPleaseLogin.greeting),
    'both pages really do say it in words, so the words cannot be what tells them apart');

  // ── AND THE THINGS THAT OUTRANK IT STILL DO ───────────────────────────────
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, isAPuzzle: true }) === null,
    'nothing is said about a puzzle, whatever else is on it');
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, path: '/checkout' }) === null,
    'and nothing about a paying page');
  ok(whatThePageShows({ ...theShopSaidPleaseLogin, signOutIsThere: true }) === 'in',
    'and a shop showing a way OUT is still a shop that let them in');
  ok(whatThePageShows({
    ...theShopSaidPleaseLogin, greeting: 'Hello, Manisha Dahiya Orders',
  }) === 'in', 'and so is one greeting somebody by name');

  // ── AND THE TWO GUARANTEES THE WHOLE RULE RESTS ON ────────────────────────
  //
  // "up" takes our cover off. The reason a shopping page does not get uncovered
  // is not this file at all — it is what fayrWholeLabel asks of a control. Until
  // now NOTHING held that question to those two promises, so the safety of the
  // rule above lived in a script's prose. It lives here now.
  //
  // ONE: THE WHOLE LABEL, NEVER A PART OF ONE. Amazon prints "Hello, sign in"
  // in a single control on its shopping page. A question that asked whether a
  // label CONTAINED a way in would match it, and would uncover that page.
  ok(/text !== words\[w\] && aria !== words\[w\]/.test(WHOLE_LABEL),
    'the label must EQUAL the word, never contain it');
  for (const loose of ['indexOf(', '.includes(', '.match(', 'startsWith(', 'RegExp']) {
    ok(!WHOLE_LABEL.includes(loose),
      `fayrWholeLabel uses ${loose}, which can match a part of a label`);
  }
  ok(WHOLE_LABEL.includes('if (el.children.length > 1) continue;'),
    'and at most one thing inside it, so a wrapper holding the page cannot match');

  // TWO: IT HAS TO BE ON SCREEN. This is the one that does the work on Amazon.
  // Its markup really does carry nodes whose whole label is exactly "Sign in" —
  // the account flyout and the sign in tooltip — and the shop keeps both hidden
  // until somebody hovers. A question that did not ask for a size would find
  // them, and the cover would come off Amazon's shopping page.
  ok(WHOLE_LABEL.includes('getBoundingClientRect'), 'it asks the control for its size');
  ok(/box\.width > 0 && box\.height > 0/.test(WHOLE_LABEL),
    'and a control with no size is not a control anybody can tap');

  // AND THE FOUR WORDS ARE FOUR WORDS. Not "account", not "hello", not a phrase
  // a shopping page puts in its menu.
  ok(A_WAY_IN.length === 4 && A_WAY_IN.every((w) => w === w.toLowerCase() && w.length <= 7),
    `the ways in are four short words: ${A_WAY_IN.join(', ')}`);
  for (const word of A_WAY_IN) {
    ok(!A_WAY_OUT.includes(word), `"${word}" must not also be a way OUT`);
    ok(!/hello|account|orders|profile|menu/.test(word),
      `"${word}" is a word a shopping page puts in its own menu`);
  }
}

console.log('\n=== 9c. BUG. THE PAGE SPOKE, SAID NOTHING CONCLUSIVE, AND WAS BLAMED ===');
{
  // ── THE OWNER'S OWN DEVICE, 15 SEPTEMBER 2026, THE 19:31 AND 19:35 RUNS ───
  //
  //   PAGE SAID {"fieldIsThere":false,"signInControlIsThere":false,
  //              "signOutIsThere":false,"looksLikeAGreeting":false,
  //              "path":"/account/orders","looksInARow":2,"greeting":""}
  //   PAGE SAID — NO SIGNAL IN IT   weSawASignIn=false
  //   (nothing at all for the next thirteen seconds)
  //   GATE opening -> failed because ranOutOfTime [15082ms of 15000]
  //
  // Three attempts in each run, the same three lines every time. THIS IS NOT THE
  // "Please Login" CASE two sections up: signInControlIsThere is FALSE here and
  // the greeting is empty. Every one of the five signals was false, held steady
  // for two looks, and the page never changed again.
  const theShopDrewAndSaidNothing = {
    __fayrPage: {
      fieldIsThere: false,
      signInControlIsThere: false,
      signOutIsThere: false,
      looksLikeAGreeting: false,
      path: '/account/orders',
      looksInARow: 2,
      greeting: '',
    },
  };
  // FIRST, THAT NOTHING ABOVE READS A SIGNAL OUT OF IT. This is what made the
  // clock the only thing left to answer, and it is still the right reading.
  ok(whatTheShopSaid(theShopDrewAndSaidNothing, false) === null,
    'nothing conclusive really is nothing conclusive, and that reading is unchanged');
  ok(whatThePageShows(theShopDrewAndSaidNothing.__fayrPage) === null,
    'and the page shows nothing that settles anything');
  // AND YET THE PAGE HAS PLAINLY SPOKEN.
  ok(thePageHasSpoken(theShopDrewAndSaidNothing) === true,
    'THE SHOP DREW A PAGE AND OUR OWN WATCHER READ IT TWICE, which is speaking');

  // ── WHAT THAT NOW DECIDES, AT THE FIFTEEN SECOND MARK ────────────────────
  const at15 = { startedAt: OPENED_AT, now: OPENED_AT + SHOP_HAS_THIS_LONG_MS };
  ok(whatDecidedIt({ ...at15, pageHasSpoken: true }) === BECAUSE_NOTHING_WAS_CONCLUSIVE,
    'the reason is that nothing it said was conclusive, and it is named as itself');
  ok(whatIsOnScreen({ ...at15, pageHasSpoken: true }) === CANNOT_TELL,
    'A GATE THAT CANNOT TELL MUST NOT SAY THE SHOP REFUSED');
  ok(whatIsOnScreen({ ...at15, pageHasSpoken: true }) !== FAILED,
    'and never the screen whose only control is Try again, which he could not get past');
  // AND THE ONE CONTROL THAT SCREEN CARRIES IS THE WHOLE POINT OF IT. Offered
  // there and nowhere else, and only ever taken by somebody tapping it — which
  // is the difference between the two screens and the whole of why this bug
  // mattered. He was on the one that cannot be uncovered at all.
  ok(shopMayBeSeen(CANNOT_TELL, true) === true,
    'because that screen lets somebody ask to look at the shop with their own eyes');
  ok(shopMayBeSeen(FAILED, true) === false,
    'and the screen he was being sent to cannot be uncovered even when asked');
  ok(shopMayBeSeen(CANNOT_TELL) === false,
    'and it is still never uncovered FOR somebody who did not ask');

  // ── AND A SHOP THAT NEVER SPOKE STILL FAILS AT FIFTEEN SECONDS ───────────
  //
  // This is the only thing the fifteen seconds were ever for, and it is not
  // touched. If this line ever goes red, the clock has stopped catching the shop
  // that genuinely never answers.
  ok(whatDecidedIt({ ...at15, pageHasSpoken: false }) === BECAUSE_TIME_RAN_OUT,
    'a shop that never posted anything is still out of time at fifteen seconds');
  ok(whatIsOnScreen({ ...at15, pageHasSpoken: false }) === FAILED,
    'and is still told so, in the sentence that is true about it');

  // ── AND IT IS A FLOOR OF TWO LOOKS, NOT ONE ──────────────────────────────
  //
  // The same floor the rest of this file uses: a page rebuilt in pieces can be
  // photographed mid-rebuild, and one look is that photograph.
  const afterOneLook = { __fayrPage: { ...theShopDrewAndSaidNothing.__fayrPage, looksInARow: 1 } };
  ok(thePageHasSpoken(afterOneLook) === false,
    'one look is a page halfway through being drawn, and is not the page speaking');
  ok(thePageHasSpoken({ __fayrPage: { looksInARow: LOOKS_IN_A_ROW_BEFORE_WE_ASK } }) === true,
    'and the floor is the file own floor, not a second number beside it');

  // ── AND IT IS ASKED OF THE MESSAGE, NEVER OF OUR READING OF IT ───────────
  //
  // The whole defect was that the reading throws this page away. Anything that
  // makes this question depend on the reading puts the bug straight back.
  //
  // AND ASKED THROUGH A GUARD, so that a question which THROWS on a shape fails
  // here instead of killing the file. Found by a mutation on 15 September 2026:
  // dropping the isForTheGate guard made this whole section die with a TypeError,
  // the runner printed no summary, and every section after it never ran — which
  // is the exact shape this project has been bitten by before.
  const spoke = (m) => {
    try { return thePageHasSpoken(m); } catch (e) { return `it threw ${e.name}`; }
  };
  ok(spoke(null) === false, 'nothing is not a page speaking');
  ok(spoke(undefined) === false, 'and neither is nothing at all');
  ok(spoke({}) === false, 'and neither is a message with no page in it');
  ok(spoke({ __fayrPage: null }) === false, 'and neither is a page that is not there');
  ok(spoke({ __fayrPage: 'orders' }) === false, 'and neither is a page that is a word');
  ok(spoke({ __fayrPage: {} }) === false,
    'and neither is a page that counted no looks at all');
  ok(spoke({ __fayrPage: { looksInARow: '2' } }) === false,
    'and the count has to be a number, because this one crosses JSON.parse');
  ok(spoke({ __fayrPage: { looksInARow: Infinity } }) === false,
    'and a real one');
  ok(spoke({ __fayrPage: { looksInARow: 2 } }) === true,
    'and a page that counted two really is one, so the guard above refuses shapes '
    + 'rather than refusing everything');

  // ── AND EVERYTHING THAT OUTRANKS THE CLOCK STILL DOES ────────────────────
  //
  // The new reason sits at the very bottom, under both clocks. Anything that
  // reordered it above these would be a page saying nothing outranking a person
  // who is plainly signed in.
  ok(whatDecidedIt({ ...at15, pageHasSpoken: true, theyAreIn: true }) === BECAUSE_THEY_ARE_IN,
    'being in still wins over a page that said nothing');
  ok(whatDecidedIt({ ...at15, pageHasSpoken: true, itWillNotOpen: true })
    === BECAUSE_THE_SHOP_SAID_SO,
    'and the shop saying out loud that it will not open still wins');
  ok(whatDecidedIt({ ...at15, pageHasSpoken: true, signInIsUp: true })
    === BECAUSE_THE_SIGN_IN_IS_UP,
    'and a sign in on screen still wins');
  ok(whatDecidedIt({ ...at15, pageHasSpoken: true, signInIsGone: true })
    === BECAUSE_THE_SIGN_IN_WENT,
    'and a sign in that went still wins');
  // AND IT IS NEVER AN ANSWER BEFORE THE TIME IS UP. A page that speaks at three
  // seconds must leave the cover on and go on waiting, exactly as it does today.
  ok(whatDecidedIt({
    startedAt: OPENED_AT, now: OPENED_AT + 3000, pageHasSpoken: true,
  }) === BECAUSE_NOTHING_YET,
    'and a page that has spoken but still has time left is simply still opening');

  // ── AND IT IS NOT THE QUIET-SHOP REASON, WHICH MEANS SOMETHING ELSE ──────
  //
  // Both end on the same screen, which is exactly why they must not share a name:
  // shopWentQuiet says a sign in was once up and then went silent. Nothing was
  // ever up here. A log naming that would send the next person hunting for a sign
  // in that never existed.
  ok(BECAUSE_NOTHING_WAS_CONCLUSIVE !== BECAUSE_THE_SHOP_WENT_QUIET,
    'the two reasons that share the cannot-tell screen have names of their own');
  ok(whatDecidedIt({
    ...at15, pageHasSpoken: true, shopHasAnswered: true, quietSince: OPENED_AT,
  }) === BECAUSE_THE_SHOP_WENT_QUIET,
    'and a shop that DID show its sign in and then went quiet still says so');
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
    // THE ONE THAT KEEPS THE COVER ON A SHOPPING PAGE. "up" takes our cover off,
    // so it must always have a REASON on the page: a box, the shop's own sign in
    // address, or a control whose whole label is a way in. Words in a greeting
    // are not a reason — Amazon's shopping page says "Hello, sign in" to somebody
    // who is not signed in, and uncovering that is the thing the cover exists to
    // prevent.
    ['the sign in is never called up without a box, an address or a control',
      ([f, a]) => !(a === 'up' && !f.fieldIsThere && !f.signInControlIsThere
        && !isTheShopsOwnSignInPage(f.path))],
    // AND THE ONE THAT WOULD HAVE CAUGHT THE FIRST VERSION OF THAT RULE. A
    // control on its own may only ever speak for the FIRST page of an attempt.
    // Once a sign in has been seen, a control is somebody having moved on, and
    // a shopping page carrying one must not be uncovered on the strength of it
    // \u2014 which Amazon's signed out home page, measured, really does carry.
    ['a control alone never calls the sign in up once one has already been seen',
      ([f, a]) => !(a === 'up' && f.signInControlIsThere && !f.fieldIsThere
        && !isTheShopsOwnSignInPage(f.path) && f.signInWasUp)],
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
  ok(asking.controls.length === 3,
    'and offers three controls: one for each thing that may have happened, and one '
    + 'to look at the page itself');
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
  ok(control(2).label === SHOW_ME_THE_SHOP, 'and the third shows them the page itself');
  ok(control(2).does === UNCOVER_THE_SHOP, 'and it is the one thing that takes our cover off');

  const signedIn = whatWeSay(SIGNED_IN_NOW);
  ok(signedIn.sentence === SIGNED_IN, 'the signed in line says they are signed in');
  ok(signedIn.controls.length === 0, 'and offers nothing, because the screen is closing');

  ok(whatWeSay(SHOP) === null, 'and over the shop own page we say nothing at all');
  for (const bad of [undefined, null, '', 'nonsense', 0, {}, []]) {
    ok(whatWeSay(bad) === null, `${JSON.stringify(bad) ?? String(bad)} is given no words`);
  }

  // Every word on screen comes from the one file our side reads from disk.
  const said = [
    OPENING, DID_NOT_OPEN, TRY_AGAIN, SIGNED_IN, NOT_SURE, I_HAVE_SIGNED_IN, SHOW_ME_THE_SHOP,
  ];
  ok(new Set(said).size === 7, 'the seven things a person can read are seven different things');
  for (const one of said) {
    ok(EVERY_SENTENCE.includes(one), `"${one}" is in the one file our side reads`);
  }
  ok(EVERY_SENTENCE.length === 7, 'and the file holds those seven and nothing else');
  // AND EVERY LABEL A CONTROL CAN CARRY IS ONE OF THEM, walked from the gate's own
  // answer rather than from a list written here, so a control added with a word
  // typed straight into gate.js cannot slip past the rule on our side.
  for (const state of [OPENING_UP, FAILED, CANNOT_TELL, SIGNED_IN_NOW]) {
    const words = whatWeSay(state);
    for (const one of words.controls) {
      ok(EVERY_SENTENCE.includes(one.label),
        `the control "${one.label}" on the ${state} screen comes from the one file `
        + 'our side reads from disk, where the plain language rule can reach it');
    }
  }
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

  // ── BUG FIVE. "THE SHOP DID NOT OPEN" THE INSTANT CONTINUE IS TAPPED ──────
  //
  // WHAT HE SAW, ON THE SIMULATOR, 15 SEPTEMBER 2026. Amazon's own sign in was on
  // screen. He typed his mobile number, tapped Continue, and the failure sentence
  // arrived at once — before the password step, every time, for ever.
  //
  // THE LINE ABOVE ABOUT THE SIGN IN BEING UP WAS MEANT TO STOP THIS and was
  // already false by the time the failure arrived. The web view reports a
  // navigation at its START, carrying the address it is going TO, before a byte of
  // the answer exists. So tapping Continue tells the screen about a page that has
  // not loaded; the cover goes back on because that address is not the shop's own
  // sign in; signInIsUp is false. Amazon's answer then arrives with an error on
  // it, and a sign in still sitting on screen in front of the person counts for
  // nothing.
  const midSignIn = { ...live, signInIsUp: false, shopHasAnswered: true };
  ok(shouldActOnFailure(midSignIn).act === false,
    'A FAILURE ARRIVING AFTER THE COVER WENT BACK ON IS IGNORED while this attempt '
    + 'has seen the shop\'s own sign in, which is the whole of what he saw');
  ok(shouldActOnFailure(midSignIn).why === THE_SIGN_IN_WAS_UP,
    'and it says WHICH reason, so this is never confused in a log with the sign in '
    + 'being up right now, or with a dead view talking');

  // AND IT IS THE MEMORY DOING IT. The identical failure with nothing ever seen is
  // still acted on, so this cannot pass by accident on some other guard.
  ok(shouldActOnFailure({ ...live, signInIsUp: false, shopHasAnswered: false }).act === true,
    'the very same failure on an attempt that never saw a sign in IS still acted '
    + 'on, and the person still gets the sentence and the control');

  // THE STAMP STILL WINS, AND IT MUST. A dead view's last word is ignored as a
  // dead view's last word, with its own reason. Sliding the new question above the
  // stamp would bring the 7 September failure back wearing a different name.
  ok(shouldActOnFailure({ ...live, fromAttempt: 0, shopHasAnswered: true }).why
    === A_DEAD_VIEW_SPOKE,
    'a dead view talking is still a dead view talking, whatever this attempt has seen');
  ok(shouldActOnFailure({ ...live, toSignIn: false, shopHasAnswered: true }).why
    === NOT_A_SIGN_IN_VISIT,
    'and a reading visit is still not gated at all');

  // EVERY REASON IS STILL REACHABLE. The new question sits below the others on
  // purpose: put it higher and "we are already asking them" could never be the
  // answer again, because a sign in can only have GONE if it was once up. A reason
  // no input can produce is a reason that has quietly left the log.
  const REACHED = {
    [NOT_A_SIGN_IN_VISIT]: { toSignIn: false },
    [A_DEAD_VIEW_SPOKE]: { ...live, fromAttempt: 0 },
    [THEY_ARE_ALREADY_IN]: { ...live, theyAreIn: true, shopHasAnswered: true },
    [THE_SIGN_IN_IS_UP]: { ...live, signInIsUp: true, shopHasAnswered: true },
    [WE_ARE_ASKING_THEM]: { ...live, signInIsGone: true, shopHasAnswered: true },
    [THE_SIGN_IN_WAS_UP]: { ...live, shopHasAnswered: true },
    [THE_SHOP_REALLY_WILL_NOT_OPEN]: live,
  };
  for (const [reason, facts] of Object.entries(REACHED)) {
    ok(shouldActOnFailure(facts).why === reason,
      `${reason} is still an answer something can actually produce`);
    ok(whyInWords(reason) !== reason,
      `and ${reason} has words of its own in connect/gateLog.js, so a phone's window `
      + 'never shows somebody a bare name it cannot act on');
  }

  // AND EVERY COMBINATION, because the order of authority is the whole function.
  const ORDER = [
    ['toSignIn', (f) => f.toSignIn !== true, NOT_A_SIGN_IN_VISIT],
    ['stamp', (f) => f.fromAttempt !== f.attemptNow, A_DEAD_VIEW_SPOKE],
    ['theyAreIn', (f) => f.theyAreIn === true, THEY_ARE_ALREADY_IN],
    ['signInIsUp', (f) => f.signInIsUp === true, THE_SIGN_IN_IS_UP],
    ['signInIsGone', (f) => f.signInIsGone === true, WE_ARE_ASKING_THEM],
    ['shopHasAnswered', (f) => f.shopHasAnswered === true, THE_SIGN_IN_WAS_UP],
  ];
  let walked = 0;
  let agreedOnFailure = 0;
  for (const toSignIn of [false, true]) {
    for (const sameStamp of [false, true]) {
      for (const theyAreIn of [false, true]) {
        for (const signInIsUp of [false, true]) {
          for (const signInIsGone of [false, true]) {
            for (const shopHasAnswered of [false, true]) {
              const facts = {
                toSignIn,
                fromAttempt: 1,
                attemptNow: sameStamp ? 1 : 0,
                theyAreIn,
                signInIsUp,
                signInIsGone,
                shopHasAnswered,
              };
              const first = ORDER.find(([, holds]) => holds(facts));
              const want = first ? first[2] : THE_SHOP_REALLY_WILL_NOT_OPEN;
              const got = shouldActOnFailure(facts);
              walked += 1;
              if (got.why === want && got.act === (first == null)) agreedOnFailure += 1;
            }
          }
        }
      }
    }
  }
  ok(walked === 64, `sixty four combinations walked (${walked}), not a sample`);
  ok(agreedOnFailure === 64,
    `AND ALL SIXTY FOUR ANSWER WITH THE FIRST REASON THAT IS REALLY TRUE (${agreedOnFailure}), `
    + 'and act on nothing else. The order of authority is the whole of this function, '
    + 'so a reordering that looks harmless is caught here rather than on a phone');
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
    [BECAUSE_THE_SHOP_WENT_QUIET]: CANNOT_TELL,
    [BECAUSE_NOTHING_WAS_CONCLUSIVE]: CANNOT_TELL,
    [BECAUSE_NOTHING_YET]: OPENING_UP,
  };
  // AND A SILENCE THAT NEVER BEGAN IS NOT A LONG SILENCE. Written out rather than
  // subtracted, because `now - null` is `now` in this language, so a quiet moment
  // of nothing read as a silence that began at the start of time — which made two
  // of the rows below disagree and was caught by them rather than by reading.
  // The real ranOutOfTime guards itself the same way, which is the point: this is
  // a model of the rule and it has to refuse what the rule refuses.
  const wentQuiet = (f) => typeof f.quietSince === 'number'
    && Number.isFinite(f.quietSince)
    && f.now - f.quietSince >= SHOP_HAS_THIS_LONG_MS;
  const IS_REALLY_TRUE = {
    [BECAUSE_THEY_ARE_IN]: (f) => f.theyAreIn === true,
    [BECAUSE_THE_SHOP_SAID_SO]: (f) => f.itWillNotOpen === true,
    [BECAUSE_THE_SIGN_IN_WENT]: (f) => f.signInIsGone === true,
    [BECAUSE_THE_SIGN_IN_IS_UP]: (f) => f.signInIsUp === true,
    // AND THE CLOCK MAY ONLY BE BLAMED WHEN IT IS REALLY THE THING THAT ENDED
    // IT. A shop that has already shown us its own sign in has answered, so the
    // fifteen seconds are not a true statement about it however long ago they
    // expired. Without this clause the table below would happily accept
    // "ranOutOfTime" on an attempt where the shop answered in five seconds.
    // AND THE CLOCK MAY NOT BE BLAMED FOR A PAGE THAT SPOKE EITHER. "The shop
    // did not open" is a statement about a shop that never answered, and a page
    // our own watcher read twice in a row has answered whatever it said.
    [BECAUSE_TIME_RAN_OUT]: (f) => f.shopHasAnswered !== true
      && f.pageHasSpoken !== true
      && f.now - f.startedAt >= SHOP_HAS_THIS_LONG_MS,
    [BECAUSE_NOTHING_WAS_CONCLUSIVE]: (f) => f.shopHasAnswered !== true
      && f.pageHasSpoken === true
      && f.now - f.startedAt >= SHOP_HAS_THIS_LONG_MS,
    // AND "NOTHING YET" IS NOW A CLAIM AND NOT A SHRUG. It used to answer true
    // for anything, which meant a gate that wrongly fell through to the loading
    // screen was counted as honest. With a latch in the file that is the exact
    // mistake worth catching: a latch that fires when it should not lands here.
    [BECAUSE_THE_SHOP_WENT_QUIET]: (f) => f.shopHasAnswered === true && wentQuiet(f),
    [BECAUSE_NOTHING_YET]: (f) => f.theyAreIn !== true
      && f.itWillNotOpen !== true
      && f.signInIsGone !== true
      && f.signInIsUp !== true
      && !(f.shopHasAnswered === true && wentQuiet(f))
      && (f.shopHasAnswered === true || f.now - f.startedAt < SHOP_HAS_THIS_LONG_MS),
  };
  // A REASON THIS TABLE HAS NEVER HEARD OF MUST FAIL, NOT KILL THE FILE.
  //
  // FOUND BY A MUTATION ON 15 SEPTEMBER 2026, and it is the one this file already
  // warns about twenty lines up. A new reason was added to gate.js and not to the
  // table, and `IS_REALLY_TRUE[why](facts)` threw TypeError: not a function — so
  // the whole file died at this section and sections 17 to 20 never ran at all,
  // while the runner printed nothing anybody would read as a failure. That is the
  // shape that once made twelve mutation results worthless.
  const isReallyTrue = (why, facts) => (IS_REALLY_TRUE[why] ?? (() => false))(facts);
  let agreed = 0;
  let named = 0;
  let walked = 0;
  for (const theyAreIn of [false, true]) {
    for (const itWillNotOpen of [false, true]) {
      for (const signInIsGone of [false, true]) {
        for (const signInIsUp of [false, true]) {
          for (const shopHasAnswered of [false, true]) {
            for (const pageHasSpoken of [false, true]) {
              for (const quietSince of [null, OPENED_AT]) {
                for (const now of [STILL_IN_TIME, OUT_OF_TIME]) {
                  const facts = {
                    theyAreIn,
                    itWillNotOpen,
                    signInIsGone,
                    signInIsUp,
                    shopHasAnswered,
                    pageHasSpoken,
                    startedAt: OPENED_AT,
                    quietSince,
                    now,
                  };
                  const why = whatDecidedIt(facts);
                  walked += 1;
                  if (STATE_OF[why] === whatIsOnScreen(facts)) agreed += 1;
                  if (isReallyTrue(why, facts)) named += 1;
                }
              }
            }
          }
        }
      }
    }
  }
  ok(walked === 256, `two hundred and fifty six combinations walked (${walked})`);
  ok(agreed === walked,
    `THE REASON AND THE SCREEN AGREE IN ALL ${walked} COMBINATIONS (${agreed}). They cannot `
    + 'drift, because whatIsOnScreen is a lookup over this same answer rather than a '
    + 'second copy of the same questions in the same order');
  ok(named === walked,
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

console.log('\n=== 18. BUG FOUR. "The shop did not open" landed in the MIDDLE of a sign in ===');
{
  // ── WHAT HE SAW, ON THE SIMULATOR, 15 SEPTEMBER 2026 ──────────────────────
  //
  // Connecting an Amazon account was impossible. Amazon's own sign in appeared,
  // he typed his mobile number, tapped Continue, and "The shop did not open.
  // Please try again." landed before Amazon's password or code step ever came.
  // Try again built a new view and it happened again, for ever.
  //
  // THE FIFTEEN SECONDS WERE BEING ASKED THE WRONG QUESTION. They run from the
  // start of the attempt, and typing a phone number takes far longer than that,
  // so the clock had already expired while he typed. It only failed to bite
  // because signInIsUp is asked first and was true while the box was on screen.
  // The moment anything made that false for a single look, the next question was
  // a clock that expired while somebody was typing.
  const TYPED_FOR = 40_000;
  const SAW_THE_SIGN_IN_AT = OPENED_AT + 5_000;

  // THE ONE THAT WAS BROKEN. A sign in seen at five seconds, gone from view at
  // forty. Forty is well past fifteen, and this must not be the failure screen.
  const midSignIn = {
    signInIsUp: false,
    shopHasAnswered: true,
    startedAt: OPENED_AT,
    now: OPENED_AT + TYPED_FOR,
  };
  ok(whatDecidedIt(midSignIn) === BECAUSE_NOTHING_YET,
    'a shop that showed its own sign in at five seconds is not blamed on the clock '
    + 'at forty, because the clock only ever meant "it never answered at all"');
  ok(whatIsOnScreen(midSignIn) !== FAILED,
    'AND THE FAILURE SENTENCE DOES NOT LAND IN THE MIDDLE OF A WORKING SIGN IN, '
    + 'which is the whole of what he saw');
  ok(whatIsOnScreen(midSignIn) === OPENING_UP,
    'our own cover is what is up instead, which is the honest thing to show while '
    + 'the shop is between two of its own pages');

  // AND IT IS THE LATCH DOING IT, not the moment. The identical facts with the
  // latch off are still the failure, so this check cannot pass by accident on a
  // clock that was never expired in the first place.
  ok(whatIsOnScreen({ ...midSignIn, shopHasAnswered: false }) === FAILED,
    'the very same forty seconds with no sign in ever seen IS still the failure, '
    + 'so what changed the answer is the shop having answered and nothing else');

  // THE THING THE FIFTEEN SECONDS ARE ACTUALLY FOR, and it is untouched. A shop
  // that never shows a sign in at all still gives up at fifteen, to the
  // millisecond, and the person still gets the one control they can use.
  ok(whatIsOnScreen({ shopHasAnswered: false, startedAt: OPENED_AT, now: STILL_IN_TIME })
    === OPENING_UP,
    'a shop that has never answered is still being waited for at 14.999 seconds');
  ok(whatIsOnScreen({ shopHasAnswered: false, startedAt: OPENED_AT, now: OUT_OF_TIME })
    === FAILED,
    'AND STILL GIVES UP ON THE FIFTEENTH SECOND. The number was not lengthened, '
    + 'because lengthening it only moves the same failure onto whoever types slowest');
  ok(whatDecidedIt({ shopHasAnswered: false, startedAt: OPENED_AT, now: OUT_OF_TIME })
    === BECAUSE_TIME_RAN_OUT,
    'and it is still named as the clock, so a phone log still tells the two roads apart');
  ok(SHOP_HAS_THIS_LONG_MS === 15000,
    'and the fifteen seconds really are still fifteen seconds, not quietly widened');

  // THE LATCH IS PER ATTEMPT AND MUST NOT CARRY. Try again throws the view away
  // and builds a new one, and a new view has been shown nothing. If the memory
  // came with it, a second attempt at a shop that says NOTHING would wait for
  // ever and the person would never get the failure or the control.
  const SECOND_TRY_AT = OPENED_AT + 60_000;
  ok(whatIsOnScreen({
    shopHasAnswered: false, startedAt: SECOND_TRY_AT, now: SECOND_TRY_AT + SHOP_HAS_THIS_LONG_MS,
  }) === FAILED,
    'A SECOND ATTEMPT GETS ITS OWN FRESH FIFTEEN SECONDS AND ITS OWN FAILURE. The '
    + 'memory of the first attempt having seen a sign in must not survive the tap '
    + 'that threw that view away — src/connect/connect.test.mjs pins the one line '
    + 'in tryAgain that forgets it');
  ok(whatIsOnScreen({
    shopHasAnswered: true, startedAt: SECOND_TRY_AT, now: SECOND_TRY_AT + SHOP_HAS_THIS_LONG_MS,
  }) !== FAILED,
    'and that really is the thing that decides it, because carrying the memory over '
    + 'would have left this one waiting instead');

  // NOTHING ELSE MOVED. The latch stops ONE branch and no other, and these are
  // the three that must still end an attempt however long the shop has been up.
  for (const answered of [false, true]) {
    ok(whatDecidedIt({
      shopHasAnswered: answered, itWillNotOpen: true, startedAt: OPENED_AT, now: OUT_OF_TIME,
    }) === BECAUSE_THE_SHOP_SAID_SO,
      `the shop saying it will not open still ends it with the sign in seen=${answered}`);
    ok(whatDecidedIt({
      shopHasAnswered: answered, theyAreIn: true, startedAt: OPENED_AT, now: OUT_OF_TIME,
    }) === BECAUSE_THEY_ARE_IN,
      `and being in still ends it with the sign in seen=${answered}`);
    ok(whatDecidedIt({
      shopHasAnswered: answered, signInIsGone: true, startedAt: OPENED_AT, now: OUT_OF_TIME,
    }) === BECAUSE_THE_SIGN_IN_WENT,
      `and the sign in going away still asks the question with the sign in seen=${answered}`);
    ok(whatDecidedIt({
      shopHasAnswered: answered, signInIsUp: true, startedAt: OPENED_AT, now: OUT_OF_TIME,
    }) === BECAUSE_THE_SIGN_IN_IS_UP,
      `and a sign in on screen is still the shop's own page with the sign in seen=${answered}`);
  }

  // ── AND THE COST, WRITTEN DOWN RATHER THAN LEFT TO BE DISCOVERED ──────────
  //
  // This is a real change and not a free one. A shop that shows its own sign in
  // and is THEN killed silently — the network dies, the page never speaks again,
  // and the web view raises nothing — leaves the person on our own covered
  // loading screen with no failure and no control, where before they would have
  // been given the failure at fifteen seconds.
  //
  // THE OWNER CHOSE THAT, in these words: once the shop's own sign in has been
  // seen even once, only an explicit refusal or success may end the attempt. It
  // is the right way round, because the other way round ends a sign in that is
  // WORKING, and that is the bug above. Asserted so the trade is a decision in
  // the file and not a surprise on somebody's phone.
  ok(whatIsOnScreen({
    shopHasAnswered: true, startedAt: OPENED_AT, now: OPENED_AT + 10 * 60 * 1000,
  }) === OPENING_UP,
    'KNOWN AND CHOSEN: a shop that answered and then went silent leaves our own '
    + 'cover up rather than the failure, for as long as it stays silent');
}

console.log('\n=== 19. BUG SIX. ten minutes on the loading screen with nothing to press ===');
{
  // ── WHAT HE SAW, ON A REAL PHONE, 15 SEPTEMBER 2026 ───────────────────────
  //
  // He connected Amazon, typed his mobile number, tapped Continue, and sat on
  // "Opening the shop so you can sign in." for TEN MINUTES with no control at
  // all. This is the cost of the latch in section 18, named there when it was
  // built and found in the wild eight hours later: once the shop has answered the
  // first clock is dead, and only the shop refusing or this person being in can
  // end the attempt — and a page that says nothing does neither, for ever.
  //
  // A PAGE CAN GO QUIET AND MEAN IT. The watcher says nothing on a paying page or
  // a puzzle, both by design, so a shop's robot check posts nothing for that
  // page's whole life; and a connection that dies after the sign in was seen is
  // silent too, now that a late error is ignored.
  const WENT_QUIET_AT = OPENED_AT + 5_000;
  const quiet = (after, rest = {}) => ({
    shopHasAnswered: true,
    startedAt: OPENED_AT,
    quietSince: WENT_QUIET_AT,
    now: WENT_QUIET_AT + after,
    ...rest,
  });

  ok(whatDecidedIt(quiet(SHOP_HAS_THIS_LONG_MS)) === BECAUSE_THE_SHOP_WENT_QUIET,
    'a shop that answered and then said nothing for fifteen seconds is named as '
    + 'having gone quiet, which is its own fact and not the sign in going away');
  ok(whatDecidedIt(quiet(SHOP_HAS_THIS_LONG_MS - 1)) === BECAUSE_NOTHING_YET,
    'and a millisecond before that it is still just waiting');

  // AND THE SCREEN IS THE ONE THAT ASKS, NEVER THE ONE THAT BLAMES.
  ok(whatIsOnScreen(quiet(SHOP_HAS_THIS_LONG_MS)) === CANNOT_TELL,
    'THE SCREEN IS THE ONE THAT SAYS WE CANNOT TELL');
  ok(whatIsOnScreen(quiet(SHOP_HAS_THIS_LONG_MS)) !== FAILED,
    'AND NEVER THE FAILURE. "The shop did not open" would be false here and the '
    + 'person can tell: they watched it open and they typed into it');

  // THE WHOLE POINT: THE PERSON IS NEVER STUCK AGAIN. The screen it reaches is
  // the one that carries controls, and the loading screen is the one that does
  // not — which is exactly why the ten minutes had nothing to press.
  ok(whatWeSay(whatIsOnScreen(quiet(SHOP_HAS_THIS_LONG_MS))).controls.length === 3,
    'and that screen puts three things in front of them, so the ten minutes with '
    + 'nothing to press cannot happen again');
  ok(whatWeSay(OPENING_UP).controls.length === 0,
    'while the screen he was stranded on really does offer nothing, which is what '
    + 'made it a dead end rather than merely a wait');

  // IT IS THE SAME FIFTEEN SECONDS, NOT A NEW NUMBER. Counted from a different
  // moment, which is the whole of the difference between the two clocks.
  ok(SHOP_HAS_THIS_LONG_MS === 15000, 'and it is still fifteen seconds, unchanged');
  ok(whatIsOnScreen({
    shopHasAnswered: true, startedAt: OPENED_AT, quietSince: OPENED_AT + 3_600_000,
    now: OPENED_AT + 3_600_000 + SHOP_HAS_THIS_LONG_MS - 1,
  }) === OPENING_UP,
    'AN ATTEMPT AN HOUR OLD THAT WENT QUIET ONE SECOND AGO IS STILL BEING WAITED '
    + 'FOR. The second clock is counted from the silence and not from the start, '
    + 'which is the mistake the first clock was making');

  // AND IT DOES NOTHING AT ALL UNTIL THE SHOP HAS ANSWERED. Before that the first
  // clock is the one that decides, on its own moment, exactly as it always did.
  ok(whatDecidedIt({
    shopHasAnswered: false, startedAt: OPENED_AT, quietSince: WENT_QUIET_AT,
    now: WENT_QUIET_AT + SHOP_HAS_THIS_LONG_MS,
  }) === BECAUSE_TIME_RAN_OUT,
    'a shop that never answered is still blamed on the first clock and still gets '
    + 'the failure screen with its one control');

  // A SILENCE THAT NEVER BEGAN NEVER RUNS OUT.
  for (const never of [null, undefined, NaN, Infinity, '0', {}]) {
    ok(whatIsOnScreen({
      shopHasAnswered: true, startedAt: OPENED_AT, quietSince: never,
      now: OPENED_AT + 10 * 60 * 1000,
    }) === OPENING_UP,
      `a quiet moment of ${String(never)} never runs out, so a screen that has not `
      + 'recorded one cannot be timed out on a silence it never saw');
  }

  // AND IT MOVES NOTHING ELSE. The four above it still decide first, however long
  // the page has been quiet.
  const longQuiet = quiet(10 * 60 * 1000);
  ok(whatDecidedIt({ ...longQuiet, theyAreIn: true }) === BECAUSE_THEY_ARE_IN,
    'being in still wins over ten minutes of silence');
  ok(whatDecidedIt({ ...longQuiet, itWillNotOpen: true }) === BECAUSE_THE_SHOP_SAID_SO,
    'and the shop saying so still wins');
  ok(whatDecidedIt({ ...longQuiet, signInIsGone: true }) === BECAUSE_THE_SIGN_IN_WENT,
    'and the sign in going away is still its own reason, with its own name, even '
    + 'though it puts up the identical screen');
  ok(whatDecidedIt({ ...longQuiet, signInIsUp: true }) === BECAUSE_THE_SIGN_IN_IS_UP,
    'and a sign in back on screen is the shop talking again, not a silence');
}

console.log('\n=== 20. BUG SIX. the cover comes off only when the person asks ===');
{
  // HE COULD NOT SEE THE THING BLOCKING HIM. If Amazon was serving its robot
  // check, our own cover was over the one page he could have acted on. So there
  // is a control that takes it off — and taking it off is a thing he does, never
  // a thing Fayr decides.
  const EVERY_SCREEN = [OPENING_UP, SHOP, FAILED, CANNOT_TELL, SIGNED_IN_NOW];

  // THE DEFAULT IS UNCHANGED FOR EVERY SCREEN, and that is asserted screen by
  // screen rather than trusted: a caller that asks nothing gets exactly the answer
  // it got before this existed.
  for (const state of EVERY_SCREEN) {
    ok(shopMayBeSeen(state) === (state === SHOP),
      `asked nothing, ${state} is ${state === SHOP ? 'seen' : 'covered'}, exactly as before`);
  }

  // AND ASKING ONLY EVER UNCOVERS THE ONE SCREEN.
  for (const state of EVERY_SCREEN) {
    const may = shopMayBeSeen(state, true);
    ok(may === (state === SHOP || state === CANNOT_TELL),
      `having asked, ${state} is ${may ? 'seen' : 'still covered'} — and only the `
      + 'screen that admits we cannot tell may be uncovered by asking');
  }
  ok(shopMayBeSeen(OPENING_UP, true) === false,
    'THE SCREEN HE WAS STRANDED ON IS NOT ONE OF THEM. A loading screen that could '
    + 'be uncovered would put a shop page nobody has read in front of somebody '
    + 'while we still believe it is loading');
  ok(shopMayBeSeen(FAILED, true) === false,
    'and neither is the failure, where the view is thrown away entirely');

  // NOTHING BUT A REAL YES COUNTS. A missing prop, a truthy leftover, an object -
  // none of these are somebody tapping a control.
  for (const notATap of [undefined, null, false, 0, '', 1, 'yes', {}, []]) {
    ok(shopMayBeSeen(CANNOT_TELL, notATap) === false,
      `${JSON.stringify(notATap) ?? String(notATap)} is not somebody asking, so the `
      + 'shop stays covered');
  }
  ok(shopMayBeSeen(CANNOT_TELL, true) === true,
    'and only a plain yes uncovers it');

  // THE CONTROL THAT DOES IT EXISTS ON THAT SCREEN AND ON NO OTHER.
  for (const state of EVERY_SCREEN) {
    const words = whatWeSay(state);
    const offers = (words == null ? [] : words.controls).some((c) => c.does === UNCOVER_THE_SHOP);
    ok(offers === (state === CANNOT_TELL),
      `the ${state} screen ${state === CANNOT_TELL ? 'offers' : 'does not offer'} `
      + 'the control that takes our cover off');
  }
}

console.log('\n=== 21. BUG SEVEN. Amazon moved its password step to /ax/ ===');
{
  // ── FROM HIS OWN DEVICE LOG, 15 SEPTEMBER 2026 ────────────────────────────
  //
  //   16:59:02.657  LOAD STARTED  /ax/claim
  //   16:59:02.662  GATE shop -> opening   because stillOpening
  //   16:59:19.531  GATE opening -> cannotTell  because shopWentQuiet
  //
  // FIVE MILLISECONDS. He typed his mobile number on /ap/signin, tapped Continue,
  // and Amazon moved him to /ax/claim — its password step, carrying Password,
  // Forgot password? and Sign in with an OTP, with a real sign in box on it. That
  // address was not in the pattern, so the screen read Amazon's own second step as
  // leaving the sign in and put our cover back over a page that was working.
  //
  // THIS IS THE SECOND TIME THE SAME SHAPE HAS BITTEN. The pattern once named
  // ap/signin alone and broke at Amazon's step two; it named /ap/ and broke when
  // Amazon added a step outside it.
  for (const step of ['/ax/claim', '/ax/challenge', '/ax/claim/', '/ax/anything']) {
    ok(isTheShopsOwnSignInPage(step) === true,
      `${step} is Amazon's own sign in and the cover stays off it`);
  }

  // AND THE STEPS THAT ALREADY WORKED STILL DO, because a widening that broke the
  // old ones would trade one of these bugs for the other.
  for (const step of ['/ap/signin', '/ap/cvf/request', '/ap/challenge', '/ap/mfa',
    '/gp/sign-in.html', '/login', '/signin', '/sign-in', '/auth/login']) {
    ok(isTheShopsOwnSignInPage(step) === true, `${step} is still read as a sign in`);
  }

  // ── AND THE WORD BOUNDARY REALLY HOLDS, which is the whole reason the pattern
  // is anchored. "ax" is two letters and they begin a great many ordinary words.
  for (const notASignIn of ['/ax', '/axe', '/axis-bank', '/axes/blue', '/taxi',
    '/', '/gp/css/homepage.html', '/dp/B0F16X1NQ7', '/your-orders',
    '/errors_page/validateCaptcha', '/checkout', '/cart']) {
    ok(isTheShopsOwnSignInPage(notASignIn) === false,
      `${notASignIn} is NOT a sign in, so our own cover stays over it`);
  }

  // ── AND THE ANCHOR ITSELF, WHICH NOTHING HERE HAD BEEN TESTING ────────────
  //
  // FOUND BY BREAKING IT: taking the ^ off the pattern changed nothing that any
  // check noticed, because every address above happens not to contain a sign in
  // word further along it. The anchor's whole job is the addresses below, so
  // they have to be here or it is decoration.
  //
  // It matters because these read as a sign in ONLY without the anchor, and a
  // shopping page read as a sign in is a shopping page UNCOVERED — the cover
  // comes off for it, which is the one thing this gate exists to prevent.
  for (const deeperIn of ['/gp/product/auth', '/orders/ap/x', '/shop/ax/y',
    '/help/login', '/dp/B0F16X1NQ7/signin', '/gp/css/gp/sign-in']) {
    ok(isTheShopsOwnSignInPage(deeperIn) === false,
      `${deeperIn} has a sign in word in it but does not START with one, so it is `
      + 'an ordinary page and stays covered');
  }

  // THE RISK THE WIDENING CARRIES IS BOUNDED, and this is the check that says so.
  // A puzzle and a paying page are both asked about BEFORE this question, so
  // neither a robot check nor a checkout under /ax/ can be uncovered by it.
  ok(whatThePageShows({ path: '/ax/claim', isAPuzzle: true, fieldIsThere: true }) === null,
    'a robot check under /ax/ is still said nothing about, never uncovered');
  ok(whatThePageShows({ path: '/checkout', fieldIsThere: true }) === null,
    'and a paying page is still refused whatever else is on it');
  ok(whatThePageShows({ path: '/ax/claim', fieldIsThere: false, looksInARow: 9 }) === 'up',
    'while Amazon’s password step reads as the sign in being up, from its address '
    + 'alone, which is what stops the cover coming back on between two of its steps');

  // AND THE PATTERN IS STILL ONE PATTERN. src/connect/connect.test.mjs proves no
  // second copy of it exists anywhere; this proves the gate and the watcher are
  // really reading the same one rather than each holding its own idea.
  ok(new RegExp(SIGN_IN_PATH).test('/ax/claim'),
    'the exported pattern itself matches it, so the watcher inside the shop’s '
    + 'page and our own side cannot disagree about what a sign in page is');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
