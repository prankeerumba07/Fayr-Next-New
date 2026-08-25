// The evidence → backend seam (Goal A). taskStore.dispatch does the local
// optimistic update, then hands the SAME evidence here to reach the authoritative
// backend. On success the backend's TaskResponse is pushed back to taskStore
// (via the injected `onApplied`); on failure the POST is parked in a persisted
// outbox and retried on the next app foreground — evidence is never lost.
//
// Wired by App.js (dependency-injected, so this module doesn't import taskStore
// and there's no import cycle):
//   evidenceSync.configure({ send: tasksApi.postEvidence, onApplied: taskStore.applyAuthoritative });
//   evidenceSync.start();

import { File, Paths } from 'expo-file-system';
import { AppState } from 'react-native';
import { enqueue, remove, isEmpty } from './outbox.js';

const OUTBOX_FILE = 'fayr-evidence-outbox-v1.json';

let queue = [];
let hydrated = false;
let send = null; // async (taskId, body) => { ok, status, task }
let onApplied = null; // (taskResponse) => void
let flushing = false;
let appStateSub = null;

function file() {
  return new File(Paths.document, OUTBOX_FILE);
}

function persist() {
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify(queue));
  } catch (e) {
    /* best-effort; the in-memory queue still drives this session */
  }
}

function hydrate() {
  if (hydrated) return;
  try {
    const f = file();
    if (f.exists) {
      const parsed = JSON.parse(f.textSync());
      if (Array.isArray(parsed)) queue = parsed;
    }
  } catch (e) {
    queue = [];
  }
  hydrated = true;
}

export function configure(opts) {
  send = opts && opts.send;
  onApplied = opts && opts.onApplied;
}

// Start listening for foregrounds so a queued POST retries the moment the app
// comes back. Idempotent — safe to call once at startup.
export function start() {
  hydrate();
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') flush();
    });
  }
  // Attempt a flush now in case something was left queued from a prior run.
  flush();
}

// Try to POST one evidence body. On success, apply the authoritative task and
// make sure it's not sitting in the outbox. On any failure (network 0 / 5xx /
// even a 4xx), park it — a 4xx is likely transient config, and the backend key
// makes a later re-send a safe no-op. A 2xx that the backend no-ops (duplicate
// key) still returns the authoritative task, so it's treated as success.
export async function syncEvidence(taskId, body) {
  hydrate();
  if (!send || !taskId) {
    // No transport yet, or nothing to post to — queue for later.
    queue = enqueue(queue, { taskId, key: body && body.key, body, at: Date.now() });
    persist();
    return { ok: false, queued: true };
  }
  try {
    const res = await send(taskId, body);
    if (res && res.ok) {
      queue = remove(queue, taskId, body && body.key);
      persist();
      if (onApplied && res.task) onApplied(res.task);
      return { ok: true, task: res.task };
    }
  } catch (e) {
    /* fall through to queue */
  }
  queue = enqueue(queue, { taskId, key: body && body.key, body, at: Date.now() });
  persist();
  return { ok: false, queued: true };
}

// Drain the outbox. Sends are sequential so a shared backend key can't race
// itself; failures stay queued for the next foreground.
export async function flush() {
  hydrate();
  if (flushing || !send || isEmpty(queue)) return;
  flushing = true;
  try {
    for (const item of [...queue]) {
      try {
        const res = await send(item.taskId, item.body);
        if (res && res.ok) {
          queue = remove(queue, item.taskId, item.key);
          persist();
          if (onApplied && res.task) onApplied(res.task);
        }
      } catch (e) {
        /* leave it queued */
      }
    }
  } finally {
    flushing = false;
  }
}

export function pending() {
  hydrate();
  return queue.length;
}
