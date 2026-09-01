// One design screen, one file, one key — checked against the design itself.
//
// The register in keys.js claims which design screens have their own file. This
// proves the claim three ways: the list is the design's own list in the design's
// own order, every key that claims a file really has one on disk, and the app
// really registers them. A claim nothing checks is a comment.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BEFORE_SIGN_IN, HOW_MANY, IN_THE_NAVIGATOR, KEYS, OWN, SCREENS,
  STILL_TO_SPLIT_CEILING, screenFor, stillToSplit,
} from './keys.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const design = readFileSync(join(root, 'fayr-design.browser.jsx'), 'utf8');
const appJs = readFileSync(join(root, 'App.js'), 'utf8');
const indexJs = readFileSync(join(here, 'index.js'), 'utf8');

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
  assert.deepEqual(
    KEYS, designKeys(),
    'keys.js has drifted from the design. Add, remove or reorder to match '
    + 'fayr-design.browser.jsx, never the other way round.',
  );
});

test('the count is the design count, and every key appears once', () => {
  assert.equal(HOW_MANY, designKeys().length);
  assert.equal(new Set(KEYS).size, HOW_MANY, 'a key is listed twice');
});

test('every row says where it is, and nothing else', () => {
  for (const s of SCREENS) {
    assert.ok(['own', 'folded', 'missing'].includes(s.at), `${s.key}: bad state ${s.at}`);
    if (s.at === 'folded') {
      assert.ok(s.inside, `${s.key} is folded and does not say into what`);
      assert.ok(
        existsSync(join(root, s.inside)),
        `${s.key} says it is inside ${s.inside}, which does not exist`,
      );
    } else {
      assert.equal(s.inside, undefined, `${s.key} is not folded but names a file`);
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
  }
  assert.equal(left.length + OWN.length, HOW_MANY);
});

test('an unknown key is answered with nothing rather than a guess', () => {
  assert.equal(screenFor('not-a-screen'), null);
});

if (process.exitCode) console.error(`\n${ran} checks passed before the failures above`);
else console.log(`screen register: ${ran} checks passed`);
