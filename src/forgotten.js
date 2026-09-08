// WHAT THE SERVER HAS FORGOTTEN, AND WHAT WE MUST THEREFORE FORGET TOO.
//
// ── THE BUG THIS EXISTS TO CLOSE ────────────────────────────────────────────
//
// src/taskStore.js keeps a claim per campaign in a file on the phone and refreshes
// it from GET /tasks. That refresh only ever ADDED: every task the server returned
// was written over the local copy, and a local copy the server never mentioned
// was left exactly where it was, for ever.
//
// So a claim that no longer exists on our side stayed believed on the phone. The
// screens read "this campaign is claimed" from that file, so the claim page and
// the terms tick box were skipped and the person was dropped on "Before you go"
// holding an offer nobody had a record of. Nothing they did there could ever be
// paid.
//
// ── WHY A REAL DELETION IS THE ONLY THING THAT SHOULD CAUSE THIS ────────────
//
// A claim does not normally disappear. It expires, it is cancelled, it is
// refunded: all three leave the row in place with a reason on it, and the app
// SHOWS those rather than hiding them (see closedInfo in src/ui/stages.js —
// hiding a dead claim is how the app used to pretend it never happened). The only
// way a task vanishes from GET /tasks is if the row itself was removed from our
// records.
//
// Today that means one thing: somebody has reset or reloaded the practice
// database while a phone was still holding the old rows. That is a development
// situation and not a thing a real person's phone will meet often. It is worth
// handling properly anyway, because the failure it produces is silent, it lands
// on the one screen where somebody is about to spend their own money, and the
// person has no way to tell what went wrong or to clear it themselves.
//
// ── AND WHY THE ANSWER IS A LIST AND NOT AN ACTION ──────────────────────────
//
// Because getting this wrong loses somebody's claim, and a claim is a real thing
// they spent tickets on. So the decision is a pure function that answers "these
// campaign keys, and no others", and it can be put through the cases a phone
// cannot be made to produce on demand: a call that failed, a call that answered
// with something that was not a list, a claim still in flight, evidence still
// waiting to be sent.

/**
 * WHICH LOCAL CAMPAIGN KEYS THE SERVER NO LONGER HAS A TASK FOR.
 *
 * `answer`        exactly what src/backend/tasksApi.js listTasks returned.
 * `entries`       the store's own map, campaignId → { taskId, ... }.
 * `outboxTaskIds` every task id with evidence still waiting to be sent, from
 *                 src/backend/evidenceSync.js pendingTaskIds. `null` means we
 *                 could not ask.
 *
 * ── FOUR REASONS TO DROP NOTHING, EACH ONE ITS OWN GUARD ────────────────────
 *
 * 1. THE CALL DID NOT SUCCEED. No signal, our side down, a 500: `ok` is false and
 *    the honest answer is that we learned nothing. Believing an old claim is
 *    harmless; throwing one away because a train went into a tunnel is not.
 *
 * 2. THE BODY WAS NOT A LIST. `ok` on its own is NOT enough. A 200 carrying
 *    something that is not a list of tasks tells us nothing about which tasks
 *    exist, and reading it as "the server has none" would clear every claim on
 *    the phone. That is why listTasks reports `gotTheList` separately: it already
 *    turns a body it could not read into an empty list, and an empty list is a
 *    real answer that means something completely different.
 *
 * 3. WE COULD NOT ASK ABOUT THE OUTBOX. If nothing told us what evidence is
 *    waiting, we cannot promise we are not about to throw some away, so we drop
 *    nothing at all. Failing this way costs a stale row on a screen. Failing the
 *    other way costs somebody the proof they already gathered.
 *
 * 4. AN EMPTY MAP. Nothing to do, and no reason to touch the file.
 *
 * A GENUINELY EMPTY LIST IS NOT ONE OF THOSE FOUR. `ok`, a real list, and nothing
 * in it means the server has no tasks for this person, and every believed claim
 * is exactly the ghost this function exists to remove.
 */
export function forgottenCampaigns(answer, entries, outboxTaskIds) {
  // 1. and 2. — the call has to have succeeded AND come back with a real list.
  if (!answer || typeof answer !== 'object') return [];
  if (answer.ok !== true) return [];
  if (answer.gotTheList !== true) return [];
  if (!Array.isArray(answer.tasks)) return [];
  // 3. — no way to check the outbox, so no dropping.
  if (!Array.isArray(outboxTaskIds)) return [];
  // 4. — nothing believed locally.
  if (!entries || typeof entries !== 'object') return [];

  const stillThere = new Set();
  for (const task of answer.tasks) {
    if (task && typeof task === 'object' && task.id) stillThere.add(task.id);
  }
  const evidenceWaiting = new Set(outboxTaskIds.filter((id) => !!id));

  const forget = [];
  for (const campaignId of Object.keys(entries)) {
    const entry = entries[campaignId];
    if (!entry || typeof entry !== 'object') continue;

    // A CLAIM IN FLIGHT HAS NO TASK ID YET. The store makes the entry the moment
    // the screen acts, before the server has answered about it. It is not missing
    // from the list because it was deleted, it is missing because it has not
    // arrived, and dropping it would race the claim it is waiting for.
    const taskId = entry.taskId || null;
    if (taskId == null) continue;

    if (stillThere.has(taskId)) continue;

    // EVIDENCE STILL WAITING TO BE SENT. src/backend/outbox.js parks a failed
    // evidence POST and src/backend/evidenceSync.js retries it on the next
    // foreground, keyed by task id. Dropping the entry would not delete the
    // outbox, but it would leave evidence queued against a task the phone no
    // longer shows, so nothing would ever display the result of sending it.
    // Evidence must never be lost, so the entry stays until its outbox is clear.
    if (evidenceWaiting.has(taskId)) continue;

    forget.push(campaignId);
  }
  return forget;
}
