// Proves restoreSession's decision (restorePlan) satisfies the three product
// guarantees, using realistic Flipkart cookie shapes. restorePlan is pure, so
// this runs without the native cookie module.
//
//   1. Return to a linked marketplace -> restore (no re-login, ever).
//   2. Relaunch the app -> restore.
//   3. A genuinely different account is live -> leave it alone (read the new one).

import { restorePlan } from './session.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const FUTURE = new Date(Date.now() + 365 * 864e5).toISOString();
const AUTH = ['at', 'rt']; // Flipkart/Myntra auth cookies

// A full logged-in snapshot for account "A".
const snapshotA = {
  at:  { name: 'at',  value: 'A-token', domain: '.flipkart.com', path: '/', expires: FUTURE },
  rt:  { name: 'rt',  value: 'A-refresh', domain: '.flipkart.com', path: '/', expires: FUTURE },
  T:   { name: 'T',   value: 'A-T', domain: '.flipkart.com', path: '/', expires: FUTURE },
  ud:  { name: 'ud',  value: 'devicehash', domain: '.flipkart.com', path: '/', expires: FUTURE },
  vd:  { name: 'vd',  value: 'A-vd', domain: '.flipkart.com', path: '/', expires: FUTURE },
};

console.log('=== 1. return to a linked marketplace: store cleared on unmount -> RESTORE all ===');
let p = restorePlan(snapshotA, {}, AUTH);
ok(p.skip === false, 'does not skip on an empty live store');
ok(p.toSet.length === 5 && p.toSet.includes('at') && p.toSet.includes('rt'), 'restores the full session incl auth cookies');

console.log('\n=== 1b. PARTIAL store on remount (the exact overcorrection bug): only non-auth cookies live ===');
// WebView kept a tracking cookie but dropped the auth ones -> MUST still restore.
const partialLive = { ud: { name: 'ud', value: 'devicehash', domain: '.flipkart.com', path: '/' } };
p = restorePlan(snapshotA, partialLive, AUTH);
ok(p.skip === false, 'name overlap on a NON-auth cookie does NOT block restore');
ok(p.toSet.includes('at') && p.toSet.includes('rt') && !p.toSet.includes('ud'), 'fills missing auth cookies, leaves the live one');

console.log('\n=== 2. relaunch the app ===');
// Fresh WebView store empty -> restore. (If WebKit persisted A, see 4.)
p = restorePlan(snapshotA, {}, AUTH);
ok(p.skip === false && p.toSet.includes('at'), 'empty store after relaunch -> restore');

console.log('\n=== 3. a DIFFERENT account is live -> leave it alone ===');
// User logged out A and into C; snapshot still A. Live has C's auth cookies.
const liveC = {
  at: { name: 'at', value: 'C-token', domain: '.flipkart.com', path: '/' },
  rt: { name: 'rt', value: 'C-refresh', domain: '.flipkart.com', path: '/' },
};
p = restorePlan(snapshotA, liveC, AUTH);
ok(p.skip === true, 'auth cookie value conflicts -> SKIP (do not clobber the live account)');
ok(p.toSet.length === 0, 'sets nothing');

console.log('\n=== 4. SAME account already live (WebKit persisted it) -> no-op restore ===');
const liveA = {
  at: { name: 'at', value: 'A-token', domain: '.flipkart.com', path: '/' },
  rt: { name: 'rt', value: 'A-refresh', domain: '.flipkart.com', path: '/' },
  T:  { name: 'T',  value: 'A-T', domain: '.flipkart.com', path: '/' },
  ud: { name: 'ud', value: 'devicehash', domain: '.flipkart.com', path: '/' },
  vd: { name: 'vd', value: 'A-vd', domain: '.flipkart.com', path: '/' },
};
p = restorePlan(snapshotA, liveA, AUTH);
ok(p.skip === false, 'same account matches -> not treated as a different account');
ok(p.toSet.length === 0, 'nothing to set — already fully logged in');

console.log('\n=== 5. edges ===');
// Rotated auth token on the same live account -> skip (live session is valid, don't clobber).
const liveArot = { at: { name: 'at', value: 'A-token-ROTATED', domain: '.flipkart.com', path: '/' } };
ok(restorePlan(snapshotA, liveArot, AUTH).skip === true, 'rotated live auth token -> skip (valid live session preserved)');
// No authCookies configured (meesho/zepto) -> always restore (persistence guaranteed).
ok(restorePlan(snapshotA, liveC, []).skip === false, 'empty authCookies -> restore always (fallback, persistence wins)');
// Expired snapshot cookie is not resurrected.
const expiredSnap = { at: { name: 'at', value: 'x', domain: '.d.com', path: '/', expires: new Date(0).toISOString() } };
ok(restorePlan(expiredSnap, {}, AUTH).toSet.length === 0, 'expired snapshot cookie is dropped');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
