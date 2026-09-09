// THE SHOP IS NOT LETTING US LOOK RIGHT NOW, AND THAT IS NOT THE SAME AS
// "WE COULD NOT FIND YOUR ORDER".
//
// ── WHY THE DIFFERENCE MATTERS MORE THAN ANYTHING ELSE IN THIS FILE ─────────
//
// Those two sentences send a person to two different places. "We could not find
// your order" means look again, send a photograph, check you bought the right
// thing — work, and possibly worry about money. "The shop is not letting us look
// right now" means wait a few minutes. Saying the first when the second is true
// is telling somebody their purchase might not count when in fact nothing is
// wrong with it at all.
//
// ── THE THREE FACES OF IT, ALL MEASURED FROM THE OWNER'S OWN LOG ────────────
//
// 9 September 2026, after the app asked Amazon for its sign in page a second
// time inside four minutes. Amazon served, in order:
//
//   a page whose whole body was "Click the button below to continue shopping"
//   HTTP 503 on /gp/sign-in.html
//   https://www.amazon.in/errors_page/validateCaptcha
//
// Three different-looking things, one meaning: slow down. Nothing in the app
// recognised any of them as that. The first fell through as an ordinary page with
// no signal in it, the 503 arrived as an error code nothing read, and the puzzle
// address did not match the pattern meant to catch it because the pattern had
// Flipkart's spelling of it.
//
// ── FAYR NEVER TOUCHES A PUZZLE ─────────────────────────────────────────────
//
// This file RECOGNISES one. It does not read it, answer it, or look inside it,
// and there is nothing here that could: it takes three plain facts and returns a
// name. The standing rule is that Fayr never types anything into a shop's page,
// and a puzzle is the page where breaking that rule would be most tempting.

/** Why the shop is refusing. Distinct causes, because they are distinct evidence. */
export const A_DEAD_END = 'theDeadEndPage';
export const TOO_MANY_ASKS = 'tooManyAsks';
export const A_PUZZLE = 'aPuzzle';

/**
 * HTTP answers that mean "not now" rather than "not ever".
 *
 * 503 is the one Amazon actually sent. 429 is the same message said properly.
 * Both are the shop rationing us, not the shop being broken and not the order
 * being absent.
 *
 * 404 IS DELIBERATELY NOT HERE. A missing page is a missing page, and calling it
 * rationing would hide a real fault of ours behind "try again in a few minutes"
 * for ever.
 */
export const SLOW_DOWN_CODES = [429, 503];

/**
 * IS THE SHOP REFUSING TO LET US LOOK? A name, or null.
 *
 * `isADeadEnd`  what the injected question answered about the page's own words.
 * `isAPuzzle`   the same, for a page asking whether they are a person.
 * `onAPuzzlePath` whether the address itself is the shop's puzzle address.
 * `statusCode`  what the shop answered, when anything did.
 *
 * ── THE ORDER IS THE ORDER OF CERTAINTY, NOT OF SEVERITY ────────────────────
 *
 * The puzzle first, because a page that says "prove you are a person" is the
 * shop stating the reason out loud and there is nothing to interpret. Then the
 * status code, which is a number the shop chose. The dead end LAST, because it is
 * the only one of the three that is inferred from prose, and prose is the thing
 * most likely to be somebody else's page one day.
 */
export function whyTheShopIsRefusing({
  isADeadEnd = false,
  isAPuzzle = false,
  onAPuzzlePath = false,
  statusCode = null,
} = {}) {
  if (isAPuzzle === true || onAPuzzlePath === true) return A_PUZZLE;
  if (typeof statusCode === 'number' && SLOW_DOWN_CODES.includes(statusCode)) {
    return TOO_MANY_ASKS;
  }
  if (isADeadEnd === true) return A_DEAD_END;
  return null;
}

/**
 * The same question as a yes or no, for a caller that only needs to know whether
 * to stop rather than which of the three it was.
 */
export function theShopIsRefusing(facts) {
  return whyTheShopIsRefusing(facts) != null;
}
