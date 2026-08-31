// The walk through cannot fall behind the design.
//
// A hand-written list of somebody else's screens rots the day after it is written.
// So this reads fayr-design.browser.jsx and asserts three things about it: that
// every screen the design can render is in the catalogue, that the groups are the
// design's groups, and that the order inside each group is the design's order.
//
// Add a screen to the design and forget the walk through, and the first test here
// fails and names the screen. That is the whole point of this file.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EDGES, EVERY_READ, FORGOTTEN, GROUPS, HOW_MANY, NOT_BUILT, SCREENS, WALK, WHAT_THIS_IS,
  backFrom, isBuilt, nextFrom, pageFor, stepOf,
} from './catalogue.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const design = readFileSync(join(root, 'fayr-design.browser.jsx'), 'utf8');
const stageSrc = readFileSync(join(root, 'src', 'walkthrough', 'OneScreen.js'), 'utf8');
const listSrc = readFileSync(join(root, 'src', 'walkthrough', 'WalkthroughScreen.js'), 'utf8');

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

// ── reading the design ───────────────────────────────────────────────────────

/**
 * Every key in the design's own map of renderable screens.
 *
 * That map is the authority on what the design HAS. Its grouped list below is the
 * authority on order, and the two disagree — which is a finding, not a bug here.
 */
function designScreenKeys() {
  const start = design.indexOf('const screens = {');
  assert.ok(start > 0, "the design no longer has a 'const screens = {' map");
  const end = design.indexOf('\n  };', start);
  assert.ok(end > start, 'could not find the end of the design screen map');
  const block = design.slice(start, end);
  const keys = [...block.matchAll(/^ {4}([a-z][a-z0-9]*):/gm)].map((m) => m[1]);
  assert.ok(keys.length > 40, `only found ${keys.length} screens in the design map`);
  return keys;
}

/** The design's own grouped list: [[group, [key, ...]], ...] in its own order. */
function designGroups() {
  const start = design.indexOf('const FLOW_GROUPS = [');
  assert.ok(start > 0, 'the design no longer has a FLOW_GROUPS list');
  const end = design.indexOf('\n  ];', start);
  const block = design.slice(start, end);
  return [...block.matchAll(/\["([^"]+)",\s*\[([^\]]*)\]\]/g)].map((m) => [
    m[1],
    [...m[2].matchAll(/"([a-z0-9]+)"/g)].map((k) => k[1]),
  ]);
}

// ── the guard against rot ────────────────────────────────────────────────────

test('every screen the design can render is in the walk through', () => {
  const inDesign = designScreenKeys();
  const missing = inDesign.filter((k) => !WALK.includes(k));
  assert.deepEqual(
    missing, [],
    'these screens exist in fayr-design.browser.jsx and are not in the walk '
    + `through: ${missing.join(', ')}. Add them to src/walkthrough/catalogue.js — `
    + 'with `opens` if Fayr has a real screen, or with `designWords` and `whyNot` '
    + 'if it does not.',
  );
});

test('the walk through invents no screen the design does not have', () => {
  const inDesign = new Set(designScreenKeys());
  const invented = WALK.filter((k) => !inDesign.has(k));
  assert.deepEqual(invented, [], `not in the design: ${invented.join(', ')}`);
});

test('the count is the design count, and it is printed rather than guessed', () => {
  assert.equal(HOW_MANY, designScreenKeys().length);
  assert.equal(HOW_MANY, WALK.length);
  assert.equal(HOW_MANY, Object.keys(SCREENS).length);
});

test("the groups are the design's groups, in the design's order", () => {
  const theirs = designGroups().map(([name]) => name);
  const ours = GROUPS.map((g) => g.name);
  // Ours ends with one group of our own, for the screens the design's own list
  // forgets. Everything before it must match the design exactly.
  assert.deepEqual(ours.slice(0, theirs.length), theirs);
  assert.equal(ours.length, theirs.length + 1);
  assert.equal(ours[ours.length - 1], FORGOTTEN);
});

test("the order inside each group is the design's order", () => {
  for (const [name, keys] of designGroups()) {
    const ours = GROUPS.find((g) => g.name === name);
    assert.ok(ours, `we lost the group ${name}`);
    assert.deepEqual(ours.keys, keys, `${name} is in a different order`);
  }
});

test("the last group holds exactly what the design's own list forgets", () => {
  const listed = new Set(designGroups().flatMap(([, keys]) => keys));
  const forgotten = designScreenKeys().filter((k) => !listed.has(k));
  const ours = GROUPS.find((g) => g.name === FORGOTTEN).keys;
  assert.deepEqual([...ours].sort(), [...forgotten].sort());
  assert.ok(
    forgotten.length > 0,
    'the design now lists all its own screens, so this group can be removed',
  );
});

test('every screen is in exactly one group', () => {
  const seen = new Map();
  for (const g of GROUPS) {
    for (const k of g.keys) {
      assert.ok(!seen.has(k), `${k} is in both ${seen.get(k)} and ${g.name}`);
      seen.set(k, g.name);
    }
  }
  for (const k of WALK) assert.equal(SCREENS[k].group, seen.get(k));
});

// ── built, or honestly not ───────────────────────────────────────────────────

test('every screen either opens something real or says what is missing', () => {
  for (const key of WALK) {
    const s = SCREENS[key];
    const hasReal = s.opens != null;
    const hasWords = s.designWords != null;
    assert.ok(hasReal || hasWords, `${key} shows nothing at all`);
    assert.ok(!(hasReal && hasWords), `${key} claims both a real screen and design words`);
    if (hasWords) {
      assert.ok(s.designWords.heading, `${key} has no heading from the design`);
      assert.ok(s.designWords.body, `${key} has no words from the design`);
      assert.ok(Array.isArray(s.designWords.buttons), `${key} buttons is not a list`);
      assert.ok(s.whyNot, `${key} is not built and does not say why`);
      assert.ok(s.whyNot.length > 40, `${key} says why in too few words to be useful`);
    }
  }
});

test('nothing unbuilt is dressed up as built', () => {
  assert.equal(NOT_BUILT.length + WALK.filter(isBuilt).length, HOW_MANY);
  for (const key of NOT_BUILT) {
    assert.equal(isBuilt(key), false);
    assert.equal(SCREENS[key].opens, undefined);
  }
});

test('there is something unbuilt, so this is not silently reporting a full house', () => {
  // A day may come when this fails because everything is built. On that day this
  // test is the one to delete, and the report that said "twenty unbuilt" was true.
  assert.ok(NOT_BUILT.length > 0);
  assert.ok(NOT_BUILT.length < HOW_MANY, 'nothing is built at all, which cannot be right');
});

test('every real screen it opens is one the walk through knows how to build', () => {
  const wanted = [...new Set(WALK.filter(isBuilt).map((k) => SCREENS[k].opens.screen))].sort();
  // The registry lives in OneScreen.js, as `KNOWN = {` with one key per screen.
  const start = stageSrc.indexOf('const KNOWN = {');
  assert.ok(start > 0, 'OneScreen.js no longer has a KNOWN registry');
  const end = stageSrc.indexOf('\n};', start);
  const block = stageSrc.slice(start, end);
  const known = [...block.matchAll(/^ {2}([A-Z][A-Za-z]*):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(wanted, known, 'the catalogue and the screen registry disagree');
});

// ── walking it ───────────────────────────────────────────────────────────────

test('the arrows walk from the first screen to the last and stop', () => {
  let key = WALK[0];
  assert.equal(backFrom(key), null, 'the first screen has a back arrow to nowhere');
  const seen = [key];
  while (nextFrom(key) != null) {
    key = nextFrom(key);
    seen.push(key);
    assert.ok(seen.length <= HOW_MANY + 1, 'the arrows go round in a circle');
  }
  assert.deepEqual(seen, WALK);
  assert.equal(nextFrom(WALK[WALK.length - 1]), null, 'the last screen wraps round');
});

test('back undoes next, everywhere', () => {
  for (const key of WALK) {
    const fwd = nextFrom(key);
    if (fwd != null) assert.equal(backFrom(fwd), key, `back from ${fwd} is not ${key}`);
  }
});

test('an unknown key is answered with nothing rather than a guess', () => {
  assert.equal(pageFor('not-a-screen'), null);
  assert.equal(stepOf('not-a-screen'), 0);
  assert.equal(nextFrom('not-a-screen'), null);
  assert.equal(backFrom('not-a-screen'), null);
  assert.equal(isBuilt('not-a-screen'), false);
});

test('every page says where it is and what it belongs to', () => {
  for (const [i, key] of WALK.entries()) {
    const p = pageFor(key);
    assert.equal(p.key, key);
    assert.equal(p.step, i + 1);
    assert.equal(p.of, HOW_MANY);
    assert.ok(p.where.includes(`${i + 1} of ${HOW_MANY}`), `${key} does not say where it is`);
    assert.ok(p.where.includes(p.group), `${key} does not name its group`);
    assert.ok(p.title && p.title.length > 4, `${key} has no title worth reading`);
  }
});

test('the titles read plainly: no long dashes, no shortenings of ours', () => {
  // The design's own words are quoted as written, long dashes and all. Our own
  // titles are held to the rule the rest of this project is held to.
  for (const key of WALK) {
    const t = SCREENS[key].title;
    assert.ok(!/--|—|–/.test(t), `${key} title has a long dash: ${t}`);
    assert.ok(!/\b(OTP|UPI|PAN|FAQ|UTR)\b/.test(t), `${key} title uses a shortening: ${t}`);
  }
});

test('every title is different, so two rows never look like the same row', () => {
  const titles = WALK.map((k) => SCREENS[k].title);
  const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
  assert.deepEqual([...new Set(dupes)], [], `repeated titles: ${dupes.join(' / ')}`);
});

// ── nothing writes ───────────────────────────────────────────────────────────

test('every read declared is a read: a path, and nothing that could be a write', () => {
  for (const key of WALK) {
    const reads = SCREENS[key].reads;
    assert.ok(Array.isArray(reads), `${key} does not declare its reads`);
    for (const path of reads) {
      assert.match(path, /^\//, `${key} declares a read that is not a path: ${path}`);
      // A declared read is a GET by definition. Anything that names a method, or
      // reads like an action rather than a thing, is caught here.
      assert.ok(
        !/\b(POST|PATCH|PUT|DELETE)\b/i.test(path),
        `${key} declares a method: ${path}`,
      );
      for (const action of ['claim', 'confirm', 'submit', 'release', 'withdraw/', 'logout']) {
        assert.ok(!path.includes(action), `${key} declares something that acts: ${path}`);
      }
    }
  }
});

test('nothing unbuilt reads anything, because there is nothing to read it for', () => {
  for (const key of NOT_BUILT) {
    assert.deepEqual(SCREENS[key].reads, [], `${key} is not built but reads something`);
  }
});

test('the whole list of reads is what the counting test walks', () => {
  assert.ok(EVERY_READ.length > 4, 'a walk that reads almost nothing proves almost nothing');
  assert.deepEqual(EVERY_READ, [...EVERY_READ].sort(), 'not in a stable order');
  assert.equal(EVERY_READ.length, new Set(EVERY_READ).size, 'a path is listed twice');
});

// ── it says what it is ───────────────────────────────────────────────────────

test('it says on itself that it is for showing the app', () => {
  assert.match(WHAT_THIS_IS, /not for using it/);
  for (const promise of ['no claim is spent', 'no money moves', 'no text message is sent']) {
    assert.ok(WHAT_THIS_IS.includes(promise), `it does not promise: ${promise}`);
  }
  // And the promise is on the screen a person is looking at, not only in a file.
  assert.match(listSrc, /WHAT_THIS_IS/, 'the list does not show the notice');
  assert.match(stageSrc, /WHAT_THIS_IS|showing the app/, 'a screen page does not show it');
});

test('stepping to another screen really remounts it', () => {
  // A real bug this caught. Several design screens share one Fayr screen with a
  // different variant: the two code failures are both OtpScreen, all five setting
  // up screens are SetupFlow, both pictures are ProofUpload, six journey pages are
  // one JourneyScreen. Each reads its variant into state once, on mount. Without a
  // key that changes with the screen, React keeps the instance across a step and
  // the arrow changes the label above the screen and nothing else.
  assert.match(
    stageSrc, /key=\{page\.key\}/,
    'OneScreen.js does not key the screen on the design key, so stepping between '
    + 'two screens that share one component would not reset it',
  );

  // And the sharing is real, so this is not a guard against nothing.
  const variants = new Map();
  for (const key of WALK.filter(isBuilt)) {
    const { screen } = SCREENS[key].opens;
    variants.set(screen, (variants.get(screen) || 0) + 1);
  }
  const shared = [...variants.entries()].filter(([, n]) => n > 1);
  assert.ok(shared.length > 0, 'no screen is shared any more, so this can go');

  // The pair that found it: two adjacent steps on the same component.
  const adjacentSharers = WALK.filter(isBuilt).filter((key, i, all) => {
    const before = all[i - 1];
    return before != null
      && SCREENS[key].opens.screen === SCREENS[before].opens.screen
      && SCREENS[key].opens.at !== SCREENS[before].opens.at;
  });
  assert.ok(
    adjacentSharers.length > 0,
    'no two neighbouring steps share a component with different variants',
  );
});

test('the list and the pages hold no copy of the screens', () => {
  // Both must ask the catalogue. A second copy of sixty one screens is a second
  // copy that goes stale, which is the failure this whole file exists to prevent.
  for (const [name, src] of [['WalkthroughScreen.js', listSrc], ['OneScreen.js', stageSrc]]) {
    assert.match(src, /from '\.\/catalogue/, `${name} does not read the catalogue`);
    for (const own of ['designWords:', 'whyNot:', 'const GROUPS = [']) {
      assert.ok(!src.includes(own), `${name} keeps its own copy: ${own}`);
    }
  }
});

test('the edge states the founder asked about are all in it', () => {
  // Named in the request: all places taken, the shop refusing to load, an account
  // blocked, a delivery late, a code entered wrongly too many times.
  const edges = GROUPS.find((g) => g.name === EDGES).keys;
  for (const key of ['seatlost', 'blocked', 'deliverydelayed', 'otplocked']) {
    assert.ok(edges.includes(key), `${key} is not among the edge states`);
    assert.ok(pageFor(key), `${key} has no page`);
  }
});

if (process.exitCode) console.error(`\n${ran} checks passed before the failures above`);
else console.log(`walkthrough catalogue: ${ran} checks passed`);
