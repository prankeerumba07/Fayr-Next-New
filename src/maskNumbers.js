// NOBODY'S TELEPHONE NUMBER REACHES ANY FILE, CHECK, FIXTURE, REPORT OR OUTPUT.
//
// ── WHY THIS FILE EXISTS, AND IT IS NOT A PRECAUTION ────────────────────────
//
// It already happened. src/connect/gateLog.js prints the shop page's own raw
// answer so a failure can be read in the Metro window, and Amazon's sign in page
// puts the person's mobile number in its greeting:
//
//   "greeting":" \nSign in\n+91XXXXXXXXXX Change\nPassword\n..."
//
// So the owner's own number went into a log he then pasted, which is the exact
// thing his standing rule forbids. The rule is not about that one log line. It is
// about every output this app can produce, so the masking is a file of its own
// that nothing is scheduled to delete, rather than a few characters inside the
// temporary instrumentation that happened to cause it.
//
// ── AND WHY IT IS THREE PATTERNS AND NOT ONE ────────────────────────────────
//
// The first draft of this file was one keen pattern: eight or more digits with
// single spaces or dashes allowed inside the run. It masked the telephone number
// correctly and it ALSO masked 403-1234567-8901234, which is the shape of an
// Amazon order number — the one fact this whole day's work exists to read and put
// on a screen. A privacy rule that eats the thing being built is a privacy rule
// somebody will switch off.
//
// So the rule the owner gave is kept LITERALLY — eight or more digits in a row,
// with or without a leading plus — and the two ways a mobile number gets written
// with separators inside it are named specifically. Both of those name the mobile
// shape rather than a length, so neither can reach an order number: an order
// number's groups are three then seven then seven, and no run of it is eight.

/** What goes in the place of a number. Says WHAT was taken out, not how much. */
export const MASK = '[number removed]';

/**
 * ONE. THE OWNER'S RULE, WORD FOR WORD: eight or more digits in a row, with or
 * without a leading plus. This alone catches the shape measured in his own log,
 * +919876543210, and the bare ten digit form.
 */
const EIGHT_OR_MORE_IN_A_ROW = /\+?\d{8,}/g;

/**
 * TWO. THE SAME NUMBER WITH THE COUNTRY CODE HELD APART: "+91 98765 43210",
 * "+91-9876543210". Anchored on the +91, so it cannot begin anywhere else.
 */
const WITH_THE_COUNTRY_CODE = /\+\s?91[\s-]?\d(?:[\s-]?\d){9}/g;

/**
 * THREE. A BARE INDIAN MOBILE SPLIT IN TWO: "98765 43210".
 *
 * Narrow on purpose. It must start 6, 7, 8 or 9, because every Indian mobile
 * does; it is exactly five digits, one separator, five digits; and it is fenced
 * with word boundaries so it cannot begin or end inside a longer run of digits.
 * That fencing is what keeps 403-1234567-8901234 whole — 1234567 does not start
 * with 6 to 9, and 8901234 has no separator after its fifth digit.
 *
 * NO LOOKBEHIND ANYWHERE IN THIS FILE. The phone runs Hermes, whose support for
 * it has been uneven, and a privacy rule that quietly stops matching on one
 * engine is worse than no rule, because nobody would find out.
 */
const IN_TWO_HALVES = /\b[6-9]\d{4}[\s-]\d{5}\b/g;

const EVERY_PATTERN = [WITH_THE_COUNTRY_CODE, IN_TWO_HALVES, EIGHT_OR_MORE_IN_A_ROW];

/**
 * THE MASK.
 *
 * The country-code pattern runs FIRST, and the order is load bearing: "+91 98765
 * 43210" would otherwise have its second half taken by the two-halves pattern and
 * its "+91" left sitting on the line, which is a masked number that still says
 * which country and still looks like a leak of half of something.
 *
 * Anything that is not a string comes back as the empty string rather than being
 * coerced, because String(someObject) is how "[object Object]" ends up in a log,
 * and because a caller handing this a non-string has lost track of what it is
 * printing and should not be helped along.
 */
export function maskNumbers(text) {
  if (typeof text !== 'string' || text === '') return '';
  let out = text;
  for (const pattern of EVERY_PATTERN) out = out.replace(pattern, MASK);
  return out;
}

/**
 * Is there a telephone-shaped run left in this text?
 *
 * Asked by checks, so a failure reads "there is still a number in here" instead
 * of putting two long strings side by side and leaving somebody to spot the
 * difference. A fresh RegExp each time because these carry the global flag, and a
 * global regular expression remembers where it stopped — sharing one between test
 * and replace is how the second caller gets a wrong answer.
 */
export function holdsANumber(text) {
  if (typeof text !== 'string' || text === '') return false;
  return EVERY_PATTERN.some((p) => new RegExp(p.source).test(text));
}
