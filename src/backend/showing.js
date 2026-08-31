// SHOWING THE APP, RATHER THAN USING IT.
//
// The walk through opens every screen in the design, one after another, with real
// data behind it. That means real screens with real buttons, and a real button
// spends a real claim, moves real money, or sends a real text message to a real
// handset. None of that may happen while somebody is being shown the app.
//
// Hiding the buttons would not do it. A screen decides what to show from what the
// server tells it, and there are forty one real screens here; the first one whose
// button gets missed spends five tickets that nobody meant to spend. So the block
// is not in the screens at all. It is in the three places a request can leave this
// app, and it is stated as a rule about the REQUEST rather than about the screen:
//
//   while the walk through is open, nothing but a GET leaves the device.
//
// A GET cannot spend a claim, move money, or send a text. Everything that can is
// a POST, a PATCH or a DELETE, so this one rule covers every one of them,
// including the ones nobody has written yet.
//
// It is deliberately NOT a mock. A mocked screen is a picture of a screen: it
// shows what somebody imagined rather than what the app does. The real screens
// read the real practice data through the real requests, and only the writing is
// refused.

/** True only while the walk through is on screen. Off everywhere else, always. */
let showing = false;

/**
 * Turn the block on when the walk through opens, off when it closes.
 *
 * Called from exactly two places, both in the walk through itself. It is not a
 * setting and it is not remembered: an app that came back from being killed with
 * the block still on would refuse every write with no way for anybody to tell why.
 */
export function showTheApp(on) {
  showing = on === true;
}

/** Whether the block is on. For the walk through's own notice, and for tests. */
export function isShowingTheApp() {
  return showing === true;
}

/**
 * The one check every request path makes before it goes anywhere.
 *
 * Returns null to let the request through, or the same { ok, status, body } shape
 * every caller in this app already handles, so a refusal reads to a screen exactly
 * like a server that said no. Nothing is thrown: a screen that crashes on a
 * refused write is a worse way to find out than a screen that says it cannot.
 *
 * status is 0, which this app's transport already uses to mean "this never left
 * the device". A 4xx would be a lie about where the answer came from.
 */
export function refuseWhileShowing(method, path) {
  if (!showing) return null;
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET') return null;
  return {
    ok: false,
    status: 0,
    body: {
      message:
        'The walk through is open, so nothing was sent. It is for showing the '
        + 'app, not for using it: while it is on screen this app reads and never '
        + 'writes, so no claim is spent, no money moves and no text message goes '
        + 'out. Close the walk through and do this from the app itself.',
      refusedBecause: 'showing-the-app',
      wouldHaveBeen: `${verb} ${String(path || '')}`,
    },
  };
}
