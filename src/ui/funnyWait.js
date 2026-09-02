// WHAT TO SAY WHILE SOMEBODY WAITS, AND THE ONE THING NEVER TO SAY.
//
// THE OWNER'S HARD RULE, in his own words: the waiting screen "must NEVER tell the
// user their marketplace account is being checked. Not in the heading, not in
// small print, not in a loading label, not anywhere."
//
// So these lines are about waiting and nothing else. Not one of them says what is
// happening, which shop it is happening at, or that anything of theirs is being
// looked at. A person reads a light line, the ring turns, and a moment later the
// screen has moved on. The test next door is the guard: it walks every line and
// fails on any of the words the owner listed, in any case, so a line added later
// cannot quietly break the rule.
//
// WHY THEY ROTATE. One line held still for four or five seconds reads as a stuck
// screen. Changing it says the app is alive without saying anything about what it
// is doing.
//
// SIMPLE WORDS ONLY. No abbreviations, no short codes, no jargon, and no double
// dashes. A school child reads every one of these without stopping.
//
// PURE. No React, no timers, no fetch. The screen owns the clock; this owns the
// words.

/** How long each line is shown before the next one. The owner's number. */
export const WAIT_LINE_MS = 2500;

/**
 * The lines, in the order they are shown.
 *
 * Deliberately empty of information. If you are tempted to add one that says what
 * is going on, that is the line the rule above exists to stop.
 */
export const WAIT_LINES = [
  'Hold on. We are having a look.',
  'One moment. We are being careful.',
  'Sit tight. This is the boring bit.',
  'Almost there. Please do not go away.',
  'Still going. Feel free to blink.',
  'Nearly done. Thank you for waiting.',
  'Hang on. We are counting on our fingers.',
  'Any moment now. Good things take a breath.',
];

/**
 * Which line to show, from how long the screen has been up.
 *
 * A sum rather than a stored number, so a screen that redraws for its own reasons
 * cannot skip a line or jump back to the first one.
 */
export function waitLineAt(elapsedMs) {
  const ms = typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs > 0
    ? elapsedMs
    : 0;
  const step = Math.floor(ms / WAIT_LINE_MS);
  return WAIT_LINES[step % WAIT_LINES.length];
}
