// ONE PLACE OWNS THE SPACE ABOVE A JOURNEY SCREEN'S BODY.
//
// The owner reported an empty band between the "Step N of 11" strip and the screen
// under it, TWICE. The first diagnosis was three small paddings adding to 18
// points; that was real but it was not the band. The band was 71 points, and 59 of
// them were the phone's notch being stepped over a second time by the Screen
// wrapper. See src/ui/journeySpacing.js for the whole walk and the library
// evidence for why the first fix could not reach it.
//
// THESE CHECKS MEASURE. The band is added up from every part, so a part that comes
// back is caught wherever it comes back from — not a check that some one padding
// is still zero somewhere.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BODY_TOP, MOST_ALLOWED_BAND, NOTCH, STRIP_BOTTOM, TOP_BAR_TOP,
  bandAbove, edgesInsideJourney, topPaddingInside,
} from './journeySpacing.js';

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    process.exitCode = 1;
  }
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p) => readFileSync(join(root, p), 'utf8');

console.log('the decision');

t('inside the journey a screen contributes nothing', () => {
  assert.equal(topPaddingInside(TOP_BAR_TOP, true), 0);
  assert.equal(topPaddingInside(BODY_TOP, true), 0);
  assert.equal(topPaddingInside(99, true), 0);
});

t('on its own it contributes its own value again', () => {
  assert.equal(topPaddingInside(TOP_BAR_TOP, false), TOP_BAR_TOP);
  assert.equal(topPaddingInside(BODY_TOP, false), BODY_TOP);
  // Anything that is not a firm yes means "not inside", so a missing context
  // leaves a screen looking exactly as it did before.
  for (const notInside of [undefined, null, 0, '', 'true', 1]) {
    assert.equal(topPaddingInside(TOP_BAR_TOP, notInside), TOP_BAR_TOP);
  }
});

t('a value we cannot use becomes nothing rather than NaN on a screen', () => {
  for (const bad of [undefined, null, NaN, -4, 'six', {}]) {
    assert.equal(topPaddingInside(bad, false), 0, `${String(bad)} leaked through`);
  }
});

t('the two values are the design’s own, not chosen', () => {
  // TopBar    padding: "6px 18px 8px"   fayr-design.browser.jsx:397
  // body      padding: "4px 22px 22px"  fayr-design.browser.jsx:2303
  assert.equal(TOP_BAR_TOP, 6);
  assert.equal(BODY_TOP, 4);
  const design = read('fayr-design.browser.jsx');
  assert.ok(
    design.includes('padding: "6px 18px 8px"'),
    'the design’s title bar padding has changed; re-measure TOP_BAR_TOP',
  );
  assert.ok(
    design.includes('padding: "4px 22px 22px"'),
    'the design’s body padding has changed; re-measure BODY_TOP',
  );
});

t('it is pure, so this test can read it at all', () => {
  assert.ok(!read('src/ui/journeySpacing.js').includes('import '));
});

console.log('\nit is said once, by the router, to everything inside it');

t('the router provides it, and wraps the screen in it', () => {
  const router = strip(read('src/journey/JourneyScreen.js'));
  assert.ok(/InsideJourneyContext\.Provider value>/.test(router),
    'the router does not say it at all');
  const wrapped = (router.match(
    /<InsideJourneyContext\.Provider[^>]*>([\s\S]*?)<\/InsideJourneyContext\.Provider>/,
  ) || [])[1] || '';
  assert.ok(/<Screen\b/.test(wrapped), 'the screen is not inside it');
  assert.ok(/key=\{designKey\}/.test(wrapped), 'the stage is not inside it');
});

t('the title bar is the one place that reads it', () => {
  const brand = strip(read('src/ui/brand.js'));
  assert.ok(/useInsideJourney\(\)/.test(brand), 'the shared title bar ignores it');
  assert.ok(
    /paddingTop: topPaddingInside\(TOP_BAR_TOP, inside\)/.test(brand),
    'the title bar does not ask what to contribute',
  );
  // And its own style no longer states a top of its own, so there is one answer.
  const style = (brand.match(/\n  topBar: \{[\s\S]*?\n  \},/) || [''])[0];
  assert.ok(!/paddingTop/.test(style), 'the title bar still has a top padding of its own');
});

t('a context, not a prop, so no screen can forget to pass it on', () => {
  const ctx = strip(read('src/journey/insideJourney.js'));
  assert.ok(/createContext\(false\)/.test(ctx), 'it does not default to being outside');
  // Not handed to screens as a route param, which is the mistake this avoids.
  const router = strip(read('src/journey/JourneyScreen.js'));
  assert.ok(
    !/insideJourney:/.test(router),
    'the router passes it as a parameter, which a screen can drop',
  );
});

console.log('\nno journey screen sets a top of its own on its outermost box');

t('every screen’s outermost box carries no top padding or margin', () => {
  // THE OWNER'S OWN CHECK. A screen that pads its own outermost container is
  // adding space above its body, which is the journey's job now.
  const dir = join(root, 'src', 'screens');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'keys.js' && f !== 'index.js');
  assert.ok(files.length > 20, `only found ${files.length} screens`);

  const guilty = [];
  for (const f of files) {
    const src = strip(readFileSync(join(dir, f), 'utf8'));
    // The outermost element of the returned tree: the first tag after the last
    // `return (` in the file's default export.
    const m = src.match(/return \(\s*\n\s*<([A-Za-z][A-Za-z0-9.]*)([^>]*)>/);
    if (!m) continue;
    const attrs = m[2];
    const styleAttr = (attrs.match(/style=\{([\s\S]*?)\}\s*$/) || attrs.match(/style=\{([^}]*)\}/) || [])[1];
    if (!styleAttr) continue;

    // Inline top spacing on the outermost box.
    if (/(padding|margin)Top\s*:/.test(styleAttr)) { guilty.push(`${f} (inline)`); continue; }
    // Or through a named style.
    for (const name of [...styleAttr.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1])) {
      const def = (src.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`)) || [''])[0];
      if (/(padding|margin)Top\s*:/.test(def)) guilty.push(`${f} (styles.${name})`);
    }
  }
  assert.deepEqual(guilty, [], `these pad their own outermost box: ${guilty.join(', ')}`);
});

console.log('\nthe band itself, added up');

t('the band before the fix was 71 points, which is what he photographed', () => {
  // The walk, on his own phone: the strip's own gap, then the notch a second
  // time, then the title bar (already zero), then the design's body padding.
  const before = bandAbove({
    stripBottom: STRIP_BOTTOM,
    screenTop: NOTCH,
    topBarTop: topPaddingInside(TOP_BAR_TOP, true),
    bodyTop: BODY_TOP,
  });
  assert.equal(before, 71, `the walk adds up to ${before}, not 71`);
  // And it is mostly one thing, not a scattering of small ones.
  assert.ok(NOTCH / before > 0.8, 'the notch is not the overwhelming part of it');
});

t('and after the fix it is the strip’s own gap and the design’s own padding', () => {
  const after = bandAbove({
    stripBottom: STRIP_BOTTOM,
    screenTop: edgesInsideJourney(['top', 'bottom'], true).includes('top') ? NOTCH : 0,
    topBarTop: topPaddingInside(TOP_BAR_TOP, true),
    bodyTop: BODY_TOP,
  });
  assert.equal(after, MOST_ALLOWED_BAND, `the band is ${after}, allowed ${MOST_ALLOWED_BAND}`);
  assert.ok(after <= 12, 'the band is bigger than the design’s own small gap');
});

t('a screen on its own still steps over the notch', () => {
  // The same screen opened by itself is exactly what the design draws, notch and
  // all. Fixing the journey must not break that.
  assert.deepEqual(edgesInsideJourney(['top', 'bottom'], false), ['top', 'bottom']);
  assert.deepEqual(edgesInsideJourney(['top', 'bottom'], true), ['bottom']);
  assert.deepEqual(edgesInsideJourney(['top'], true), []);
  assert.deepEqual(edgesInsideJourney(['bottom'], true), ['bottom']);
  // Anything that is not a firm yes means "not inside".
  for (const notInside of [undefined, null, 0, '', 'true', 1]) {
    assert.deepEqual(edgesInsideJourney(['top', 'bottom'], notInside), ['top', 'bottom']);
  }
  // And junk edges do not crash a screen.
  assert.deepEqual(edgesInsideJourney(null, true), ['bottom']);
  assert.deepEqual(edgesInsideJourney(undefined, false), ['top', 'bottom']);
});

t('the sum ignores anything it cannot use rather than becoming NaN', () => {
  assert.equal(bandAbove({}), 0);
  assert.equal(bandAbove(null), 0);
  assert.equal(bandAbove({ stripBottom: NaN, screenTop: 'tall', bodyTop: -3 }), 0);
  assert.equal(bandAbove({ stripBottom: 8, bodyTop: 4 }), 12);
});

console.log('\nthe Screen wrapper is the one place it is fixed');

t('Screen asks whether it is inside the journey, and drops its top edge', () => {
  const prim = strip(read('src/ui/primitives.js'));
  assert.ok(/useInsideJourney\(\)/.test(prim), 'Screen never asks');
  assert.ok(/edgesInsideJourney\(edges, inside\)/.test(prim),
    'Screen does not use the one place that decides its edges');
  assert.ok(/edges=\{stepOver\}/.test(prim),
    'Screen still hands SafeAreaView the edges it was asked for');
  assert.ok(!/edges=\{edges\}/.test(prim),
    'Screen still passes its raw edges straight through');
});

t('and the library really does ignore the context, which is why', () => {
  // THE EVIDENCE FOR THE DIAGNOSIS, kept in the check so it cannot rot quietly.
  // If a later version of the library starts reading the context, this fails and
  // whoever sees it can simplify with confidence instead of guessing.
  const lib = read('node_modules/react-native-safe-area-context/src/SafeAreaView.tsx');
  assert.ok(/NativeSafeAreaView/.test(lib), 'SafeAreaView no longer renders the native view');
  assert.ok(!/SafeAreaInsetsContext/.test(lib),
    'SafeAreaView now reads the insets context, so the simpler fix would work');
});

t('every journey screen goes through Screen, so one place covers them all', () => {
  const steps = [
    'linkaccount', 'buyinterstitial', 'returncatch', 'proofprimer', 'underreview',
    'ocrconfirm', 'delivery', 'reviewguide', 'reviewproof', 'returnwindow', 'reward',
  ];
  const missing = steps.filter((k) => !/<Screen\b/.test(read(`src/screens/${k}.js`)));
  assert.deepEqual(missing, [], `these do not use Screen: ${missing.join(', ')}`);
  assert.equal(steps.length, 11, 'the journey is eleven steps');
});

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
