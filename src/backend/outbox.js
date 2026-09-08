// A tiny, PURE outbox for evidence POSTs that couldn't reach the backend (no
// signal / server down / 5xx). Evidence must never be lost, so a failed POST is
// parked here and flushed on the next app foreground (see evidenceSync.js).
//
// Deduped by (taskId, key): re-queuing the same event replaces the prior entry
// rather than piling up, and because the backend keys events, re-sending after a
// partial success is a safe no-op. Pure data ops only — persistence + network
// live in evidenceSync.js so this stays node-testable.

export function enqueue(queue, item) {
  const q = Array.isArray(queue) ? queue : [];
  const rest = q.filter(
    (x) => !(x.taskId === item.taskId && x.key === item.key),
  );
  return rest.concat([
    { taskId: item.taskId, key: item.key, body: item.body, at: item.at ?? null },
  ]);
}

export function remove(queue, taskId, key) {
  const q = Array.isArray(queue) ? queue : [];
  return q.filter((x) => !(x.taskId === taskId && x.key === key));
}

/**
 * EVERY TASK ID WITH SOMETHING STILL WAITING, each one once.
 *
 * Asked by src/taskStore.js before it forgets a claim the server no longer has:
 * an entry whose evidence is still queued must not be dropped, or the queue
 * would go on retrying against a task nothing on the phone displays any more.
 * See src/forgotten.js, which says why that direction of failure is the safe one.
 */
export function taskIds(queue) {
  const q = Array.isArray(queue) ? queue : [];
  const seen = [];
  for (const item of q) {
    const id = item && item.taskId;
    if (id && !seen.includes(id)) seen.push(id);
  }
  return seen;
}

export function isEmpty(queue) {
  return !Array.isArray(queue) || queue.length === 0;
}

export function size(queue) {
  return Array.isArray(queue) ? queue.length : 0;
}
