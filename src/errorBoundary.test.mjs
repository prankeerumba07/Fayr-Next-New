// THE LAST LINE OF DEFENCE, AND THE ONE THING THAT MUST NOT BE A SOURCE GUARD.
//
// Until now a single render error anywhere in the app ended the session on a red
// screen (dev) or a white one (release). There was no ErrorBoundary and no
// componentDidCatch in the tree at all. That is a demo-ending failure with no
// recovery: the person holding the phone cannot tap their way out of a blank
// screen.
//
// Almost every other device test here is a pure-helper test or a source-level
// guard, because an RN screen cannot be imported under node. This one is
// different, and deliberately so: a boundary that is *believed* to catch is worth
// nothing. So `src/ErrorBoundary.js` is written with React.createElement and NO
// react-native import, which lets a real React reconciler mount it here, throw a
// real error inside it, and prove what the user actually ends up looking at.
//
// The RN part — the cream full-screen fallback — lives in src/ErrorFallback.js,
// which cannot be mounted under node. That file gets the source-level treatment,
// and the split is enforced below so it cannot quietly collapse back.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// react-test-renderer needs this flag or every act() call warns, and it prints a
// deprecation notice of its own on import. Both are noise that would bury a real
// failure, so the flag goes on first and the import happens quietly.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const realError = console.error;
const realWarn = console.warn;
const hush = () => { console.error = () => {}; console.warn = () => {}; };
const unhush = () => { console.error = realError; console.warn = realWarn; };

hush();
const React = (await import('react')).default;
const TestRenderer = (await import('react-test-renderer')).default;
const ErrorBoundary = (await import('./ErrorBoundary.js')).default;
unhush();

const el = React.createElement;

// A fallback that renders a plain string, so the assertion is about WHICH branch
// rendered rather than about any RN markup.
const FALLBACK = 'FALLBACK';
let lastResetFn = null;
const renderFallback = ({ reset }) => { lastResetFn = reset; return FALLBACK; };

// Mount and unmount counters, so "the children came back" can be told apart from
// "the children were never unmounted".
let mounts = 0;
function Healthy() {
  React.useEffect(() => { mounts += 1; }, []);
  return 'ALIVE';
}

function Boom() { throw new Error('render exploded'); }

// React logs a caught error and its component stack to console.error on every
// boundary catch. That is correct behaviour and we WANT it in production, but in
// a test run it drowns the results, so throwing mounts are wrapped.
function mountQuietly(node) {
  let tree;
  hush();
  try {
    TestRenderer.act(() => { tree = TestRenderer.create(node); });
  } finally {
    unhush();
  }
  return tree;
}

console.log('=== 1. the boundary is invisible when nothing throws ===');
{
  const seen = [];
  const tree = mountQuietly(
    el(ErrorBoundary, { renderFallback, onError: (e) => seen.push(e) }, el(Healthy)),
  );
  ok(tree.toJSON() === 'ALIVE', 'a healthy child renders exactly as it would unwrapped');
  ok(seen.length === 0, 'nothing is reported when nothing goes wrong');
}

console.log('\n=== 2. a component that throws on render shows the fallback, not a crash ===');
{
  const seen = [];
  let tree = null;
  let threw = null;
  try {
    tree = mountQuietly(
      el(ErrorBoundary, { renderFallback, onError: (e) => seen.push(e) }, el(Boom)),
    );
  } catch (e) {
    threw = e;
  }
  // The whole point: the mount COMPLETES. Before the boundary existed this threw
  // straight through to the host and the screen went blank.
  ok(threw === null, 'mounting a throwing child does NOT propagate the error');
  ok(tree && tree.toJSON() === FALLBACK, 'the user is looking at the fallback');
  ok(seen.length === 1, 'the error is reported exactly once, not per-render');
  ok(seen[0] instanceof Error && seen[0].message === 'render exploded',
    'the real error is handed to the logger, so it reaches the console');
}

console.log('\n=== 3. a throw deep in the tree is caught, not just a direct child ===');
{
  // The realistic shape: the crash is four levels down inside a screen, not in a
  // component the boundary can see.
  const Deep = () => el('x', null, el('y', null, el(Boom)));
  const Screen = () => el(Deep);
  const tree = mountQuietly(el(ErrorBoundary, { renderFallback }, el(Screen)));
  ok(tree.toJSON() === FALLBACK, 'a throw nested several components down still lands here');
}

console.log('\n=== 4. the fallback\'s one button rebuilds the app FRESH ===');
{
  // Crash first, then reset, and count how many times the children MOUNTED. The
  // count is the whole assertion: "the children are back" and "the children were
  // rebuilt from scratch" look identical on screen and are not the same thing.
  mounts = 0;
  lastResetFn = null;
  let phase = 'boom';
  const Flaky = () => (phase === 'boom' ? el(Boom) : el(Healthy));
  const tree = mountQuietly(el(ErrorBoundary, { renderFallback }, el(Flaky)));
  ok(tree.toJSON() === FALLBACK, 'crashed, so the fallback is on screen');
  ok(mounts === 0, 'the crashed children are NOT mounted while the fallback shows');
  ok(typeof lastResetFn === 'function', 'the fallback is handed a reset function to wire to its button');

  phase = 'fine';
  hush();
  try { TestRenderer.act(() => { lastResetFn(); }); } finally { unhush(); }
  ok(tree.toJSON() === 'ALIVE', 'after reset the real app is back on screen');
  ok(mounts === 1, 'the children were mounted FRESH — a rebuild, not a resurrected broken tree');
}

console.log('\n=== 5. a second crash is caught too — never a one-shot boundary ===');
{
  // A deterministic bug crashes again the moment the app rebuilds. That must give
  // the fallback a second time, forever if need be. Tapping a button that does
  // nothing is survivable; a white screen is not.
  let phase = 'boom';
  const Flaky = () => (phase === 'boom' ? el(Boom) : el(Healthy));
  const tree = mountQuietly(el(ErrorBoundary, { renderFallback }, el(Flaky)));
  ok(tree.toJSON() === FALLBACK, 'first crash caught');

  phase = 'fine';
  hush();
  try { TestRenderer.act(() => { lastResetFn(); }); } finally { unhush(); }
  ok(tree.toJSON() === 'ALIVE', 'recovered');

  phase = 'boom';
  hush();
  try { TestRenderer.act(() => { tree.update(el(ErrorBoundary, { renderFallback }, el(Flaky))); }); } finally { unhush(); }
  ok(tree.toJSON() === FALLBACK, 'and the NEXT crash is caught as well, not passed through');
}

console.log('\n=== 6. it logs by itself, with no logger injected ===');
{
  // App.js passes no onError. The default must still put the error where a
  // developer will find it, because "no new telemetry" means the console IS the
  // report.
  const lines = [];
  console.error = (...a) => lines.push(a.map(String).join(' '));
  console.warn = () => {};
  try {
    TestRenderer.act(() => { TestRenderer.create(el(ErrorBoundary, { renderFallback }, el(Boom))); });
  } finally {
    unhush();
  }
  ok(lines.some((l) => l.includes('render exploded')),
    'with no onError given, the error still reaches console.error');
}

console.log('\n=== 7. the boundary is actually WIRED, and around everything ===');
{
  // A correct boundary that nothing is wrapped in is worth nothing, and App.js
  // cannot be imported here. Comments are stripped first: this file explains the
  // trap by naming it, and a guard that matches its own explanation teaches
  // people to delete the warning instead of the bug.
  const app = readFileSync(join(HERE, '..', 'App.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  ok(/import\s+ErrorBoundary\s+from\s+'\.\/src\/ErrorBoundary'/.test(app),
    'App.js imports the boundary');
  ok(/<ErrorBoundary/.test(app), 'App.js renders it');

  // Every branch must be inside it. The boundary therefore wraps the component
  // that chooses the branch, not one of the branches: splash, first-run, setup and
  // the navigator are all early returns, so a boundary inside the navigator would
  // leave the whole sign-in journey unguarded.
  const exported = app.match(/export default function App\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  ok(exported !== null, 'App.js still has a default-exported App function to inspect');
  if (exported) {
    const body = exported[1];
    ok(/<ErrorBoundary/.test(body),
      'the DEFAULT EXPORT is the boundary wrapper — so every branch is inside it');
    ok(!/NavigationContainer/.test(body),
      'the exported App holds no branch logic of its own: it wraps, and nothing else');
  }
  // The inner component still has to exist, or the wrapper wraps nothing.
  ok(/function AppInner\s*\(/.test(app), 'the branching app lives in AppInner, inside the boundary');
  ok(/NavigationContainer/.test(app), 'and AppInner still builds the navigator');
}

console.log('\n=== 8. the split that makes this testable cannot quietly collapse ===');
{
  const boundary = readFileSync(join(HERE, 'ErrorBoundary.js'), 'utf8');
  // The moment ErrorBoundary.js imports react-native, node can no longer load it
  // and every assertion above silently degrades into a source guard. The RN UI
  // belongs in ErrorFallback.js for exactly this reason.
  ok(!/from\s+'react-native'/.test(boundary),
    'ErrorBoundary.js imports no react-native, so it stays really mountable');
  ok(!/<\/|\/>/.test(boundary.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    'and no JSX, so node needs no transform to read it');

  const fallback = readFileSync(join(HERE, 'ErrorFallback.js'), 'utf8');
  ok(/from\s+'react-native'/.test(fallback), 'ErrorFallback.js is the RN half');

  // The copy, checked here because the screen itself cannot be rendered under
  // node. Plain words, no error code, no jargon, and nothing claimed about the
  // user's account that the app cannot actually promise after an unknown crash.
  ok(fallback.includes('Something went wrong'), 'the headline is plain');
  ok(/Start again/.test(fallback), 'there is a Start again control');
  ok(!/error|Error|crash|exception|undefined/.test(
    fallback.split('const styles')[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      // property names and identifiers are not user-facing copy
      .replace(/\b(onReset|ErrorFallback|onError)\b/g, ''),
  ), 'no developer words leak into what the user reads');
  // Exactly one control: the fallback must not offer a choice to someone who has
  // just been dropped by the app.
  ok((fallback.match(/<TouchableOpacity/g) || []).length === 1,
    'exactly one button in the fallback');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
