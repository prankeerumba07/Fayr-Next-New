// The signed-in user: their balances (GET /me/wallet) and their profile
// (GET/PATCH /me). The profile calls are what make setup RESUMABLE — every answer
// is saved as it is given, so the step to show is derived from the server rather
// than from local state a reinstall would lose.
//
// getWallet returns the ticket count and the refundable balance in integer paise
// (a string on the wire). Nothing here throws — screens degrade to placeholders on
// failure rather than crashing on a bad network.
import { authedFetch } from './http.js';

export async function getWallet() {
  const res = await authedFetch('/me/wallet', { method: 'GET' });
  if (!res.ok) return { ok: false, status: res.status };
  const b = res.body || {};
  return {
    ok: true,
    ticketBalance: b.ticketBalance != null ? Number(b.ticketBalance) : 0,
    walletBalancePaise: b.walletBalancePaise != null ? String(b.walletBalancePaise) : '0',
  };
}

/**
 * The user's own profile. `setupDone` is the server's one-way latch and decides
 * whether the setup sequence runs at all; `termsVersion` / `termsAcceptedAt` are the
 * consent record. Never throws — a failure returns ok:false and the caller decides.
 */
export async function getProfile() {
  const res = await authedFetch('/me', { method: 'GET' });
  if (!res.ok) return { ok: false, status: res.status };
  const b = res.body || {};
  return {
    ok: true,
    profile: {
      id: b.id || null,
      displayId: b.displayId || null,
      name: b.name || null,
      ageBand: b.ageBand || null,
      gender: b.gender || null,
      categories: Array.isArray(b.categories) ? b.categories : [],
      platforms: Array.isArray(b.platforms) ? b.platforms : [],
      setupDone: b.setupDone === true,
      termsVersion: b.termsVersion || null,
      termsAcceptedAt: b.termsAcceptedAt || null,
      hasPan: b.hasPan === true,
    },
  };
}

/**
 * Save part of the profile. PATCH is PROGRESSIVE on the server — only the fields
 * present are written — which is what lets each setup screen save as it is answered
 * instead of everything at the end.
 */
export async function patchProfile(patch) {
  const res = await authedFetch('/me', {
    method: 'PATCH',
    body: JSON.stringify(patch || {}),
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: (res.body && (res.body.message || res.body.error)) || null,
    };
  }
  return { ok: true, profile: res.body || {} };
}
