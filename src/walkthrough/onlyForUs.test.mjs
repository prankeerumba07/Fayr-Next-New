// The walk through is off unless somebody turns it on, and a shopper cannot.
//
// The owner found the walk through in Expo Go and asked for it gone from the
// normal journey. This proves it is gone: the switch is off by default, off in
// Expo Go, and the profile does not draw the row unless it is on.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG_KEY, SWITCH, switchedOn } from './onlyForUs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const profile = readFileSync(join(root, 'src', 'ProfileScreen.js'), 'utf8');
const appJs = readFileSync(join(root, 'App.js'), 'utf8');

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

// ── the switch ───────────────────────────────────────────────────────────────

test('off when nothing says otherwise', () => {
  assert.equal(switchedOn(null, null), false);
  assert.equal(switchedOn({}, {}), false);
  assert.equal(switchedOn(undefined, undefined), false);
});

test('off in Expo Go, which is where the complaint came from', () => {
  // React Native's own development flag is true there. The switch deliberately
  // does not read it: a flag that is on wherever the problem was seen is no fix.
  assert.equal(switchedOn({ NODE_ENV: 'development' }, {}), false);
  // Comments stripped first. The file's own comment explains WHY it does not
  // read __DEV__, and the first version of this test failed on that explanation.
  const src = readFileSync(join(root, 'src', 'walkthrough', 'onlyForUs.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/__DEV__/.test(src), 'the switch reads __DEV__, which is true in Expo Go');
});

test('on when the environment says so, in the ways a person would write it', () => {
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE', ' 1 ']) {
    assert.equal(switchedOn({ [SWITCH]: value }, null), true, `${value} did not turn it on`);
  }
});

test('off for anything that is not a yes', () => {
  for (const value of ['0', 'false', 'no', 'off', '', 'maybe', 'null']) {
    assert.equal(switchedOn({ [SWITCH]: value }, null), false, `${value} turned it on`);
  }
});

test('on from app.json only for the exact value true', () => {
  assert.equal(switchedOn(null, { [CONFIG_KEY]: true }), true);
  // A string is a typo, not an intention. Reading a truthy string would turn it
  // on for anybody who typed "false" by hand.
  for (const wrong of ['true', 'yes', 1, {}, []]) {
    assert.equal(switchedOn(null, { [CONFIG_KEY]: wrong }), false, `${JSON.stringify(wrong)} turned it on`);
  }
});

test('a different key in app.json does nothing', () => {
  assert.equal(switchedOn(null, { walkthrough: true, debug: true }), false);
});

// ── the app really honours it ────────────────────────────────────────────────

test('the half that asks Expo is separate, so this test can run at all', () => {
  const pure = readFileSync(join(root, 'src', 'walkthrough', 'onlyForUs.js'), 'utf8');
  assert.ok(!pure.includes('import '), 'onlyForUs.js imports something, so node cannot read it');
  const wired = readFileSync(join(root, 'src', 'walkthrough', 'isItOn.js'), 'utf8');
  assert.match(wired, /switchedOn\(/, 'isItOn.js does not use the decision it is meant to');
});

test('the profile asks before it draws the row', () => {
  assert.match(profile, /walkthroughIsOn\(\)/, 'ProfileScreen does not ask the switch');
  // Inside the guard, not merely near it. The first version of this test looked
  // 900 characters after the first mention of the switch, which was the IMPORT
  // line, so it never reached the row and would have passed with no guard at all.
  const guard = profile.match(/\{showWalkthrough \?([\s\S]*?): null\}/);
  assert.ok(guard, 'ProfileScreen has no {showWalkthrough ? ... : null} guard');
  assert.match(guard[1], /Walk through every screen/, 'the row is not inside the guard');
  // And the guarded block is the ONLY place the row appears.
  const outside = profile.replace(guard[0], '');
  assert.ok(
    !outside.includes('Walk through every screen'),
    'the row also appears outside the guard',
  );
});

test('the row cannot be reached any other way from the profile', () => {
  // One entry point, and it is the guarded one. A second unguarded navigate to
  // the walk through anywhere in this file would put it back in front of people.
  const navigations = [...profile.matchAll(/navigate\('Walkthrough'\)/g)];
  assert.equal(
    navigations.length, 1,
    `the profile has ${navigations.length} ways into the walk through; there must be one`,
  );
});

test('no other screen in the app opens it', () => {
  // Checked across every screen file rather than by memory.
  const files = [
    'src/HomeScreen.js', 'src/MyProductsScreen.js', 'src/EarningsScreen.js',
    'src/DetailScreen.js', 'src/TaskScreen.js', 'src/WalletScreen.js',
    'src/SupportScreen.js', 'src/ChatScreen.js', 'src/PolicyScreen.js',
    'src/journey/JourneyScreen.js', 'src/firstrun/FirstRunFlow.js',
  ];
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8');
    assert.ok(
      !src.includes("'Walkthrough'"),
      `${f} opens the walk through, and only the profile may`,
    );
  }
});

test('the screens stay registered, so nothing underneath it breaks', () => {
  // Switched off, not deleted. The owner asked for the code to keep working.
  assert.match(appJs, /name="Walkthrough"/);
  assert.match(appJs, /name="OneScreen"/);
});

test('the block that stops it writing is untouched', () => {
  const showing = readFileSync(join(root, 'src', 'backend', 'showing.js'), 'utf8');
  assert.match(showing, /export function refuseWhileShowing/);
  assert.match(showing, /export function showTheApp/);
});

if (process.exitCode) console.error(`\n${ran} checks passed before the failures above`);
else console.log(`walk through switch: ${ran} checks passed`);
