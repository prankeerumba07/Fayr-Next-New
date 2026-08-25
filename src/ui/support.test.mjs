// Regression tests for the Help thread logic.
//
// The case that drives it: a person writes to Fayr because their money is stuck,
// so the thread must always be honest about who is waiting on whom. Trusting the
// backend's ANSWERED flag alone would tell a user "Fayr replied" on a thread they
// have since written to again and are waiting on.

import {
  statusMeta, sortThreads, validateQuestion, validateReply, threadMessages,
  SUBJECT_MAX, BODY_MAX, TOPICS,
} from './support.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const staff = (at) => ({ id: 's', author: 'staff', body: 'looking into it', createdAt: at });
const user = (at) => ({ id: 'u', author: 'user', body: 'any update?', createdAt: at });

console.log('=== 1. who is waiting on whom ===');
{
  ok(statusMeta('OPEN', []).waiting === 'fayr', 'a new question waits on Fayr');
  ok(statusMeta('OPEN', []).label === 'Waiting on Fayr', 'and says so');

  const answered = statusMeta('ANSWERED', [staff('2026-08-13T10:00:00Z')]);
  ok(answered.waiting === 'user' && answered.label === 'Fayr replied', 'a staff reply puts it with the user');

  // The case the flag alone gets wrong.
  const followedUp = statusMeta('ANSWERED', [staff('2026-08-13T10:00:00Z'), user('2026-08-13T11:00:00Z')]);
  ok(followedUp.waiting === 'fayr', 'a user follow-up puts the ball BACK with Fayr, whatever the flag says');
  ok(followedUp.label === 'Waiting on Fayr', 'and the label follows the conversation, not the flag');

  ok(statusMeta('CLOSED', [staff('x')]).waiting === 'none', 'a closed thread waits on nobody');
  ok(statusMeta('CLOSED', []).tone === 'green', 'and reads as settled');
}

console.log('\n=== 2. newest activity first ===');
{
  const a = { id: 'a', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z', replies: [] };
  const b = { id: 'b', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', replies: [staff('2026-08-12T00:00:00Z')] };
  const sorted = sortThreads([a, b]);
  ok(sorted[0].id === 'b', 'an old thread Fayr just answered sorts above a newer quiet one');
  ok(sortThreads(null).length === 0, 'null is an empty list, not a crash');
  ok(sortThreads([{ id: 'x' }]).length === 1, 'a thread with no timestamps still survives sorting');
}

console.log('\n=== 3. validation happens before the request, not as a 400 ===');
{
  ok(validateQuestion({ subject: '', body: 'x' }).ok === false, 'a missing subject is caught here');
  ok(/subject/i.test(validateQuestion({ subject: '  ', body: 'x' }).reason), 'and says which field');
  ok(validateQuestion({ subject: 's', body: '   ' }).ok === false, 'an empty body is caught');
  ok(validateQuestion({ subject: 'a'.repeat(SUBJECT_MAX + 1), body: 'x' }).ok === false, 'over-long subject caught');
  ok(validateQuestion({ subject: 's', body: 'a'.repeat(BODY_MAX + 1) }).ok === false, 'over-long body caught');
  const good = validateQuestion({ subject: '  My refund  ', body: '  where is it  ' });
  ok(good.ok === true && good.subject === 'My refund' && good.body === 'where is it', 'and it trims what it passes on');

  ok(validateReply('').ok === false && validateReply('  ok  ').body === 'ok', 'replies validate and trim too');
  ok(SUBJECT_MAX === 200 && BODY_MAX === 5000, 'limits mirror the backend DTO');
}

console.log('\n=== 4. the thread reads as one conversation ===');
{
  const q = {
    id: 'q1', subject: 'Refund', body: 'my refund is stuck', createdAt: '2026-08-10T00:00:00Z',
    replies: [user('2026-08-12T00:00:00Z'), staff('2026-08-11T00:00:00Z')],
  };
  const msgs = threadMessages(q);
  ok(msgs.length === 3, 'the original question is a message, not a separate header');
  ok(msgs[0].body === 'my refund is stuck' && msgs[0].author === 'user', 'and it comes first');
  ok(msgs[1].author === 'staff' && msgs[2].author === 'user', 'replies are sorted oldest first regardless of input order');
  ok(threadMessages(null).length === 1, 'a missing question degrades to one empty message, not a crash');
  ok(TOPICS.length >= 4 && TOPICS.includes('My refund has not arrived'), 'suggested topics are real user problems');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
