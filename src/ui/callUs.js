// THE CALL ROW ON THE HELP SCREEN, DECIDED WITHOUT DRAWING ANYTHING.
//
// PURE. No React, no Linking — so every judgement about the number can be checked
// under node, the same reason as ui/emailAddress.js and ui/journey.js.
//
// THE APP HOLDS NO NUMBER. Everything here comes from what our side sent back, and
// this file only decides two things: is there something to ring, and what does the
// phone need to be handed in order to ring it. It writes no sentence of its own:
// the heading, the sentence and the button's words all arrive from our side, where
// the plain-language check reads them.
//
// WHAT IT REFUSES, and why that matters more than what it allows: a number that is
// not a full international number never becomes a tappable button. A button that
// does nothing when tapped is worse than no button, because the person keeps
// tapping it while their money is stuck.

/** A full international number: a plus sign, a country code, then digits. */
const FULL_NUMBER = /^\+[1-9]\d{7,14}$/;

/** What a phone needs to start a call, or null when there is nothing to ring. */
export function dialLink(phone) {
  if (typeof phone !== 'string') return null;
  const tidy = phone.trim();
  if (!FULL_NUMBER.test(tidy)) return null;
  return `tel:${tidy}`;
}

/**
 * What the Help screen should show, out of what our side sent.
 *
 * Always returns a heading and a sentence, so there is always something to read.
 * `canCall` is false whenever there is nothing safe to ring, and then there is no
 * button and no number on the screen at all.
 */
export function callRow(fromOurSide) {
  const got = fromOurSide && typeof fromOurSide === 'object' ? fromOurSide : {};
  const title = typeof got.title === 'string' && got.title.trim() ? got.title.trim() : null;
  const words = typeof got.words === 'string' && got.words.trim() ? got.words.trim() : null;
  const link = dialLink(got.phone);
  const button =
    typeof got.button === 'string' && got.button.trim() ? got.button.trim() : null;
  // A number with no words to go with it is still shown; words with no number are
  // the ordinary case. But a button is only ever offered when BOTH the number can
  // be dialled and there are words on the button.
  const canCall = link != null && button != null;
  return {
    title,
    words,
    canCall,
    dialLink: canCall ? link : null,
    button: canCall ? button : null,
  };
}
