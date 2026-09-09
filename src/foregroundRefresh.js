// COMING BACK TO FAYR FROM A SHOP, AND ASKING OUR OWN SIDE WHAT CHANGED.
//
// ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
//
// Everything a person does at Amazon happens where Fayr cannot see it. They
// leave, they buy, they come back — and until now nothing asked our side what
// had happened in between. The screens watch the store, the store is only
// refreshed on launch, so somebody who left the app open saw the state from
// whenever they last started it.
//
// ── WHY THE DECISION IS A FILE AND THE DOING IS THREE LINES IN App.js ───────
//
// Because a phone cannot be made to produce these moments on demand. iOS reports
// "active" for a great many things that are not somebody coming back from a shop:
// pulling the notification shade down and up again, glancing at the app switcher,
// dismissing a call. Each of those is an event, and each of them would otherwise
// be a fetch. Whether to act on one is a decision with three inputs and a clock,
// and every combination of those can be walked under node.
//
// NOTHING HERE FETCHES ANYTHING. It answers yes or no.

/**
 * NOT MORE OFTEN THAN THIS, however many times the phone says "active".
 *
 * ── WHY TEN SECONDS AND NOT A MINUTE ───────────────────────────────────────
 *
 * The event worth catching is somebody walking back from Amazon, and that is
 * minutes away from the last one at the very least. The events worth collapsing
 * are the shade, the switcher and the call, and those come in bursts of two or
 * three inside a second or two.
 *
 * A minute would be safer for the network and WRONG FOR THE PERSON: they could
 * come back, look at a stale screen, leave for the shop again to check, and come
 * back inside the minute to the same stale screen. Ten seconds collapses every
 * burst and cannot make somebody wait.
 */
export const NOT_MORE_OFTEN_THAN_MS = 10 * 1000;

/**
 * SHOULD WE ASK OUR SIDE WHAT CHANGED?
 *
 * `nextState`  what the phone just said. Only 'active' is coming back.
 * `signedIn`   whether there is anybody to ask about.
 * `lastAt`     when we last asked, or null if we never have.
 * `now`        the clock, handed in, so this can be walked.
 *
 * ── AND IT NEVER FIRES FOR SOMEBODY WHO IS NOT SIGNED IN ───────────────────
 *
 * The owner asked for that in those words. A fetch with no session is refused,
 * the transport treats a refusal as a reason to renew, and a renewal with no
 * refresh token clears the session — so a refresh fired at a signed-out app is
 * not merely wasted, it is a way to reach the sign-in screen from the sign-in
 * screen. The guard is first for that reason and not for tidiness.
 *
 * A FIRST TIME ALWAYS GOES. `lastAt` of null is not "we asked at time zero", it
 * is "we have never asked", and those must not be the same answer.
 */
export function shouldRefreshOnForeground({ nextState, signedIn, lastAt, now }) {
  if (nextState !== 'active') return false;
  if (signedIn !== true) return false;
  if (lastAt == null) return true;
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt)) return true;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  // A CLOCK THAT WENT BACKWARDS IS NOT PERMISSION TO REFUSE. If `now` is before
  // the last time we asked, something is wrong with the clock rather than with
  // the person, and the safe answer is to ask.
  if (at < lastAt) return true;
  return at - lastAt >= NOT_MORE_OFTEN_THAN_MS;
}
