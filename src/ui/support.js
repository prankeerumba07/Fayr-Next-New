// What the Help screens show. Pure, so it is tested under node.
//
// The one thing worth getting right here: a person writes to Fayr when their
// money is stuck, so the thread must always say who is waiting on whom. A
// question the user has already followed up on is NOT "answered", and an
// ANSWERED thread the user has since replied to is back with Fayr.

/** Backend QuestionStatus: OPEN | ANSWERED | CLOSED. */
export function statusMeta(status, replies) {
  const list = Array.isArray(replies) ? replies : [];
  const last = list.length ? list[list.length - 1] : null;
  const lastWasUser = last ? last.author === 'user' : true;

  if (status === 'CLOSED') {
    return { label: 'Closed', tone: 'green', waiting: 'none' };
  }
  // Trust the conversation over the flag: staff set ANSWERED when they reply, but
  // the user may have written again since, which puts the ball back with Fayr.
  if (status === 'ANSWERED' && !lastWasUser) {
    return { label: 'Fayr replied', tone: 'blue', waiting: 'user' };
  }
  return { label: 'Waiting on Fayr', tone: 'amber', waiting: 'fayr' };
}

/** Newest activity first — a thread Fayr just answered should not sit at the bottom. */
export function sortThreads(questions) {
  const list = Array.isArray(questions) ? questions.slice() : [];
  const stamp = (q) => {
    const times = [q.updatedAt, q.createdAt]
      .concat((q.replies || []).map((r) => r.createdAt))
      .map((s) => (s ? Date.parse(s) : NaN))
      .filter((n) => !Number.isNaN(n));
    return times.length ? Math.max.apply(null, times) : 0;
  };
  return list.sort((a, b) => stamp(b) - stamp(a));
}

/** Can this be sent? Mirrors the backend DTO limits so a 400 is never the first feedback. */
export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

export function validateQuestion({ subject, body }) {
  const s = String(subject == null ? '' : subject).trim();
  const b = String(body == null ? '' : body).trim();
  if (!s) return { ok: false, reason: 'Add a short subject so we can route it.' };
  if (s.length > SUBJECT_MAX) return { ok: false, reason: `Keep the subject under ${SUBJECT_MAX} characters.` };
  if (!b) return { ok: false, reason: 'Tell us what happened.' };
  if (b.length > BODY_MAX) return { ok: false, reason: `That is longer than ${BODY_MAX} characters.` };
  return { ok: true, reason: null, subject: s, body: b };
}

export function validateReply(body) {
  const b = String(body == null ? '' : body).trim();
  if (!b) return { ok: false, reason: 'Write a reply first.' };
  if (b.length > BODY_MAX) return { ok: false, reason: `That is longer than ${BODY_MAX} characters.` };
  return { ok: true, reason: null, body: b };
}

/**
 * The full thread as a flat message list, oldest first — the original question is
 * the first message, not a separate header, so the conversation reads as one.
 */
export function threadMessages(question) {
  const q = question || {};
  const first = { id: `${q.id}:q`, author: 'user', body: q.body, createdAt: q.createdAt };
  const replies = (Array.isArray(q.replies) ? q.replies.slice() : []).sort(
    (a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0),
  );
  return [first].concat(replies);
}

/** Suggested subjects — the real reasons a Fayr user gets stuck, in their words. */
export const TOPICS = [
  'My refund has not arrived',
  'My order was not found',
  'My review is not being detected',
  'A problem with my withdrawal',
  'Something else',
];
