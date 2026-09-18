// One design screen, one file, one key — checked against the design itself.
//
// The register in keys.js claims which design screens have their own file. This
// proves the claim three ways: the list is the design's own list in the design's
// own order, every key that claims a file really has one on disk, and the app
// really registers them. A claim nothing checks is a comment.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BEFORE_SIGN_IN, FROM_THE_NEW_DESIGN, HOW_MANY, IN_THE_APP, IN_THE_NAVIGATOR, KEYS, OWN, REMOVED,
  SCREENS, STILL_TO_SPLIT_CEILING, screenFor, stillToSplit,
} from './keys.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const design = readFileSync(join(root, 'fayr-design.browser.jsx'), 'utf8');
const appJs = readFileSync(join(root, 'App.js'), 'utf8');
const indexJs = readFileSync(join(here, 'index.js'), 'utf8');

/** Every JavaScript file the app itself is built from. */
function everyAppFile(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyAppFile(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

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

/** The design's own list of screens it can draw, in its own order. */
function designKeys() {
  const start = design.indexOf('const screens = {');
  assert.ok(start > 0, "the design no longer has a 'const screens = {' map");
  const end = design.indexOf('\n  };', start);
  const keys = [...design.slice(start, end).matchAll(/^ {4}([a-z][a-z0-9]*):/gm)]
    .map((m) => m[1]);
  assert.ok(keys.length > 40, `only found ${keys.length} screens in the design`);
  return keys;
}

// ── the list is the design's ─────────────────────────────────────────────────

test("it is the design's list, in the design's order", () => {
  // THE OLD DESIGN'S LIST, EXACTLY, once the rows the NEW design added are set
  // aside. Since 18 September 2026 keys.js has two sources and says which is
  // which: every row is either one of fayr-design.browser.jsx's sixty one, in
  // its order, or names the Figma frame it came from. Neither is allowed to
  // stand in for the other.
  assert.deepEqual(
    KEYS.filter((k) => !FROM_THE_NEW_DESIGN.includes(k)), designKeys(),
    'keys.js has drifted from the design. Add, remove or reorder to match '
    + 'fayr-design.browser.jsx, never the other way round.',
  );
});

test('a screen from the new design names the frame it came from, and is not one of the old sixty one', () => {
  assert.deepEqual(FROM_THE_NEW_DESIGN, ['shop'],
    'exactly one screen has come from the new design so far: the shop inside Fayr');
  for (const key of FROM_THE_NEW_DESIGN) {
    const row = screenFor(key);
    assert.ok(row && /^\d+:\d+$/.test(row.fromTheNewDesign),
      `${key} must name its Figma frame as node:id`);
    assert.ok(!designKeys().includes(key),
      `${key} is in the OLD design too, so it does not belong under the new one`);
    assert.equal(row.addedOn, '2026-09-18', `${key} says when it arrived`);
  }
});

test('the count is the design count, and every key appears once', () => {
  assert.equal(HOW_MANY, designKeys().length + FROM_THE_NEW_DESIGN.length);
  assert.equal(new Set(KEYS).size, HOW_MANY, 'a key is listed twice');
});

test('sixty one in the design, sixty in the app, and the one gone is named', () => {
  // THE RULE CHANGED ON 2 SEPTEMBER 2026. It used to be that no design screen is
  // ever deleted, and this check enforced it. The owner withdrew that rule in
  // writing — "WHEN HE SAYS REMOVE, YOU DELETE. Not hide, not mark, not leave off
  // a path. Delete the file, the key and the route." — and ordered the
  // confirmation page removed.
  //
  // THIS IS NOT A WEAKER CHECK. It does not pass on a count. It says the design
  // has sixty one, the app has sixty, and the ONE screen the app is missing is
  // this one BY NAME. A second screen going missing fails here, and so does this
  // one coming back without the register being changed to say so.
  // SIXTY TWO SINCE 18 SEPTEMBER 2026: the old design's sixty one plus the shop
  // inside Fayr from the new one. Still one removed, by name, below.
  assert.equal(HOW_MANY, 62, 'the two designs have sixty two screens between them');
  assert.equal(IN_THE_APP, 61, 'and the app accounts for sixty one of them');
  assert.deepEqual(REMOVED, ['confirm'],
    'exactly one screen has been removed by order, and it is the confirmation '
    + 'page. Any other screen appearing here is a screen that went missing without '
    + 'anybody deciding to remove it');

  const confirm = screenFor('confirm');
  assert.ok(confirm, 'the row must stay, so the register is still the design’s own list');
  assert.equal(confirm.removedOn, '2026-09-02', 'the day it was removed is recorded');
  assert.ok(/owner ordered it removed/.test(confirm.why),
    'and the row says the owner ordered it, in words');
  assert.ok(/product page/.test(confirm.why), 'and says why');
});

test('nothing anywhere still points at a removed screen', () => {
  for (const key of REMOVED) {
    // (a) the file is gone
    assert.ok(!existsSync(join(here, `${key}.js`)),
      `src/screens/${key}.js still exists. Removed means deleted, not left in place`);
    // (b) it is not in the registry
    assert.ok(!OWN.includes(key), `${key} is still counted as having its own file`);
    assert.ok(!IN_THE_NAVIGATOR.includes(key), `${key} is still in the navigator list`);
    assert.ok(!indexJs.includes(`from './${key}'`),
      `src/screens/index.js still imports ${key}`);
    assert.ok(!new RegExp(`\\b${key}[,:]`).test(
      indexJs.slice(indexJs.indexOf('export const SCREENS = {'))),
    `src/screens/index.js still maps ${key}`);
    // (c) it has no route
    assert.ok(!new RegExp(`name="${key}"`).test(appJs),
      `App.js still registers a screen called "${key}"`);
    assert.ok(!new RegExp(`DESIGN_SCREENS\\.${key}\\b`).test(appJs),
      `App.js still reaches for DESIGN_SCREENS.${key}`);
    // (d) nothing navigates to it, and nothing imports it
    const pointing = [];
    for (const file of everyAppFile(join(root, 'src'))) {
      const src = readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '');
      if (new RegExp(`(navigate|replace|push)\\(\\s*['"\`]${key}['"\`]`).test(src)) {
        pointing.push(`${file} navigates to it`);
      }
      if (new RegExp(`from '[^']*screens/${key}'`).test(src)
        || new RegExp(`require\\('[^']*screens/${key}'\\)`).test(src)) {
        pointing.push(`${file} imports it`);
      }
    }
    assert.deepEqual(pointing, [], `\n  ${pointing.join('\n  ')}`);
    // (e) and the journey does not route to it
    const journey = readFileSync(join(root, 'src', 'ui', 'journey.js'), 'utf8');
    assert.ok(!new RegExp(`designKey: '${key}'`).test(journey),
      `${key} is removed and journey.js still routes to it`);
  }
});

test('every row says where it is, and nothing else', () => {
  for (const s of SCREENS) {
    assert.ok(['own', 'folded', 'missing', 'removed'].includes(s.at),
      `${s.key}: bad state ${s.at}`);
    if (s.at === 'folded') {
      assert.ok(s.inside, `${s.key} is folded and does not say into what`);
      assert.ok(
        existsSync(join(root, s.inside)),
        `${s.key} says it is inside ${s.inside}, which does not exist`,
      );
    } else {
      assert.equal(s.inside, undefined, `${s.key} is not folded but names a file`);
    }
    if (s.at === 'removed') {
      // A removal is a decision somebody made on a day, for a reason. Without all
      // three, "removed" would be a way to make a missing screen stop failing.
      assert.match(String(s.removedOn), /^\d{4}-\d{2}-\d{2}$/,
        `${s.key} is removed and does not say on what day`);
      assert.ok(typeof s.why === 'string' && s.why.length > 30,
        `${s.key} is removed and does not say why, in words`);
    } else {
      assert.equal(s.removedOn, undefined, `${s.key} is not removed but names a day`);
    }
  }
});

// ── every claim of a file is true ────────────────────────────────────────────

test('every key with its own file really has one, named by the key', () => {
  for (const key of OWN) {
    const file = join(here, `${key}.js`);
    assert.ok(existsSync(file), `${key} claims its own file, and src/screens/${key}.js is not there`);
    const src = readFileSync(file, 'utf8');
    assert.match(
      src, /export default|export \{ default \}/,
      `src/screens/${key}.js has no default export, so nothing can render it`,
    );
  }
});

test('no stray file sits in here pretending to be a screen', () => {
  const files = readdirSync(here)
    .filter((f) => f.endsWith('.js') && f !== 'keys.js' && f !== 'index.js')
    .map((f) => f.replace(/\.js$/, ''));
  const strays = files.filter((f) => !OWN.includes(f));
  assert.deepEqual(
    strays, [],
    `these are in src/screens and are not design screens: ${strays.join(', ')}`,
  );
  const claimed = OWN.filter((k) => !files.includes(k));
  assert.deepEqual(claimed, [], `claimed but absent: ${claimed.join(', ')}`);
});

test('one file per key: no file serves two design screens', () => {
  // The whole point. Two keys pointing at one file is what the old app did, and
  // it is what the owner asked to be undone.
  const seen = new Map();
  for (const key of OWN) {
    const src = readFileSync(join(here, `${key}.js`), 'utf8');
    const reexport = src.match(/export \{ default \} from '([^']+)'/);
    if (!reexport) continue;
    const target = reexport[1];
    assert.ok(
      !seen.has(target),
      `${key} and ${seen.get(target)} both point at ${target}. `
      + 'One design screen, one real screen.',
    );
    seen.set(target, key);
  }
});

// ── the registry and the app agree ───────────────────────────────────────────

test('index.js maps exactly the keys that have their own file', () => {
  const start = indexJs.indexOf('export const SCREENS = {');
  assert.ok(start > 0, 'index.js has no SCREENS map');
  const end = indexJs.indexOf('\n};', start);
  // The map uses shorthand (`splash,`), so match a key with or without a colon.
  const mapped = [...indexJs.slice(start, end).matchAll(/^ {2}([a-z][a-z0-9]*)\s*[:,]/gm)]
    .map((m) => m[1]);
  assert.deepEqual(
    [...mapped].sort(), [...OWN].sort(),
    'the registry and keys.js disagree about which screens exist',
  );
});

test('index.js imports each screen from its own file, by its own key', () => {
  for (const key of OWN) {
    assert.ok(
      indexJs.includes(`from './${key}'`),
      `index.js does not import src/screens/${key}.js`,
    );
  }
});

test('the app registers every screen that belongs in the navigator', () => {
  for (const key of IN_THE_NAVIGATOR) {
    assert.ok(
      new RegExp(`name="${key}"`).test(appJs),
      `App.js does not register a screen called "${key}"`,
    );
  }
});

test('the app does NOT register the screens that come before signing in', () => {
  // Putting these in the navigator would open a way into the signed-in app from
  // the sign in screen. They are resolved from the same registry by the same key,
  // so there is still exactly one file each.
  for (const key of BEFORE_SIGN_IN) {
    assert.ok(
      !new RegExp(`name="${key}"`).test(appJs),
      `App.js registers "${key}", which happens before anybody is signed in`,
    );
  }
});

test('the two lists together are every screen with its own file', () => {
  assert.deepEqual(
    [...IN_THE_NAVIGATOR, ...BEFORE_SIGN_IN].sort(),
    [...OWN].sort(),
  );
  const both = IN_THE_NAVIGATOR.filter((k) => BEFORE_SIGN_IN.includes(k));
  assert.deepEqual(both, [], `registered in two places: ${both.join(', ')}`);
});

// ── the ratchet ──────────────────────────────────────────────────────────────

test('the number still to split has not gone up', () => {
  const left = stillToSplit();
  assert.ok(
    left.length <= STILL_TO_SPLIT_CEILING,
    `${left.length} screens are not yet their own file, and the ceiling is `
    + `${STILL_TO_SPLIT_CEILING}. A screen has been folded back into another one, `
    + 'or a new design screen arrived with nothing behind it. This number may go '
    + 'down and may never go up.',
  );
});

test('the ceiling is kept honest: it is never far above the real number', () => {
  // A ceiling left high after work lands stops being a ratchet at all.
  const left = stillToSplit().length;
  assert.ok(
    STILL_TO_SPLIT_CEILING - left <= 2,
    `${left} left to split but the ceiling is still ${STILL_TO_SPLIT_CEILING}. `
    + 'Lower it to the real number so it keeps biting.',
  );
});

test('every screen not yet its own file is accounted for, one way or the other', () => {
  const left = stillToSplit();
  for (const key of left) {
    const s = screenFor(key);
    assert.ok(s, `${key} is not in the register at all`);
    assert.notEqual(s.at, 'own');
    assert.notEqual(s.at, 'removed', `${key} is removed, so it is not work left to do`);
  }
  // Every one of the design's screens is in exactly one of three piles: it has its
  // own file, it is still to build, or it was removed by order. Nothing falls
  // between them.
  assert.equal(left.length + OWN.length + REMOVED.length, HOW_MANY,
    `${OWN.length} have their own file, ${left.length} are still to do and `
    + `${REMOVED.length} were removed, which must add up to the design's ${HOW_MANY}`);
});

test('an unknown key is answered with nothing rather than a guess', () => {
  assert.equal(screenFor('not-a-screen'), null);
});

if (process.exitCode) console.error(`\n${ran} checks passed before the failures above`);
else console.log(`screen register: ${ran} checks passed`);
