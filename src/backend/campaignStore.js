// Backend-sourced campaign cache. Campaigns now come from the backend (real
// UUIDs the app can claim); this holds the last-fetched list, exposes sync
// accessors for the screens + the ConnectScreen prop resolver, and notifies on
// refresh. It never invents campaigns — an empty list means "none published".
import { getCampaign, listCampaigns } from './campaignsApi.js';

let campaigns = [];
let loaded = false;
let listeners = [];
// Campaigns fetched individually by id because they are no longer ACTIVE (paused
// or ended) and so never appear in the list. Kept separate from `campaigns` so
// they can never leak into the Home feed as claimable offers.
let extras = {};
let inflight = {};

function emit() {
  for (const fn of listeners) {
    try {
      fn(campaigns);
    } catch (e) {
      /* a bad listener must not break the store */
    }
  }
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function getAll() {
  return campaigns;
}
export function isLoaded() {
  return loaded;
}
export function getById(id) {
  return campaigns.find((c) => c.id === id) || extras[id] || null;
}

/**
 * Resolve a campaign by id whatever its status — the lookup a CLAIMED task needs.
 *
 * Returns the cached copy if there is one, otherwise fetches GET /campaigns/:id
 * and caches it. Concurrent callers for the same id share one request, so a list
 * of tasks all pointing at the same paused campaign does not fire N fetches.
 */
export async function ensureById(id) {
  if (!id) return null;
  const cached = getById(id);
  if (cached) return cached;
  if (!inflight[id]) {
    inflight[id] = getCampaign(id)
      .then((res) => {
        if (res.ok && res.campaign) {
          extras = { ...extras, [id]: res.campaign };
          emit();
          return res.campaign;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => { delete inflight[id]; });
  }
  return inflight[id];
}
// The active campaign for a marketplace (first match). The current model has one
// test campaign per platform; if several exist, the Task-screen flow always
// passes an explicit campaignId, so this is only the connect-tile fallback.
export function forMarketplace(key) {
  return campaigns.find((c) => c.marketplace === key) || null;
}

export async function load() {
  const res = await listCampaigns();
  if (res.ok) {
    campaigns = res.campaigns;
    loaded = true;
    emit();
  }
  return { ok: res.ok, campaigns };
}

export function reset() {
  campaigns = [];
  extras = {};
  inflight = {};
  loaded = false;
  emit();
}
