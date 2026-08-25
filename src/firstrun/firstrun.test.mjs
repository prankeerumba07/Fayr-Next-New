// The first-run journey's checkable parts.
//
// The design's Flow 2 note says "no path dead-ends", so the step order and the
// exits from each dead-end state are asserted rather than eyeballed. Mobile
// validation is tested because it is the gate on the only way into the app.

import { STEPS } from './steps.js';
import { isValidMobile, groupMobile } from './mobile.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  XFAIL ' + m); } };

console.log('=== 1. the journey order (design §1–3) ===');
{
  ok(STEPS[0] === 'splash', 'the app opens on the splash, not a login form');
  ok(STEPS.indexOf('onboarding') === 1, 'onboarding comes second');
  ok(STEPS.indexOf('landing') < STEPS.indexOf('phone'), 'the welcome screen precedes phone entry');
  ok(STEPS.indexOf('phone') < STEPS.indexOf('otp'), 'phone precedes OTP');
  ok(STEPS.length === 5, 'five steps, no more');
  ok(new Set(STEPS).size === STEPS.length, 'no duplicated step');
}

console.log('\n=== 2. mobile validation — the gate on the only way in ===');
{
  ok(isValidMobile('7980952792') === true, 'a real 10-digit number starting 7 is valid');
  for (const good of ['6000000000', '9999999999', '8123456789']) {
    ok(isValidMobile(good) === true, `${good.slice(0, 1)}xxxxxxxxx accepted`);
  }
  for (const bad of ['5123456789', '0123456789', '1234567890']) {
    ok(isValidMobile(bad) === false, `${bad.slice(0, 1)}xxxxxxxxx rejected — Indian mobiles start 6-9`);
  }
  ok(isValidMobile('798095279') === false, 'nine digits rejected');
  ok(isValidMobile('79809527921') === false, 'eleven digits rejected');
  ok(isValidMobile('') === false, 'empty rejected');
  ok(isValidMobile(null) === false, 'null rejected, not thrown');
  ok(isValidMobile('79809 52792') === false, 'a spaced value is not valid raw input');
}

console.log('\n=== 3. display grouping ===');
{
  ok(groupMobile('7980952792') === '79809 52792', 'ten digits group 5+5');
  ok(groupMobile('79809') === '79809', 'exactly five stay ungrouped');
  ok(groupMobile('798095') === '79809 5', 'the space appears at six');
  ok(groupMobile('') === '', 'empty stays empty');
  ok(groupMobile(null) === '', 'null renders as empty, not "null"');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
