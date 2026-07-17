// Proves restoreSession's decision (restorePlan, fill-missing) satisfies the
// three product guarantees for EVERY marketplace, with no per-platform tuning.
// restorePlan is pure, so this runs without the native cookie module.
//
//   1. Return to a linked marketplace -> restore (no re-login, ever).
//   2. Relaunch the app -> restore.
//   3. A genuinely different account is live -> its auth cookies are preserved
//      (never overwritten), so the fetch reads the new account.

import { restorePlan } from './session.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const FUTURE = new Date(Date.now() + 365 * 864e5).toISOString();
const ck = (name, value) => ({ name, value, domain: '.myntra.com', path: '/', expires: FUTURE });

// A full logged-in snapshot for account "A" (Myntra-shaped: rotating at/rt).
const snapshotA = {
  at: ck('at', 'A-token'), rt: ck('rt', 'A-refresh'),
  user_session: ck('user_session', 'A-sess'), ud: ck('ud', 'devicehash'),
};
const names = (p) => p.toSet.slice().sort();

console.log('=== 1. return to a linked marketplace: store cleared on unmount -> RESTORE all ===');
let p = restorePlan(snapshotA, {});
ok(p.toSet.length === 4 && p.toSet.includes('at') && p.toSet.includes('rt'), 'empty store -> fills the full session (incl auth)');

console.log('\n=== 1b. PARTIAL store on remount (the regression): only a NON-auth cookie is live ===');
// The bug: auth cookies are gone but a tracking cookie remains. MUST still fill auth.
p = restorePlan(snapshotA, { ud: ck('ud', 'devicehash') });
ok(p.toSet.includes('at') && p.toSet.includes('rt') && !p.toSet.includes('ud'), 'fills missing auth, leaves the live cookie — no wholesale skip');

console.log('\n=== 1c. ROTATED auth token live (the Myntra case): must NOT log out ===');
// at rotated to a new value; rt/user_session missing after remount. Fill the
// missing ones, keep the live (rotated) at. Old code skipped everything here.
p = restorePlan(snapshotA, { at: ck('at', 'A-token-ROTATED') });
ok(!p.toSet.includes('at'), 'live rotated at is preserved (not overwritten)');
ok(p.toSet.includes('rt') && p.toSet.includes('user_session'), 'the missing session cookies are still filled -> stays logged in');

console.log('\n=== 2. relaunch: empty store -> restore ===');
ok(restorePlan(snapshotA, {}).toSet.includes('at'), 'empty store after relaunch -> fills auth');

console.log('\n=== 3. a DIFFERENT account is live -> preserve it, read the new one ===');
// User logged out A and into C; snapshot still A. C is fully live.
const liveC = { at: ck('at', 'C-token'), rt: ck('rt', 'C-refresh'), user_session: ck('user_session', 'C-sess'), ud: ck('ud', 'devicehash') };
p = restorePlan(snapshotA, liveC);
ok(!p.toSet.includes('at') && !p.toSet.includes('rt') && !p.toSet.includes('user_session'), 'C auth cookies are NOT overwritten -> fetch reads C');
ok(p.toSet.length === 0, 'nothing to fill — C is complete');

console.log('\n=== 4. same account already live (WebKit persisted it) -> no-op ===');
const liveA = { at: ck('at', 'A-token'), rt: ck('rt', 'A-refresh'), user_session: ck('user_session', 'A-sess'), ud: ck('ud', 'devicehash') };
ok(restorePlan(snapshotA, liveA).toSet.length === 0, 'nothing to fill — already fully logged in');

console.log('\n=== 5. edges ===');
const expiredSnap = { at: { name: 'at', value: 'x', domain: '.d.com', path: '/', expires: new Date(0).toISOString() } };
ok(restorePlan(expiredSnap, {}).toSet.length === 0, 'expired snapshot cookie is dropped');
ok(restorePlan({}, {}).toSet.length === 0, 'empty snapshot -> nothing to do');
// A partially-different live account (missing one auth cookie) still isn't clobbered on its present cookies.
const partialC = { at: ck('at', 'C-token') };
ok(!restorePlan(snapshotA, partialC).toSet.includes('at'), 'never overwrites the live at, even for a partial different session');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
