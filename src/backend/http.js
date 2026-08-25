// The authenticated transport every backend call (Phases 1–2) goes through.
// Attaches the bearer; on a 401 it refreshes ONCE and retries the request a
// single time. A refresh failure clears the session — the auth gate is
// subscribed, so the app routes back to sign-in on its own with no caller code.

import { API_BASE } from './config';
import { refreshTokens } from './authApi';
import * as session from './authSession';

// Single-flight refresh: many requests can 401 at once (e.g. after a long spell
// in the background); they must SHARE one /auth/refresh, not stampede it.
let refreshing = null;

async function doRefresh() {
  const rt = session.getRefreshToken();
  if (!rt) return false;
  const res = await refreshTokens(rt);
  if (res.ok && res.body && res.body.accessToken && res.body.refreshToken) {
    await session.updateTokens(res.body.accessToken, res.body.refreshToken);
    return true;
  }
  // Refresh token expired/revoked → the session is dead. Clearing it notifies
  // the gate, which shows sign-in.
  await session.clearSession();
  return false;
}

function refreshOnce() {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// Authenticated fetch → { ok, status, body } (same shape as authApi). Retries
// once after a successful silent refresh; otherwise returns the 401 as-is
// (session already cleared).
export async function authedFetch(path, options = {}) {
  const attempt = async () => {
    const token = session.getAccessToken();
    // A FormData body MUST set its own content-type, because only the runtime
    // knows the multipart boundary it generated. Forcing application/json here
    // made every file upload arrive as an unparseable body — so the JSON default
    // applies to everything EXCEPT multipart.
    const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
      ...(isMultipart ? null : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
  };

  let out = await attempt();
  if (out.status === 401 && session.getRefreshToken()) {
    const ok = await refreshOnce();
    if (ok) out = await attempt(); // retry once with the rotated token
  }
  return out;
}

// The authenticated principal — a cheap way to prove a restored session is still
// valid, and the seam Phases 1–2 build on.
export function getMe() {
  return authedFetch('/auth/me', { method: 'GET' });
}
