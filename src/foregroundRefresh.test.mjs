// COMING BACK TO FAYR, AND THE REPLY THE SCREEN THREW AWAY.
//
// Two bugs, one file, because they are the same bug from two ends: our own side
// knew something and nothing on the phone was told.
//
// THE PURE HALF walks the foreground decision through every event iOS really
// sends — the shade, the switcher, a dismissed call — and through the clock going
// backwards, which is the case nobody writes a test for.
//
// THE STRUCTURAL HALF reads App.js and the buy screen off disk and refuses the
// version that drops the reply. That check exists because the version that
// dropped it passed every check in the project.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NOT_MORE_OFTEN_THAN_MS, shouldRefreshOnForeground } from './foregroundRefresh.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/** One fixed moment, so nothing here depends on the real clock. */
const T = Date.UTC(2026, 8, 9, 10, 0);
const ask = (over) => shouldRefreshOnForeground({
  nextState: 'active', signedIn: true, lastAt: null, now: T, ...over,
});

console.log('=== 1. coming back is the one thing worth acting on ===');
{
  ok(ask({}) === true, 'active, signed in, never asked before: we ask');
  // EVERY OTHER STATE THE PHONE REPORTS. None of these is somebody coming back.
  for (const state of ['background', 'inactive', 'unknown', 'extension', '', null, undefined]) {
    ok(ask({ nextState: state }) === false,
      `${JSON.stringify(state) ?? String(state)} is not coming back, so nothing is asked`);
  }
}

console.log('\n=== 2. AND NEVER FOR SOMEBODY WHO IS NOT SIGNED IN ===');
{
  // THE OWNER ASKED FOR THIS IN THOSE WORDS, and it is not merely a wasted
  // request: a fetch with no session is refused, the transport reads a refusal as
  // a reason to renew, and a renewal with nothing to renew clears the session. So
  // a refresh fired at a signed-out app is a way to reach the sign-in screen
  // FROM the sign-in screen.
  for (const who of [false, null, undefined, 0, '', 'yes', 1]) {
    ok(ask({ signedIn: who }) === false,
      `signedIn=${JSON.stringify(who) ?? String(who)} asks nothing`);
  }
  ok(ask({ signedIn: true }) === true, 'and only a real true asks');
}

console.log('\n=== 3. THE BURST, WHICH IS WHAT THE CLOCK IS FOR ===');
{
  // Pulling the notification shade down and up again is two "active" events
  // inside a second. Glancing at the app switcher is another. Each of those would
  // otherwise be a fetch.
  ok(ask({ lastAt: T }) === false, 'asked this instant: not again');
  ok(ask({ lastAt: T, now: T + 1 }) === false, 'a millisecond later: still not');
  ok(ask({ lastAt: T, now: T + 900 }) === false, 'most of a second later: still not');
  ok(ask({ lastAt: T, now: T + NOT_MORE_OFTEN_THAN_MS - 1 }) === false,
    'a millisecond BEFORE the gap has passed: still not');
  ok(ask({ lastAt: T, now: T + NOT_MORE_OFTEN_THAN_MS }) === true,
    'AT the gap exactly: we ask');
  ok(ask({ lastAt: T, now: T + NOT_MORE_OFTEN_THAN_MS + 1 }) === true, 'and after it');
  // THE REAL EVENT IS MINUTES AWAY, so it can never be collapsed.
  ok(ask({ lastAt: T, now: T + 8 * 60 * 1000 }) === true,
    'SOMEBODY BACK FROM AMAZON eight minutes later is always asked about');
  ok(NOT_MORE_OFTEN_THAN_MS === 10 * 1000,
    'and the gap is ten seconds, which collapses a burst and cannot make anybody wait');
}

console.log('\n=== 4. NEVER ASKED BEFORE IS NOT THE SAME AS ASKED AT TIME ZERO ===');
{
  ok(ask({ lastAt: null }) === true, 'null means we have never asked, so we ask');
  ok(ask({ lastAt: undefined }) === true, 'and so does nothing at all');
  ok(ask({ lastAt: 0, now: 0 }) === false,
    'BUT A REAL ZERO IS A REAL TIME and is treated as one');
  for (const junk of ['just now', {}, NaN, Infinity]) {
    ok(ask({ lastAt: junk }) === true,
      `a last time of ${JSON.stringify(junk) ?? String(junk)} cannot be compared, so we ask`);
  }
}

console.log('\n=== 5. and a clock that went backwards is not permission to refuse ===');
{
  // A phone's clock can move. If `now` is before the last time we asked,
  // something is wrong with the clock rather than with the person, and refusing
  // would leave them staring at a stale screen until the clock caught up.
  ok(ask({ lastAt: T, now: T - 1 }) === true, 'a millisecond behind: we ask');
  ok(ask({ lastAt: T, now: T - 60 * 60 * 1000 }) === true, 'an hour behind: we ask');
  ok(ask({ lastAt: T, now: 'no idea' }) === true,
    'and a clock we cannot read at all falls back to the real one rather than refusing');
}

console.log('\n=== 6. IT IS WIRED, AND IT IS WIRED WHERE ONLY A SIGNED IN APP RUNS ===');
{
  const app = read('App.js');
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/import \{ shouldRefreshOnForeground \} from '\.\/src\/foregroundRefresh'/.test(code),
    'App.js takes the decision from the file that owns it');
  ok(/shouldRefreshOnForeground\(\{[\s\S]{0,140}nextState: next/.test(code),
    'and hands it the state the phone actually reported');
  ok(/signedIn: authSession\.isAuthed\(\)/.test(code),
    'AND ASKS THE SESSION ITSELF whether anybody is signed in');
  ok(/void refreshFromBackend\(\);/.test(code), 'and the yes leads to a refresh');
  ok(/askedAt = now;/.test(code), 'which remembers when it asked, or the gap means nothing');

  // ONE WATCHER, INSIDE THE EFFECT THAT ONLY EXISTS WHILE SIGNED IN.
  const watcherAt = code.indexOf("AppState.addEventListener('change'");
  const guardAt = code.lastIndexOf("if (authState !== 'in') return;", watcherAt);
  ok(watcherAt !== -1 && guardAt !== -1 && guardAt < watcherAt,
    'the watcher lives inside an effect that returns early unless signed in');
  ok((code.match(/AppState\.addEventListener/g) || []).length === 1,
    'and App.js adds exactly one, so there is one place to reason about');
  // THE TOKEN RENEWAL IS UNTOUCHED. It was there first and it is a separate job.
  ok(/if \(next === 'active'\) void keeper\.checkNow\(\);/.test(code),
    'the token renewal that was already there still happens');

  // ── AND THE THREE THINGS OUR SIDE MAY HAVE CHANGED WHILE NOBODY LOOKED ──
  //
  // 21 September 2026, the owner: "whenever I add a new campaign, is there any
  // particular command that I need to share on the terminal so it refreshes the
  // page and shows it on the app itself? I cannot tell you every time I add a
  // new campaign."
  //
  // There was no command. campaignStore.load() ran once, in the sign-in effect,
  // so an offer published while the app was open stayed invisible until the JS
  // was reloaded — on a phone, a force-quit. Coming back is the moment to ask,
  // and the offers ride on the same decision the other two already use rather
  // than growing a second opinion about when it is polite to ask.
  const yesAt = code.indexOf('askedAt = now;');
  const yesEnd = code.indexOf('}', yesAt);
  const onYes = code.slice(yesAt, yesEnd);
  ok(yesAt !== -1 && yesEnd > yesAt, 'the yes branch is where expected');
  for (const [what, call] of [
    ['the tasks', 'void refreshFromBackend();'],
    ['which shops they are signed in at', 'void connectedShops.load();'],
    ['the offers themselves', 'void campaignStore.load();'],
  ]) {
    ok(onYes.includes(call), `coming back re-reads ${what}`);
  }
  // AND ALL THREE ARE INSIDE THE GATE, never above it: a fetch with no session
  // is not merely wasted, it is a way to reach the sign-in screen from the
  // sign-in screen. The note above the watcher in App.js says so.
  ok(!/void campaignStore\.load\(\);[\s\S]{0,200}shouldRefreshOnForeground/.test(code),
    'AND THE OFFERS ARE NOT FETCHED BEFORE ANYBODY HAS BEEN ASKED whether to');
}

console.log('\n=== 7. AND THE BUY SCREEN TELLS THE STORE WHAT OUR SIDE SAID ===');
{
  // MY BUG. The screen asked our side to record the visit, took the pop-up's
  // words out of the reply, and threw the rest away — so the store still held the
  // task as it was BEFORE the tap, and the screen watches the store. Watching a
  // record nobody was updating is why it went on saying OPEN AMAZON.
  const screen = read('src/screens/buyinterstitial.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/import \{ applyAuthoritative,/.test(code),
    'the screen can reach the store');
  ok(/applyAuthoritative\(answer\.task\);/.test(code),
    'THE REPLY IS PUSHED INTO THE STORE, which is the whole fix');

  // BEFORE the notice is built, so the face behind the pop-up is already right.
  const told = code.indexOf('applyAuthoritative(answer.task);');
  const built = code.indexOf('const built = noticeFromTask(');
  ok(told !== -1 && built !== -1 && told < built,
    'and pushed BEFORE the pop-up is built, so nothing changes in front of them');

  // AND ONLY AFTER THE REPLY IS KNOWN GOOD. Handing a failed answer's missing
  // task to the store would write a null over a real record.
  const refused = code.indexOf('setCouldNotStart(true);');
  ok(refused !== -1 && refused < told,
    'and only after a failed reply has already returned');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
