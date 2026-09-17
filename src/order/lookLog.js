// THE LOOK'S RUNNING COMMENTARY, FOR WHOEVER IS WATCHING THE METRO WINDOW.
//
// ── WHY THIS FILE EXISTS, AND THAT IT IS TEMPORARY ──────────────────────────
//
// The owner tried the automatic order find on a real phone on 11 September 2026.
// It came back with nothing and put him on the screenshot screen. Afterwards
// there was NOTHING ANYWHERE to say why: no row in order_candidates, no line in
// the backend log, no page text, no count of anything. The database could not
// even say whether the phone had spoken to the server at all.
//
// That is because FOUR different things land on that one screen and leave the
// same trace, which is none:
//
//   the shop's list came back with no order numbers on it
//   the order pages were opened but none of them could be read
//   the pages were sent and the server matched nothing
//   the request never left the phone
//
// The first and the last are opposite problems with opposite fixes, and today
// they are the same silence. These lines tell them apart.
//
// IT COMES OUT WHEN THE READ IS PROVEN, in the same way src/connect/gateLog.js
// does and for the same reason. It is one file rather than lines scattered
// through the screen precisely so that deleting it is one deletion.
//
// ── NOT ONE WORD OF THIS IS FOR A PERSON USING FAYR ─────────────────────────
//
// These are developer words on a developer's console: brackets, bare status
// codes, a clock reading. The screen they come from is the one screen in the app
// forbidden from telling anybody their shop account is being looked at, and
// src/ui/funnyWait.test.mjs reads that screen and holds every piece of text in it
// to that rule. NOTHING HERE MAY EVER REACH IT.
//
// The thing that keeps that true is structural rather than a promise: there is
// ONE call to console.log in this file, it is inside say(), and it always puts
// TAG in front. So every line this file can possibly emit begins with a bracket.
//
// ── AND NOBODY'S TELEPHONE NUMBER GOES OUT OF IT ────────────────────────────
//
// gateLog.js leaked the owner's own number once: a shop's sign in page puts the
// mobile number in its greeting, and the raw answer went straight into a line he
// then pasted into a message. The same structure that keeps the bracket in front
// keeps the number out — every line is assembled in lookLine() and lookLine()
// masks what it assembled as its LAST act, so it cannot matter which argument a
// future caller puts a page's answer into.
//
// ── AND NO PAGE TEXT IS EVER PASSED TO IT ───────────────────────────────────
//
// The mask is the second line of defence, not the first. An Amazon order page
// carries the buyer's name and their delivery address, so the rule at the call
// sites is that a page's HTML and an order's text are NEVER arguments here —
// only their `.length`. A byte count says everything needed ("was there a page
// at all, and was it a real one or a stub") and says nothing about anybody.
//
// ORDER NUMBERS ARE NOT LOGGED EITHER, for the same reason and one more: an
// order number is a strong identifier tied to the owner's own account, it is
// already kept server side where it belongs, and a COUNT is what the question
// actually needs.
//
// ── AND IT IS OFF IN A REAL BUILD ───────────────────────────────────────────
//
// Guarded on __DEV__, read defensively so this module also loads under node,
// where this file's own checks call the pure half of it directly.

import { maskNumbers } from '../maskNumbers.js';

/** The one prefix, so a whole look can be found in a busy window by searching. */
export const TAG = '[fayr-look]';

/**
 * Is the commentary on? Only in development, and never in a build a person gets.
 *
 * `typeof` first because __DEV__ is the phone's word, not node's, and the checks
 * for this file run under node.
 */
export function lookLogIsOn() {
  // eslint-disable-next-line no-undef
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * THE CLOCK READING, to the millisecond.
 *
 * The look has a twenty second ceiling over it and a gap between its fetches, so
 * every question about it is a question about ordering and duration. Seconds
 * would hide the thing being looked for.
 */
export function stamp(at) {
  const when = typeof at === 'number' && Number.isFinite(at) ? new Date(at) : new Date();
  const two = (n) => String(n).padStart(2, '0');
  const three = String(when.getMilliseconds()).padStart(3, '0');
  return `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}.${three}`;
}

/**
 * ONE LINE, BUILT AND NOT PRINTED, so the shape of it can be checked under node.
 */
export function lookLine(what, detail, at) {
  const tail = detail == null || detail === '' ? '' : ` ${detail}`;
  // MASKED HERE, AT THE ONE PLACE EVERY LINE PASSES THROUGH, as the last act
  // before the line exists. See the note above about the telephone number. The
  // whole assembled line goes through it, not just `detail`, so it does not
  // matter which argument a future caller puts a page's answer into.
  return maskNumbers(`${TAG} ${stamp(at)} ${what}${tail}`);
}

/** The only place this file writes anything anywhere. */
function say(line) {
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * WHAT KIND OF ERROR PAGE A SHOP SENT, IN WORDS THAT CARRY NO ONE'S DATA.
 *
 * ── WHY THIS EXISTS AND WHY IT IS SHAPED THIS WAY ──────────────────────────
 *
 * A read that comes back non-200 has one number to explain it — the status —
 * and a shop sends several different pages under one status. A 400 from Amazon
 * on the profile can be a plain "Bad Request", a scraping block that names an
 * email to write to, a robot check, or a "claim your profile" bounce, and those
 * four want four different fixes. Without this, every one of them is the same
 * silence, and finding out which costs the owner a round trip to paste his
 * screen back at us.
 *
 * IT NEVER RETURNS THE PAGE. It returns a title with digits and long id-like
 * tokens stripped, plus a handful of yes/no marks for phrases that only ever
 * appear in a shop's own furniture — never in anything a person wrote, never a
 * name, never a number, never a review's words. The standing rule that a page's
 * bytes are counted and never printed holds here: this is not the bytes, it is
 * a fingerprint of which stock error page they are.
 *
 * Pure, so it is checked under node and can be asked twice without a clock.
 */
export function errorTell(html) {
  if (typeof html !== 'string' || html === '') return 'tell=none';
  const lower = html.toLowerCase();
  // MARKS ONLY, AND NEVER THE TITLE. The title was tried and dropped: on a good
  // profile it IS the person's name, and a rule that a name never reaches a log
  // does not bend for a field that is usually safe. Every mark below is a phrase
  // that only appears in a shop's own stock error furniture — never in a name,
  // a number, an id or a review's words — so the whole return is a fingerprint
  // of WHICH error page, carrying nothing of whose it is.
  const mark = (needle) => (lower.indexOf(needle) >= 0 ? 1 : 0);
  return `badreq=${mark('bad request')} `
    + `robot=${mark('robot') || mark('are not a robot') || mark('captcha')} `
    + `signin=${mark('sign in') || mark('signin') || mark('/ap/signin')} `
    + `apiblock=${mark('api-services-support') || mark('automated access')} `
    + `denied=${mark('access denied') || mark('forbidden') || mark('not authorized') || mark('unauthorized')} `
    + `claim=${mark('/ax/claim') || mark('claim your')} `
    + `wrong=${mark('something went wrong') || mark("we're sorry") || mark('sorry!')} `
    + `len=${lower.length < 8000 ? 'small' : 'big'}`;
}

/**
 * Say one line, if the commentary is on. Answers whether it said anything, so a
 * check can prove the guard works without reading the console.
 */
export function logLook(what, detail, at) {
  if (!lookLogIsOn()) return false;
  say(lookLine(what, detail, at));
  return true;
}
