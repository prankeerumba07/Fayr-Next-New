// The whole opening sequence, from the logo to the home page.
//
// Each half was already checked on its own. What nothing checked was the JOIN:
// that the sign-in journey really does run into the setup questions, in that
// order, and that somebody who has already set up skips the parts they have
// already done. That is the most-seen sequence in the app.
import {
  ANIMATIONS_STEP,
  CODE_STEP,
  HOME,
  LOGO_STEP,
  NAME_STEP,
  NUMBER_STEP,
  OPENING_SEQUENCE,
  SETUP_ORDER,
  needsTheNameStep,
  openingScreensFor,
  willSeeTheAnimations,
} from './opening.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const at = (step) => OPENING_SEQUENCE.indexOf(step);

console.log('=== 1. the order, end to end ===');
{
  ok(OPENING_SEQUENCE[0] === LOGO_STEP, 'the logo is first, before anything else');
  ok(at(ANIMATIONS_STEP) === 1, 'then the three animations');
  ok(at(ANIMATIONS_STEP) < at(NUMBER_STEP), 'the animations come before signing in');
  ok(at(NUMBER_STEP) < at(CODE_STEP), 'the number is typed before the code');
  ok(at(CODE_STEP) < at(NAME_STEP), 'the code before the name');
  ok(at(NAME_STEP) < at(HOME), 'and the name before the home page');
  ok(OPENING_SEQUENCE[OPENING_SEQUENCE.length - 1] === HOME,
    'the sequence ends at the home page and nowhere else');
  ok(new Set(OPENING_SEQUENCE).size === OPENING_SEQUENCE.length,
    'no screen appears twice');
}

console.log('\n=== 2. somebody brand new sees all of it ===');
{
  const seen = openingScreensFor({ seenTheAnimations: false, signedIn: false,
    profile: { setupDone: false } });
  ok(seen[0] === LOGO_STEP, 'the logo first');
  ok(seen.includes(ANIMATIONS_STEP), 'the animations');
  ok(seen.includes(NUMBER_STEP) && seen.includes(CODE_STEP), 'number, then code');
  ok(seen.includes(NAME_STEP), 'and the name step');
  ok(seen[seen.length - 1] === HOME, 'ending at the home page');
}

console.log('\n=== 3. somebody who has already set up skips what they have done ===');
{
  // The whole point of item five's last line.
  const done = { setupDone: true, name: 'Prakash', ageBand: '25-34', gender: 'male',
                 categories: ['a', 'b', 'c'], platforms: ['AMAZON'] };
  const seen = openingScreensFor({ seenTheAnimations: true, signedIn: true, profile: done });
  ok(!seen.includes(ANIMATIONS_STEP), 'no animations');
  ok(!seen.includes(NAME_STEP), 'and no name step');
  ok(seen.length === 1 && seen[0] === HOME,
    'opening the app goes straight to the home page and nothing else');

  ok(willSeeTheAnimations(true) === false, 'the animations are not shown again');
  ok(needsTheNameStep(done) === false, 'and the name is not asked again');
}

console.log('\n=== 4. the two skips are separate facts, on purpose ===');
{
  // Signing out must not replay three slides at somebody who has used the app
  // for months, so the animations are a property of the INSTALL. Whether setup
  // is done is the SERVER'S, so it survives a new phone.
  const signedOutButHasSeenThem = openingScreensFor({
    seenTheAnimations: true, signedIn: false, profile: null,
  });
  ok(signedOutButHasSeenThem.includes(LOGO_STEP), 'signing out still shows the logo');
  ok(!signedOutButHasSeenThem.includes(ANIMATIONS_STEP),
    'but not the animations again');
  ok(signedOutButHasSeenThem.includes(NUMBER_STEP), 'and asks for the number');

  const newPhone = openingScreensFor({
    seenTheAnimations: false, signedIn: true,
    profile: { setupDone: true, name: 'Prakash' },
  });
  ok(!newPhone.includes(NAME_STEP),
    'a new phone does not ask a set-up person for their name again');
}

console.log('\n=== 5. coming back part way through ===');
{
  // Somebody who answered two questions and closed the app lands on the first
  // thing still missing, not back at the welcome screen.
  const halfWay = openingScreensFor({
    seenTheAnimations: true, signedIn: true,
    profile: { setupDone: false, ageBand: '25-34', gender: 'male',
               categories: ['a', 'b', 'c'], platforms: ['AMAZON'] },
  });
  ok(halfWay[0] === NAME_STEP, 'they land on the name, which is what was missing');
  ok(!halfWay.includes(SETUP_ORDER[0]),
    'and never see the welcome screen again, which would read as lost answers');

  const untouched = openingScreensFor({
    seenTheAnimations: true, signedIn: true, profile: { setupDone: false },
  });
  ok(untouched[0] === SETUP_ORDER[0],
    'somebody who has answered nothing does start at the welcome screen');
}

console.log('\n=== 6. nothing is guessed ===');
{
  // A profile we have not loaded yet must not produce a guess. Showing setup on
  // a guess is worse than showing it a moment late.
  const notAsked = openingScreensFor({ seenTheAnimations: true, signedIn: true, profile: null });
  ok(!notAsked.includes(NAME_STEP), 'no setup screen appears before we have asked');
  ok(notAsked.includes(HOME), 'and the sequence still ends somewhere');

  for (const nonsense of [undefined, null, 'yes', 42, []]) {
    let threw = null;
    try { openingScreensFor(nonsense); } catch (e) { threw = e.message; }
    ok(!threw, `survives ${JSON.stringify(nonsense)}` + (threw ? ` — threw: ${threw}` : ''));
  }
}

console.log('\n=== 7. three animations, and the app really asks this file ===');
{
  // "The three short animations already in the design." Three, not two and not
  // four, and the count is in the screen rather than here — so this reads it.
  const fs = await import('node:fs');
  const onboarding = fs.readFileSync(
    new URL('./OnboardingScreen.js', import.meta.url), 'utf8',
  );
  const block = (onboarding.match(/const SLIDES = \[([\s\S]*?)\n\];/) || [])[1] || '';
  const slides = [...block.matchAll(/\n {2}\{/g)].length;
  ok(slides === 3, `three animations in the design, found ${slides}`);

  const splash = fs.readFileSync(
    new URL('./SplashScreen.js', import.meta.url), 'utf8',
  );
  ok(/LogoMark/.test(splash) && /Wordmark/.test(splash),
    'the first screen draws the logo mark and the wordmark, from the brand file');

  // And the sequence is not a description nobody reads: the flow asks it.
  const flow = fs.readFileSync(
    new URL('./FirstRunFlow.js', import.meta.url), 'utf8',
  );
  ok(flow.includes('willSeeTheAnimations('),
    'the flow asks opening.js whether to show the animations');
  ok(!/setStep\(seen \? /.test(flow),
    'and does not decide it a second time with its own branch');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
