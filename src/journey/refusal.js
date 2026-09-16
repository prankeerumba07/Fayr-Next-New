// WHY OUR OWN SIDE SAID NO, IN ITS OWN WORDS.
//
// A rule with no React in it, in a file with no React in it, so it can be walked
// by a test directly rather than read as source text. Everything else on the buy
// screen that a person reads already works this way — see src/ui/journeyWords.js
// and src/journey/theNotice.js — and this is the same idea for the one sentence
// that arrives at run time instead of being written down in advance.

/**
 * THE SENTENCE OUR SIDE GAVE FOR SAYING NO, OR NULL IF IT DID NOT GIVE ONE.
 *
 * Its own function so the rule is one readable line rather than a condition
 * buried in a handler, and so a test can walk it without a screen.
 *
 * 400 AND NOTHING ELSE. That is the status this server uses when it has decided
 * and written the decision out for the person to read. A 401, a 404, a 500, a
 * connection that never answered: none of those is a sentence anybody wrote, and
 * printing "Internal server error" at somebody mid-purchase would be worse than
 * the general failure it replaced.
 *
 * TRIMMED, AND EMPTY COUNTS AS NOTHING. A body with a blank message is a body
 * with no message.
 */
export function theSentenceTheyGaveUs(answer) {
  if (!answer || answer.status !== 400) return null;
  const said = answer.error;
  if (typeof said !== 'string') return null;
  const trimmed = said.trim();
  return trimmed === '' ? null : trimmed;
}
