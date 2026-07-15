// The single task, persisted across launches.
//
// Device-only for now. The authoritative task will live in the NestJS service:
// this device copy is forgeable and must never be the thing that moves money.
// It is kept deliberately thin - load, dispatch, save, notify - so that porting
// the rules to the backend later means moving taskflow.js, not this file.
//
// Stored with expo-file-system (Paths.document) rather than SecureStore: a task
// with its event history outgrows SecureStore's per-item size limit, and none of
// it is a secret. The session cookies that ARE secret stay in session.js.

import { File, Paths } from 'expo-file-system';
import { createTask, transition, STATES } from './taskflow';
import { CAMPAIGN } from './campaign';

const FILE = 'fayr-task-v1.json';

let task = null;
let listeners = [];

function file() {
  return new File(Paths.document, FILE);
}

function notify() {
  listeners.forEach((fn) => {
    try { fn(task); } catch (e) { /* a bad listener must not break the store */ }
  });
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function getTask() {
  return task;
}

function fresh() {
  return createTask({
    id: 'task_demo_1',
    platform: CAMPAIGN.marketplace,
    campaignId: CAMPAIGN.id,
    asin: CAMPAIGN.asin,
    product: CAMPAIGN.productName,
    category: CAMPAIGN.category,
  });
}

// Restore, or start a fresh CLAIMED task. A task whose file is corrupt or from
// an older shape is discarded rather than migrated - it is a demo task, and
// half-restoring one would produce exactly the "looks like data but isn't"
// state the flow is built to avoid.
export function load() {
  try {
    const f = file();
    if (f.exists) {
      const parsed = JSON.parse(f.textSync());
      if (parsed && parsed.id && parsed.state && STATES[parsed.state]) {
        task = Object.freeze(parsed);
        notify();
        return task;
      }
    }
  } catch (e) {
    /* fall through to a fresh task */
  }
  task = fresh();
  save();
  notify();
  return task;
}

function save() {
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify(task));
  } catch (e) {
    /* persistence is best-effort; the in-memory task is still usable */
  }
}

// The ONLY way the task changes. Every mutation goes through taskflow's
// transition() so the atomic/idempotent guarantees hold here too.
export function dispatch(event) {
  if (!task) load();
  const res = transition(task, event);
  if (res.task !== task) {
    task = res.task;
    save();
    notify();
  }
  return res;
}

export function reset() {
  task = fresh();
  save();
  notify();
  return task;
}
