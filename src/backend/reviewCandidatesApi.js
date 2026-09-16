// THE REVIEWS THE PHONE FOUND, HANDED TO THE SERVER TO JUDGE.
//
//   POST /tasks/:id/reviews-found        the text of each review page opened
//
// THIS CLIENT SENDS TEXT AND NOTHING ELSE. Not a product, not a star, not a date,
// and above all not whether the review is public. That last one is the payout
// signal — the single fact separating a task that gets paid from one that does
// not — and the endpoint has no field for it, so a phone that tried to send it is
// refused at the door. See backend/src/tasks/dto/found-reviews.dto.ts.
import { authedFetch } from './http.js';

/**
 * Hand over the text of every review page the phone opened. Never throws.
 *
 * The answer carries the server's own verdict and the reason for it, in the
 * shape the one caller logs: ok/status/matched/reason/why. `why` is whatever a
 * failure said — the backend's words or the runtime's — because three different
 * failures all arrive as status 0 and telling them apart is what cost an
 * afternoon on the order read.
 */
export async function sendFoundReviews(taskId, pages) {
  if (!taskId) {
    return { ok: false, status: 0, matched: false, reason: null, why: 'no task' };
  }
  const list = Array.isArray(pages) ? pages.filter((p) => typeof p === 'string') : [];
  const res = await authedFetch(`/tasks/${taskId}/reviews-found`, {
    method: 'POST',
    body: JSON.stringify({ pages: list }),
  });
  if (res.ok && res.body && typeof res.body === 'object') {
    return {
      ok: true,
      status: res.status,
      matched: res.body.matched === true,
      reason: typeof res.body.reason === 'string' ? res.body.reason : null,
      why: null,
    };
  }
  return {
    ok: false,
    status: res.status,
    matched: false,
    reason: null,
    why: (res.body && (res.body.message || res.body.error)) || null,
  };
}
