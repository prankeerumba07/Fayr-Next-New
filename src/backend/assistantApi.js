// "Chat with us" — the transport, and nothing more.
//
//   POST /assistant/ask                        ask something
//   POST /assistant/questions/:id/helpful      say whether the reply helped
//   GET  /assistant/questions                  what I asked before
//
// Every one is scoped server-side to the person signed in. A question id
// belonging to anybody else comes back as a 404, so there is nothing for this
// file to check and nothing it could get wrong.
import { authedFetch } from './http.js';

function errorText(res) {
  const m = res.body && res.body.message;
  if (Array.isArray(m)) return m.join('; ');
  if (typeof m === 'string' && m) return m;
  return res.status === 0
    ? 'Could not reach Fayr. Check your connection and try again.'
    : 'Something went wrong. Please try again.';
}

/** POST /assistant/ask → { ok, reply: { questionId, answer, answered, … } } */
export async function ask(question) {
  const res = await authedFetch('/assistant/ask', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
  return res.ok
    ? { ok: true, status: res.status, reply: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}

/** POST /assistant/questions/:id/helpful → { ok } */
export async function sayItHelped(questionId, helpful) {
  const res = await authedFetch(`/assistant/questions/${questionId}/helpful`, {
    method: 'POST',
    body: JSON.stringify({ helpful }),
  });
  return res.ok
    ? { ok: true, status: res.status }
    : { ok: false, status: res.status, error: errorText(res) };
}

/** GET /assistant/questions → { ok, turns: [...] } — mine only, newest first. */
export async function listMyQuestions() {
  const res = await authedFetch('/assistant/questions', { method: 'GET' });
  return {
    ok: res.ok,
    status: res.status,
    turns: res.ok && Array.isArray(res.body) ? res.body : [],
  };
}

// ── the conversation ────────────────────────────────────────────────────────
//
//   GET  /chat            my conversation, oldest message first
//   POST /chat/messages   say something in it
//
// Both scoped server-side to the person signed in; there is no way to ask for
// somebody else's, so there is nothing for this file to check.
//
// READING IS CHEAP ON PURPOSE. The screen reads this every few seconds while it
// is open, so a reply written by a person at Fayr appears without anybody having
// to do anything. A kept-alive connection would save a few seconds and would
// break on a train.

/** GET /chat → { ok, chat } */
export async function readChat() {
  const res = await authedFetch('/chat', { method: 'GET' });
  return res.ok
    ? { ok: true, status: res.status, chat: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}

/** POST /chat/messages → { ok, chat } — the whole conversation, reply included. */
export async function sendChatMessage(message) {
  const res = await authedFetch('/chat/messages', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  return res.ok
    ? { ok: true, status: res.status, chat: res.body }
    : { ok: false, status: res.status, error: errorText(res) };
}
