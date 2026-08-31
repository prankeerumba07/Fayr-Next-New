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
    payoutCapPaise: c.payoutCapPaise != null ? Number(c.payoutCapPaise) : null,
    ticketCost: c.ticketCost != null ? c.ticketCost : 5,
    // How many days the buyer has to purchase after claiming. NO fallback: if the
    // server did not say, the confirmation screen shows no deadline at all rather
    // than a number this file invented. The server's value comes from the same
    // setting that actually expires the claim.
    claimWindowDays: Number.isInteger(c.claimWindowDays) ? c.claimWindowDays : null,
    // Seats, both counted server-side from real tasks. NO FALLBACK, for the same
    // reason as the claim window: a default here would be a number this file
    // invented. Missing must stay missing so the screen can say nothing — a
    // defaulted 0 would read as "All seats taken" on an offer that is wide open.
    claimedCount: Number.isInteger(c.claimedCount) ? c.claimedCount : null,
    seatsLeft: Number.isInteger(c.seatsLeft) ? c.seatsLeft : null,
    category: c.category || null,
    asin: c.asin || null,
    pid: null, // discovered on a prior fetch only; never from the campaign
    styleId: null,
    imageUrl: c.imageUrl || null,
    terms: c.terms || null,
    // Whether the offer feed shows this greyed out, and what to say on it. The
    // SERVER decides: it is the only place that can see the places left and the
    // last look at the shop page together. Passed through untouched, with no
    // fallback, so an offer is never greyed out on a guess made here.
    availability:
      c.availability && typeof c.availability === 'object'
        ? {
            greyedOut: c.availability.greyedOut === true,
            label:
              typeof c.availability.label === 'string' ? c.availability.label : null,
            reason:
              typeof c.availability.reason === 'string' ? c.availability.reason : null,
          }
        : null,
  };
}

// GET /campaigns/:id → { ok, status, campaign|null }. Never throws.
//
// The LIST endpoint only returns ACTIVE campaigns, so once ops pauses or ends a
// campaign it vanishes from the store — and every screen that resolved a task's
// campaign through the cache showed a blank product for a claim the user still
// has money riding on. This endpoint returns a campaign in ANY status, which is
// exactly what an already-claimed task needs.
export async function getCampaign(id) {
  if (!id) return { ok: false, status: 0, campaign: null };
  const res = await authedFetch(`/campaigns/${id}`, { method: 'GET' });
  if (!res.ok || !res.body || !res.body.id) {
    return { ok: false, status: res.status, campaign: null };
  }
  return { ok: true, status: res.status, campaign: normalizeCampaign(res.body) };
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
