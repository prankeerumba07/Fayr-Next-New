// Payout destinations and cash-out requests. Thin transport over endpoints that
// ALREADY EXIST and enforce every rule themselves — this file adds no policy:
//
//   GET  /me/payout-methods   the caller's ACTIVE destinations, already MASKED
//   POST /me/payout-methods   add a UPI or bank destination (PAN required)
//   GET  /withdrawals         the caller's own requests, newest first
//   POST /withdrawals         request a cash-out (>= MIN_WITHDRAWAL_PAISE)
//
// The server owns the minimum, the balance re-check under a row lock, PAN
// anchoring and cross-user dedup (backend/src/withdrawals/withdrawal.service.ts).
// Duplicating any of that here would only let the two drift.
//
// Errors carry the server's own message so the screen can show it VERBATIM —
// "PAN is already linked to another account" is a real answer the user can act
// on, and inventing softer copy for it would hide the reason.
import { authedFetch } from './http.js';

const message = (res) => (res.body && res.body.message) || null;

// A NestJS validation failure returns `message` as an ARRAY of strings; a
// business rejection returns a single string. Flatten so callers never have to
// care which kind of refusal they got.
function errorText(res) {
  const m = message(res);
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string' && m) return m;
  return res.status === 0 ? 'Could not reach Fayr. Try again.' : 'Something went wrong.';
}

// GET /me/payout-methods → { ok, methods: [{id, type, label, status, createdAt}] }
// `label` is masked server-side (maskUpi / maskAccount) — it is the ONLY form of
// the destination the app ever sees, so there is nothing here to redact.
export async function getPayoutMethods() {
  const res = await authedFetch('/me/payout-methods', { method: 'GET' });
  return {
    ok: res.ok,
    status: res.status,
    methods: res.ok && Array.isArray(res.body) ? res.body : [],
  };
}

// POST /me/payout-methods → { ok, method } | { ok:false, error }
//
// `pan` is REQUIRED for both types: it is the fraud-model anchor (one PAN per
// user, one user per PAN), enforced in the service. Send only the fields the
// chosen type uses, so a half-filled bank form can't ride along with a UPI id.
export async function addPayoutMethod(input) {
  const i = input || {};
  const body =
    i.type === 'UPI'
      ? { type: 'UPI', pan: i.pan, upiId: i.upiId }
      : {
          type: 'BANK',
          pan: i.pan,
          bankAccount: i.bankAccount,
          ifsc: i.ifsc,
          accountName: i.accountName,
        };
  const res = await authedFetch('/me/payout-methods', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.ok
    ? { ok: true, status: res.status, method: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}

// GET /withdrawals → { ok, withdrawals: [...] } newest first.
export async function getWithdrawals() {
  const res = await authedFetch('/withdrawals', { method: 'GET' });
  return {
    ok: res.ok,
    status: res.status,
    withdrawals: res.ok && Array.isArray(res.body) ? res.body : [],
  };
}

// POST /withdrawals → { ok, withdrawal } | { ok:false, error }
//
// amountPaise goes over the wire as a STRING of integer paise (JSON has no
// BigInt) — the same convention as evidence money. Requesting RESERVES the funds
// immediately (a USER→PAYOUT ledger leg), so the caller must re-read both the
// balance and this list afterwards or the screen will look like money vanished.
export async function requestWithdrawal({ amountPaise, payoutMethodId }) {
  const res = await authedFetch('/withdrawals', {
    method: 'POST',
    body: JSON.stringify({ amountPaise: String(amountPaise), payoutMethodId }),
  });
  return res.ok
    ? { ok: true, status: res.status, withdrawal: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}
