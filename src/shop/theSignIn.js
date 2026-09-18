// SIGNING IN TO THE SHOP, INSIDE THE SCREEN THEY ARE SHOPPING IN.
//
// ── THE RUN THAT ASKED FOR THIS, 18 September 2026 ──────────────────────────
//
// The owner walked the live Zepto offer on a real phone. The only web view he
// ever reached was the CONNECT one, pointed at https://www.zepto.com/account/orders
// — a page he cannot buy anything on — and the shop inside Fayr, which he can,
// was never opened at all. Two web views, and the one he got was the wrong one.
//
// His words the same day: "we are opening a web view inside the Fayr app for all
// the marketplaces ... so the user is not out of our vision for a single time."
// A person who has to leave the shopping view to sign in and come back is out of
// our vision for the one moment that decides whether they can shop at all.
//
// So for the three quick-commerce shops the sign in happens where the shopping
// happens: the shop's own login appears in front of them, in Fayr's own view, on
// the shop's own page, and they carry on.
//
// ── EVERY WORD OF THE DETECTION IS THE CONNECT FLOW'S, UNCHANGED ────────────
//
// NOT ONE QUESTION ABOUT A SHOP'S PAGE IS ASKED IN THIS FILE. That is the whole
// design of it. src/connect/ is frozen, it is measured, and today's log is
// exactly why: at 15:31:56 it read Zepto's "Please Login / Please login to check
// orders. / Login" out of a live page and got it right, and at 15:32:14 the
// session file was written with 22 real cookies.
//
//   the script put into the page   src/connect/watchSignIn.js  watchSignInScript
//   is this message even ours      src/connect/gate.js         isForTheGate
//   what did the page just show    src/connect/gate.js         whatTheShopSaid
//
// This file imports those three and adds the one thing the connect flow cannot
// answer, because it is not a question about a page at all: GIVEN what the page
// showed, and given what this session has already done, is there anything to
// record. Importing a frozen file is not changing it; there is no copy of any of
// those questions here, and the check next door refuses this file if a sign-in
// pattern of its own ever appears in it.
//
// ── AND IT IS A RECORD, NEVER A GATE ────────────────────────────────────────
//
// Nothing in here can stop a page rendering, hide the shop, cover it, or refuse
// a navigation. ShopScreen draws the shop's page from one condition and one
// only — whether the saved session has been restored — and no answer from this
// file can reach it. A person the shop has not greeted can still browse, still
// search and still buy; they will simply meet the shop's own login when the shop
// itself decides to show it, which is what happens in any browser.
//
// That is the opposite of the connect screen's job, and deliberately. There, a
// cover goes over the shop until the gate is sure, because the person is there
// to sign in and nothing else. Here they are there to buy something.

import { isForTheGate, whatTheShopSaid } from '../connect/gate.js';
import { watchSignInScript } from '../connect/watchSignIn.js';

/** Re-exported so the screen takes the frozen script from here and nowhere else. */
export { watchSignInScript };

/**
 * HOW WE KNEW, in the words our own side stores against the sign-in.
 *
 * One string, and it names this screen rather than the shop, so a sign-in
 * recorded from inside the shopping view can be told apart from one recorded by
 * the connect flow when somebody reads the table later. Our side takes 200
 * characters; this is well inside that.
 */
export const HOW_WE_KNEW_INSIDE_THE_SHOP = 'the shop greeted them inside the Fayr shopping view';

/**
 * WHAT THE PAGE JUST SHOWED — the frozen reading, and nothing added to it.
 *
 * `signInWasUp` is OUR side's memory and is the one fact the page cannot supply:
 * a shop that reloads itself on signing in hands the script a brand new life
 * with no memory of the page before it. gate.js says so where it is read.
 *
 * Answers null for a message that is not ours and for a page with nothing
 * conclusive on it, which are the same answer here: there is nothing to do.
 */
export function whatTheShopShowed(message, signInWasUp) {
  if (!isForTheGate(message)) return null;
  return whatTheShopSaid(message, signInWasUp === true);
}

/**
 * IS THERE ANYTHING TO RECORD?
 *
 * `showed`           what whatTheShopShowed answered, or null.
 * `alreadyRecorded`  whether this session has recorded it once already.
 *
 * ONCE PER SESSION AND NEVER AGAIN. A shop greets somebody on every page they
 * open, so the greeting arrives over and over; recording each one would mean a
 * request per page for the whole of somebody's shopping.
 *
 * AND ONLY ON "they are in". Not on a sign in being up, which is the opposite,
 * and not on one having gone — a sign in box that disappears is a person who
 * went somewhere else just as often as it is a person who signed in, and
 * gate.js's own note says the same thing about which of its signals is safe to
 * read on its own.
 */
export function shouldRecordTheSignIn(showed, alreadyRecorded) {
  if (alreadyRecorded === true) return false;
  return !!(showed && showed.theyAreIn === true);
}

/**
 * SHOULD OUR SIDE'S MEMORY OF A SIGN IN BOX BE TURNED ON?
 *
 * Only ever turned ON here, never off, and that asymmetry is gate.js's: the
 * memory exists precisely so that a page which REPLACES the sign in box can
 * still be read as somebody having signed in. Clearing it the moment the box
 * went would throw the fact away at the instant it becomes useful.
 */
export function nowRememberTheSignInWasUp(showed, remembered) {
  if (remembered === true) return true;
  return !!(showed && showed.signInIsUp === true);
}
