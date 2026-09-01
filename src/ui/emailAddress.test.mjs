// An email address, without a phone.
import {
  codeDigits, codeIsComplete, looksLikeAnAddress, maskAddress, tidyAddress, typoFix,
} from './emailAddress.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

console.log('=== 1. tidying ===');
{
  ok(tidyAddress('  Person@Gmail.COM ') === 'person@gmail.com',
    'trimmed and lower cased, because that is how it is stored');
  for (const nothing of [undefined, null, 42, {}, []]) {
    ok(tidyAddress(nothing) === '', `${JSON.stringify(nothing)} tidies to nothing`);
  }
}

console.log('\n=== 2. the SHAPE of an address, and nothing more claimed ===');
{
  for (const good of ['a@b.co', 'person@gmail.com', 'PERSON@GMAIL.COM',
                      'first.last+tag@sub.example.in']) {
    ok(looksLikeAnAddress(good), `${good} has the shape`);
  }
  for (const bad of ['', ' ', 'person', 'person@', '@gmail.com', 'person@gmail',
                     'a b@c.com', 'person@@gmail.com', undefined, null, 42, {}]) {
    ok(!looksLikeAnAddress(bad), `${JSON.stringify(bad)} does not`);
  }
}

console.log('\n=== 3. the typo the design catches ===');
{
  ok(typoFix('person@gmial.com') === 'person@gmail.com', 'gmial');
  ok(typoFix('person@gamil.com') === 'person@gmail.com', 'gamil');
  ok(typoFix('person@gmali.com') === 'person@gmail.com', 'gmali');
  ok(typoFix('person@gmail.co') === 'person@gmail.com', 'a dropped m');
  ok(typoFix('person@yahooo.com') === 'person@yahoo.com', 'an extra o');
  ok(typoFix('person@gmail.com') === null, 'a correct address has nothing to fix');
  for (const nothing of ['', undefined, null, 42, {}, 'person']) {
    ok(typoFix(nothing) === null, `${JSON.stringify(nothing)} has nothing to fix`);
  }
  // IT IS ONLY EVER OFFERED. Nothing here changes anybody's address by itself, so
  // the check is that the original is untouched.
  const original = 'person@gmial.com';
  typoFix(original);
  ok(original === 'person@gmial.com', 'and the address handed in is not changed');
}

console.log('\n=== 4. showing an address back ===');
{
  ok(maskAddress('prakash@gmail.com') === 'pr•••••@gmail.com', 'most of the name is hidden');
  ok(maskAddress('ab@gmail.com') === 'ab•••@gmail.com', 'a short name still gets dots');
  ok(maskAddress('a@b.co') === 'a•••@b.co', 'and a one letter name too');
  for (const bad of ['', '@gmail.com', 'person', undefined, null, 42]) {
    ok(maskAddress(bad) === null, `${JSON.stringify(bad)} cannot be masked`);
  }
  ok(!/undefined|NaN/.test(String(maskAddress('x@y.zz'))), 'nothing missing gets through');
}

console.log('\n=== 5. the six boxes ===');
{
  ok(JSON.stringify(codeDigits('123456')) === JSON.stringify(['1','2','3','4','5','6']),
    'six digits fill six boxes');
  ok(JSON.stringify(codeDigits('12')) === JSON.stringify(['1','2','','','','']),
    'a part typed code leaves the rest empty');
  ok(JSON.stringify(codeDigits('12ab34')) === JSON.stringify(['1','2','3','4','','']),
    'letters are dropped, not shown');
  ok(JSON.stringify(codeDigits('1234567890')) === JSON.stringify(['1','2','3','4','5','6']),
    'and a pasted long number is cut to six');
  for (const nothing of [undefined, null, 42, {}]) {
    ok(JSON.stringify(codeDigits(nothing)) === JSON.stringify(['','','','','','']),
      `${JSON.stringify(nothing)} fills nothing`);
  }
  ok(codeDigits('1234', 4).length === 4, 'a different number of boxes is honoured');
  ok(codeDigits('1', 0).length === 6, 'and a silly number falls back to six');

  ok(codeIsComplete('123456') === true, 'six digits is complete');
  ok(codeIsComplete('12345') === false, 'five is not');
  ok(codeIsComplete('') === false, 'and nothing is not');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
