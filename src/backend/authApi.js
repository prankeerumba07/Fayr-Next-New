// The pre-session /auth wire calls. These run BEFORE (or to establish) a
// session, so they carry no bearer — the authed transport lives in http.js.
//
// Every call returns { ok, status, body } and never throws on an HTTP error:
// the UI maps status → a friendly line via describeAuthError. Only a true
// network failure yields status 0.

import { API_BASE } from './config';
import { toE164 } from './format';
// Safe direction: authSession imports nothing from here (or from http.js), so
// this cannot form a cycle.
import * as session from './authSession';
import { refuseWhileShowing } from './showing';

async function post(path, body) {
  // Every call in this file is a POST, and one of them sends a real text message
  // to a real handset. While the walk through is open, none of them go.
  const refused = refuseWhileShowing('POST', path);
  if (refused) return refused;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, body: { message: String((e && e.message) || e) } };
  }
  let parsed = null;
  try {
    parsed = await res.json();
  } catch (e) {
    parsed = null;
  }
  return { ok: res.ok, status: res.status, body: parsed || {} };
}

// → { expiresInSeconds, resendInSeconds }  (or 429 with resendInSeconds).
export function requestOtp(mobile) {
  return post('/auth/otp/request', { mobile: toE164(mobile) });
}

// → { user: { id, mobile }, accessToken, refreshToken }  (or 401 on bad code).
export function verifyOtp(mobile, code) {
  return post('/auth/otp/verify', {
    mobile: toE164(mobile),
    code: String(code == null ? '' : code).trim(),
  });
}

// Used by http.js on a 401 → { accessToken, refreshToken }.
export function refreshTokens(refreshToken) {
  return post('/auth/refresh', { refreshToken });
}

export function logout(refreshToken) {
  return post('/auth/logout', { refreshToken });
}

/**
 * Log out properly: REVOKE the refresh token server-side, then forget the
 * session locally.
 *
 * Clearing the keychain alone — which is all "Log out" used to do — left a live
 * refresh token on the server that could still mint access tokens. `logout` and
 * its endpoint both already existed; nothing called them.
 *
 * Revocation is best-effort by design. A user offline, or on a dead backend,
 * must still be able to log out of the device, so a failed revoke never blocks
 * the local clear. It is reported back so a caller can tell the difference
 * rather than assume success: `{ revoked: boolean }`.
 */
export async function signOut() {
  const refreshToken = session.getRefreshToken();
  let revoked = false;
  if (refreshToken) {
    const res = await logout(refreshToken);
    revoked = !!(res && res.ok);
  }
  await session.clearSession();
  return { revoked };
}
