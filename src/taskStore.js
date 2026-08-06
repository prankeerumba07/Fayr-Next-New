// The on-device task store — now a DISPLAY-ONLY MIRROR of the authoritative
// backend task (Phase 1). It still does the instant OPTIMISTIC transition() so
// the UI reacts the moment evidence is fetched, but the backend is the single
// source of truth: every EVIDENCE event is forwarded to POST /tasks/:id/evidence
// and the returned authoritative task replaces the local copy. The local store
// NEVER independently decides money — refunds live on the backend.
//
// Persistence keeps the (campaignId → taskId) map + last-known authoritative
// snapshot so a relaunch shows real state offline; it is re-derived from
// GET /tasks (the source of truth) on the next foreground.

import { File, Paths } from 'expo-file-system';
import { createTask, transition, STATES } from './taskflow';
import { toEvidenceDto } from './backend/evidenceDto';
import { evidenceKey } from './backend/evidenceKey';
import { claim as claimApi, listTasks } from './backend/tasksApi';

const FILE = 'fayr-tasks-v3.json'; // v3: {campaignId: {taskId, authoritative}}

// entries[campaignId] = { taskId|null, authoritative: TaskResponse|null, optimistic: engineTask }
let entries = {};
let listeners = [];
let syncFn = null; // injected: (taskId, dtoBody) => Promise (see evidenceSync)

function file() {
  return new File(Paths.document, FILE);
}

function notify(campaignId) {
  for (const fn of listeners) {
    try {
      fn(campaignId, getTask(campaignId));
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

// Inject the evidence transport (evidenceSync.syncEvidence). Kept out of this
// module so there's no import cycle and the store stays testable/UI-agnostic.
export function configureSync(fn) {
  syncFn = fn;
}

// ── engine-task <-> backend response ──────────────────────────────────────────

// A fresh CLAIMED engine task for a campaign (platform/category best-effort).
function freshTask(campaignId, platform, category) {
  return createTask({
    id: `local_${campaignId}`,
    platform: platform || 'amazon',
    category: category || null,
  });
}

const msOf = (iso) => {
  if (iso == null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const numOf = (s) => (s == null ? null : Number(s));

// Backend TaskResponse → an engine task shaped exactly as TaskScreen/taskflow
// expect (paise as numbers, dates as ms). This is what makes the authoritative
// state drive the same rendering the optimistic path uses.
function engineTaskFromResponse(tr) {
  const base = freshTask(
    tr.campaign ? tr.campaign.id : tr.id,
    tr.campaign ? String(tr.campaign.platform || '').toLowerCase() : null,
    tr.campaign ? tr.campaign.category : null,
  );
  return Object.freeze({
    ...base,
    id: tr.id,
    state: tr.state,
    order: tr.order
      ? {
          id: tr.order.id,
          date: msOf(tr.order.date),
          itemPaise: numOf(tr.order.itemPaise),
          orderTotalPaise: numOf(tr.order.orderTotalPaise),
          product: tr.order.product,
          source: tr.order.source,
        }
      : null,
    delivery: tr.delivery
      ? { at: msOf(tr.delivery.at), source: tr.delivery.source }
      : null,
    review: tr.review
      ? {
          published: tr.review.published,
          rating: tr.review.rating,
          product: tr.review.product,
        }
      : null,
    returned: tr.returned,
    blocker: tr.blocker,
    blockerReason: tr.blockerReason,
  });
}

// ── accessors ─────────────────────────────────────────────────────────────────

export function getTask(campaignId) {
  const e = entries[campaignId];
  return e ? e.optimistic : null;
}
export function getAuthoritative(campaignId) {
  const e = entries[campaignId];
  return e ? e.authoritative : null;
}
export function getTaskId(campaignId) {
  const e = entries[campaignId];
  return e ? e.taskId : null;
}
export function hasTask(campaignId) {
  const e = entries[campaignId];
  return !!(e && e.taskId);
}
export function getTasks() {
  const out = {};
  for (const cid of Object.keys(entries)) out[cid] = entries[cid].optimistic;
  return out;
}

// ── persistence ─────────────────────────────────────────────────────────────

function persist() {
  try {
    const slim = {};
    for (const cid of Object.keys(entries)) {
      slim[cid] = {
        taskId: entries[cid].taskId,
        authoritative: entries[cid].authoritative,
      };
    }
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify(slim));
  } catch (e) {
    /* best-effort */
  }
}

// Load the persisted map/snapshots synchronously for instant UI, then refresh
// from the backend (source of truth) in the background.
export function load() {
  try {
    const f = file();
    if (f.exists) {
      const parsed = JSON.parse(f.textSync());
      if (parsed && typeof parsed === 'object') {
        entries = {};
        for (const cid of Object.keys(parsed)) {
          const p = parsed[cid] || {};
          entries[cid] = {
            taskId: p.taskId || null,
            authoritative: p.authoritative || null,
            optimistic: p.authoritative
              ? engineTaskFromResponse(p.authoritative)
              : freshTask(cid),
          };
        }
      }
    }
  } catch (e) {
    entries = {};
  }
  for (const cid of Object.keys(entries)) notify(cid);
  // Fire-and-forget refresh from the source of truth.
  refreshFromBackend();
  return entries;
}

// Rebuild the map + snapshots from GET /tasks — the authoritative source.
export async function refreshFromBackend() {
  try {
    const res = await listTasks();
    if (res.ok) {
      for (const tr of res.tasks) applyAuthoritative(tr);
    }
  } catch (e) {
    /* keep last-known state */
  }
}

// ── authoritative apply ───────────────────────────────────────────────────────

// Store a backend TaskResponse as the truth for its campaign, and snap the
// optimistic copy to it so the display can't drift from the server.
export function applyAuthoritative(tr) {
  if (!tr || !tr.campaign || !tr.campaign.id) return;
  const cid = tr.campaign.id;
  entries[cid] = {
    taskId: tr.id,
    authoritative: tr,
    optimistic: engineTaskFromResponse(tr),
  };
  persist();
  notify(cid);
}

// ── claim ─────────────────────────────────────────────────────────────────────

// Explicit claim (spends tickets; idempotent server-side). Seeds the entry from
// the authoritative task the backend returns.
export async function claim(campaignId) {
  const res = await claimApi(campaignId);
  if (res.ok && res.task) {
    applyAuthoritative(res.task);
    return { ok: true, task: res.task };
  }
  return { ok: false, status: res.status, error: res.error };
}

// ── the sync seam ───────────────────────────────────────────────────────────

// The ONLY way a task changes locally. Applies the optimistic transition for
// instant feedback, then (for EVIDENCE on a claimed task) forwards the SAME
// evidence to the backend; the authoritative response snaps the display via
// applyAuthoritative. Non-EVIDENCE events stay local-only in Phase 1 (the
// confirm/review/hold/release actions get their backend wiring in a later phase).
export function dispatch(campaignId, event) {
  let e = entries[campaignId];
  if (!e) {
    e = { taskId: null, authoritative: null, optimistic: freshTask(campaignId) };
    entries[campaignId] = e;
  }

  const res = transition(e.optimistic, event);
  if (res.task !== e.optimistic) {
    e.optimistic = res.task;
    notify(campaignId);
  }

  if (event.type === 'EVIDENCE' && e.taskId && syncFn) {
    // Derive a SUPERSET idempotency key from the evidence CONTENT (not
    // ConnectScreen's bare order-id key), so a purchase-only check and a later
    // purchase+delivery check on the same order get distinct keys and both
    // apply, while an identical re-fetch collapses to a backend no-op.
    const body = toEvidenceDto(event.evidence, evidenceKey(event.evidence));
    // Fire-and-forget: success/queue handled in evidenceSync; the authoritative
    // response returns via applyAuthoritative (injected onApplied).
    Promise.resolve(syncFn(e.taskId, body)).catch(() => {});
  }

  return res;
}

// Dev helper: clear a campaign's LOCAL mirror (does not un-claim on the backend).
export function reset(campaignId) {
  delete entries[campaignId];
  persist();
  notify(campaignId);
  return null;
}
