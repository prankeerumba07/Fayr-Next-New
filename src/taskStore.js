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
import { claim as claimApi, listTasks, postTaskAction } from './backend/tasksApi';
import { isTaskAction, alreadyApplied } from './backend/taskActions';
import { preferTask } from './ui/tasklist';
import { forgottenCampaigns } from './forgotten';

const FILE = 'fayr-tasks-v3.json'; // v3: {campaignId: {taskId, authoritative}}

// entries[campaignId] = { taskId|null, authoritative: TaskResponse|null, optimistic: engineTask }
let entries = {};
let listeners = [];
let syncFn = null; // injected: (taskId, dtoBody) => Promise (see evidenceSync)
let outboxFn = null; // injected: () => taskId[] still waiting (see evidenceSync)

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

// Inject the outbox reader (evidenceSync.pendingTaskIds). Same reason as above —
// this module must not import evidenceSync — and it is asked before a claim the
// server no longer has is forgotten, so evidence still waiting is never
// stranded. If nothing is injected, NOTHING is ever forgotten: see forgotten.js.
export function configureOutbox(fn) {
  outboxFn = fn;
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
          // ── THE DAY THE SHOP PRINTED, WHICH WAS BEING THROWN AWAY HERE ────
          //
          // MEASURED ON THE OWNER'S OWN TASK, 16 September 2026: "Order date:
          // Not available" beside an order whose page plainly says 2 June.
          //
          // The day was read, written down, stored, shown to staff and — once
          // the response learned to send it — put on the wire. THIS LINE IS
          // WHERE IT DIED. This function does not pass the order through; it
          // rebuilds it field by field, so a field nobody lists is a field that
          // silently does not exist on the device, however well the backend
          // carries it. That is the same way `quantity`, `match`, `image` and
          // `statusText` were each lost in turn, and the comments below are the
          // record of it.
          //
          // NOT A DATE AND NEVER READ AS ONE. `date` above is an instant the
          // purchase window is tested against; a shop that prints only a day
          // cannot give one and dateToSubmit refuses to invent a time. This is
          // the day, for showing.
          dateRaw: tr.order.dateRaw == null ? null : String(tr.order.dateRaw),
          itemPaise: numOf(tr.order.itemPaise),
          // ── AND WHAT THE PAGE SAID THE OFFER'S OWN PRODUCT COST ──────────
          //
          // NOT a resolver input and never passed to one. It is the row the
          // screen shows as the product's price, so that an order holding two
          // products does not fall back to showing the BILL — which on the
          // owner's order was ₹1,331.00 against a product that cost ₹938.00.
          matchedPricePaise: numOf(tr.order.matchedPricePaise),
          // The resolver's other inputs. Dropping these meant the device's copy
          // of resolveChargedPaise ran on a third of its evidence — `quantity`
          // was being SENT by the backend and thrown away right here, so every
          // multi-unit order looked like "count unknown" on the screen while the
          // backend paid a real figure. src/chargedAmount.test.mjs reads the
          // resolver's inputs out of its own source and checks each one survives.
          unitPricePaise: numOf(tr.order.unitPricePaise),
          lineTotalPaise: numOf(tr.order.lineTotalPaise),
          quantity: tr.order.quantity == null ? null : tr.order.quantity,
          orderTotalPaise: numOf(tr.order.orderTotalPaise),
          itemAmountAmbiguous: tr.order.itemAmountAmbiguous === true,
          product: tr.order.product,
          source: tr.order.source,
          // Kept, not dropped: the confirm screen's ambiguity and price warnings
          // are driven off `match`, and stripping it here made them vanish the
          // moment the authoritative response replaced the optimistic copy.
          match: tr.order.match || null,
          orderConfirmed: tr.order.orderConfirmed === true,
          // TaskScreen renders both of these; dropping them here is why the
          // order photo and status row never appeared for ANY platform once the
          // authoritative snapshot landed.
          image: tr.order.image || null,
          statusText: tr.order.statusText || null,
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
// True while a task ACTION is in flight — the screen disables the buttons so a
// second tap can't race the first.
export function isPending(campaignId) {
  const e = entries[campaignId];
  return !!(e && e.pending);
}
// The last action failure for this task ('' when the last one succeeded). Shown
// on screen: an action that silently does nothing is the exact bug this whole
// change exists to remove.
export function getActionError(campaignId) {
  const e = entries[campaignId];
  return (e && e.actionError) || null;
}
export function clearActionError(campaignId) {
  const e = entries[campaignId];
  if (e && e.actionError) {
    e.actionError = null;
    notify(campaignId);
  }
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
//
// TWO HALVES, AND THE SECOND ONE IS NEW. Adding was all this ever did: every task
// the server returned was written over the local copy, and a local copy the
// server never mentioned was left alone for ever. So a claim deleted on our side
// stayed believed on the phone, the claim page and the terms box were skipped,
// and somebody was dropped on "Before you go" holding an offer no record existed
// of. Now the list is subtracted from as well as added to.
export async function refreshFromBackend() {
  try {
    const answer = await listTasks();
    if (answer.ok) {
      for (const tr of answer.tasks) applyAuthoritative(tr);
    }
    forgetWhatIsGone(answer);
  } catch (e) {
    /* keep last-known state */
  }
}

// Drop the local mirror of any claim the server no longer has a task for.
//
// EVERY GUARD THAT DECIDES THIS LIVES IN src/forgotten.js, on purpose: getting it
// wrong loses somebody's claim, so the decision is pure and walked under node
// against a failed call, a body that was not a list, a claim still in flight and
// evidence still queued. What is left here is only the doing of it.
//
// Deleted all at once, then written to disk once, then every listener told. A
// listener that reads the store back mid-way through would otherwise see a file
// and a map that disagreed.
function forgetWhatIsGone(answer) {
  let waiting = null;
  try {
    waiting = outboxFn ? outboxFn() : null;
  } catch (e) {
    // A broken reader is not permission to guess. Null means "we could not ask",
    // and forgottenCampaigns answers that with an empty list.
    waiting = null;
  }
  const gone = forgottenCampaigns(answer, entries, waiting);
  if (gone.length === 0) return;
  for (const campaignId of gone) delete entries[campaignId];
  persist();
  for (const campaignId of gone) notify(campaignId);
}

// ── authoritative apply ───────────────────────────────────────────────────────

// Store a backend TaskResponse as the truth for its campaign, and snap the
// optimistic copy to it so the display can't drift from the server.
//
// The map is keyed by campaignId, so a campaign the user has claimed TWICE has
// two candidate tasks for one slot. GET /tasks arrives newest-first, so plain
// assignment let the LAST write — the oldest, already-closed task — win, and a
// user who re-claimed saw "This claim expired" over their live claim. preferTask
// decides instead: an open task always beats a closed one, then newer wins.
export function applyAuthoritative(tr) {
  if (!tr || !tr.campaign || !tr.campaign.id) return;
  const cid = tr.campaign.id;
  const current = entries[cid] ? entries[cid].authoritative : null;
  const winner = preferTask(current, tr);
  if (winner !== tr) return; // an older/closed row lost — leave the display alone
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
//
// `acceptedTerms` comes from the tick box on the product page and is handed
// through untouched. NO DEFAULT anywhere on this path: the server refuses a claim
// that does not carry it, and a default here would claim somebody accepted terms
// they never saw.
export async function claim(campaignId, acceptedTerms) {
  const res = await claimApi(campaignId, acceptedTerms);
  if (res.ok && res.task) {
    applyAuthoritative(res.task);
    return { ok: true, task: res.task };
  }
  return { ok: false, status: res.status, error: res.error };
}

// ── the sync seam ───────────────────────────────────────────────────────────

// Run a task ACTION against the backend. Deliberately NOT the evidence pattern:
//   - no optimistic commit. The local copy is never moved ahead of the server,
//     so it cannot silently drift — the exact failure that let a tapped
//     "I've written my review" vanish on the next fetch;
//   - no offline queue. You cannot honestly release a refund offline, and a
//     queued action replayed later against a changed state would just 409;
//   - the authoritative response REPLACES the local copy via applyAuthoritative,
//     the same seam evidence already uses.
function runAction(campaignId, e, type) {
  if (alreadyApplied(type, e.authoritative)) return;
  e.pending = true;
  e.actionError = null;
  notify(campaignId);
  Promise.resolve(postTaskAction(e.taskId, type))
    .then((res) => {
      e.pending = false;
      if (res && res.ok && res.task) {
        applyAuthoritative(res.task); // wholesale replace — no merge, no drift
      } else {
        // A 409 is the server's real answer ("cannot start hold from DELIVERED",
        // "Order amount is unknown"). Show it verbatim rather than inventing copy.
        e.actionError = (res && res.error) || 'Could not reach Fayr. Try again.';
        notify(campaignId);
      }
    })
    .catch(() => {
      e.pending = false;
      e.actionError = 'Could not reach Fayr. Try again.';
      notify(campaignId);
    });
}

// The ONLY way a task changes locally.
//
// EVIDENCE keeps the optimistic path: it follows a slow WebView fetch the user
// has already left, so instant local feedback is worth the reconciliation.
// The four ACTIONS are server-first (see runAction) — they are single taps on a
// visible screen, so a brief pending state is cheaper than any risk of the
// display claiming something the backend never agreed to.
export function dispatch(campaignId, event) {
  let e = entries[campaignId];
  if (!e) {
    e = { taskId: null, authoritative: null, optimistic: freshTask(campaignId) };
    entries[campaignId] = e;
  }

  // Pre-flight ONLY for actions: run the local engine to catch an obviously
  // invalid tap (and keep the instant "Not yet" alert) without committing it.
  if (isTaskAction(event.type)) {
    const pre = transition(e.optimistic, event);
    if (pre.rejected) return pre;
    if (!e.taskId) {
      return { task: e.optimistic, changed: false, rejected: true,
        reason: 'This task isn’t synced with Fayr yet.' };
    }
    runAction(campaignId, e, event.type);
    return { task: e.optimistic, changed: false, reason: 'sent to Fayr' };
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
