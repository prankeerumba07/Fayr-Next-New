// The signed-in user's own balances (GET /me/wallet). Read-only. Returns the
// ticket count and the refundable wallet balance in integer paise (string on
// the wire). Never throws — screens degrade to placeholders on failure.
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
