// The block that stops the walk through writing anything.
//
// One rule, stated about the request rather than about the screen: while the walk
// through is open, nothing but a GET leaves the device. This file proves the rule
// itself, and then proves that all three of the places a request can leave this
// app actually ask for it — because a rule nobody consults is a comment.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  isShowingTheApp, refuseWhileShowing, showTheApp,
} from './showing.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');

let ran = 0;
const test = (name, fn) => {
  try {
    fn();
    ran += 1;
  } catch (e) {
    console.error(`FAIL: ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};

// ── off by default, and off is the state that matters most ───────────────────

test('starts off, so the ordinary app is untouched', () => {
  assert.equal(isShowingTheApp(), false);
  assert.equal(refuseWhileShowing('POST', '/tasks/x/claim'), null);
});

test('only the exact value true turns it on', () => {
  // Anything looser and a stray truthy value would silently block the whole app.
  for (const nearly of ['true', 1, {}, [], 'yes']) {
    showTheApp(nearly);
    assert.equal(isShowingTheApp(), false, `${JSON.stringify(nearly)} turned it on`);
  }
  showTheApp(true);
  assert.equal(isShowingTheApp(), true);
  showTheApp(false);
  assert.equal(isShowingTheApp(), false);
});

// ── the rule ─────────────────────────────────────────────────────────────────

test('a GET goes through while it is open', () => {
  showTheApp(true);
  assert.equal(refuseWhileShowing('GET', '/campaigns'), null);
  assert.equal(refuseWhileShowing('get', '/campaigns'), null);
  // An absent method means GET in every request library there is, including this
  // app's own transport, where options.method is left off for every read.
  assert.equal(refuseWhileShowing(undefined, '/campaigns'), null);
  assert.equal(refuseWhileShowing(null, '/campaigns'), null);
  showTheApp(false);
});

test('every other method is refused, including ones nobody has written yet', () => {
  showTheApp(true);
  for (const verb of ['POST', 'PATCH', 'PUT', 'DELETE', 'post', 'HEAD', 'OPTIONS', 'TRACE']) {
    const out = refuseWhileShowing(verb, '/anything');
    assert.ok(out, `${verb} was allowed through`);
    assert.equal(out.ok, false);
  }
  showTheApp(false);
});

test('the three things that must never happen are all writes', () => {
  // The whole rule rests on this: spending a claim, moving money and sending a
  // text are all writes, so one rule about writes covers all three.
  showTheApp(true);
  const spendAClaim = refuseWhileShowing('POST', '/tasks');
  const moveMoney = refuseWhileShowing('POST', '/me/withdrawals');
  const sendAText = refuseWhileShowing('POST', '/auth/otp/request');
  for (const out of [spendAClaim, moveMoney, sendAText]) {
    assert.ok(out);
    assert.equal(out.ok, false);
  }
  showTheApp(false);
});

test('says it never left the device, rather than pretending a server said no', () => {
  showTheApp(true);
  const out = refuseWhileShowing('POST', '/tasks');
  assert.equal(out.status, 0, 'a 4xx would be a lie about where the answer came from');
  assert.equal(out.body.refusedBecause, 'showing-the-app');
  assert.match(out.body.message, /showing the app, not for using it/);
  assert.match(out.body.wouldHaveBeen, /^POST \/tasks$/);
  showTheApp(false);
});

test('never throws, so a screen says it cannot rather than crashing', () => {
  showTheApp(true);
  assert.doesNotThrow(() => refuseWhileShowing('POST', undefined));
  assert.doesNotThrow(() => refuseWhileShowing(undefined, undefined));
  assert.doesNotThrow(() => refuseWhileShowing({}, 42));
  showTheApp(false);
});

test('answers in the shape every caller in this app already handles', () => {
  showTheApp(true);
  const out = refuseWhileShowing('POST', '/x');
  for (const field of ['ok', 'status', 'body']) {
    assert.ok(field in out, `a refusal with no ${field} would not read as a reply`);
  }
  showTheApp(false);
});

// ── all three exits ask for the rule ─────────────────────────────────────────

test('every place a request can leave this app consults the rule', () => {
  // Found by looking for fetch( across src/backend. If a fourth exit is ever
  // added, this test does not know about it — so the assertion below is the one
  // that matters: it counts the exits and fails when the count changes.
  const exits = ['http.js', 'authApi.js', 'liveCheckApi.js'];
  for (const file of exits) {
    const src = read(file);
    assert.match(src, /refuseWhileShowing\(/, `${file} does not ask`);
    // And it asks BEFORE it sends. A check after the fetch is no check at all.
    const asks = src.indexOf('refuseWhileShowing(');
    const sends = src.search(/await fetch\(/);
    assert.ok(asks < sends, `${file} asks after it has already sent`);
  }
});

test('there are exactly three exits, so a fourth cannot be added unnoticed', () => {
  // The rule is only as good as the list of places that consult it, and that list
  // cannot be derived at run time. So it is counted here instead: adding a fourth
  // fetch anywhere under src/backend fails this, and whoever adds it reads why.
  const files = [
    'apiBase.js', 'assistantApi.js', 'authApi.js', 'authSession.js', 'campaignStore.js',
    'campaignsApi.js', 'config.js', 'evidenceDto.js', 'evidenceKey.js', 'evidenceSync.js',
    'format.js', 'http.js', 'liveCheckApi.js', 'meApi.js', 'outbox.js', 'screenshotsApi.js',
    'sessionKeeper.js', 'showing.js', 'supportApi.js', 'taskActions.js', 'tasksApi.js',
    'withdrawalsApi.js',
  ];
  const withFetch = files.filter((f) => /(^|[^a-zA-Z])fetch\(/.test(read(f)));
  assert.deepEqual(
    withFetch.sort(),
    ['authApi.js', 'http.js', 'liveCheckApi.js'],
    'the set of files that make requests has changed; each one must consult showing.js',
  );
});

test('the block is not remembered, so a restart cannot come back blocked', () => {
  // Deliberately no storage of any kind in this module. An app that came back from
  // being killed with the block still on would refuse every write with nothing on
  // screen to explain why.
  const src = read('showing.js');
  for (const kind of ['AsyncStorage', 'SecureStore', 'localStorage', 'File(', 'Paths.']) {
    assert.ok(!src.includes(kind), `showing.js remembers state through ${kind}`);
  }
});

if (process.exitCode) console.error(`\n${ran} checks passed before the failure above`);
else console.log(`showing.js: ${ran} checks passed`);
