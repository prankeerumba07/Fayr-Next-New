// Backend-sourced campaign cache. Campaigns now come from the backend (real
// UUIDs the app can claim); this holds the last-fetched list, exposes sync
// accessors for the screens + the ConnectScreen prop resolver, and notifies on
// refresh. It never invents campaigns — an empty list means "none published".
import { listCampaigns } from './campaignsApi.js';

let campaigns = [];
let loaded = false;
let listeners = [];

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
  return campaigns.find((c) => c.id === id) || null;
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
  loaded = false;
  emit();
}
