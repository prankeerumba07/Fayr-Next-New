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
// is shown to nobody.
//
// ── FOUR THINGS ON SCREEN AND NO FIFTH ──────────────────────────────────────
//
//   opening   our own loading screen, one sentence. The shop is loading behind it.
//   shop      the shop's own sign in, and nothing of ours over it.
//   failed    our own one sentence and one button.
//   signedIn  our own one sentence, for a breath, then the screen closes.
//
// ── PURE, AND THAT IS THE POINT ─────────────────────────────────────────────
//
// No React, no web view, no clock of its own: every moment is handed in. So every
// rule below can be checked under node, including the ones that only happen when
// something goes wrong, which are the ones a phone can never be made to do on
// demand. Same reason as ui/journey.js and ui/callUs.js.
//
// ── AND IT NEVER TYPES ANYTHING ─────────────────────────────────────────────
//
// Nothing in this file, and nothing in the screen that uses it, writes into a
// shop's page. It reads four signals, each of which is only ever a yes or a no,
// and it decides which of the four things above is on screen. The person types
// their own number and their own code on the shop's own page, and Fayr never sees
// either. connect-words.spec.ts on our side reads this file and proves it.

import { readAccountName } from '../signin.js';
import { DID_NOT_OPEN, OPENING, SIGNED_IN, TRY_AGAIN } from './gateWords.js';

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

/** The four things that can be on screen. Nothing else ever is. */
export const OPENING_UP = 'opening';
export const SHOP = 'shop';
export const FAILED = 'failed';
export const SIGNED_IN_NOW = 'signedIn';

/**
 * The four signals, and every one of them is only ever a yes or a no.
 *
 *   signInIsUp     the shop's own sign in is on screen. Either its address is the
 *                  shop's own sign in, or the shop's own page put a field asking
 *                  for a number or an email on screen.
 *   theyAreIn      the shop's own page says this person is signed in. Never a
 *                  guess: see whatTheShopSaid.
 *   itWillNotOpen  the shop said it could not, or it ran out of time.
 *   startedAt      when the shop was asked to open, so the wait can be counted.
 */
export function whatIsOnScreen({
  signInIsUp = false,
  theyAreIn = false,
  itWillNotOpen = false,
  startedAt = null,
  now = null,
} = {}) {
  // BEING IN WINS OVER EVERYTHING. If the shop's page says this person is signed
  // in, nothing else matters: not a slow load, not a failure, not a clock. The
  // job is done and the screen closes.
  if (theyAreIn === true) return SIGNED_IN_NOW;
  if (itWillNotOpen === true) return FAILED;
  if (ranOutOfTime(startedAt, now)) return FAILED;
  // ONLY the sign in uncovers the shop. Any other page the shop serves - its
  // shopping page, its captcha, its error, its "install our app" - leaves this
  // false, and the person stays on our loading screen and never sees it.
  if (signInIsUp === true) return SHOP;
  return OPENING_UP;
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

/** What our own screen says, or null when the shop's page is what is showing. */
export function whatWeSay(state) {
  if (state === OPENING_UP) return { sentence: OPENING, button: null };
  if (state === FAILED) return { sentence: DID_NOT_OPEN, button: TRY_AGAIN };
  if (state === SIGNED_IN_NOW) return { sentence: SIGNED_IN, button: null };
  return null;
}

/**
 * WHAT THE SHOP'S OWN PAGE SAID, TURNED INTO SIGNALS.
 *
 * The page can only hand something back one way, and this is the only shape this
 * screen accepts. Anything else is ignored outright, so a shop's own page cannot
 * reach our screen by posting something we did not ask for.
 *
 * THE THREE THINGS IT MAY SAY, and not one of them is anything anybody typed:
 *
 *   signIn: 'up'   a field asking for a number or an email is on screen, or the
 *                  address is the shop's own sign in. Asked whether a field
 *                  EXISTS. Never once what is in one.
 *   signIn: 'in'   the shop's own page is greeting this person by name, or the
 *                  shop's own sign out control is on the page. Both are things a
 *                  shop only ever shows to somebody who is already in.
 *   greeting       the words the shop itself printed at the top of its own page.
 *                  Turned into a name HERE, by readAccountName, which is already
 *                  written and already checked and already refuses "Hello, sign
 *                  in", "Hello, Guest" and "Hello, there". The page sends the
 *                  words it can see; deciding whether they are a name is ours.
 */
export function whatTheShopSaid(message) {
  const said = message && typeof message === 'object' ? message : {};
  const signal = typeof said.__fayrSignIn === 'string' ? said.__fayrSignIn : null;
  if (signal !== 'up' && signal !== 'in') return null;
  const greeting = typeof said.__fayrGreeting === 'string' ? said.__fayrGreeting : '';
  return {
    // THE TRUTH ABOUT WHAT THE PAGE SAW, and this used to say true for both
    // signals. A shop greeting somebody by name is showing them NO sign in, so
    // reporting one was reporting something the page did not say. It was harmless
    // only because being in is tested first below. That made it a trap: reorder
    // those two lines, or read this field on its own, and the gate would uncover a
    // shop's already-signed-in pages instead of closing the screen.
    signInIsUp: signal === 'up',
    theyAreIn: signal === 'in',
    // A name only ever comes with 'in'. A greeting arriving with 'up' would mean
    // a shop was greeting somebody who is not signed in, which no shop does, so
    // it is dropped rather than believed.
    accountName: signal === 'in' ? readAccountName(greeting) : null,
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
    && typeof message.__fayrSignIn === 'string';
}
