// THE PHONE MUST STOP BELIEVING IN CLAIMS THE SERVER HAS FORGOTTEN, AND MUST
// NEVER FORGET ONE FOR ANY OTHER REASON.
//
// Two halves. THE PURE HALF puts the decision through every case that decides
// whether somebody keeps or loses a claim they spent tickets on: a call that
// failed, a call that answered with something that was not a list, a claim still
// in flight, evidence still queued, and the one case that is meant to drop
// things. THE STRUCTURAL HALF reads the store and App.js off disk, because the
// purest decision in the world does nothing if nobody asks it.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { forgottenCampaigns } from './forgotten.js';
import { taskIds, enqueue } from './backend/outbox.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/**
 * HOW MANY WOULD BE FORGOTTEN, and -1 IF IT THREW.
 *
 * ── WHY THIS WRAPPER EXISTS, FOUND BY BREAKING THE CODE ─────────────────────
 *
 * Two of the guards in forgotten.js are the only thing standing between a null
 * and a crash: without them `outboxTaskIds.filter` and `Object.keys(entries)`
 * throw. Called bare, that throw escapes to the top of this file, node kills the
 * process, and NO SUMMARY IS EVER PRINTED. The mutation harness then sees a
 * non-zero exit with nothing run and reports it as caught, which is the exact
 * hole the owner named: a crash is not a catch.
 *
 * So every call goes through here. A throw becomes -1, which fails its check
 * like anything else, and the summary still prints.
 */
function forgetCount(answer, entries, waiting) {
  try {
    const out = forgottenCampaigns(answer, entries, waiting);
    return Array.isArray(out) ? out.length : -1;
  } catch (e) {
    return -1;
  }
}

/** The store's own map shape: campaignId → { taskId, authoritative, optimistic }. */
const ENTRIES = {
  camp_kept: { taskId: 'task_kept', authoritative: { id: 'task_kept' } },
  camp_gone: { taskId: 'task_gone', authoritative: { id: 'task_gone' } },
};
/** A real, successful GET /tasks that still carries one of the two. */
const GOOD = { ok: true, status: 200, gotTheList: true, tasks: [{ id: 'task_kept' }] };
/** Nothing is waiting to be sent. An ARRAY, which is what "we asked" looks like. */
const NOTHING_WAITING = [];

console.log('=== 1. the one case that is meant to drop something ===');
{
  const gone = forgottenCampaigns(GOOD, ENTRIES, NOTHING_WAITING);
  ok(gone.length === 1, 'exactly one of the two is forgotten');
  ok(gone[0] === 'camp_gone', 'and it is the one the server no longer has a task for');
  ok(!gone.includes('camp_kept'),
    'THE ONE THE SERVER STILL HAS SURVIVES, which is most of the point');
}

console.log('\n=== 2. AN EMPTY LIST IS A REAL ANSWER AND IT MEANS EMPTY ===');
{
  // This is the owner's actual bug: the practice database was reloaded, the
  // server has no tasks for this person, and every claim on the phone is a ghost.
  const empty = { ok: true, status: 200, gotTheList: true, tasks: [] };
  const gone = forgottenCampaigns(empty, ENTRIES, NOTHING_WAITING);
  ok(gone.length === 2, 'both believed claims are forgotten');
  ok(gone.includes('camp_kept') && gone.includes('camp_gone'), 'and it is both of them');
}

console.log('\n=== 3. A FAILED CALL CHANGES NOTHING. NOT ONE ENTRY. ===');
{
  const cases = [
    [{ ok: false, status: 0, gotTheList: false, tasks: [] }, 'no signal at all'],
    [{ ok: false, status: 500, gotTheList: false, tasks: [] }, 'our side broke'],
    [{ ok: false, status: 401, gotTheList: false, tasks: [] }, 'the sign-in was refused'],
    [null, 'nothing came back at all'],
    [undefined, 'and nothing at all in the other way'],
    ['not an answer', 'and something that is not an answer'],
  ];
  for (const [answer, why] of cases) {
    ok(forgetCount(answer, ENTRIES, NOTHING_WAITING) === 0,
      `${why}: nothing is forgotten`);
  }
  // FOUND BY BREAKING THE CODE ON PURPOSE. Every case above also has
  // `gotTheList` false, so the guard that reads `ok` could be deleted and all six
  // still passed. listTasks cannot produce this pair — it works `gotTheList` out
  // from `ok` — but a guard nothing reaches is a guard the next edit removes.
  ok(forgetCount(
    { ok: false, status: 500, gotTheList: true, tasks: [] }, ENTRIES, NOTHING_WAITING,
  ) === 0,
  'A CALL THAT FAILED FORGETS NOTHING even if it somehow claims it got the list');
}

console.log('\n=== 4. AND `ok` ON ITS OWN IS NOT ENOUGH ===');
{
  // A 200 whose body we could not read as a list. listTasks turns that into an
  // EMPTY LIST, so a caller looking only at `tasks` cannot tell it apart from
  // "the server has none" — and those two mean opposite things here. Reading it
  // the wrong way would clear every claim on the phone off a malformed reply.
  ok(forgetCount(
    { ok: true, status: 200, gotTheList: false, tasks: [] }, ENTRIES, NOTHING_WAITING,
  ) === 0,
  'a 200 whose body was not a list forgets NOTHING, however empty tasks looks');
  ok(forgetCount(
    { ok: true, status: 200, tasks: [] }, ENTRIES, NOTHING_WAITING,
  ) === 0,
  'and an answer that does not say whether it got the list is treated the same way');
  ok(forgetCount(
    { ok: true, status: 200, gotTheList: true, tasks: 'nope' }, ENTRIES, NOTHING_WAITING,
  ) === 0,
  'and one that claims the list but did not bring one forgets nothing either');
}

console.log('\n=== 5. A CLAIM IN FLIGHT IS NEVER FORGOTTEN ===');
{
  // The store makes the entry the moment the screen acts, before the server has
  // answered about it. It is not missing from the list because it was deleted, it
  // is missing because it has not arrived.
  const midClaim = {
    ...ENTRIES,
    camp_flight: { taskId: null, authoritative: null },
  };
  const gone = forgottenCampaigns(GOOD, midClaim, NOTHING_WAITING);
  ok(!gone.includes('camp_flight'),
    'an entry with no task id yet is left exactly where it is');
  ok(gone.length === 1 && gone[0] === 'camp_gone',
    'and the one that really is gone is still forgotten alongside it');
  const noField = { camp_flight: { authoritative: null } };
  ok(forgetCount(GOOD, noField, NOTHING_WAITING) === 0,
    'and an entry with no task id FIELD at all is the same thing');
}

console.log('\n=== 6. EVIDENCE STILL WAITING IS NEVER FORGOTTEN ===');
{
  // Evidence must never be lost. Dropping the entry would not empty the outbox,
  // it would leave evidence queued against a task nothing on the phone shows, so
  // sending it would change nothing anybody could see.
  const gone = forgottenCampaigns(GOOD, ENTRIES, ['task_gone']);
  ok(gone.length === 0,
    'the entry the server no longer has STAYS, because its evidence is queued');
  const other = forgottenCampaigns(GOOD, ENTRIES, ['task_somebody_else']);
  ok(other.length === 1 && other[0] === 'camp_gone',
    'and a queue holding some OTHER task does not protect this one');
}

console.log('\n=== 7. AND IF WE COULD NOT ASK THE OUTBOX, WE FORGET NOTHING ===');
{
  // Failing this way costs a stale row on a screen. Failing the other way costs
  // somebody the proof they already gathered, so this is the safe direction.
  for (const couldNotAsk of [null, undefined, 0, 'no', {}]) {
    ok(forgetCount(GOOD, ENTRIES, couldNotAsk) === 0,
      `no answer from the outbox (${JSON.stringify(couldNotAsk)}): nothing is forgotten`);
  }
}

console.log('\n=== 8. nothing believed, nothing to do ===');
{
  ok(forgetCount(GOOD, {}, NOTHING_WAITING) === 0, 'an empty map');
  ok(forgetCount(GOOD, null, NOTHING_WAITING) === 0, 'and no map at all');
  ok(forgetCount(GOOD, undefined, NOTHING_WAITING) === 0, 'and no map in the other way');
  ok(forgetCount(GOOD, 'not a map', NOTHING_WAITING) === 0, 'and something that is not one');
  ok(forgetCount(GOOD, { camp_x: null }, NOTHING_WAITING) === 0,
    'and an entry that is not an entry is skipped rather than dropped');
  const junk = { ok: true, status: 200, gotTheList: true, tasks: [null, {}, { id: 'task_kept' }] };
  const gone = forgottenCampaigns(junk, ENTRIES, NOTHING_WAITING);
  ok(gone.length === 1 && gone[0] === 'camp_gone',
    'and rubbish in the list is ignored without taking a real task with it');
}

console.log('\n=== 9. what the outbox reports about itself ===');
{
  ok(taskIds([]).length === 0, 'an empty queue has no tasks waiting');
  ok(taskIds(null).length === 0, 'and neither has no queue');
  let q = [];
  q = enqueue(q, { taskId: 't1', key: 'a', body: {}, at: 1 });
  q = enqueue(q, { taskId: 't1', key: 'b', body: {}, at: 2 });
  q = enqueue(q, { taskId: 't2', key: 'a', body: {}, at: 3 });
  const ids = taskIds(q);
  ok(ids.length === 2, 'TWO ENTRIES FOR ONE TASK COUNT ONCE, not twice');
  ok(ids.includes('t1') && ids.includes('t2'), 'and both tasks are named');
  ok(taskIds([{ key: 'a' }, null, { taskId: '' }]).length === 0,
    'and an item with no task id names nothing rather than an empty string');
}

console.log('\n=== 10. THE STORE ACTUALLY ASKS, AND ACTUALLY WRITES IT DOWN ===');
{
  const store = read('src/taskStore.js');
  const code = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok(/import \{ forgottenCampaigns \} from '\.\/forgotten'/.test(code),
    'the store takes its decision from forgotten.js and does not write its own');
  ok(/forgetWhatIsGone\(answer\);/.test(code),
    'and the refresh calls it');
  // THE WHOLE ANSWER GOES IN, not just the list. A caller that passed only
  // `answer.tasks` would throw away the two guards that keep a failed call safe.
  ok(/forgottenCampaigns\(answer, entries, waiting\)/.test(code),
    'the WHOLE answer is handed over, so the failed-call guards can see it');
  ok(/waiting = outboxFn \? outboxFn\(\) : null;/.test(code),
    'the outbox is asked through the injected reader');

  // EVERYTHING BELOW READS THIS FUNCTION'S OWN BODY AND NOT THE WHOLE FILE.
  // FOUND BY BREAKING THE CODE: the check that a throwing reader answers "we
  // could not ask" was written against the whole file as
  // /catch[\s\S]{0,80}waiting = null;/ and, once comments are stripped, it
  // happily matched refreshFromBackend's OWN catch a few lines above. So the
  // catch body could be changed to say "nothing is waiting" — which would let a
  // broken reader strand somebody's evidence — and the check still passed.
  const body = code.slice(code.indexOf('function forgetWhatIsGone'));
  ok(/\} catch \(e\) \{\s*waiting = null;/.test(body),
    'and a reader that throws answers "we could not ask" rather than "nothing is waiting"');

  // ORDER MATTERS: delete them all, write the file once, then tell everybody. A
  // listener that read the store back mid-way would see a map and a file that
  // disagreed.
  const del = body.indexOf('delete entries[');
  const wrote = body.indexOf('persist();');
  const told = body.indexOf('notify(campaignId);');
  ok(del !== -1 && wrote !== -1 && told !== -1, 'it deletes, writes and notifies');
  ok(del < wrote && wrote < told,
    'IN THAT ORDER: deleted, then written to disk, then everybody told');
  ok(/if \(gone\.length === 0\) return;/.test(body),
    'and a refresh that forgets nothing does not touch the file at all');

  // A DELETION AND NOT A REWRITE. reset() already existed for clearing one
  // campaign by hand; this must not have become a way to blank the whole file.
  ok(!/entries = \{\}/.test(body),
    'it never empties the map wholesale, it removes named keys');
}

console.log('\n=== 11. AND App.js WIRES THE OUTBOX READER ===');
{
  // WITHOUT THIS WIRE NOTHING IS EVER FORGOTTEN. forgottenCampaigns answers an
  // empty list when it cannot see the outbox, which is the safe direction — and
  // it also means a missing wire is a silent no-op rather than a crash. So the
  // wire is checked here.
  const app = read('App.js');
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/configureOutbox/.test(code), 'App.js knows about the outbox wire');
  ok(/configureOutbox\(evidenceSync\.pendingTaskIds\)/.test(code),
    'and it hands the store the real reader');
  const sync = read('src/backend/evidenceSync.js');
  ok(/export function pendingTaskIds\(\)/.test(sync), 'which evidenceSync exports');
  ok(/pendingTaskIds\(\) \{\s*hydrate\(\);/.test(sync),
    'AND HYDRATES FIRST, because the queue that matters is the one left on disk '
    + 'by the last run, not what this run has collected so far');
}

console.log('\n=== 12. and the list call says whether it really got a list ===');
{
  const api = read('src/backend/tasksApi.js');
  ok(/const gotTheList = res\.ok && Array\.isArray\(res\.body\);/.test(api),
    'listTasks decides it from the body itself');
  ok(/return \{ ok: res\.ok, status: res\.status, tasks: arr, gotTheList \};/.test(api),
    'and reports it alongside the tasks');
  ok(/const arr = gotTheList \? res\.body : \[\];/.test(api),
    'and the empty list it falls back to is the SAME decision, so the two cannot '
    + 'drift apart');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
