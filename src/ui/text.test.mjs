// Tests for the uppercase-as-you-type transform.
//
// The bug: autoCapitalize="characters" is a keyboard HINT. Devices that ignore it
// left a PAN on screen in lowercase while it was silently uppercased at submit —
// so the user proofread one string and saved another, on a field that is
// permanently anchored to their account and not editable from the app.
//
// The trap in fixing it: a controlled TextInput given back a different-LENGTH
// value can have its selection reset to the end, throwing the caret out of the
// middle of the field on every keystroke. Hence the length property below, which
// is the real guarantee — not an implementation detail.

import { toDisplayUpper } from './text.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== 1. it uppercases what a user actually types ===');
{
  ok(toDisplayUpper('abcde1234f') === 'ABCDE1234F', 'a full lowercase PAN comes back uppercase');
  ok(toDisplayUpper('AbCdE1234f') === 'ABCDE1234F', 'mixed case is normalised');
  ok(toDisplayUpper('hdfc0001234') === 'HDFC0001234', 'an IFSC too');
  ok(toDisplayUpper('ABCDE1234F') === 'ABCDE1234F', 'already-uppercase text is unchanged');
  ok(toDisplayUpper('1234567890') === '1234567890', 'digits pass through');
}

console.log('\n=== 2. THE CARET GUARANTEE: length never changes ===');
{
  // Every prefix of a PAN being typed, plus the awkward characters. If any of
  // these changed length, editing mid-field would jump the caret to the end.
  const inputs = [
    '', 'a', 'ab', 'abc', 'abcd', 'abcde', 'abcde1', 'abcde12', 'abcde123',
    'abcde1234', 'abcde1234f', 'ß', 'straße', 'ﬁle', 'aßb', 'ǳ', 'i', 'ı',
    'abc def', '  ab  ', 'ABCDE1234F', '😀a', 'ｆｕｌｌ',
  ];
  const bad = inputs.filter((s) => toDisplayUpper(s).length !== s.length);
  ok(bad.length === 0, `all ${inputs.length} inputs keep their exact length (offenders: ${JSON.stringify(bad)})`);
}

console.log('\n=== 3. characters whose uppercase would GROW are left alone ===');
{
  // 'ß'.toUpperCase() is 'SS' — expanding it would both change the length and
  // silently invent a character the user never typed.
  ok(toDisplayUpper('ß') === 'ß', 'the sharp s is left as typed, not expanded to SS');
  ok(toDisplayUpper('aßb') === 'AßB', 'and its neighbours still uppercase around it');
  ok(toDisplayUpper('ﬁ') === 'ﬁ', 'the fi ligature is left as typed, not expanded to FI');
}

console.log('\n=== 4. surrogate pairs survive intact ===');
{
  const out = toDisplayUpper('😀abc');
  ok(out === '😀ABC', 'an emoji is not split in half and the rest still uppercases');
  ok([...out].length === [...'😀abc'].length, 'code-point count is preserved too');
}

console.log('\n=== 5. safe on junk input ===');
{
  ok(toDisplayUpper(null) === '', 'null is an empty string, never "null" on screen');
  ok(toDisplayUpper(undefined) === '', 'undefined likewise');
  ok(toDisplayUpper(0) === '0', 'a number is stringified rather than crashing the field');
  ok(toDisplayUpper('abc') === toDisplayUpper(toDisplayUpper('abc')), 'idempotent — re-running on state changes nothing');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
