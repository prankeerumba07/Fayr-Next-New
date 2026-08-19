// The setup sequence: which step to show, what to save, and when it is done.
//
// Two failures this exists to stop:
//  1. verifying the code dropped the user straight onto the campaign feed — the
//     whole setup journey existed in the design and was never wired in;
//  2. a user who abandons setup halfway must RESUME, not start again. That means
//     the step is derived from what the server already has, never from local state
//     that a reinstall or a second device would lose.

import { setupStep, STEPS, isSetupNeeded, patchFor, resumeCopy } from './setup.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const blank = {
  setupDone: false, name: null, ageBand: null, gender: null,
  categories: [], platforms: [], termsVersion: null, termsAcceptedAt: null,
};

console.log('=== 1. a returning user must NEVER see setup again ===');
{
  ok(isSetupNeeded({ ...blank, setupDone: true }) === false, 'setupDone true → skip entirely');
  // The latch is the only authority: even a profile with nothing else filled in.
  ok(isSetupNeeded({ setupDone: true }) === false, 'and it wins over every other field');
  ok(isSetupNeeded(blank) === true, 'a fresh user needs setup');
  ok(isSetupNeeded(null) === false, 'no profile yet → do not guess; wait for one');
}

console.log('\n=== 2. a fresh user starts at the beginning ===');
{
  ok(setupStep(blank) === STEPS.INTRO, 'nothing saved → the intro');
  ok(STEPS.INTRO === 'setupintro', 'the design\'s own screen name');
}

console.log('\n=== 3. resume lands on the first UNANSWERED question ===');
{
  const withAge = { ...blank, ageBand: '25 - 34' };
  ok(setupStep(withAge) === STEPS.SETUP, 'age but no gender → still the question screens');

  const withBoth = { ...blank, ageBand: '25 - 34', gender: 'Female' };
  ok(setupStep(withBoth) === STEPS.SETUP, 'age+gender but no categories → still questions');

  const withCats = {
    ...blank, ageBand: '25 - 34', gender: 'Female',
    categories: ['Footwear', 'Home & Kitchen', 'Sports & Fitness'],
  };
  ok(setupStep(withCats) === STEPS.SETUP, 'categories but no platforms → still questions');

  const withPlats = { ...withCats, platforms: ['amazon'] };
  ok(setupStep(withPlats) === STEPS.NAME, 'everything but the name → the name screen');

  const withName = { ...withPlats, name: 'Asha' };
  ok(setupStep(withName) === STEPS.HOW, 'name saved but no consent → the terms screen');

  const done = { ...withName, termsVersion: '2026-08-13', termsAcceptedAt: '2026-08-19T00:00:00Z' };
  ok(setupStep(done) === STEPS.HOW, 'consent given but setupDone not latched → still the last screen');
}

console.log('\n=== 4. the inner question step resumes too ===');
{
  ok(setupStep(blank, { inner: true }).question === undefined, 'shape check: plain call is a string');
  // Which of the three question steps to open.
  const q = (p) => setupStep.question(p);
  ok(q(blank) === 0, 'nothing → age+gender');
  ok(q({ ...blank, ageBand: '25 - 34' }) === 0, 'age alone is not enough — gender is on the same step');
  ok(q({ ...blank, ageBand: '25 - 34', gender: 'Male' }) === 1, 'both → categories');
  ok(q({ ...blank, ageBand: '25 - 34', gender: 'Male', categories: ['Footwear'] }) === 1,
    'fewer than 3 categories → still on categories, matching the design\'s own rule');
  ok(q({
    ...blank, ageBand: '25 - 34', gender: 'Male',
    categories: ['Footwear', 'Home & Kitchen', 'Sports & Fitness'],
  }) === 2, 'three categories → platforms');
}

console.log('\n=== 5. what gets sent, and when ===');
{
  const p1 = patchFor.question(0, { age: '25 - 34', gender: 'Female' });
  ok(p1.ageBand === '25 - 34' && p1.gender === 'Female', 'step 0 saves the band and gender');
  ok(!('categories' in p1), 'and nothing it has not asked yet');

  const p2 = patchFor.question(1, { cats: ['Footwear', 'Footwear', 'Home & Kitchen'] });
  ok(p2.categories.length === 2, 'a repeated category is not sent twice');

  const p3 = patchFor.question(2, { plats: ['amazon', 'zepto'] });
  ok(p3.platforms.join(',') === 'amazon,zepto', 'step 2 saves the platforms');

  const pn = patchFor.name('  asha  ');
  ok(pn.name === 'Asha', 'the name is trimmed and title-cased, as the design does');

  const pc = patchFor.consent('2026-08-13');
  ok(pc.acceptTerms === true && pc.termsVersion === '2026-08-13', 'consent carries its version');
  ok(pc.setupDone === true, 'and the same call latches setup as finished');
}

console.log('\n=== 6. the intro says whether this is a resume ===');
{
  ok(/set up your profile/i.test(resumeCopy(blank).title), 'a fresh user is invited to start');
  ok(/pick up where you left off/i.test(resumeCopy({ ...blank, ageBand: '25 - 34' }).title),
    'a returning half-finished user is told their answers are kept');
  ok(/saved/i.test(resumeCopy({ ...blank, ageBand: '25 - 34' }).body),
    'and the body says so, so it does not feel like starting over');
  ok(resumeCopy(blank).cta === "LET'S GO", 'the design\'s own words, verbatim');
  ok(resumeCopy({ ...blank, ageBand: '25 - 34' }).cta === 'CONTINUE SETUP', 'and for a resume');
}

console.log('\n=== 7. nothing here can crash on a partial profile ===');
{
  for (const p of [null, undefined, {}, { categories: null }, { platforms: 'nope' }]) {
    const s = setupStep(p);
    ok(typeof s === 'string' && s.length > 0, `${JSON.stringify(p)} → a real step (${s})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
