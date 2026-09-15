// THE GATE'S RUNNING COMMENTARY, FOR WHOEVER IS WATCHING THE METRO WINDOW.
//
// ── WHY THIS FILE EXISTS, AND THAT IT IS TEMPORARY ──────────────────────────
//
// The owner asked for it by name on 7 September 2026, after test 3 failed on a
// real iPhone for the second time: "instrument it so we stop guessing". Two days
// had gone into reasoning about a screen nobody could see inside, and the same
// sentence - "The shop did not open. Please try again." - has TWO different
// causes behind it that look identical on a phone.
//
// IT COMES OUT AFTER HE CONFIRMS THE TEST PASSES, not before. Nothing else in the
// app is built to be deleted, and this is, so it is one file rather than lines
// scattered through the screen.
//
// ── NOT ONE WORD OF THIS IS FOR A PERSON USING FAYR ─────────────────────────
//
// Every word a person reads lives in src/connect/gateWords.js, where our own
// side's plain language check reads it off disk. NOTHING HERE IS THAT. These are
// developer words on a developer's console: they carry brackets, an underscore
// name, a bare error code and a clock reading, every one of which that rule
// refuses on sight - which is exactly why they must never reach a screen.
//
// The one thing that keeps that true is structural rather than a promise: there
// is ONE call to console.log in this file, it is inside say(), and it always puts
// TAG in front. So every line this file can possibly emit begins with a bracket.
// backend/src/shops/connect-words.spec.ts checks that by reading this file.
//
// ── AND NOBODY'S TELEPHONE NUMBER GOES OUT OF IT ────────────────────────────
//
// THIS FILE LEAKED THE OWNER'S OWN NUMBER. ConnectScreen hands the shop page's
// raw answer straight to logGate, and Amazon's sign in page puts the person's
// mobile number in its greeting, so it went into a log he then pasted. The same
// structure that keeps the bracket in front now keeps the number out: every line
// is assembled in gateLine() and gateLine() masks what it assembled, so it cannot
// matter which argument the next caller puts a page's answer into. The rule
// itself lives in src/maskNumbers.js, which is not one of the files this
// instrumentation takes with it when it is deleted.
//
// ── AND IT IS OFF IN A REAL BUILD ───────────────────────────────────────────
//
// Guarded on __DEV__, read defensively so this module also loads under node,
// where the app's own checks call the pure half of it directly.

import { maskNumbers } from '../maskNumbers.js';

/** The one prefix, so a whole test can be found in a busy window by searching. */
export const TAG = '[fayr-gate]';

/**
 * Is the commentary on? Only in development, and never in a build a person gets.
 *
 * `typeof` first because __DEV__ is the phone's word, not node's, and the checks
 * for this file run under node.
 */
export function gateLogIsOn() {
  // eslint-disable-next-line no-undef
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/**
 * THE CLOCK READING, to the millisecond, because the whole question is ordering.
 *
 * A stale event and a real one are the same event a few hundred milliseconds
 * apart. Seconds would hide exactly the thing being looked for.
 */
export function stamp(at) {
  const when = typeof at === 'number' && Number.isFinite(at) ? new Date(at) : new Date();
  const two = (n) => String(n).padStart(2, '0');
  const three = String(when.getMilliseconds()).padStart(3, '0');
  return `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}.${three}`;
}

/**
 * ONE LINE, BUILT AND NOT PRINTED, so the shape of it can be checked under node.
 *
 * Every line carries the millisecond and the attempt, because a line without the
 * attempt cannot answer the only question that matters: was this about the view
 * on screen now, or the one before it?
 */
export function gateLine(attempt, what, detail, at) {
  const n = typeof attempt === 'number' && Number.isFinite(attempt) ? attempt : '?';
  const tail = detail == null || detail === '' ? '' : ` ${detail}`;
  // MASKED HERE, AT THE ONE PLACE EVERY LINE PASSES THROUGH. See the note above
  // about the telephone number. The whole assembled line goes through it, not
  // just `detail`, so it does not matter which argument a future caller puts a
  // page's raw answer into.
  return maskNumbers(`${TAG} ${stamp(at)} attempt=${n} ${what}${tail}`);
}

/** The only place this file writes anything anywhere. */
function say(line) {
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * Say one line, if the commentary is on. Answers whether it said anything, so a
 * check can prove the guard works without reading the console.
 */
export function logGate(attempt, what, detail, at) {
  if (!gateLogIsOn()) return false;
  say(gateLine(attempt, what, detail, at));
  return true;
}

/**
 * THE GATE'S ONE WORD ANSWERS, PUT INTO WORDS, and only here.
 *
 * connect/gate.js answers why it ignored a failure with a single name, because our
 * own side refuses to let that file hold a sentence - see the note beside those
 * names. This is where a name becomes something a person reading a phone's window
 * can act on, and this file is the one that gets deleted, so the sentences go with
 * it.
 *
 * An unknown name is handed back as it came rather than swallowed: a reason nobody
 * can read is still better than a blank.
 */
const IN_WORDS = {
  notASignInVisit: 'this is not a visit made to sign in',
  staleAttempt: 'IT WAS A DEAD VIEW TALKING — the event was stamped with an attempt that is over',
  alreadyIn: 'they are already signed in',
  theSignInIsUp: 'the shop\'s own sign in is on screen, so it plainly did open',
  weAreAsking: 'we are already asking them whether it worked',
  theSignInWasUp: 'the shop showed its own sign in earlier in this attempt, so it did open',
  reallyWillNotOpen: 'the shop really will not open',
};

/** The gate's one word answer, in words. */
export function whyInWords(reason) {
  if (typeof reason !== 'string' || reason === '') return '?';
  return IN_WORDS[reason] || reason;
}

/**
 * WHAT THE WEB VIEW ACTUALLY SAID WENT WRONG, in one readable clause.
 *
 * ── THE FACT THAT WAS BEING THROWN AWAY ─────────────────────────────────────
 *
 * Until today the screen's failure handler took NO ARGUMENT AT ALL. The web view
 * hands over the error's domain, its code and the shop's own description of it,
 * and every bit of that was dropped on the floor - so "the shop did not open"
 * could not be told apart from "there is no network", "the shop answered 503" or
 * "the page's own process died", and the one number that would have said which
 * was never written down anywhere.
 *
 * The codes worth recognising on sight, from Apple's own list:
 *   -1009  there is no network at all      (airplane mode, no wifi)
 *   -1005  the connection was lost         (the network went away mid request)
 *   -1001  it took too long                (timed out)
 *   -1003  the shop's name would not resolve
 *   -999   cancelled. THE LIBRARY SWALLOWS THIS ONE and never passes it on, which
 *          was measured in its own source, so it can never appear here.
 */
export function describeFailure(which, nativeEvent) {
  const e = nativeEvent && typeof nativeEvent === 'object' ? nativeEvent : {};
  const bits = [`from=${which || '?'}`];
  if (e.domain != null) bits.push(`domain=${e.domain}`);
  if (e.code != null) bits.push(`code=${e.code}`);
  if (e.statusCode != null) bits.push(`status=${e.statusCode}`);
  if (e.url != null) bits.push(`url=${e.url}`);
  if (e.description != null) bits.push(`said="${e.description}"`);
  return bits.join(' ');
}
