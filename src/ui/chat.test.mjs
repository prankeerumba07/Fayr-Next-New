// "Chat with us" — every decision the screen makes, checked under node.
//
// The screen itself is React Native and cannot be imported here, so every
// decision it makes lives in chat.js and is checked directly. The last section is
// the render smoke test: it runs the whole view model against realistic data and
// asserts that nothing throws and that no "undefined" or "NaN" reaches what would
// be drawn. That is the check that caught a helper which never existed in the
// staff panel, and it is the same check here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FEEDBACK_NO,
  FEEDBACK_PROMPT,
  FEEDBACK_YES,
  QUESTION_MAX,
  SCREEN_TITLE,
  chatView,
  turnFromAsk,
  validateQuestion,
} from './chat.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS ' + name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL ' + name + '\n        ' + err.message);
  }
}

console.log('\nChat with us — the name');
test('the screen is called exactly what was asked for', () => {
  assert.equal(SCREEN_TITLE, 'Chat with us');
});

console.log('\nChat with us — what you may send');
test('accepts an ordinary question', () => {
  const out = validateQuestion('when will my refund arrive');
  assert.equal(out.ok, true);
  assert.equal(out.question, 'when will my refund arrive');
  assert.equal(out.reason, null);
});

test('keeps the words as typed, only trimming the ends', () => {
  const out = validateQuestion('   mera refund kab aayega   ');
  assert.equal(out.question, 'mera refund kab aayega');
});

test('refuses an empty question, in words', () => {
  for (const empty of ['', '   ', '\n', null, undefined, 42]) {
    const out = validateQuestion(empty);
    assert.equal(out.ok, false);
    assert.ok(out.reason && out.reason.length > 5, 'needs a readable reason');
    assert.ok(!/--|_/.test(out.reason), 'the reason must read plainly');
  }
});

test('refuses one longer than the app will take, and says the number', () => {
  const out = validateQuestion('a'.repeat(QUESTION_MAX + 1));
  assert.equal(out.ok, false);
  assert.ok(out.reason.includes(String(QUESTION_MAX)));
});

test('the limit matches what the backend accepts', () => {
  // The backend refuses over 2000. A screen that lets somebody type 5000 turns a
  // careful answer into a rejection they cannot understand.
  assert.equal(QUESTION_MAX, 2000);
});

console.log('\nChat with us — one exchange');
test('turns an answered reply into a pair of messages', () => {
  const turn = turnFromAsk('when will my refund arrive', {
    questionId: 'q1',
    answer: 'We send your money back once your review is live.',
    language: 'en',
    languageName: 'English',
    answered: true,
  });
  assert.equal(turn.questionId, 'q1');
  assert.equal(turn.question, 'when will my refund arrive');
  assert.equal(turn.answered, true);
  assert.equal(turn.helpful, null);
});

test('marks the honest case as waiting for a person', () => {
  const turn = turnFromAsk('do you deliver to Kathmandu', {
    questionId: 'q2',
    answer: 'I could not answer this one yet. A person from Fayr will read it.',
    language: 'en',
    answered: false,
  });
  assert.equal(turn.answered, false);
  assert.equal(turn.waitingForAPerson, true);
});

test('survives a reply with pieces missing', () => {
  for (const junk of [null, undefined, {}, { answer: null }, 'nope']) {
    const turn = turnFromAsk('anything', junk);
    assert.ok(turn, 'must still make a turn');
    assert.equal(typeof turn.question, 'string');
    assert.ok(!JSON.stringify(turn).includes('undefined'));
  }
});

console.log('\nChat with us — the did-it-help question');
test('asks one simple question, with two plain answers', () => {
  for (const text of [FEEDBACK_PROMPT, FEEDBACK_YES, FEEDBACK_NO]) {
    assert.ok(text.length > 3, 'must say something');
    assert.ok(!/--|—|_/.test(text), 'no long dashes and no codes: ' + text);
    assert.ok(!/\b(API|OTP|FAQ)\b/.test(text), 'no short codes: ' + text);
  }
  assert.ok(FEEDBACK_PROMPT.endsWith('?'), 'it has to be a question');
});

test('the question is asked after every reply, answered or not', () => {
  const answered = chatView({
    turns: [turnFromAsk('a', { questionId: 'q1', answer: 'yes', answered: true })],
  });
  const notAnswered = chatView({
    turns: [turnFromAsk('b', { questionId: 'q2', answer: 'not yet', answered: false })],
  });
  assert.ok(answered.feedback, 'asked after an answer');
  assert.ok(notAnswered.feedback, 'asked after the honest reply too');
  assert.equal(answered.feedback.questionId, 'q1');
});

test('stops asking once somebody has said', () => {
  const turn = turnFromAsk('a', { questionId: 'q1', answer: 'yes', answered: true });
  const view = chatView({ turns: [{ ...turn, helpful: true }] });
  assert.equal(view.feedback, null);
});

test('only ever asks about the newest reply', () => {
  const first = turnFromAsk('a', { questionId: 'q1', answer: 'one', answered: true });
  const second = turnFromAsk('b', { questionId: 'q2', answer: 'two', answered: true });
  const view = chatView({ turns: [first, second] });
  assert.equal(view.feedback.questionId, 'q2');
});

console.log('\nChat with us — the honest case on screen');
test('shows a waiting label rather than repeating itself', () => {
  const view = chatView({
    turns: [turnFromAsk('x', { questionId: 'q1', answer: 'not yet', answered: false })],
  });
  const last = view.messages[view.messages.length - 1];
  assert.equal(last.tone, 'waiting');
  assert.ok(last.label, 'needs a short label');
  // The reply already says a person will look. A second sentence saying the same
  // thing reads as a system that did not notice it had spoken.
  assert.ok(last.label.length < 40, 'a label, not another sentence');
});

test('an answered reply carries no waiting label', () => {
  const view = chatView({
    turns: [turnFromAsk('x', { questionId: 'q1', answer: 'here you go', answered: true })],
  });
  const last = view.messages[view.messages.length - 1];
  assert.equal(last.tone, 'answer');
  assert.equal(last.label, null);
});

console.log('\nChat with us — the whole view');
test('an empty conversation invites a first question', () => {
  const view = chatView({ turns: [] });
  assert.equal(view.messages.length, 0);
  assert.equal(view.empty, true);
  assert.ok(view.intro.length > 20, 'says what this is for');
  assert.equal(view.feedback, null);
});

test('a question and its reply come out oldest first', () => {
  const view = chatView({
    turns: [
      turnFromAsk('first', { questionId: 'q1', answer: 'one', answered: true }),
      turnFromAsk('second', { questionId: 'q2', answer: 'two', answered: true }),
    ],
  });
  assert.deepEqual(
    view.messages.map((m) => m.text),
    ['first', 'one', 'second', 'two'],
  );
  assert.deepEqual(
    view.messages.map((m) => m.who),
    ['you', 'fayr', 'you', 'fayr'],
  );
});

test('the send control is off while a question is empty or in flight', () => {
  assert.equal(chatView({ draft: '' }).input.canSend, false);
  assert.equal(chatView({ draft: '   ' }).input.canSend, false);
  assert.equal(chatView({ draft: 'hello' }).input.canSend, true);
  assert.equal(chatView({ draft: 'hello', busy: true }).input.canSend, false);
});

test('shows a problem in words, and keeps what was typed', () => {
  const view = chatView({ draft: 'my question', error: 'Could not reach Fayr.' });
  assert.equal(view.error, 'Could not reach Fayr.');
  assert.equal(view.input.value, 'my question');
});

console.log('\nChat with us — the render smoke test');
test('every realistic state renders with nothing missing', () => {
  const answered = turnFromAsk('when will my refund arrive', {
    questionId: 'q1',
    answer: 'We send your money back once your review is live.',
    language: 'en',
    languageName: 'English',
    answered: true,
  });
  const unanswered = turnFromAsk('do you deliver to Kathmandu', {
    questionId: 'q2',
    answer: 'I could not answer this one yet.',
    language: 'en',
    answered: false,
  });
  const hindi = turnFromAsk('मेरा पैसा कब आएगा', {
    questionId: 'q3',
    answer: 'आपका पैसा रिव्यू दिखने के बाद आता है।',
    language: 'hi',
    languageName: 'Hindi',
    answered: true,
  });

  const states = [
    { turns: [] },
    { turns: [], loading: true },
    { turns: [], error: 'Could not reach Fayr. Check your connection.' },
    { turns: [answered] },
    { turns: [unanswered] },
    { turns: [hindi] },
    { turns: [answered, unanswered, hindi] },
    { turns: [{ ...answered, helpful: true }] },
    { turns: [{ ...unanswered, helpful: false }] },
    { turns: [answered], draft: 'another question', busy: true },
    { turns: [answered], draft: 'x'.repeat(QUESTION_MAX + 50) },
    // and the shapes nobody should ever pass, because somebody will
    { turns: null },
    { turns: [null, undefined, {}] },
    {},
    undefined,
  ];

  for (const [i, state] of states.entries()) {
    let view;
    assert.doesNotThrow(() => {
      view = chatView(state);
    }, 'state ' + i + ' threw');

    const drawn = JSON.stringify(view);
    assert.ok(!drawn.includes('undefined'), 'state ' + i + ' drew "undefined"');
    assert.ok(!drawn.includes('NaN'), 'state ' + i + ' drew "NaN"');
    assert.ok(!drawn.includes('[object Object]'), 'state ' + i + ' drew an object');

    for (const m of view.messages) {
      assert.ok(['you', 'fayr'].includes(m.who), 'state ' + i + ': who is ' + m.who);
      assert.equal(typeof m.text, 'string');
      assert.ok(m.text.length > 0, 'state ' + i + ': an empty message');
      assert.ok(typeof m.id === 'string' && m.id.length > 0, 'every message needs an id');
    }
    if (view.feedback) {
      assert.equal(typeof view.feedback.questionId, 'string');
      assert.equal(view.feedback.prompt, FEEDBACK_PROMPT);
    }
    assert.equal(typeof view.input.canSend, 'boolean');
    assert.equal(typeof view.input.value, 'string');
  }
});

console.log('\nChat with us — the screen only uses helpers that exist');
test('every helper the screen imports is really exported', () => {
  // The bug this catches is a real one from the staff panel: a helper that never
  // existed. The file parsed, every search passed, and the screen threw the first
  // time somebody opened it.
  const src = fs.readFileSync(new URL('../ChatScreen.js', import.meta.url), 'utf8');
  // [^}]* on purpose: a lazy match across the whole file starts at the FIRST
  // "import {" and swallows every import in between, which is how this check
  // first reported that ActivityIndicator was missing from ui/chat.js.
  const match = src.match(/import \{([^}]*)\} from '\.\/ui\/chat\.js'/);
  assert.ok(match, 'the screen must take its logic from ui/chat.js');
  const names = match[1]
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  assert.ok(names.length > 3, 'the screen should be using the helpers');
  const exported = new Set(Object.keys(chatModule));
  for (const name of names) {
    assert.ok(exported.has(name), name + ' is imported by the screen but not exported');
  }
});

test('the screen is actually reachable from the app', () => {
  // A screen nobody can open is not a feature. This is the same gap Help had for
  // weeks: built, routed, and unreachable because no screen linked to it.
  const app = fs.readFileSync(new URL('../../App.js', import.meta.url), 'utf8');
  assert.ok(app.includes("import ChatScreen"), 'App.js must import the screen');
  assert.ok(
    /Stack\.Screen name="Chat"/.test(app),
    'App.js must register a "Chat" route',
  );
  const profile = fs.readFileSync(new URL('../ProfileScreen.js', import.meta.url), 'utf8');
  assert.ok(
    profile.includes("navigate('Chat')"),
    'My Profile must have a row that opens it',
  );
  assert.ok(
    profile.includes('Chat with us'),
    'the row must be called what the screen is called',
  );
});

test('the screen shows the name it is meant to', () => {
  const src = fs.readFileSync(new URL('../ChatScreen.js', import.meta.url), 'utf8');
  assert.ok(src.includes('SCREEN_TITLE'), 'the title must come from one place');
});

import * as chatModule from './chat.js';

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
