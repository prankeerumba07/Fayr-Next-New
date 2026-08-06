// Authenticated task calls. These are the money-authoritative endpoints: the
// backend runs the ported state machine and returns the TRUE task state; the app
// only transports evidence and displays what comes back.
import { authedFetch } from './http.js';

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
