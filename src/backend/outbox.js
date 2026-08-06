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

export function isEmpty(queue) {
  return !Array.isArray(queue) || queue.length === 0;
}

export function size(queue) {
  return Array.isArray(queue) ? queue.length : 0;
}
