// THE GATE OVER A SHOP'S PAGE. WHAT IS ON SCREEN, AND WHEN.
//
// ── THE FAILURE THIS EXISTS TO STOP ─────────────────────────────────────────
//
// Somebody taps "connect my Amazon account" and the next thing on screen is
// Amazon's shopping page, or Amazon's captcha, or Amazon's "install our app", or
// the web view library's own untranslated "Error loading page / Domain:
// NSURLErrorDomain / Error Code: -1009". A person watching a demo sees that and
// knows something is wrong, and a person using Fayr does not know what to do.
//
// SO THE SHOP'S PAGE IS COVERED UNTIL WE HAVE SEEN THE SHOP'S OWN SIGN IN. Not
// hidden after the fact: covered from the first moment, and uncovered only on a
// signal that says the sign in is really up. Anything else the shop tries to show
// is shown to nobody. AND COVERED AGAIN THE MOMENT THE SIGN IN GOES AWAY, which
// is the fix for the flash of Amazon's home page the owner saw on a real phone.
//
// ── FIVE THINGS ON SCREEN AND NO SIXTH ──────────────────────────────────────
//
//   opening     our own loading screen, one sentence. The shop is loading behind it.
//   shop        the shop's own sign in, and nothing of ours over it.
//   failed      our own one sentence and one button.
//   cannotTell  the sign in has gone and we cannot see whether it worked. Our own
//               sentence and two controls.
//   signedIn    our own one sentence, for a breath, then the screen closes.
//
// THE FIFTH ONE IS NEW AND IT IS THE OWNER'S OWN DECISION, taken on 6 September
// 2026 after a measurement killed the simpler idea. See whatThePageShows below
// for what was measured and why guessing was refused.
//
// ── PURE, AND THAT IS THE POINT ─────────────────────────────────────────────
//
// No React, no web view, no clock of its own: every moment is handed in. So every
// rule below can be checked under node, including the ones that only happen when
// something goes wrong, which are the ones a phone can never be made to do on
// demand. Same reason as ui/journey.js and ui/callUs.js.
//
// AND THE PAGE ITSELF DECIDES NOTHING. A shop's page gathers plain facts and hands
// them over; every decision made about them is in this file, where a check can
// reach it. See src/connect/pageQuestions.js for why the split is that way round.
//
// ── AND IT NEVER TYPES ANYTHING ─────────────────────────────────────────────
//
// Nothing in this file, and nothing in the screen that uses it, writes into a
// shop's page. It reads facts, each of which is only ever a yes, a no, a path or
// the words a shop printed itself, and it decides which of the five things above
// is on screen. The person types their own number and their own code on the
// shop's own page, and Fayr never sees either. connect-words.spec.ts on our side
// reads this file and proves it.

import { readAccountName } from '../signin.js';
import {
  DID_NOT_OPEN, I_HAVE_SIGNED_IN, NOT_SURE, OPENING, SIGNED_IN, TRY_AGAIN,
} from './gateWords.js';
import { PAYING_PATH, SIGN_IN_PATH } from './pageQuestions.js';

/**
 * HOW LONG THE SHOP GETS TO OPEN.
 *
 * FIFTEEN SECONDS, AND IT IS NOT A NUMBER CHOSEN FOR THIS SCREEN. It is the wait
 * Fayr already gives a shop's own page in two other places, both of them a web
 * view loading a shop:
 *
 *   src/livecheck.js      PAGE_TIMEOUT_MS
 *   src/orderhistory.js   LIST_TIMEOUT_MS
 *
 * The three are pinned to each other by gate.test.mjs, so nobody can move one and
 * leave the other two behind.
 *
 * WHY NOT SHORTER: an Indian mobile connection loading a shop's own sign in page,
 * which is a heavy page on every one of the seven, regularly takes more than ten
 * seconds. Giving up at five would make a working shop look broken.
 *
 * WHY NOT LONGER: a person who has tapped a button and seen nothing for fifteen
 * seconds has already decided it is broken. Spinning for thirty tells them
 * nothing they did not know at fifteen, and takes away the one thing they can do
 * about it.
 */
export const SHOP_HAS_THIS_LONG_MS = 15000;

/** How long the "you are signed in" line stays up before the page closes. */
export const SIGNED_IN_SHOWS_FOR_MS = 900;

/**
 * HOW OFTEN THE PAGE IS LOOKED AT, and it used to be every second and a half.
 *
 * THREE HUNDRED MILLISECONDS. The old number was copied from src/signinTap.js,
 * where a slow beat is right because that script CLICKS things and a fast one
 * would tap over whatever the person was doing. This one only reads, so the only
 * question is what a look costs.
 *
 * MEASURED, ON 6 SEPTEMBER 2026, in a real WebKit browser with a real iPhone user
 * agent and a real iPhone screen, running the app's own questions:
 *
 *   Flipkart's home page      1770 nodes, 1316 candidates   11    ms a look
 *   Blinkit's home page       1835 nodes, 1575 candidates    5.3  ms a look
 *   Amazon's sign in page      527 nodes,  110 candidates    1.15 ms a look
 *   Flipkart's account page    250 nodes,  126 candidates    0.5  ms a look
 *   Zepto's orders page        254 nodes,   18 candidates    0.05 ms a look
 *
 * ELEVEN MILLISECONDS EVERY THREE HUNDRED is under four hundredths of the time
 * available, on the heaviest page the app opens, and under half of one hundredth
 * on a sign in page, which is where the watcher actually spends its life. A phone
 * draws a frame every sixteen milliseconds and this never takes a whole one.
 *
 * AND IT ONLY LOOKS. It reads nothing anybody typed, taps nothing, and changes
 * nothing on the page, so looking more often cannot do anything to a sign in.
 */
export const HOW_OFTEN_IT_LOOKS_MS = 300;

/**
 * HOW MANY LOOKS IN A ROW BEFORE WE BELIEVE THE SIGN IN HAS GONE.
 *
 * TWO, and the owner asked for two by name: "it has been true for two looks in a
 * row, not one, so a page halfway through changing cannot be read as a sign in".
 * A shop's own page is rebuilt in pieces, and for one look in the middle of that
 * there can be no sign in box on it and no way in either.
 */
export const LOOKS_IN_A_ROW_BEFORE_WE_ASK = 2;

/** The five things that can be on screen. Nothing else ever is. */
export const OPENING_UP = 'opening';
export const SHOP = 'shop';
export const FAILED = 'failed';
export const CANNOT_TELL = 'cannotTell';
export const SIGNED_IN_NOW = 'signedIn';

/**
 * HOW LONG "WE CANNOT TELL" IS HELD BACK BEFORE IT IS SHOWN.
 *
 * ── THE NUMBER COMES OUT OF THE OWNER'S OWN LOG ────────────────────────────
 *
 * 9 September 2026. At 19:07:14 the cannot-tell screen appeared, and at 19:07:16
 * the gate worked out he was signed in. TWO SECONDS. He was interrupted by a
 * question about whether it had worked, two seconds before we knew that it had.
 *
 * So three seconds: the measured gap plus one second of margin. Not thirty,
 * because a person who really is stuck should not sit in front of a covered page
 * wondering; and not two, because the number measured once is the number that
 * will be exceeded.
 *
 * ── WHAT IT COSTS IF IT IS WRONG, WHICH IS WHY IT IS SAFE ──────────────────
 *
 * Waiting three seconds too long shows the covered "opening" page for three more
 * seconds. Not waiting shows a question that answers itself while somebody is
 * reading it. The first is a delay and the second is a screen that lies.
 */
export const HOLD_CANNOT_TELL_MS = 3000;

/** What a control on our own screen does. Never more than these two. */
export const ASK_THE_SHOP_AGAIN = 'tryAgain';
export const THEY_SAY_THEY_ARE_IN = 'confirm';

/**
 * THE FIVE INPUTS, NAMED, so a log can say which one decided and be believed.
 *
 * They are the ANSWER of whatDecidedIt and nothing reads them for a person: they
 * are words for whoever is reading a phone's log. The one that matters most is
 * the difference between the last two, because both of them put the same
 * sentence on screen and only one of them is the shop's own doing.
 */
export const BECAUSE_THEY_ARE_IN = 'theyAreIn';
export const BECAUSE_THE_SHOP_SAID_SO = 'itWillNotOpen';
export const BECAUSE_THE_SIGN_IN_WENT = 'signInIsGone';
export const BECAUSE_THE_SIGN_IN_IS_UP = 'signInIsUp';
export const BECAUSE_TIME_RAN_OUT = 'ranOutOfTime';
export const BECAUSE_NOTHING_YET = 'stillOpening';

/**
 * WHAT EACH REASON PUTS ON SCREEN. The whole of whatIsOnScreen is this table.
 *
 * TWO REASONS SHARE ONE SCREEN and that is the point of naming them apart: the
 * shop saying it could not open, and our own fifteen seconds running out, both
 * show "The shop did not open. Please try again." A person cannot tell them
 * apart and neither could we, until now.
 */
const STATE_FOR_REASON = {
  [BECAUSE_THEY_ARE_IN]: SIGNED_IN_NOW,
  [BECAUSE_THE_SHOP_SAID_SO]: FAILED,
  [BECAUSE_THE_SIGN_IN_WENT]: CANNOT_TELL,
  [BECAUSE_THE_SIGN_IN_IS_UP]: SHOP,
  [BECAUSE_TIME_RAN_OUT]: FAILED,
  [BECAUSE_NOTHING_YET]: OPENING_UP,
};

/**
 * HOLD "WE CANNOT TELL" BACK, BRIEFLY, AND HOLD NOTHING ELSE BACK EVER.
 *
 * Answers WHICH SCREEN TO ACTUALLY SHOW, given the one the gate decided and how
 * long it has been saying it.
 *
 * ── WHY ONLY THIS ONE SCREEN ───────────────────────────────────────────────
 *
 * Because "we cannot tell" is the only one of the five that can be WRONG A
 * MOMENT LATER. It is reached when the shop's sign in box has gone and the shop
 * will not say whether it worked, and one of the things that looks exactly like
 * that is a sign in which HAS worked and has not been recognised yet — the shop
 * rebuilds its page in pieces, and for a look or two in the middle there is no
 * box and no way in either. The other four are all settled: they are in, the box
 * is up, the shop said it would not open, or the clock ran out.
 *
 * ── AND IT CAN NEVER DELAY THE FAILED SCREEN. THE OWNER ASKED FOR THAT ─────
 *
 * Written as a single equality against CANNOT_TELL rather than a list of screens
 * to hold or not hold. A list is a thing somebody adds to; this cannot be added
 * to by accident. FAILED arrives by two roads — the shop saying so, and our own
 * fifteen seconds running out — and somebody whose shop genuinely will not open
 * must not be made to wait three more seconds to be told so.
 *
 * While it is held back, the screen shown is OPENING_UP: the cover stays on, the
 * page underneath is still loading as far as anybody can see, and nothing has
 * been claimed. That is the honest thing to show while we do not yet know.
 */
export function holdBackCannotTell({
  gate = null, since = null, now = null, holdMs = HOLD_CANNOT_TELL_MS,
} = {}) {
  if (gate !== CANNOT_TELL) return gate;
  // NO MOMENT MEANS NO HOLDING. If nothing recorded when this began we cannot
  // say how long it has been, and inventing a start would hold the screen back
  // for ever. Showing it is the answer that always ends.
  if (typeof since !== 'number' || !Number.isFinite(since)) return gate;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  // A clock that went backwards is not a reason to keep somebody waiting.
  if (at < since) return CANNOT_TELL;
  return at - since < holdMs ? OPENING_UP : CANNOT_TELL;
}

/**
 * THE KEY THE SHOP'S PAGE IS BUILT UNDER, and why asking it to reload is not enough.
 *
 * THE OWNER FOUND THIS ONE ON A REAL PHONE, 5 September 2026. Airplane mode on,
 * tap connect, wait, get "The shop did not open. Please try again." Airplane mode
 * off, wait for the network, tap Try again. NOTHING HAPPENED, however many times
 * he tapped it.
 *
 * HIS DIAGNOSIS WAS RIGHT. Try again asked the web view to reload, and a web view
 * whose load FAILED is holding no page: there is nothing committed to reload, so
 * reload returns having done nothing at all and the failure it is still holding is
 * reported straight back. The remedy is not to ask the old view to try harder. It
 * is to throw it away and build a new one, which is what a changed key does.
 *
 * So Try again counts up, this turns the count into a key, and a key that has
 * changed makes the whole view new: a new page, a new request to the shop, a new
 * watcher, and a new fifteen seconds.
 */
export function shopViewKey(attempt) {
  const n = typeof attempt === 'number' && Number.isFinite(attempt) ? attempt : 0;
  return `shop-${n}`;
}

/**
 * IS THIS THE SHOP'S OWN SIGN IN PAGE?
 *
 * ONE ANSWER, IN ONE PLACE, and the owner named the reason: it was written out
 * twice, in the watcher and in the tap script, "and a third copy in the screen is
 * how they start disagreeing". The pattern itself lives in pageQuestions.js
 * because the tap script has to put it inside a shop's page as text.
 *
 * ── HOW THE MULTI STEP SIGN IN WAS MADE SAFE ────────────────────────────────
 *
 * Amazon asks for the number on one page and then moves the person to another
 * page of its own for the password or the code. BOTH ARE ITS OWN SIGN IN PAGES,
 * so our cover must not come back on between them, and the screen uses exactly
 * this question to decide. It is safe because the pattern in pageQuestions.js
 * matches Amazon's whole authentication portal and not only its first page: every
 * step of an Amazon sign in is under /ap/, which was opened and read on
 * 6 September 2026 rather than assumed. The old pattern named /ap/signin alone,
 * and with that the cover really would have flashed on at Amazon's second step.
 */
export function isTheShopsOwnSignInPage(path) {
  if (typeof path !== 'string') return false;
  const where = path.charAt(0) === '/' ? path : `/${path}`;
  return new RegExp(SIGN_IN_PATH).test(where);
}

/**
 * THE PATH PART OF AN ADDRESS, or null when it is not one we can read.
 *
 * The screen is handed a whole address by the web view and every question above
 * takes a path, so the taking apart happens once, here, where it is checked.
 */
export function pathOf(url) {
  if (typeof url !== 'string') return null;
  const m = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url.trim());
  if (!m) return null;
  return m[1] == null || m[1] === '' ? '/' : m[1];
}

/** A checkout, a cart or a payment page. Nothing is read on one and none is covered. */
export function isAPayingPage(path) {
  if (typeof path !== 'string') return false;
  const where = path.charAt(0) === '/' ? path : `/${path}`;
  return new RegExp(PAYING_PATH).test(where);
}

/**
 * The signals, and every one of them is only ever a yes or a no.
 *
 *   signInIsUp     the shop's own sign in is on screen. Either its address is the
 *                  shop's own sign in, or the shop's own page put a box asking
 *                  for a number or an email on screen.
 *   signInIsGone   the sign in WAS up and is not any more, and the page does not
 *                  say whether it worked. See whatThePageShows.
 *   theyAreIn      the shop's own page says this person is signed in. Never a
 *                  guess: see whatThePageShows.
 *   itWillNotOpen  the shop said it could not.
 *   startedAt      when the shop was asked to open, so the wait can be counted.
 */
export function whatIsOnScreen(facts = {}) {
  return STATE_FOR_REASON[whatDecidedIt(facts)];
}

/**
 * WHICH ONE OF THE FIVE INPUTS DECIDED IT, in a word.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS THE SAME CODE AND NOT A SECOND COPY ──────
 *
 * The owner asked, on 7 September 2026, to be able to read off a real phone which
 * input put the screen where it is, because "The shop did not open" is one
 * sentence with TWO different causes behind it: the shop saying so, and our own
 * clock running out. On a phone they look identical, and he had been left guessing
 * which one he was looking at.
 *
 * IT WOULD HAVE BEEN EASY TO GET THIS WRONG. The obvious way is a second function
 * that repeats the same five questions in the same order for the log. That is a
 * copy, and a copy drifts: the day somebody reorders one, the log starts naming an
 * input that did not decide anything, which is worse than no log at all. So the
 * order lives HERE, once, and whatIsOnScreen is a lookup over this answer. The two
 * cannot disagree, because there is only one of them.
 */
export function whatDecidedIt({
  signInIsUp = false,
  signInIsGone = false,
  theyAreIn = false,
  itWillNotOpen = false,
  startedAt = null,
  now = null,
} = {}) {
  // BEING IN WINS OVER EVERYTHING. If the shop's page says this person is signed
  // in, nothing else matters: not a slow load, not a failure, not a clock. The
  // job is done and the screen closes.
  if (theyAreIn === true) return BECAUSE_THEY_ARE_IN;
  // The shop said out loud that it could not open. That is a statement, and it
  // beats anything we worked out for ourselves.
  if (itWillNotOpen === true) return BECAUSE_THE_SHOP_SAID_SO;
  // THE SIGN IN WENT AWAY. Our own screen, and a question, because the shop is
  // not telling us whether it worked.
  if (signInIsGone === true) return BECAUSE_THE_SIGN_IN_WENT;
  // ONLY the sign in uncovers the shop. Any other page the shop serves - its
  // shopping page, its captcha, its error, its "install our app" - leaves this
  // false, and the person stays on our loading screen and never sees it.
  //
  // AND IT NOW BEATS THE CLOCK, which it did not before and should have. The
  // fifteen seconds are there to catch a shop that never answers. A shop that took
  // sixteen seconds and then showed its own sign in HAS answered, and the old
  // order put "The shop did not open" over a working sign in page for ever,
  // because nothing ever moved the clock back.
  if (signInIsUp === true) return BECAUSE_THE_SIGN_IN_IS_UP;
  if (ranOutOfTime(startedAt, now)) return BECAUSE_TIME_RAN_OUT;
  return BECAUSE_NOTHING_YET;
}

/** Has the shop had its fifteen seconds? False whenever we cannot tell. */
export function ranOutOfTime(startedAt, now) {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  if (typeof now !== 'number' || !Number.isFinite(now)) return false;
  return now - startedAt >= SHOP_HAS_THIS_LONG_MS;
}

/**
 * IS THE SHOP'S PAGE ALLOWED TO BE SEEN RIGHT NOW?
 *
 * The single question the screen asks. One line, so there is one answer and it
 * cannot be got right in one branch and wrong in another.
 */
export function shopMayBeSeen(state) {
  return state === SHOP;
}

/**
 * IS THE SHOP'S PAGE ALLOWED TO EXIST RIGHT NOW? Not "be seen" - EXIST.
 *
 * ── WHY A DEAD VIEW MUST BE GONE AND NOT MERELY COVERED ─────────────────────
 *
 * The owner found this on a real phone on 7 September 2026, after the Try again
 * fix of 5 September was already in: airplane mode on, tap connect, get the
 * failure, airplane mode off, wait, tap Try again ONCE - and the same sentence
 * came straight back.
 *
 * A COVERED VIEW IS STILL ALIVE AND CAN STILL SPEAK. While our failure screen was
 * up, the web view underneath it was still mounted, still holding a load that had
 * failed, and still able to report that failure again. Throwing it away when the
 * count changes is not enough on its own, because the throwing away and the new
 * view's first moments happen together, and a last word from the dying one lands
 * in the middle of them. The certain fix is for there to be nothing there to
 * speak: while the screen says the shop did not open, the shop's view does not
 * exist at all, so tapping Try again builds one from nothing.
 *
 * ONLY ON A VISIT MADE TO SIGN IN. A visit made to READ somebody's own orders
 * keeps its view mounted through everything, on purpose: it is what stops
 * returning from the results screen from reloading the page and dropping the
 * shop session. Unmounting there would break the thing this app is for.
 *
 * AND THE COST IS REAL AND WORTH SAYING. A shop that was one second away from
 * showing its own sign in when the fifteen seconds ran out used to be able to
 * rescue itself, because a late sign in beats the clock in whatDecidedIt. Once
 * the view is gone it cannot. That is the right trade: a rescue nobody can rely
 * on, for a Try again that works every time.
 */
export function shopViewMayExist(toSignIn, state) {
  if (toSignIn !== true) return true;
  return state !== FAILED;
}

/**
 * SHOULD A "THE SHOP WILL NOT OPEN" EVENT BE ACTED ON, OR IGNORED AND WHY?
 *
 * ── THE STALE EVENT, WHICH IS THE WHOLE REASON THIS IS A FUNCTION ───────────
 *
 * Every one of these events carries the count of the attempt whose view raised
 * it, stamped in at the moment that view was built. A view being torn down can
 * still deliver one last failure, and without the stamp there is no way to tell
 * that word from a word about the attempt happening now: the screen would take a
 * dead view's complaint about a network that no longer exists and put the failure
 * back over a shop that is loading perfectly well.
 *
 * IT IS A FUNCTION AND NOT A LINE IN THE SCREEN because a phone cannot be made to
 * produce a dying view's last word on demand. Here it is six arguments and a
 * plain answer, and every combination of them can be checked under node - which
 * is the same reason the rest of this file is shaped the way it is.
 *
 * THE ANSWER CARRIES ITS OWN REASON so the log can say why it ignored something.
 * An ignored event that nobody can explain is how this bug survived two days.
 */
export function shouldActOnFailure({
  toSignIn = false,
  fromAttempt = null,
  attemptNow = null,
  theyAreIn = false,
  signInIsUp = false,
  signInIsGone = false,
} = {}) {
  // A reading visit is not gated at all, and its own error handling is unchanged.
  if (toSignIn !== true) return { act: false, why: NOT_A_SIGN_IN_VISIT };
  // THE STAMP. Anything but the attempt on screen right now is a dead view talking.
  if (fromAttempt !== attemptNow) return { act: false, why: A_DEAD_VIEW_SPOKE };
  // Already in: a stray failure from some small thing on the page must not throw
  // away a person who is signed in.
  if (theyAreIn === true) return { act: false, why: THEY_ARE_ALREADY_IN };
  // The sign in is on screen, so the shop plainly did open.
  if (signInIsUp === true) return { act: false, why: THE_SIGN_IN_IS_UP };
  // We are already asking them a question, and must not replace it with a
  // sentence that is no longer true.
  if (signInIsGone === true) return { act: false, why: WE_ARE_ASKING_THEM };
  return { act: true, why: THE_SHOP_REALLY_WILL_NOT_OPEN };
}

/**
 * WHY AN EVENT WAS IGNORED, OR ACTED ON. One word each, and that is deliberate.
 *
 * THIS FILE WRITES NO SENTENCES, and the rule is not mine: our own side enforces
 * it by reading this file off disk and refusing any literal in it of four words
 * or more, because "a sentence written in the gate would never be read by
 * anybody" - it would sit outside gateWords.js where the plain language rule
 * cannot reach it. So the answers here are names, and the readable clause a
 * developer sees is built from them in connect/gateLog.js, which is development
 * only and is deleted when this is over.
 */
export const NOT_A_SIGN_IN_VISIT = 'notASignInVisit';
export const A_DEAD_VIEW_SPOKE = 'staleAttempt';
export const THEY_ARE_ALREADY_IN = 'alreadyIn';
export const THE_SIGN_IN_IS_UP = 'theSignInIsUp';
export const WE_ARE_ASKING_THEM = 'weAreAsking';
export const THE_SHOP_REALLY_WILL_NOT_OPEN = 'reallyWillNotOpen';

/**
 * What our own screen says, or null when the shop's page is what is showing.
 *
 * A sentence, and the controls under it. Every word comes from gateWords.js,
 * which our own side reads from disk and puts through the real plain language
 * rule. Nothing here writes a word of its own.
 */
export function whatWeSay(state) {
  if (state === OPENING_UP) return { sentence: OPENING, controls: [] };
  if (state === FAILED) {
    return {
      sentence: DID_NOT_OPEN,
      controls: [{ label: TRY_AGAIN, does: ASK_THE_SHOP_AGAIN }],
    };
  }
  if (state === CANNOT_TELL) {
    // TWO CONTROLS HERE AND ONE EVERYWHERE ELSE, on purpose. This screen is up in
    // two opposite situations that look identical from outside the page: they
    // signed in and the shop moved them on, or they backed out of the sign in
    // without doing it. One control would be right for one of them and a trap for
    // the other, because the only way forward would be to say something untrue.
    return {
      sentence: NOT_SURE,
      controls: [
        { label: I_HAVE_SIGNED_IN, does: THEY_SAY_THEY_ARE_IN },
        { label: TRY_AGAIN, does: ASK_THE_SHOP_AGAIN },
      ],
    };
  }
  if (state === SIGNED_IN_NOW) return { sentence: SIGNED_IN, controls: [] };
  return null;
}

/**
 * WHAT THE SHOP'S OWN PAGE IS SHOWING, WORKED OUT FROM PLAIN FACTS.
 *
 * ── THE MEASUREMENT THAT CHANGED THIS, 6 September 2026 ─────────────────────
 *
 * The owner signed in at Flipkart on a real phone. Flipkart signed him in, took
 * him to its own home page, and Fayr left him sitting there: the watcher knew only
 * two ways to tell somebody is in, a sign out control and a greeting, and
 * Flipkart's home page shows neither. He was right that the whole thing had been
 * built around what Amazon does.
 *
 * HIS PROPOSED THIRD SIGN WAS THAT A SHOP SHOWING NO WAY IN HAS LET THEM IN. It
 * was measured before it was built, in a real WebKit browser with a real iPhone
 * user agent, signed out, using the app's own questions:
 *
 *   Flipkart's home page       no way in, and no link to one   <- signed OUT
 *   Blinkit's home page        no way in, and no link to one   <- signed OUT
 *   Flipkart's account page    "Log In" is right there
 *   Zepto's orders page        "Login" is right there
 *
 * SO THE SIGN IS FALSE ON THE ONE PAGE IT WAS MEANT FOR. A signed out Flipkart
 * home page is the same page, by that test, as a signed in one. Somebody who
 * tapped Flipkart's own back control would have been told they were signed in,
 * had a row written down, and been moved on to buying. That is the exact hole
 * src/screens/linkaccount.js says it closed.
 *
 * SO IT IS NOT USED TO CLAIM ANYTHING. It answers "gone", which is a question and
 * not an answer: our own cover goes back on and the person is asked, in one
 * sentence, with a control for each of the two things that really might have
 * happened. That was the owner's own choice between three, made with the
 * measurement in front of him.
 *
 * ── THE FACTS, AND WHERE EACH ONE COMES FROM ────────────────────────────────
 *
 *   signInWasUp           OUR OWN SIDE, and not the page: has the sign in been on
 *                         screen at any point in this attempt. It has to be ours,
 *                         because a page that fully reloads gets a brand new
 *                         script with no memory of what the last page showed. On a
 *                         shop that reloads on signing in, a page owned answer
 *                         would be false for ever and the sign in going away could
 *                         never be noticed at all.
 *   fieldIsThere          the page: is a sign in box on screen. Never its value.
 *   signInControlIsThere  the page: is a control whose WHOLE label is a way in.
 *   signOutIsThere        the page: is a control whose WHOLE label is a way out.
 *   greeting              the page: the words the SHOP printed at the top of
 *                         itself. Whether they are a name is decided here.
 *   path                  the page: the address, with no query and no host.
 *   isAPuzzle             the page: is this asking whether they are a person.
 *   looksInARow           the page: how many looks in a row these facts have held.
 *
 * Answers 'in', 'up', 'gone', or null for "say nothing".
 */
export function whatThePageShows(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const path = typeof f.path === 'string' ? f.path : '/';

  // A PUZZLE OR A PAYING PAGE: nothing is said at all. Not "they are in", not
  // "the sign in is up", and above all not "the sign in has gone", which on a
  // puzzle would put a question on screen over a page we must not touch.
  if (f.isAPuzzle === true) return null;
  if (isAPayingPage(path)) return null;

  const onItsSignIn = isTheShopsOwnSignInPage(path);

  // A WAY OUT. A shop only ever shows one to somebody who is signed in.
  if (f.signOutIsThere === true) return 'in';

  // A GREETING THAT IS REALLY A NAME, and that last clause is not decoration.
  // Amazon prints "Hello, sign in" at the top of its own shopping page to
  // somebody who is NOT signed in, and the old rule asked only whether the words
  // began "Hello,". readAccountName already refuses "Hello, sign in", "Hello,
  // Guest" and "Hello, there" outright, so asking it is both the stricter
  // question and the one that cannot disagree with the name on the card.
  if (typeof f.greeting === 'string' && readAccountName(f.greeting) != null) return 'in';

  // THE SIGN IN IS UP. Either the shop's own address, or a box on its own page.
  if (f.fieldIsThere === true || onItsSignIn) return 'up';

  // AND THE SIGN IN HAS GONE. Every one of these has to hold.
  if (f.signInWasUp !== true) return null;
  // Still on the shop's own sign in, so it has not gone anywhere.
  if (onItsSignIn) return null;
  // The shop is offering a way in, which is a shop saying they are not in. This
  // is what keeps somebody who backed out onto Flipkart's own account page, or
  // Zepto's own orders page, where the shop really does print a way in.
  if (f.signInControlIsThere === true) return null;
  // Held for long enough that a page halfway through being rebuilt cannot count.
  const looks = typeof f.looksInARow === 'number' ? f.looksInARow : 0;
  if (looks < LOOKS_IN_A_ROW_BEFORE_WE_ASK) return null;
  return 'gone';
}

/**
 * WHAT THE SHOP'S OWN PAGE SAID, TURNED INTO SIGNALS.
 *
 * The page can only hand something back one way, and this is the only shape this
 * screen accepts. Anything else is ignored outright, so a shop's own page cannot
 * reach our screen by posting something we did not ask for.
 *
 * THE PAGE SENDS FACTS AND NOTHING ELSE. It used to send a verdict, which meant
 * the deciding happened inside a shop's page where no check could reach it. Now
 * the facts arrive here, whatThePageShows above decides, and every combination of
 * those facts is walked under node.
 */
export function whatTheShopSaid(message, signInWasUp = false) {
  if (!isForTheGate(message)) return null;
  // OUR OWN MEMORY IS PUT IN HERE, and it is deliberately the only fact the page
  // does not supply. See whatThePageShows for why a page cannot be trusted to
  // remember what an earlier page showed.
  const facts = { ...message.__fayrPage, signInWasUp: signInWasUp === true };
  const shows = whatThePageShows(facts);
  if (shows == null) return null;
  const greeting = typeof facts.greeting === 'string' ? facts.greeting : '';
  return {
    // THE TRUTH ABOUT WHAT THE PAGE SAW, and this used to say true for both
    // signals. A shop greeting somebody by name is showing them NO sign in, so
    // reporting one was reporting something the page did not say. It was harmless
    // only because being in is tested first. That made it a trap: reorder those
    // two lines, or read this field on its own, and the gate would uncover a
    // shop's already-signed-in pages instead of closing the screen.
    signInIsUp: shows === 'up',
    theyAreIn: shows === 'in',
    signInIsGone: shows === 'gone',
    // A name only ever comes with 'in'. A greeting arriving with anything else
    // would mean a shop was greeting somebody who is not signed in, which no shop
    // does, so it is dropped rather than believed.
    accountName: shows === 'in' ? readAccountName(greeting) : null,
  };
}

/**
 * IS THIS MESSAGE THE GATE'S BUSINESS AT ALL?
 *
 * The screen this gate sits in already has its own message handler, for the
 * reader's own results, and that handler treats anything without `ok` as a failed
 * read. So a gate message arriving there would put the words "Fetch failed" on a
 * screen where nothing failed. This is the question that keeps the two apart, and
 * src/connect/accountName.js has been asking for it in writing since the day the
 * card was built.
 */
export function isForTheGate(message) {
  return message != null
    && typeof message === 'object'
    && message.__fayrPage != null
    && typeof message.__fayrPage === 'object';
}
