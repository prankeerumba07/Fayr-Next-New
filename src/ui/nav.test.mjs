// Tests for the guarantee that a back control ALWAYS goes somewhere.
//
// What this exists to stop, reported live: inside Connect Marketplaces, after
// logging out of Amazon, there was no way back to Home — the app had to be
// force-quit. `navigation.goBack()` is a SILENT NO-OP when there is nothing
// underneath to pop, so a back arrow wired straight to it can do literally
// nothing and still look like a working button.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exitAction, goBackOrHome, goHome, ROOT_ROUTE, HOME_ROUTE } from './nav.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, '..', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

/** A fake navigation object that records what was asked of it. */
function fakeNav({ canGoBack = true } = {}) {
  const calls = [];
  return {
    calls,
    canGoBack: () => canGoBack,
    goBack: () => calls.push(['goBack']),
    navigate: (...a) => calls.push(['navigate', ...a]),
  };
}

console.log('=== 1. the decision: back when there is a screen underneath ===');
{
  ok(exitAction(fakeNav({ canGoBack: true })) === 'back', 'something underneath → step back');
  ok(exitAction(fakeNav({ canGoBack: false })) === 'home', 'nothing underneath → go Home');
  // Never trust the shape of the object: a missing canGoBack must not throw and
  // must not silently choose the no-op path.
  ok(exitAction({}) === 'home', 'a navigation object without canGoBack still exits');
  ok(exitAction(null) === 'home', 'no navigation object at all does not crash');
}

console.log('\n=== 2. goBackOrHome never does nothing ===');
{
  const back = fakeNav({ canGoBack: true });
  ok(goBackOrHome(back) === 'back' && back.calls.length === 1, 'a normal back pops one screen');
  ok(back.calls[0][0] === 'goBack', '  and uses goBack, preserving the stack');

  const stranded = fakeNav({ canGoBack: false });
  ok(goBackOrHome(stranded) === 'home', 'a stranded screen falls back to Home');
  ok(stranded.calls.length === 1 && stranded.calls[0][0] === 'navigate',
    '  and it actually navigates — this is the no-op that trapped the user');
  ok(stranded.calls[0][1] === ROOT_ROUTE, `  to the tab root (${ROOT_ROUTE})`);
  ok(stranded.calls[0][2] && stranded.calls[0][2].screen === HOME_ROUTE,
    `  selecting the ${HOME_ROUTE} tab, not whichever tab was last open`);
}

console.log('\n=== 3. goHome is one tap out of a marketplace, wherever you are ===');
{
  // The marketplace WebView needs an exit that does NOT unwind into a
  // half-finished stack: from Home → Amazon → Task, "back" lands the user inside
  // Amazon's website again, which is what "no way back to Home" felt like.
  const deep = fakeNav({ canGoBack: true });
  ok(goHome(deep) === 'home', 'goHome ignores the stack and goes Home');
  ok(deep.calls.length === 1 && deep.calls[0][0] === 'navigate', 'in a single navigate');
  ok(deep.calls.every((c) => c[0] !== 'goBack'), 'and never steps back one screen at a time');

  ok(goHome(null) === 'none', 'no navigation object → no crash, no pretence it worked');
  ok(goHome({}) === 'none', 'an object with no navigate → reports that it did nothing');
}

console.log('\n=== THE OFFER PAGE\u2019S BACK ARROW: WHERE IT IS DRAWN, AND WHERE IT GOES ===');
{
  // ── THE RUN THIS COMES FROM — 21 SEPTEMBER 2026 ─────────────────────────
  //
  // The owner: "There is a Back option at the top left corner of the screen, but
  // when I click it, nothing happens. It does not take me back to the homepage."
  //
  // TWO SEPARATE FAULTS, and fixing either alone leaves him stuck.
  //
  // WHERE IT WAS DRAWN. styles.back was `position:'absolute', top: 0` inside a
  // hero padded by insets.top. React Native configures Yoga with YGErrataAll,
  // and AbsolutePositionWithoutInsetsExcludesPadding is part of All — so an
  // absolutely positioned child is laid out from the parent's PADDING EDGE and
  // the parent's paddingTop is never added. `top: 0` meant screen y 0: the whole
  // 40pt circle, and all of its hitSlop, sat inside the status bar, which the
  // system owns. His taps never reached the button.
  //
  // WHERE IT WENT. goBackOrHome obeys the stack, and on his path the stack was
  // wrong — see the popTo section below. He asked for Home, so it goes Home.
  const detail = src('DetailScreen.js');

  ok(/style=\{\[styles\.back, \{ top: insets\.top \+ 8 \}\]\}/.test(detail),
    'THE ARROW CARRIES ITS OWN INSET, so it is drawn below the notch and not inside the status bar');
  const style = detail.slice(detail.indexOf('  back: {'), detail.indexOf('  backIcon:'));
  ok(style.length > 20, 'styles.back is where expected');
  ok(!/top: 0/.test(style),
    'AND styles.back NO LONGER PINS ITSELF TO 0 — the fault, in one number');
  ok(/position: 'absolute'/.test(style), 'it is still absolute, so it still floats over the photo');
  ok(/onPress=\{\(\) => goHome\(navigation\)\}/.test(detail),
    'and it goes HOME, which is what the owner asked the arrow to do');
  ok(!/goBackOrHome/.test(detail),
    'and not through the stack, which on this page leads back into the journey it came from');
}

console.log('\n=== AND "BACK TO THE OFFER" RETURNS TO THE OFFER RATHER THAN DUPLICATING IT ===');
{
  // React Navigation 7 (this project is on @react-navigation/native 7.3.16)
  // reuses an existing route for a NAVIGATE only when the target name equals the
  // CURRENT route's name, or when the action carries `pop`:
  //
  //   } else if (action.type === 'NAVIGATE') {
  //     const currentRoute = state.routes[state.index];
  //     if (action.payload.name === currentRoute.name) { route = currentRoute; }
  //     else if (action.payload.pop) { route = state.routes.findLast(...); }
  //   }
  //                         @react-navigation/routers StackRouter.tsx:385-396
  //
  // Neither holds from the journey screens, so navigate('Detail') PUSHED A
  // SECOND offer page on top of the order page. The arrow there came back to the
  // order page, whose only control pushed the offer page again: two screens, and
  // Home unreachable from either. That is the owner's "I cannot go back to the
  // homepage", and it is a different fault from where the arrow is drawn.
  for (const file of ['screens/delivery.js', 'screens/returncatch.js']) {
    const body = src(file);
    ok(/navigation\.popTo\('Detail', \{ campaignId \}\)/.test(body),
      `${file} RETURNS to the offer already in the stack`);
    ok(!/navigation\.navigate\('Detail'/.test(body),
      `${file} never pushes a second one`);
  }
  // AND THE VERSION THE RULE DEPENDS ON IS PINNED. popTo does not exist before
  // React Navigation 7; if this is ever downgraded the call is a crash, not a
  // silent regression, and this says why out loud.
  const pkg = JSON.parse(readFileSync(join(HERE, '..', '..', 'package.json'), 'utf8'));
  const ver = pkg.dependencies['@react-navigation/native'] || '';
  ok(/^[~^]?7\./.test(ver), `@react-navigation/native is 7.x (${ver}), which is where popTo exists`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
