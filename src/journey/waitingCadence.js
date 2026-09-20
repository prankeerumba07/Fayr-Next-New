// A STEP WHOSE ONLY JOB IS TO WAIT ASKS OUR SIDE AGAIN BY ITSELF. WHEN, ONLY.
//
// ── THE REHEARSAL THIS COMES FROM ──────────────────────────────────────────
//
// 21 September 2026, the owner's own Zepto order, with the hold set to two
// minutes for a rehearsal. The review was found, the record moved to HOLDING,
// and the app drew "Your refund unlocks in 2 minutes". Two minutes later the
// scheduler released the money — and the screen went on saying the same thing,
// because nothing on it ever asked again. The refund had landed and the person
// watching could not tell.
//
// The journey already re-reads the record on two occasions: whenever the store
// changes, and whenever the screen is arrived at. Neither of those happens while
// somebody sits still and watches a countdown, and that is the one moment of the
// whole journey where sitting still and watching is exactly what we ask of them.
//
// ── AND IT IS ONLY THE WAIT FOR MONEY ──────────────────────────────────────
//
// HOLDING and nothing else. Every other step is waiting for something a PERSON
// does — buy it, use it, review it — and no amount of asking our side brings any
// of those closer. HOLDING is waiting for a clock we can read, so it is the one
// step where asking again is the difference between a screen that moves by
// itself and one that needs to be poked.
//
// PURE. No React, no fetch, no clock: the clock is handed in.

/**
 * HOW CLOSE THE END HAS TO BE BEFORE ASKING AGAIN IS WORTH ANYTHING.
 *
 * Five minutes. A person does not sit and watch a three hour hold, and a screen
 * that asks every minute for three hours is asking on behalf of nobody — they
 * have put the phone down, and coming back is an arrival, which already
 * re-reads. Five minutes is the span over which somebody really does wait and
 * watch, and it comfortably contains the rehearsal hold this was measured on.
 */
export const IN_SIGHT_MS = 5 * 60 * 1000;

/**
 * THE LONGEST IT WILL SIT WITHOUT ASKING while the end IS in sight, and the
 * shortest gap it will ever leave between two asks.
 *
 * AFTER_MS is a minute because the release runs on a one minute cadence, so a
 * window that has closed is paid within the minute and asking twice inside it is
 * asking for the same answer. AT_MOST_MS is the same minute for the same reason.
 * FLOOR_MS is not a cadence at all: it is the guard that stops a window ending
 * one millisecond from now turning a chain of timers into a spin.
 */
export const AT_MOST_MS = 60 * 1000;
export const AFTER_MS = 15 * 1000;
export const FLOOR_MS = 2 * 1000;

/** The one state where asking again can change what the screen says. */
export const THE_WAITING_STATE = 'HOLDING';

/**
 * WHEN TO ASK OUR SIDE AGAIN, in milliseconds from now, or NULL for "do not".
 *
 * `state`         the record's own state.
 * `windowEndsAt`  when the refund becomes due, in milliseconds, or null.
 * `now`           the clock, handed in, so every case can be walked.
 *
 * NULL FOR AN UNKNOWN WINDOW, and that is deliberate rather than defensive: a
 * HOLDING task with no window is a record that has not worked out when the money
 * is due, and asking every minute would not make it work it out. It is a thing
 * to fix on our side, not to poll at.
 */
export function askAgainIn({ state, windowEndsAt, now } = {}) {
  if (state !== THE_WAITING_STATE) return null;
  if (typeof windowEndsAt !== 'number' || !Number.isFinite(windowEndsAt)) return null;
  if (typeof now !== 'number' || !Number.isFinite(now)) return null;
  const left = windowEndsAt - now;
  // THE WINDOW HAS CLOSED AND THE MONEY HAS NOT MOVED YET. The release runs on
  // its own cadence, so this is a short wait for a thing already due.
  if (left <= 0) return AFTER_MS;
  if (left > IN_SIGHT_MS) return null;
  // ONE MORE THAN THE WAIT, so the ask happens just after the window rather than
  // just before it, and never longer than a minute so a screen left open on a
  // four minute wait still moves while somebody is looking at it.
  return Math.max(FLOOR_MS, Math.min(left + 1000, AT_MOST_MS));
}
