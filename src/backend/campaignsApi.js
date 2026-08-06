// Read-only campaign fetch from the backend. Campaigns are now backend-sourced
// (real UUIDs) — the app no longer invents ids. Normalizes the backend
// CampaignResponse into the shape the app screens + the (frozen) ConnectScreen
// prop expect.
import { authedFetch } from './http.js';

// Backend CampaignResponse → app shape. Money arrives as a decimal-string paise
// value; the app carries the campaign AMOUNT in whole/decimal rupees (what the
// scraper matcher + TaskScreen compare against), and keeps paise separately.
export function normalizeCampaign(c) {
  const platform = String(c.platform || '').toLowerCase();
  const pricePaise = c.productPricePaise != null ? Number(c.productPricePaise) : null;
  return {
    id: c.id,
    platform,
    marketplace: platform, // ConnectScreen/TaskScreen key off this
    title: c.title || c.productName || '',
    productName: c.productName || '',
    amount: pricePaise != null ? pricePaise / 100 : null, // rupees, for name+amount match
    productPricePaise: pricePaise,
    percent: c.payoutPercent != null ? c.payoutPercent : 100,
    payoutPercent: c.payoutPercent != null ? c.payoutPercent : 100,
    ticketCost: c.ticketCost != null ? c.ticketCost : 5,
    category: c.category || null,
    asin: c.asin || null,
    pid: null, // discovered on a prior fetch only; never from the campaign
    styleId: null,
    imageUrl: c.imageUrl || null,
    terms: c.terms || null,
  };
}

// GET /campaigns → { ok, status, campaigns:[normalized] }. Never throws.
export async function listCampaigns() {
  const res = await authedFetch('/campaigns', { method: 'GET' });
  if (!res.ok) return { ok: false, status: res.status, campaigns: [] };
  const arr = Array.isArray(res.body)
    ? res.body
    : res.body && Array.isArray(res.body.items)
      ? res.body.items
      : [];
  return { ok: true, status: res.status, campaigns: arr.map(normalizeCampaign) };
}
