// The pre-session /auth wire calls. These run BEFORE (or to establish) a
// session, so they carry no bearer — the authed transport lives in http.js.
//
// Every call returns { ok, status, body } and never throws on an HTTP error:
// the UI maps status → a friendly line via describeAuthError. Only a true
// network failure yields status 0.

import { API_BASE } from './config';
import { toE164 } from './format';

async function post(path, body) {
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
