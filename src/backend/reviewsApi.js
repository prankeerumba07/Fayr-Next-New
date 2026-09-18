// THE REVIEW A PERSON WROTE INSIDE FAYR, to and from our own side.
//
// TWO CALLS AND NOTHING ELSE. Neither of them moves a task, sends evidence or
// touches money — the server side says the same in as many words.
//
// THE SCORE IS NOT SENT. The app works one out as somebody types, because a live
// indicator cannot be a network call per keystroke, and that number stays on the
// phone. The server scores the text it stores, from its own copy of the rules,
// because a number arriving from a phone is a number somebody can set to
// whatever they like.
//
// AND THE TEXT IS SENT EXACTLY AS IT WAS TYPED. No trim, no whitespace
// collapsing, no tidying of any kind on the way out — the same rule the server
// keeps on the way in. What is stored is what they wrote.
//
// NOTHING HERE THROWS. Every call answers with what happened, the same shape as
// tasksApi.js next door.
import { authedFetch } from './http.js';

/** GET /tasks/:id/review → { ok, status, review|null }. */
export async function getReview(taskId) {
  if (!taskId) return { ok: false, status: 0, review: null };
  const res = await authedFetch(`/tasks/${taskId}/review`, { method: 'GET' });
  return res.ok
    ? { ok: true, status: res.status, review: res.body || null }
    : { ok: false, status: res.status, review: null,
      error: res.body && res.body.message };
}

/**
 * PUT /tasks/:id/review → { ok, status, review }.
 *
 * A 409 is the server saying it has not matched an order for this task yet,
 * which is a real answer rather than a transport failure: a review about a
 * purchase nobody has confirmed is a review about nothing. Its own sentence is
 * surfaced rather than replaced with one of ours.
 */
export async function putReview(taskId, text, stars) {
  if (!taskId) return { ok: false, status: 0, review: null };
  // THE STARS ARE SENT ONLY WHEN THERE ARE SOME. A null would be a field the
  // server has to interpret; leaving it out says "they have not said" with no
  // interpreting at all, which is the same thing the column means.
  const body = typeof stars === 'number' ? { text, stars } : { text };
  const res = await authedFetch(`/tasks/${taskId}/review`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return res.ok
    ? { ok: true, status: res.status, review: res.body || null }
    : { ok: false, status: res.status, review: null,
      error: res.body && res.body.message };
}
