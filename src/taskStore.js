// The tasks - one per campaign - persisted across launches.
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
import { CAMPAIGNS, campaignById } from './campaign';

// Bumped from v1 (single task) to v2 (campaignId -> task map). Old files are
// ignored, not migrated - a demo task half-restored into a new shape is exactly
// the "looks like data but isn't" state the flow is built to avoid.
const FILE = 'fayr-tasks-v2.json';

let tasks = {};       // campaignId -> frozen task
let listeners = [];   // fns(campaignId, task)

function file() {
  return new File(Paths.document, FILE);
}

function notify(id) {
  listeners.forEach((fn) => {
    try { fn(id, tasks[id]); } catch (e) { /* a bad listener must not break the store */ }
  });
}

// subscribe((campaignId, task) => …). Screens filter to the campaign they show.
export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

export function getTask(campaignId) {
  return tasks[campaignId] || null;
}

export function getTasks() {
  return tasks;
}

function freshFor(c) {
  return createTask({
    id: 'task_' + c.id,
    platform: c.marketplace,
    campaignId: c.id,
    asin: c.asin || null,
    product: c.productName,
    category: c.category,
  });
}

// Restore each campaign's task, or start a fresh CLAIMED one. A task whose
// stored shape is corrupt or stale is discarded rather than migrated.
export function load() {
  let stored = {};
  try {
    const f = file();
    if (f.exists) {
      const parsed = JSON.parse(f.textSync());
      if (parsed && typeof parsed === 'object') stored = parsed;
    }
  } catch (e) {
    /* fall through to fresh tasks */
  }
  tasks = {};
  CAMPAIGNS.forEach((c) => {
    const s = stored[c.id];
    tasks[c.id] = (s && s.id && s.state && STATES[s.state]) ? Object.freeze(s) : freshFor(c);
  });
  save();
  CAMPAIGNS.forEach((c) => notify(c.id));
  return tasks;
}

function save() {
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify(tasks));
  } catch (e) {
    /* persistence is best-effort; the in-memory tasks are still usable */
  }
}

// The ONLY way a task changes. Every mutation goes through taskflow's
// transition() so the atomic/idempotent guarantees hold here too.
export function dispatch(campaignId, event) {
  if (!Object.keys(tasks).length) load();
  const cur = tasks[campaignId];
  if (!cur) return { task: null, changed: false, reason: `unknown campaign ${campaignId}` };
  const res = transition(cur, event);
  if (res.task !== cur) {
    tasks[campaignId] = res.task;
    save();
    notify(campaignId);
  }
  return res;
}

export function reset(campaignId) {
  const c = campaignById(campaignId);
  if (!c) return null;
  tasks[campaignId] = freshFor(c);
  save();
  notify(campaignId);
  return tasks[campaignId];
}
