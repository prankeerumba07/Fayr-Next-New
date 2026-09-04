// THE NAME ON A SHOP ACCOUNT, AND WHY THERE IS NOT ONE YET.
//
// WHAT WAS ASKED FOR: "After signing in, read the name on that shop account from
// the shop's own page and show VERIFIED {SHOP} ACCOUNT with the name on it and a
// MANAGE control. If the name cannot be read, the card says the account is
// connected and shows NO name. It never invents one and never leaves a blank
// where a name goes."
//
// THE CARD IS BUILT AND IT WORKS. Both of its shapes are built and both are
// checked: with a name, and with no name. Reading the name off the shop's own
// page is the half that is NOT done, and this file is where it will go.
//
// ── WHY IT IS NOT DONE, EXACTLY ─────────────────────────────────────────────
//
// The only thing in Fayr that can see inside a shop's own page is the web view in
// src/ConnectScreen.js. That file is frozen, in writing, in this same instruction:
// "Do not edit src/ConnectScreen.js — it is frozen and it does not need to
// change." The owner is rebuilding that area himself.
//
// AND IT REALLY DOES NEED ONE LINE IN THAT FILE. A page can only hand something
// back through window.ReactNativeWebView.postMessage, and the connect screen's
// own handler reads every message that arrives like this (src/ConnectScreen.js
// :196 onward):
//
//     setBusy(false);
//     msg = JSON.parse(event.nativeEvent.data);
//     ...
//     if (!msg.ok) { setError(msg.error || 'Fetch failed.'); ... return; }
//
// So a message carrying a name would be read as a failed fetch and the person
// would be shown the words "Fetch failed" on a screen where nothing had failed.
// Sending one anyway would break a working screen to half-build a label.
//
// THE ONE LINE THAT OPENS IT, for whoever unfreezes that file: an early exit at
// the top of onMessage, in the shape the file already uses for its own probe at
// :207 —
//
//     if (msg && typeof msg.__fayrAccountName === 'string') {
//       rememberAccountName(platform.key, msg.__fayrAccountName);
//       return;
//     }
//
// with a small script added to the sign in visit that reads the greeting at the
// top of the shop's own page and posts it. The reader itself is already written
// and already checked: readAccountName in src/signin.js takes the words off a
// shop's own page and answers a name or nothing, and it refuses "Hello, sign in",
// "Hello, Guest" and "Hello, there" outright.
//
// ── WHAT HAPPENS TODAY, THEN ────────────────────────────────────────────────
//
// The card says the account is connected and shows no name, which is the exact
// branch that was asked for when the name cannot be read. It is not a blank where
// a name goes and it is not a guess. And on the day the line above exists, this
// file is the only one that changes.
//
// NOTHING IS HALF SWITCHED ON. There is no store here waiting to be filled and no
// dead code pretending to read anything.

/**
 * THE NAME FAYR HAS READ OFF THIS SHOP'S OWN PAGE, or null.
 *
 * THE LINE THIS FILE ASKED FOR NOW EXISTS. On 5 September 2026 the connect screen
 * was unfrozen to build the gate over a shop's page, and the early exit this file
 * described in writing went in with it: a message carrying a sign in signal is
 * taken by the gate and never reaches the reader's own handler, so it can no
 * longer be read as a failed read.
 *
 * SO THE NAME IS REAL NOW, and it comes from one place. The shop's own page sends
 * the words it printed at the top of itself, readAccountName in src/signin.js
 * decides whether those words are a name, and this remembers the answer.
 *
 * IT IS STILL NEVER INVENTED. readAccountName refuses "Hello, sign in", "Hello,
 * Guest" and "Hello, there" outright, and when it answers nothing the card says
 * the account is connected and shows no name at all.
 *
 * ── WHY IT IS KEPT ONLY FOR THIS RUN OF THE APP ─────────────────────────────
 *
 * It is not written to a file and it is not sent anywhere. A name is the closest
 * thing to a personal detail this whole path ever touches, so it lives in memory
 * for as long as the app is open and goes when the app does. The card then says
 * the account is connected with no name, which is the branch that was built for
 * exactly this and is not a blank where a name goes.
 */

/** What each shop last greeted this person as. Emptied when the app closes. */
const greetedAs = new Map();

/** Remember the name a shop printed at the top of its own page. */
export function rememberAccountName(platformKey, name) {
  const key = String(platformKey || '').toLowerCase();
  if (key === '') return;
  if (typeof name !== 'string' || name.trim() === '') return;
  greetedAs.set(key, name.trim());
}

/** The name, or null when no shop has printed one this run. */
export function accountNameFor(platformKey) {
  const key = String(platformKey || '').toLowerCase();
  const name = greetedAs.get(key);
  return typeof name === 'string' && name !== '' ? name : null;
}

/** For a check: nothing carried over from another one. */
export function forgetAccountNames() {
  greetedAs.clear();
}
