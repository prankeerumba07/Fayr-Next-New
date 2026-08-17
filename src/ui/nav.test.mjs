// Tests for the guarantee that a back control ALWAYS goes somewhere.
//
// What this exists to stop, reported live: inside Connect Marketplaces, after
// logging out of Amazon, there was no way back to Home — the app had to be
// force-quit. `navigation.goBack()` is a SILENT NO-OP when there is nothing
// underneath to pop, so a back arrow wired straight to it can do literally
// nothing and still look like a working button.

import { exitAction, goBackOrHome, goHome, ROOT_ROUTE, HOME_ROUTE } from './nav.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
