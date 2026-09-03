// The call row on the Help screen. No phone, no React, no real number.
//
// EVERY NUMBER IN THIS FILE IS MADE UP. The real one lives in backend/.env and is
// in no file in this project, which backend/src/contact/number-lives-in-one-place
// checks by really going and looking.
import { callRow, dialLink } from './callUs.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const GOOD = '+919000000001';

console.log('=== 1. what a phone is handed ===');
{
  ok(dialLink(GOOD) === `tel:${GOOD}`, 'a full international number becomes something a phone can dial');
  ok(dialLink(`  ${GOOD} `) === `tel:${GOOD}`, 'surrounding spaces do not stop the call');
}

console.log('\n=== 2. what never becomes a button ===');
{
  // A button that does nothing when tapped is worse than no button at all: the
  // person keeps tapping it while their money is stuck.
  const refused = [
    ['nothing at all', null],
    ['not set', undefined],
    ['empty', ''],
    ['spaces', '   '],
    ['no plus sign', '919000000001'],
    ['half a number', '+9190'],
    ['spaces inside', '+91 90000 00001'],
    ['dashes inside', '+91-90000-00001'],
    ['a leading zero', '+09000000001'],
    ['far too long', `+91${'9'.repeat(20)}`],
    ['words', 'ring the office'],
    ['a number', 919000000001],
    ['an object', { phone: GOOD }],
  ];
  for (const [what, value] of refused) {
    ok(dialLink(value) === null, `${what} cannot be dialled`);
  }
}

console.log('\n=== 3. the row, out of what our side sent ===');
{
  const full = callRow({ phone: GOOD, title: 'How to reach us', words: 'You can call us.', button: 'Call Fayr' });
  ok(full.canCall === true, 'with a number and a button, there is a call to make');
  ok(full.dialLink === `tel:${GOOD}`, 'and the phone is handed the number');
  ok(full.button === 'Call Fayr', 'and the button says what our side said');
  ok(full.title === 'How to reach us', 'the heading came from our side');
  ok(full.words === 'You can call us.', 'and so did the sentence');
}

console.log('\n=== 4. no number: words, and nothing to tap ===');
{
  const none = callRow({ phone: null, title: 'How to reach us', words: 'Write to us in the app.', button: null });
  ok(none.canCall === false, 'there is nothing to ring');
  ok(none.dialLink === null, 'so nothing is handed to the phone');
  ok(none.button === null, 'and no button is offered');
  ok(none.words === 'Write to us in the app.', 'but there is still a full sentence to read');
}

console.log('\n=== 5. a half answer is treated as no answer ===');
{
  // Each of these is our side having sent something incomplete. None of them may
  // produce a tappable button, because a tap would go nowhere.
  const halves = [
    ['a number but no words on the button', { phone: GOOD, words: 'x', button: null }],
    ['a button but no number', { phone: null, words: 'x', button: 'Call Fayr' }],
    ['a button whose words are blank', { phone: GOOD, words: 'x', button: '   ' }],
    ['a broken number with a button', { phone: '+9190', words: 'x', button: 'Call Fayr' }],
  ];
  for (const [what, sent] of halves) {
    const row = callRow(sent);
    ok(row.canCall === false && row.dialLink === null && row.button === null,
      `${what} offers no button`);
  }
}

console.log('\n=== 6. nothing came back at all ===');
{
  for (const nothing of [null, undefined, 'a string', 42, []]) {
    const row = callRow(nothing);
    ok(row.canCall === false, `${JSON.stringify(nothing) || String(nothing)} gives no call`);
    ok(row.words === null, '  and no sentence, so the screen shows no row at all');
  }
}

console.log('\n=== 7. this file writes no sentence of its own ===');
{
  // Every word a person reads arrives from our side, where the plain-language
  // check reads it. So the helper must never invent a fallback sentence.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./callUs.js', import.meta.url), 'utf8');
  const code = source.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const sentences = (code.match(/'[^']*'|"[^"]*"/g) || []).filter((s) => {
    const inner = s.slice(1, -1);
    return (inner.match(/[a-z]+/g) || []).length >= 4;
  });
  ok(sentences.length === 0, `no sentence in the helper (found ${JSON.stringify(sentences)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
