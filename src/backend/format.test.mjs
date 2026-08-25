// Pure-helper tests for the auth format layer. Runs under plain `node` (these
// helpers deliberately import nothing from react-native / expo).
import {
  CODE_LENGTH,
  toE164,
  isValidIndianMobile,
  describeAuthError,
} from './format.js';

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) {
    pass++;
    console.log('  PASS ' + m);
  } else {
    fail++;
    console.log('  FAIL ' + m);
  }
};

console.log('=== toE164: 10-digit + variants → the backend E164 shape ===');
ok(toE164('9876543210') === '+919876543210', 'bare 10-digit gets +91');
ok(toE164('98765 43210') === '+919876543210', 'spaces tolerated');
ok(toE164('98765-43210') === '+919876543210', 'dashes tolerated');
ok(toE164('09876543210') === '+919876543210', 'domestic trunk 0 dropped');
ok(toE164('919876543210') === '+919876543210', '12-digit 91… gets +');
ok(toE164('+919876543210') === '+919876543210', 'already-E164 preserved');
ok(toE164('') === '', 'empty → empty (never a bare +91)');
ok(toE164(null) === '', 'null → empty');

console.log('=== every toE164 output matches the backend E164_REGEX ===');
const E164 = /^\+[1-9]\d{7,14}$/;
for (const inp of ['9876543210', '09876543210', '+919876543210']) {
  ok(E164.test(toE164(inp)), `E164_REGEX accepts toE164(${inp})`);
}

console.log('=== isValidIndianMobile: first digit 6–9, exactly 10 ===');
ok(isValidIndianMobile('9876543210') === true, '9xxxxxxxxx valid');
ok(isValidIndianMobile('6012345678') === true, '6xxxxxxxxx valid');
ok(isValidIndianMobile('1234567890') === false, 'leading 1 invalid');
ok(isValidIndianMobile('98765') === false, 'too short invalid');
ok(isValidIndianMobile('98765432100') === false, 'too long invalid');

console.log('=== describeAuthError: status → friendly line ===');
ok(/wrong or has expired/i.test(describeAuthError(401, {}).message), '401 → wrong/expired');
ok(/blocked/i.test(describeAuthError(403, {}).message), '403 → blocked');
ok(describeAuthError(429, { resendInSeconds: 12 }).resendInSeconds === 12, '429 surfaces resendInSeconds');
ok(/12s/.test(describeAuthError(429, { resendInSeconds: 12 }).message), '429 message shows the wait');
ok(/reach the Fayr server/i.test(describeAuthError(0, {}).message), 'status 0 → network line');
ok(describeAuthError(400, { message: 'custom' }).message === 'custom', 'passes through a backend message');

console.log('=== CODE_LENGTH matches the backend OTP_LENGTH (6) ===');
ok(CODE_LENGTH === 6, 'CODE_LENGTH is 6');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
