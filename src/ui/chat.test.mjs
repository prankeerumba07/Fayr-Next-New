// "Chat with us" — every decision the screen makes, checked without React.
//
// The screen is a conversation now, not a list of question-and-answer pairs. The
// thing that changed and the thing most worth checking is the same: a reply
// written by a real person at Fayr has to be tellable from one the answer book
// produced, by somebody glancing at their phone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FEEDBACK_NO,
  FEEDBACK_PROMPT,
  FEEDBACK_YES,
  INTRO,
  QUESTION_MAX,
  SCREEN_TITLE,
  chatView,
  messagesFrom,
  statusLine,
  validateQuestion,
} from './chat.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const msg = (over) => ({
  id: 'm1', author: 'PERSON', from: 'Them', body: 'where is my refund',
  language: 'en', sentAt: '2026-08-31T05:00:00.000Z', fromAPerson: false,
  questionId: 'q1', helpful: null, ...over,
});

const conversation = (over) => ({
  chatId: 'c1', state: 'ASSISTANT', stateInWords: 'The assistant is handling this',
  takenBy: null, startedAt: '2026-08-31T05:00:00.000Z',
  lastMessageAt: '2026-08-31T05:01:00.000Z',
  withTheAssistant: true, waitingForAPerson: false, closed: false,
  messages: [
    msg({ id: 'm1', author: 'PERSON' }),
    msg({ id: 'm2', author: 'ASSISTANT', from: 'Fayr assistant',
          body: 'Your money comes back once your review is live.' }),
  ],
  ...over,
});

console.log('=== 1. what can be sent ===');
{
  ok(validateQuestion('what are tickets').ok, 'ordinary words go');
  ok(validateQuestion('  hi  ').question === 'hi', 'it trims');
  ok(!validateQuestion('').ok, 'an empty box is refused');
  ok(!validateQuestion('   ').ok, 'and so are only spaces');
  ok(!validateQuestion(null).ok, 'and so is nothing at all');
  const long = validateQuestion('a'.repeat(QUESTION_MAX + 1));
  ok(!long.ok, 'too long is refused');
  ok(long.reason.includes(String(QUESTION_MAX)), 'and it says how long is too long');
  ok(validateQuestion('a'.repeat(QUESTION_MAX)).ok, 'exactly the limit is fine');
}

console.log('\n=== 2. the messages ===');
{
  const out = messagesFrom(conversation({}));
  ok(out.length === 2, 'both messages come through');
  ok(out[0].who === 'you', 'their own words are theirs');
  ok(out[1].who === 'fayr', 'the reply is ours');
  ok(out[1].tone === 'answer', 'an answer reads as an answer');
  ok(out[1].label === null, 'and carries no label');

  const ids = out.map((m) => m.id);
  ok(new Set(ids).size === ids.length, 'every message has its own name');
}

console.log('\n=== 3. a reply from a real person ===');
{
  // The whole reason this screen changed.
  const out = messagesFrom(conversation({
    state: 'TAKEN', takenBy: { id: 's1', name: 'Asha' }, withTheAssistant: false,
    messages: [
      msg({ id: 'm1', author: 'PERSON', body: 'do you deliver to Kathmandu' }),
      msg({ id: 'm2', author: 'ASSISTANT', from: 'Fayr assistant',
            body: 'I could not answer this one yet.' }),
      msg({ id: 'm3', author: 'AGENT', from: 'Asha', fromAPerson: true,
            body: 'We only send things inside India for now.' }),
    ],
  }));
  ok(out[2].tone === 'person', 'a reply from a person reads differently');
  ok(out[2].label === 'Asha', 'and it carries their name');
  ok(out[1].tone !== out[2].tone,
    'the assistant and a person never look the same');
  ok(out[2].who === 'fayr', 'it is still on Fayr’s side of the screen');
}

console.log('\n=== 4. waiting for a person ===');
{
  const waiting = conversation({
    state: 'WAITING_FOR_PERSON', waitingForAPerson: true, withTheAssistant: false,
    messages: [
      msg({ id: 'm1', author: 'PERSON', body: 'do you deliver to Kathmandu' }),
      msg({ id: 'm2', author: 'ASSISTANT', from: 'Fayr assistant',
            body: 'I could not answer this one yet.' }),
    ],
  });
  const out = messagesFrom(waiting);
  ok(out[1].tone === 'waiting', 'the reply says it is waiting');
  ok(out[1].label === 'Waiting for a person', 'with a label saying so');

  // Only the LAST one. An older answer was a real answer at the time and must
  // not be repainted as a failure because a later question could not be answered.
  const mixed = messagesFrom(conversation({
    waitingForAPerson: true, withTheAssistant: false,
    messages: [
      msg({ id: 'm1', author: 'PERSON' }),
      msg({ id: 'm2', author: 'ASSISTANT', from: 'Fayr assistant', body: 'A real answer.' }),
      msg({ id: 'm3', author: 'PERSON', body: 'do you deliver to Kathmandu' }),
      msg({ id: 'm4', author: 'ASSISTANT', from: 'Fayr assistant', body: 'I could not answer that.' }),
    ],
  }));
  ok(mixed[1].tone === 'answer', 'the earlier answer stays an answer');
  ok(mixed[3].tone === 'waiting', 'only the newest one is waiting');
}

console.log('\n=== 5. who has it, in words ===');
{
  ok(statusLine(conversation({})) === null,
    'nothing is said while the assistant is handling it');
  ok(statusLine(conversation({ waitingForAPerson: true, withTheAssistant: false }))
      === 'A person from Fayr will reply here.',
    'somebody waiting is told a person is coming');
  ok(statusLine(conversation({
        state: 'TAKEN', withTheAssistant: false, takenBy: { id: 's1', name: 'Asha' },
      })) === 'Asha from Fayr is helping you.',
    'and once somebody has it, they are named');
  ok(statusLine(conversation({ closed: true })) === 'This conversation is closed.',
    'a closed one says so');
  ok(statusLine(null) === null, 'and nothing at all is not a crash');
}

console.log('\n=== 6. did that help ===');
{
  const asked = chatView({ chat: conversation({}), draft: '', busy: false, loading: false });
  ok(asked.feedback !== null, 'it asks after a reply');
  ok(asked.feedback.questionId === 'q1', 'against the right question');
  ok(asked.feedback.prompt === FEEDBACK_PROMPT, 'with the one prompt');
  ok(asked.feedback.yes === FEEDBACK_YES && asked.feedback.no === FEEDBACK_NO,
    'and two plain answers');

  const already = chatView({ chat: conversation({
    messages: [msg({ id: 'm1' }), msg({ id: 'm2', author: 'ASSISTANT', helpful: true })],
  }) });
  ok(already.feedback === null, 'and stops asking once they have said');

  const saidNo = chatView({ chat: conversation({
    messages: [msg({ id: 'm1' }), msg({ id: 'm2', author: 'ASSISTANT', helpful: false })],
  }) });
  ok(saidNo.feedback === null, 'including when they said no');

  // A reply from a person is worth asking about too: that is how we find out
  // whether what an agent wrote was any good.
  const fromAPerson = chatView({ chat: conversation({
    state: 'TAKEN', withTheAssistant: false, takenBy: { id: 's1', name: 'Asha' },
    messages: [
      msg({ id: 'm1', author: 'PERSON' }),
      msg({ id: 'm2', author: 'AGENT', from: 'Asha', fromAPerson: true,
            body: 'We only send things inside India for now.' }),
    ],
  }) });
  ok(fromAPerson.feedback !== null, 'a person’s reply is asked about as well');

  const theirOwnWords = chatView({ chat: conversation({
    messages: [msg({ id: 'm1', author: 'PERSON' })],
  }) });
  ok(theirOwnWords.feedback === null,
    'and it never asks whether their own question helped');
}

console.log('\n=== 7. the whole screen ===');
{
  const view = chatView({ chat: conversation({}), draft: '', busy: false, loading: false });
  ok(view.title === SCREEN_TITLE, 'the title comes from one place');
  ok(view.intro === INTRO, 'and so does what an empty screen says');
  ok(view.empty === false, 'a conversation with messages is not empty');
  ok(view.input.canSend === false, 'an empty box cannot be sent');
  ok(view.input.hint === null, 'and an empty box is not nagged at');

  const typed = chatView({ chat: conversation({}), draft: 'why', busy: false, loading: false });
  ok(typed.input.canSend === true, 'something typed can be sent');

  const sending = chatView({ chat: conversation({}), draft: 'why', busy: true });
  ok(sending.input.canSend === false, 'not while one is already going');

  const loading = chatView({ chat: null, loading: true });
  ok(loading.empty === false, 'a screen still loading is not "you have nothing"');
  ok(loading.messages.length === 0, 'and it draws no messages yet');

  const first = chatView({ chat: conversation({ messages: [] }), loading: false });
  ok(first.empty === true, 'a conversation with nothing in it is empty');

  const closed = chatView({ chat: conversation({ closed: true }), draft: 'hello' });
  ok(closed.input.canSend === false, 'a closed conversation takes nothing more');
  ok(closed.input.hint === 'This conversation is closed.',
    'and it says so rather than throwing the words away');

  const broken = chatView({ chat: conversation({}), error: 'Could not reach Fayr.' });
  ok(broken.error === 'Could not reach Fayr.', 'an error is carried through');
}

console.log('\n=== 8. nothing missing reaches the screen ===');
{
  // Every shape the backend could hand over, including the ones it should not.
  const states = [
    ['nothing at all', {}],
    ['no conversation', { chat: null }],
    ['a conversation with no messages field', { chat: { chatId: 'c1' } }],
    ['messages that are not a list', { chat: { messages: 'nope' } }],
    ['a message with no body', { chat: { messages: [{ id: 'm1', author: 'PERSON' }] } }],
    ['a message with no name', { chat: { messages: [{ author: 'AGENT' }] } }],
    ['an author we do not know', { chat: { messages: [msg({ author: 'ROBOT' })] } }],
    ['a takenBy with no name', { chat: conversation({ takenBy: { id: 's1' }, withTheAssistant: false }) }],
    ['everything present', { chat: conversation({}), draft: 'hi', busy: false, loading: false }],
  ];
  for (const [label, state] of states) {
    let threw = null;
    let view = null;
    try { view = chatView(state); } catch (e) { threw = e.message; }
    ok(!threw, `survives ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (threw) continue;
    const flat = JSON.stringify(view);
    ok(!flat.includes('undefined'), `${label}: nothing "undefined" reaches the screen`);
    ok(!flat.includes('[object Object]'), `${label}: no raw object reaches the screen`);
    for (const m of view.messages) {
      ok(typeof m.text === 'string', `${label}: every message has text`);
      ok(m.who === 'you' || m.who === 'fayr', `${label}: every message has a side`);
    }
  }
}

const try_ = (label, fn) => { try { fn(); ok(true, label); } catch (e) { ok(false, label + ' — ' + e.message); } };

// ── the questions somebody can tap instead of typing ────────────────────────
//
// THE OWNER ASKED FOR THIS on 2 September 2026: "whenever I say 'hi,' it should
// reply with basic questions and answers." The screen draws whatever the server
// hands it and writes no list of its own: a list here could offer a question the
// answer bank has never heard of.
console.log('\nthe questions somebody can tap');
{
  const withThem = (over) => chatView({
    chat: {
      chatId: 'c1', state: 'ASSISTANT', closed: false, waitingForAPerson: false,
      takenBy: null, messages: [], suggestions: [
        'Where is my refund', 'How long does a refund take',
        'My order was not found', 'How do tickets work',
      ],
      ...over,
    },
    draft: '', busy: false, loading: false, error: null,
  });

  try_('it draws the ones the server sent, in the order it sent them', () => {
    const v = withThem({});
    assert.deepEqual(v.suggestions, [
      'Where is my refund', 'How long does a refund take',
      'My order was not found', 'How do tickets work',
    ]);
  });

  try_('none at all when the server sent none', () => {
    assert.deepEqual(withThem({ suggestions: [] }).suggestions, []);
    assert.deepEqual(withThem({ suggestions: undefined }).suggestions, []);
  });

  try_('and it never invents one when the server sends something odd', () => {
    // A screen that guesses a question could offer one nothing can answer.
    assert.deepEqual(withThem({ suggestions: null }).suggestions, []);
    assert.deepEqual(withThem({ suggestions: 'Where is my refund' }).suggestions, []);
    assert.deepEqual(withThem({ suggestions: [1, 2, 3] }).suggestions, []);
    assert.deepEqual(withThem({ suggestions: ['', '   '] }).suggestions, []);
  });

  try_('they go away while a message is going out', () => {
    const v = chatView({
      chat: {
        chatId: 'c1', state: 'ASSISTANT', closed: false, messages: [],
        suggestions: ['Where is my refund'],
      },
      draft: '', busy: true, loading: false, error: null,
    });
    assert.deepEqual(v.suggestions, [],
      'tapping twice while the first tap is still going would ask twice');
  });

  try_('and never appear on a finished conversation', () => {
    const v = chatView({
      chat: {
        chatId: 'c1', state: 'CLOSED', closed: true, messages: [],
        suggestions: ['Where is my refund'],
      },
      draft: '', busy: false, loading: false, error: null,
    });
    assert.deepEqual(v.suggestions, []);
    assert.equal(v.input.canSend, false, 'and nothing can be sent into it either');
  });

  try_('a screen with no conversation yet offers none', () => {
    assert.deepEqual(chatView({}).suggestions, []);
  });

  try_('the screen really draws them, and tapping one sends those words', () => {
    const screen = readFileSync(new URL('../ChatScreen.js', import.meta.url), 'utf8');
    ok(/view\.suggestions\.length > 0/.test(screen),
      'the screen must draw the questions the server sent');
    ok(/onPress=\{\(\) => sendWords\(one\)\}/.test(screen),
      'and tapping one must send those exact words');
    ok(/const send = useCallback\(\(\) => sendWords\(draft\)/.test(screen),
      'and typing must go through the same one place, so a tapped question and a '
      + 'typed one are answered by the same thing');
  });
}

console.log('\n=== 10. when it was sent ===');
{
  // NOBODY READS A BARE TIMESTAMP, and the app must not turn one into words
  // itself: the phone's clock could be a day out, and a sentence written in the
  // app is a sentence the plain language check never reads. So the words arrive
  // from our side and this only carries them.
  const out = messagesFrom({
    messages: [
      { id: 'a', author: 'PERSON', body: 'hello',
        sentAt: '2026-09-05T09:50:00.000Z',
        sentAtInWords: 'Today at 3:20 in the afternoon' },
      { id: 'b', author: 'ASSISTANT', body: 'here you are',
        sentAt: '2026-09-05T09:51:00.000Z',
        sentAtInWords: 'Today at 3:21 in the afternoon' },
      { id: 'c', author: 'AGENT', from: 'Asha', body: 'looked at it',
        sentAtInWords: 'Yesterday at 9:05 in the morning' },
      { id: 'd', author: 'SYSTEM', body: 'sorry about the wait',
        sentAtInWords: '26 August at 3:20 in the afternoon' },
    ],
  });
  ok(out[0].when === 'Today at 3:20 in the afternoon', 'their own message carries its time');
  ok(out[1].when === 'Today at 3:21 in the afternoon', 'an answer carries its time');
  ok(out[2].when === 'Yesterday at 9:05 in the morning', 'a real person’s reply carries its time');
  ok(out[3].when === '26 August at 3:20 in the afternoon', 'a note carries its time');
  ok(out.every((m) => !/\d{4}-\d{2}-\d{2}/.test(m.when || '')),
    'and not one of them is a stored moment');
}

{
  // Nothing came back, or something odd came back. The line must carry no time
  // rather than a guess, and the message must still be readable.
  const nothing = messagesFrom({
    messages: [
      { id: 'a', author: 'PERSON', body: 'hello' },
      { id: 'b', author: 'PERSON', body: 'again', sentAtInWords: '   ' },
      { id: 'c', author: 'PERSON', body: 'and again', sentAtInWords: 42 },
      { id: 'd', author: 'PERSON', body: 'once more', sentAtInWords: null },
    ],
  });
  for (const m of nothing) {
    ok(m.when === null, `no time sent means no time shown (${m.id})`);
    ok(m.text !== '', `  and the message itself still reads (${m.id})`);
  }
}

{
  // The app must never work a time out for itself.
  const helper = readFileSync(new URL('./chat.js', import.meta.url), 'utf8');
  const code = helper.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const forbidden of ['new Date', 'toLocaleTimeString', 'toLocaleDateString', 'getHours', 'Date.parse']) {
    ok(!code.includes(forbidden), `the helper never calls ${forbidden}`);
  }
  const screen = readFileSync(new URL('../ChatScreen.js', import.meta.url), 'utf8');
  ok(/\{message\.when\}/.test(screen), 'and the screen really draws the time it was sent');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
