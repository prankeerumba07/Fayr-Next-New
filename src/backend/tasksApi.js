// Authenticated task calls. These are the money-authoritative endpoints: the
// backend runs the ported state machine and returns the TRUE task state; the app
// only transports evidence and displays what comes back.
import { authedFetch } from './http.js';
import { ACTION_PATHS } from './taskActions.js';

// POST /tasks — claim a campaign (deducts tickets). IDEMPOTENT server-side: a
// second claim for the same open campaign returns the existing task, no
// double-spend. → { ok, status, task } | { ok:false, status, error }.
export async function claim(campaignId) {
  const res = await authedFetch('/tasks', {
    method: 'POST',
    body: JSON.stringify({ campaignId }),
  });
  return res.ok
    ? { ok: true, status: res.status, task: res.body }
    : { ok: false, status: res.status, error: res.body && res.body.message };
}

// GET /tasks — the caller's tasks (newest first). Used on launch to rebuild the
// campaignId → taskId map from the source of truth.
export async function listTasks() {
  const res = await authedFetch('/tasks', { method: 'GET' });
  const arr = res.ok && Array.isArray(res.body) ? res.body : [];
  return { ok: res.ok, status: res.status, tasks: arr };
}

// GET /tasks/:id — one authoritative task.
export async function getTask(taskId) {
  const res = await authedFetch(`/tasks/${taskId}`, { method: 'GET' });
  return res.ok
    ? { ok: true, status: res.status, task: res.body }
    : { ok: false, status: res.status, error: res.body && res.body.message };
}

// POST /tasks/:id/evidence — submit an evidence DTO (already money→string, with
// its idempotency key). Returns the authoritative task after the transition.
export async function postEvidence(taskId, dtoBody) {
  const res = await authedFetch(`/tasks/${taskId}/evidence`, {
    method: 'POST',
    body: JSON.stringify(dtoBody),
  });
  return res.ok
    ? { ok: true, status: res.status, task: res.body }
    : { ok: false, status: res.status, error: res.body && res.body.message };
}

// ── task ACTIONS ────────────────────────────────────────────────────────────
// The four user-driven transitions. Unlike evidence they carry NO body: the
// action is the URL, and the backend runs the same state machine and returns
// the authoritative task. A 409 is the normal way the server says "not from
// this state" (e.g. hold before the review is public) — it is a real answer,
// not a transport failure, so the message is surfaced rather than retried.
// One entry point for all four: taskStore passes the EVENT TYPE, the route comes
// from the shared ACTION_PATHS map, so the URL is defined in exactly one place.
export async function postTaskAction(taskId, type) {
  const path = ACTION_PATHS[type];
  if (!path) return { ok: false, status: 0, error: `unknown task action ${type}` };
  const res = await authedFetch(`/tasks/${taskId}/${path}`, { method: 'POST' });
  return res.ok
    ? { ok: true, status: res.status, task: res.body }
    : { ok: false, status: res.status, error: res.body && res.body.message };
}

// Named wrappers, for callers that want the intent rather than the event type.
export const confirmOrder = (taskId) => postTaskAction(taskId, 'CONFIRM_ORDER');
export const markReviewed = (taskId) => postTaskAction(taskId, 'MARK_REVIEWED');
export const startHold = (taskId) => postTaskAction(taskId, 'START_HOLD');
export const releaseRefund = (taskId) => postTaskAction(taskId, 'RELEASE_REFUND');
