// KEEPING A SIGNED-IN PERSON SIGNED IN.
//
// The sign-in already survives the app being closed: the tokens live in the
// device keychain and are read back at startup. What was missing is the quiet
// part. A renewal only happened AFTER a request had already been refused, so
// somebody who left the app open over lunch came back, tapped something, and
// waited through a failed request before anything worked.
//
// So this decides WHEN to renew, from the token itself, and nothing else. It is
// pure: no fetch, no storage, and the clock is always handed in, so every
// decision here can be checked under node.
//
// WHY READ THE TOKEN AND NOT ASK THE SERVER. The token says when it stops being
// good, in itself. Storing a separate "renew at" would be a second copy of the
// same fact, and the two would disagree the first time a clock was wrong.
//
// NOTHING HERE TRUSTS THE TOKEN. Reading the expiry out of it is scheduling, not
// a security decision — the server checks the signature on every single request.
// A token we cannot read at all is treated as due for renewal now, which is the
// safe way round: renewing when we did not need to costs one request.

/** Renew this long before it stops being good. */
export const RENEW_MARGIN_MS = 2 * 60 * 1000;

/** Never check less often than this, however soon the expiry looks. */
export const MIN_RENEW_DELAY_MS = 5 * 1000;

/** And never wait longer than this without looking, whatever the token says. */
export const MAX_RENEW_DELAY_MS = 10 * 60 * 1000;

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base sixty four, by hand.
 *
 * Written out rather than using a built-in because the built-ins differ: node
 * has Buffer and no atob for a long time, the phone has atob and no Buffer, and
 * a helper that only works in one of them is a helper that cannot be tested.
 */
function decodeBase64Url(input) {
  const clean = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const ch of padded) {
    if (ch === '=') break;
    const at = B64.indexOf(ch);
    if (at === -1) return null; // not base sixty four at all
    value = (value << 6) | at;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * When does this token stop being good? Milliseconds, or null if we cannot tell.
 *
 * Defensive at every step. A token in a shape we did not expect must never throw
 * on the startup path — the whole app is behind this.
 */
export function expiryOf(accessToken) {
  if (typeof accessToken !== 'string' || accessToken === '') return null;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  const json = decodeBase64Url(parts[1]);
  if (!json) return null;
  let payload = null;
  try {
    payload = JSON.parse(json);
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const exp = payload.exp;
  // Seconds since the epoch, which is what the standard says. Anything else is
  // something we do not understand, and guessing at it would be worse.
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
  return exp * 1000;
}

/** Is it time to renew? Unreadable counts as yes: see the note at the top. */
export function shouldRenew(accessToken, now) {
  const at = expiryOf(accessToken);
  if (at === null) return true;
  return at - Number(now) <= RENEW_MARGIN_MS;
}

/**
 * How long to wait before renewing.
 *
 * Kept inside a floor and a ceiling. The floor stops a token that is already
 * expired turning into a renewal every few milliseconds; the ceiling means we
 * still look every ten minutes even if a token claims to last a year, so a
 * server that shortened its lifetime is noticed without anybody being logged out.
 */
export function msUntilRenew(accessToken, now) {
  const at = expiryOf(accessToken);
  if (at === null) return MIN_RENEW_DELAY_MS;
  const wait = at - Number(now) - RENEW_MARGIN_MS;
  if (wait < MIN_RENEW_DELAY_MS) return MIN_RENEW_DELAY_MS;
  if (wait > MAX_RENEW_DELAY_MS) return MAX_RENEW_DELAY_MS;
  return wait;
}

/**
 * The keeper: renew quietly, for as long as somebody is signed in.
 *
 * Takes everything it needs as arguments — the token to look at, the thing that
 * renews, the clock, and how to set a timer — so the whole loop can be run under
 * node with a fake clock and no phone.
 *
 * ONE RENEWAL AT A TIME. The renew function is expected to be single-flight
 * itself, and this waits for it before scheduling the next look, so a slow
 * network cannot pile up renewals behind each other.
 */
export function startKeeper(deps) {
  const getToken = deps.getToken;
  const renew = deps.renew;
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimer || setTimeout;
  const clearTimer = deps.clearTimer || clearTimeout;

  let timer = null;
  let stopped = false;
  let running = false;

  function schedule() {
    if (stopped) return;
    const wait = msUntilRenew(getToken(), now());
    timer = setTimer(() => {
      timer = null;
      void tick();
    }, wait);
  }

  async function tick(force) {
    if (stopped || running) return;
    const token = getToken();
    // Nobody is signed in any more. Stop, rather than renewing nothing forever.
    if (!token && !force) {
      schedule();
      return;
    }
    if (!force && !shouldRenew(token, now())) {
      schedule();
      return;
    }
    running = true;
    try {
      await renew();
    } catch (e) {
      // A renewal that fails is not a reason to stop trying. The transport
      // clears the session itself when a refresh is genuinely dead, and the gate
      // is watching that — so all this has to do is keep looking.
    }
    running = false;
    schedule();
  }

  schedule();

  return {
    /**
     * Look now. Called when the app comes back to the foreground: a phone asleep
     * in a pocket does not run timers, so the scheduled look may be long overdue.
     */
    checkNow() {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      return tick(false);
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
