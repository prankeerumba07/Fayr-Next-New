// Support questions — the only channel a user has when their money is stuck.
//
// All four endpoints already existed and nothing called them, which meant the
// staff "Open questions" queue could never receive a single item. Thin transport
// only; the backend scopes every read to the caller (a foreign id is a 404).
//
//   POST /questions             raise one
//   GET  /questions             my threads, each with its replies inlined
//   GET  /questions/:id         one thread
//   POST /questions/:id/replies follow up on my own thread
//
// A reply's author is inferred server-side from staffUserId: 'staff' means Fayr
// answered, 'user' means the person followed up. The client never sends it.
import { authedFetch } from './http.js';

function errorText(res) {
  const m = res.body && res.body.message;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string' && m) return m;
  return res.status === 0
    ? 'Could not reach Fayr. Check your connection and try again.'
    : 'Something went wrong. Please try again.';
}

/** GET /questions → { ok, questions: [{id, subject, body, status, replies[], …}] } */
export async function listQuestions() {
  const res = await authedFetch('/questions', { method: 'GET' });
  return {
    ok: res.ok,
    status: res.status,
    questions: res.ok && Array.isArray(res.body) ? res.body : [],
  };
}

/** GET /questions/:id → { ok, question } */
export async function getQuestion(id) {
  const res = await authedFetch(`/questions/${id}`, { method: 'GET' });
  return res.ok
    ? { ok: true, status: res.status, question: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}

/**
 * POST /questions → { ok, question }
 * subject <= 200 chars, body <= 5000 (backend DTO). Both required.
 */
export async function askQuestion({ subject, body }) {
  const res = await authedFetch('/questions', {
    method: 'POST',
    body: JSON.stringify({ subject, body }),
  });
  return res.ok
    ? { ok: true, status: res.status, question: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}

/** POST /questions/:id/replies → { ok, question } (the whole thread comes back) */
export async function replyToQuestion(id, body) {
  const res = await authedFetch(`/questions/${id}/replies`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return res.ok
    ? { ok: true, status: res.status, question: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}
