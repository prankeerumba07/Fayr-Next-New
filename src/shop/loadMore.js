// "LOAD MORE" — HOW MANY TIMES, AND WHEN TO STOP.
//
// ── THE RUN THAT ASKED FOR THIS, 18 September 2026 ──────────────────────────
//
// The owner walked his live Zepto claim on a real phone. The order read ran
// perfectly — eight list rows, eight order pages opened, every one of them a
// 200, every one of them posted to the server — and answered matched=0 seven
// times in a row. Nothing was broken. The order it was looking for was simply
// not among the eight it could see.
//
// ZEPTO-BRIEF.md, 15 September 2026 evening, measured on his own signed-in
// account in Chrome: "The order list loads eight at a time behind a 'Load More'
// button. Seven presses loads all 64 orders, back to November 2024. Any read
// that stops at the first eight sees four weeks of history." It lists this as
// item (f) and says plainly what it costs: "It cannot wait for a real user who
// buys something and then buys eight more things before the look runs."
//
// ── THE LIMIT, AND WHY IT IS SEVEN ─────────────────────────────────────────
//
// SEVEN IS NOT A ROUND NUMBER SOMEBODY LIKED. It is the measured number of
// presses that exhausts the owner's own account, and exhausting the list is the
// only stopping point that is not arbitrary: the press after the last one finds
// no button and stops on its own, so on a smaller account the limit never bites
// at all. It is a ceiling on a runaway loop, not a policy about how far back to
// look.
//
// WHAT A PRESS COSTS, SAID HONESTLY. Nothing is navigated and no page is
// reloaded: the list is already open, a press is one click and a wait for the
// new rows to appear and hold still. Measured against the numbers this project
// already uses, that is two steady looks — 600ms — plus whatever the shop takes
// to answer. Seven of those is a few seconds, once, on a screen that already
// spends 45.
//
// AND WHAT IT DOES NOT BUY, WHICH MATTERS MORE. Expanding the list to 64 rows
// does NOT mean 64 orders are read. detailLook.js slices the list to
// MOST_DETAIL_PAGES, which is ten, and LookingForItScreen gives the whole read
// MOST_TIME_MS, which is 45 seconds at about 1.1 seconds an order page. So this
// file widens what the read can SEE and changes nothing about what it can open.
// An order sixty rows back is still out of reach, and the two numbers that put
// it there are in a different file and are a different decision — how long a
// person is willing to watch a spinner. That is written down here rather than
// discovered later.
//
// ── AN UNBOUNDED LOOP ON SOMEBODY'S PHONE IS NOT ACCEPTABLE ────────────────
//
// Three conditions stop it and any one of them is enough. Two of them can be
// answered inside the shop's own page and the third cannot: whether an order
// MATCHED is the server's answer and the server has not been asked yet when the
// list is being expanded. It is in the rule anyway, and the screen supplies it,
// because a rule that quietly drops a condition it cannot currently reach is
// how the condition stops existing.

/**
 * HOW MANY TIMES THE BUTTON IS PRESSED, AT MOST.
 *
 * A NAMED CONSTANT AND NOT A LITERAL IN A LOOP, which is the whole reason this
 * file exists rather than a `7` somewhere in an injected script: a bound on
 * somebody's phone has to be findable by the next person who wonders why a read
 * took as long as it did.
 */
export const PRESSES_AT_MOST = 7;

/**
 * HOW MANY ROWS EACH PRESS IS EXPECTED TO ADD, on the one shop this is measured
 * for. Used only to say in the log whether a press did anything, never to decide
 * whether to press again — that is the button's presence, which is a fact about
 * the page rather than an expectation about it.
 */
export const ROWS_A_PRESS_ADDS = 8;

/**
 * THE WORDS ON THE BUTTON, PER SHOP.
 *
 * ── MEASURED FOR ZEPTO AND FOR NOBODY ELSE ─────────────────────────────────
 *
 * "Load More" is quoted from ZEPTO-BRIEF.md, read off the owner's own signed-in
 * account. Blinkit and Instamart are NOT here, and that is the same rule this
 * whole phase runs on: nobody has looked at either shop's order list, so there
 * is no wording to put here, and inventing one would give two shops a press loop
 * hunting a button that may not exist.
 *
 * LOWER CASE, because the page's text is lowered before it is compared. A shop
 * that renders it in capitals is the same button.
 */
export const LOAD_MORE_WORDS = {
  zepto: ['load more'],
};

/** Does this shop's order list hide older orders behind a button? */
export function shopPressesForMore(platformKey) {
  const words = LOAD_MORE_WORDS[String(platformKey || '').toLowerCase()];
  return Array.isArray(words) && words.length > 0;
}

/** The words to look for on this shop's button, or an empty list for a shop with none. */
export function loadMoreWordsFor(platformKey) {
  const words = LOAD_MORE_WORDS[String(platformKey || '').toLowerCase()];
  return Array.isArray(words) ? words.slice() : [];
}

/**
 * SHOULD IT BE PRESSED AGAIN?
 *
 * `pressesSoFar`  how many presses have already happened.
 * `buttonIsThere` whether the shop is still offering one.
 * `orderFound`    whether the order being looked for has already been matched.
 *
 * THE THREE STOPS, AND ANY ONE OF THEM ENDS IT:
 *
 *   the order was found    there is nothing left to look for, so looking
 *                          further is somebody's phone working for nothing;
 *   the button is gone     the shop has no more to give. This is the ordinary
 *                          ending on any account smaller than the limit, and it
 *                          is the reason the limit is a backstop rather than a
 *                          policy;
 *   the limit was reached  the backstop. An unbounded loop driven by a page we
 *                          do not control is not something to put on somebody's
 *                          phone, however well the first two behave.
 *
 * A non-number for `pressesSoFar` counts as the limit being reached, not as
 * zero. This answer decides whether to act on somebody's device, and the safe
 * direction for an input this file cannot read is to stop.
 */
export function shouldPressAgain({ pressesSoFar, buttonIsThere, orderFound } = {}) {
  if (orderFound === true) return false;
  if (buttonIsThere !== true) return false;
  if (typeof pressesSoFar !== 'number' || !Number.isFinite(pressesSoFar)) return false;
  return pressesSoFar < PRESSES_AT_MOST;
}

/**
 * WHY IT STOPPED, IN WORDS, FOR THE LOG.
 *
 * Asked separately from shouldPressAgain rather than returned beside it, so that
 * the answer used to ACT is a plain yes or no and cannot be read wrong. A run
 * that ends on the limit and a run that ends because the shop ran out of orders
 * look identical in a row count and are completely different facts about the
 * account.
 */
export function whyItStopped({ pressesSoFar, buttonIsThere, orderFound } = {}) {
  if (orderFound === true) return 'the order was found';
  if (buttonIsThere !== true) return 'the button is gone';
  if (typeof pressesSoFar !== 'number' || !Number.isFinite(pressesSoFar)) {
    return 'the count of presses could not be read';
  }
  if (pressesSoFar >= PRESSES_AT_MOST) return `the limit of ${PRESSES_AT_MOST} presses was reached`;
  return 'it has not stopped';
}
