// Filling the six-box code input.
//
// What this exists to stop: the boxes were built for ONE KEYSTROKE AT A TIME.
// setAt did `v.replace(/\D/g,'').slice(-1)` with maxLength={1}, so a six-digit
// blob — from the iOS keyboard suggestion, from Android sms-otp autofill, or from
// a paste — kept only its LAST digit and the other five were thrown away.
//
// Manual typing must keep working perfectly. Autofill is a bonus, never a
// dependency: these free SMS routes send from a random numeric sender, so it may
// not trigger at all.

import { fillOtp, nextFocus, OTP_LENGTH } from './otp.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const empty = () => Array(OTP_LENGTH).fill('');

console.log('=== 1. all six digits arriving AT ONCE ===');
{
  const r = fillOtp(empty(), 0, '483920');
  ok(r.digits.join('') === '483920', 'a six-digit blob fills every box');
  ok(r.complete === true, 'and reports complete, so the screen can submit');
  ok(r.focus === OTP_LENGTH - 1, 'focus lands on the last box, not box one');
}

console.log('\n=== 2. one keystroke at a time still works ===');
{
  let digits = empty();
  const typed = '483920';
  for (let i = 0; i < typed.length; i++) {
    const r = fillOtp(digits, i, typed[i]);
    digits = r.digits;
    ok(r.complete === (i === typed.length - 1), `keystroke ${i + 1}: complete only at the end`);
  }
  ok(digits.join('') === '483920', 'typing one at a time gives the same result');
}

console.log('\n=== 3. a paste is just a blob, wherever the cursor is ===');
{
  // Pasting into box 3 should still fill from box 3 onward, not silently reset.
  const r = fillOtp(empty(), 2, '4839');
  ok(r.digits.join('') === '__4839'.replace(/_/g, ''), 'fills forward from the focused box');
  ok(r.digits[2] === '4' && r.digits[5] === '9', 'boxes 3-6 take the four digits');
  ok(r.complete === false, 'not complete — boxes 1 and 2 are still empty');
}

console.log('\n=== 4. a paste with spaces or junk in it ===');
{
  for (const messy of ['483 920', '483-920', ' 483920 ', '48 39 20', 'code: 483920']) {
    const r = fillOtp(empty(), 0, messy);
    ok(r.digits.join('') === '483920', `"${messy}" → 483920`);
  }
  ok(fillOtp(empty(), 0, 'abcdef').digits.join('') === '', 'letters alone fill nothing');
}

console.log('\n=== 5. a partial paste ===');
{
  const r = fillOtp(empty(), 0, '483');
  ok(r.digits.join('') === '483', 'three digits fill three boxes');
  ok(r.complete === false, 'and it is not treated as done');
  ok(r.focus === 3, 'focus moves to the next empty box');
}

console.log('\n=== 6. more digits than boxes ===');
{
  const r = fillOtp(empty(), 0, '4839201234');
  ok(r.digits.length === OTP_LENGTH, 'never grows past six boxes');
  ok(r.digits.join('') === '483920', 'extra digits are dropped, not wrapped around');
  ok(r.complete === true, 'and it is complete');
}

console.log('\n=== 7. clearing and correcting ===');
{
  const filled = '483920'.split('');
  const cleared = fillOtp(filled, 3, '');
  ok(cleared.digits.join('') === '483920'.slice(0, 3) + '20', 'an empty value clears just that box');
  ok(cleared.digits[3] === '', '  the box is empty');
  ok(cleared.complete === false, '  so the code is no longer complete');
  ok(cleared.focus === 3, '  and focus stays put rather than jumping');

  // Overwriting a single filled box replaces it rather than appending.
  const over = fillOtp(filled, 1, '7');
  ok(over.digits.join('') === '473920', 'overwriting one box replaces that digit');
}

console.log('\n=== 8. it never returns something the screen cannot render ===');
{
  const inputs = [null, undefined, '', '0', '000000', 5, {}, '٣٤٥'];
  for (const v of inputs) {
    const r = fillOtp(empty(), 0, v);
    ok(Array.isArray(r.digits) && r.digits.length === OTP_LENGTH,
      `${JSON.stringify(v)} → still six boxes`);
    ok(r.digits.every((d) => d === '' || /^\d$/.test(d)), '  every box is a digit or empty');
    ok(typeof r.focus === 'number' && r.focus >= 0 && r.focus < OTP_LENGTH, '  focus is in range');
  }
  // A leading zero must survive — '000000' is a valid code.
  ok(fillOtp(empty(), 0, '000000').digits.join('') === '000000', 'a code of all zeros works');
  ok(fillOtp(empty(), 0, '000000').complete === true, '  and counts as complete');
}

console.log('\n=== 9. a bad index cannot crash the screen ===');
{
  for (const i of [-1, 99, null, undefined, 1.5]) {
    const r = fillOtp(empty(), i, '4');
    ok(Array.isArray(r.digits) && r.digits.length === OTP_LENGTH, `index ${String(i)} → safe`);
  }
}

console.log('\n=== 10. nextFocus points at the first gap ===');
{
  ok(nextFocus(['4', '8', '', '', '', '']) === 2, 'the first empty box');
  ok(nextFocus(['4', '8', '3', '9', '2', '0']) === OTP_LENGTH - 1, 'a full code stays on the last');
  ok(nextFocus(empty()) === 0, 'an empty code starts at the first');
  ok(nextFocus(null) === 0, 'and junk does not crash it');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
