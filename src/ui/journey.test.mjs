// The claim journey as ten pages — every decision, without React.
//
// The thing worth proving hardest: coming back from the shop lands on the page
// somebody was on. It cannot land at the beginning, because there is no local
// pointer to lose — the page is worked out from the server's record every time.
import { STATES } from '../taskflow.js';
import {
  JOURNEY,
  JOURNEY_KEYS,
  OF,
  checkLine,
  journeyStepFor,
  journeyView,
  page,
  stepNumber,
} from './journey.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

console.log('=== 1. ten pages, in the order that was asked for ===');
{
  ok(OF === 10, `ten pages, found ${OF}`);
  ok(JSON.stringify(JOURNEY_KEYS) === JSON.stringify([
    'join', 'connect', 'buy', 'delivered', 'purchase-shot',
    'checking', 'review', 'review-shot', 'window', 'refund',
  ]), 'in exactly the order asked for');
  ok(new Set(JOURNEY_KEYS).size === OF, 'no page twice');

  for (const step of JOURNEY) {
    ok(typeof step.title === 'string' && step.title.length > 4,
      `${step.key} has a heading`);
    ok(typeof step.body === 'string' && step.body.length > 20,
      `${step.key} says something`);
    ok(typeof step.next === 'string' && step.next.length > 10,
      `${step.key} says what happens next`);
    ok(typeof step.from === 'string' && step.from.length > 3,
      `${step.key} names the design screen it came from`);
  }
}

console.log('\n=== 2. every page says where you are and what comes next ===');
{
  for (let i = 0; i < JOURNEY.length; i += 1) {
    const key = JOURNEY[i].key;
    ok(stepNumber(key) === i + 1, `${key} is step ${i + 1}`);
  }
  ok(stepNumber('not-a-page') === 0, 'a name we do not know is not a step');
  ok(page('join') !== null && page('nope') === null, 'pages are looked up by name');
}

console.log('\n=== 3. which page, from the server’s record ===');
{
  const at = (state) => journeyStepFor(state);

  ok(at({ task: null }) === 'join', 'no task at all means they have not joined');
  ok(at({}) === 'join', 'and neither does nothing at all');

  ok(at({ task: { state: STATES.CLAIMED }, connected: false }) === 'connect',
    'joined but not connected: connect');
  ok(at({ task: { state: STATES.CLAIMED }, connected: true }) === 'buy',
    'connected but nothing bought: buy');

  ok(at({ task: { state: STATES.PURCHASED }, connected: true }) === 'delivered',
    'bought and read for us: straight to has it arrived');
  ok(at({ task: { state: STATES.CLAIMED, order: { id: 'o1' } }, connected: true })
      === 'delivered',
    'an order we could read counts as bought, whatever the state says');

  ok(at({ task: { state: STATES.DELIVERED } }) === 'review', 'delivered: write the review');
  ok(at({ task: { state: STATES.REVIEWED } }) === 'review-shot',
    'reviewed: send the picture of it');
  ok(at({ task: { state: STATES.HOLDING } }) === 'window', 'holding: the return window');
  ok(at({ task: { state: STATES.REFUNDED } }) === 'refund', 'refunded: the last page');
}

console.log('\n=== 4. the screenshot step is only in the way when it is needed ===');
{
  // The shop is read for us where it can be. A screenshot page in front of
  // somebody who has nothing to send is asking for work nobody has to do.
  const bought = { task: { state: STATES.PURCHASED }, connected: true };
  ok(journeyStepFor(bought) === 'delivered',
    'nothing to send: the screenshot page is skipped');

  // The SERVER's word, read off the task's own blocker — the same names the
  // stuck-task screen already explains, so the two cannot disagree.
  for (const blocker of ['order_unreadable', 'no_delivery_date']) {
    const stuck = { task: { state: STATES.PURCHASED, blocker }, connected: true };
    ok(journeyStepFor(stuck) === 'purchase-shot',
      `${blocker}: choose a picture`);
    ok(journeyStepFor({ ...stuck, purchaseShotSent: true }) === 'checking',
      `${blocker}: and once it is sent, the page that shows the reading`);
  }

  // A blocker about something else must NOT put a screenshot page in front of
  // somebody who has nothing to send.
  for (const other of ['reconnect_account', 'review_not_public', 'returned',
                       'order_out_of_window']) {
    const stuck = { task: { state: STATES.PURCHASED, blocker: other }, connected: true };
    ok(journeyStepFor(stuck) === 'delivered',
      `${other} is not a screenshot problem`);
  }
}

console.log('\n=== 5. COMING BACK LANDS WHERE THEY WERE ===');
{
  // The requirement this file exists for. Leaving for the shop and coming back
  // re-derives the page from the same record, so the same record gives the same
  // page — every time, with nothing kept on the device to be lost.
  const states = [
    { task: { state: STATES.CLAIMED }, connected: true },
    { task: { state: STATES.PURCHASED }, connected: true },
    { task: { state: STATES.DELIVERED }, connected: true },
    { task: { state: STATES.REVIEWED }, connected: true },
    { task: { state: STATES.HOLDING }, connected: true },
  ];
  for (const state of states) {
    const before = journeyStepFor(state);
    const afterComingBack = journeyStepFor(JSON.parse(JSON.stringify(state)));
    ok(before === afterComingBack,
      `${state.task.state}: comes back to ${before}, not to the beginning`);
    ok(afterComingBack !== 'join' || state.task === null,
      `${state.task.state}: never lands back at the first page`);
  }
}

console.log('\n=== 6. the whole page, as data ===');
{
  const view = journeyView({
    task: { state: STATES.DELIVERED }, connected: true,
    productName: 'Prestige cooktop', shopName: 'Amazon',
  });
  ok(view.key === 'review', 'it knows which page');
  ok(view.where === 'Step 7 of 10', 'and says where you are, in the design’s words');
  ok(view.stepNumber === 7 && view.of === 10, 'with the numbers to draw it');
  ok(view.track.length === 10, 'one segment per page');
  ok(view.track.filter((t) => t.state === 'done').length === 6, 'six behind');
  ok(view.track.filter((t) => t.state === 'here').length === 1, 'one here');
  ok(view.track.filter((t) => t.state === 'todo').length === 3, 'three to come');
  ok(view.action !== null && view.action.enabled === true, 'and something to press');
  ok(view.product === 'Prestige cooktop', 'it carries the product');

  const waiting = journeyView({ task: { state: STATES.HOLDING } });
  ok(waiting.waiting === true, 'a waiting page says so');
  ok(waiting.action === null, 'and offers nothing to press');

  const busy = journeyView({
    task: { state: STATES.DELIVERED }, connected: true, busy: true,
  });
  ok(busy.action.busy === true && busy.action.enabled === false,
    'a button in flight cannot be pressed again');
}

console.log('\n=== 7. what the reading of a screenshot says ===');
{
  // NOTHING here may say a screenshot was accepted on its own. A person at Fayr
  // approves, always, and a screen implying otherwise promises what we do not do.
  const decided = ['APPROVED', 'REJECTED', 'NEEDS_MORE'];
  for (const status of decided) {
    ok(/person at Fayr/.test(checkLine(status)),
      `${status} names the person who decided`);
  }
  ok(/Reading/.test(checkLine('EXTRACTING')), 'a reading in progress says so');
  ok(/could not read/.test(checkLine('FAILED')), 'and a failed read says so plainly');
  ok(checkLine('SOMETHING_NEW') === 'Waiting.',
    'a status we do not know says nothing it cannot back up');

  for (const status of ['UPLOADED', 'EXTRACTING', 'EXTRACTED', 'APPROVED',
                        'REJECTED', 'NEEDS_MORE', 'FAILED', 'X']) {
    const line = checkLine(status);
    ok(typeof line === 'string' && line.length > 5 && !/undefined/.test(line),
      `${status} produces a real sentence`);
  }
}

console.log('\n=== 8. nothing missing reaches the screen ===');
{
  const states = [
    ['nothing at all', undefined],
    ['an empty object', {}],
    ['a task that is not an object', { task: 'CLAIMED' }],
    ['a state we do not know', { task: { state: 'SOMETHING_NEW' }, connected: true }],
    ['no product name', { task: { state: STATES.DELIVERED } }],
    ['a product name that is not text', { task: { state: STATES.DELIVERED }, productName: 42 }],
    ['an error on screen', { task: { state: STATES.DELIVERED }, error: 'Could not reach Fayr.' }],
    ['a check with no status', { task: { state: STATES.PURCHASED }, needsPurchaseShot: true,
                                purchaseShotSent: true, check: {} }],
  ];
  for (const [label, state] of states) {
    let threw = null;
    let view = null;
    try { view = journeyView(state); } catch (e) { threw = e.message; }
    ok(!threw, `survives ${label}` + (threw ? ` — threw: ${threw}` : ''));
    if (threw) continue;
    const flat = JSON.stringify(view);
    ok(!flat.includes('undefined'), `${label}: nothing "undefined" reaches the screen`);
    ok(!flat.includes('[object Object]'), `${label}: no raw object reaches the screen`);
    ok(typeof view.title === 'string' && view.title !== '', `${label}: there is a heading`);
    ok(typeof view.next === 'string' && view.next !== '', `${label}: and what comes next`);
    ok(/^Step \d+ of 10$/.test(view.where), `${label}: and where you are`);
  }
}

console.log('\n=== 9. the design covers every page, and what I added is named ===');
{
  const m = await import('./journey.js');
  ok(m.EVERY_PAGE_HAS_A_DESIGN === true,
    'every page names the design screen it is drawn from');
  ok(m.WHAT_I_ADDED.length === 2,
    `two pages carry something the design does not have, found ${m.WHAT_I_ADDED.length}`);
  for (const one of m.WHAT_I_ADDED) {
    ok(typeof one.added === 'string' && one.added.length > 40,
      `${one.key} says what was added and why`);
  }

  // Seven of the tracker's short labels are the design's own STEPS7, which it
  // wrote and never put on a screen. Read out of the design, not copied here.
  const fs = await import('node:fs');
  const design = fs.readFileSync(
    new URL('../../fayr-design.browser.jsx', import.meta.url), 'utf8',
  );
  const line = (design.match(/const STEPS7 = \[([^\]]*)\]/) || [])[1] || '';
  const theirs = [...line.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  ok(theirs.length === 7, `the design's own step copy is still there, ${theirs.length} of it`);
  const ours = JOURNEY.map((x) => x.short);
  const shared = theirs.filter((t) => ours.some((o) => o === t || t.startsWith(o)));
  ok(shared.length >= 5,
    `most short labels are the design's own words, ${shared.length} of 7 matched`);

  for (const step of JOURNEY) {
    ok(typeof step.short === 'string' && step.short.length > 3,
      `${step.key} has a short label for the tracker`);
  }
}

console.log('\n=== 10. the screen draws it and decides nothing itself ===');
{
  const fs = await import('node:fs');
  const screen = fs.readFileSync(
    new URL('../journey/JourneyScreen.js', import.meta.url), 'utf8',
  );

  ok(screen.includes('journeyView('), 'the screen asks journey.js for the page');
  ok(screen.includes('journeyStepFor('), 'and for which page it is');
  ok(!/const JOURNEY\s*=/.test(screen), 'and holds no copy of the pages itself');
  ok(!/'Step ' \+|`Step \$/.test(screen),
    'the step wording comes from journey.js, not from a second copy here');

  // The design's own parts, reused rather than redrawn.
  ok(screen.includes('StepTracker'), 'it draws the design\'s segment tracker');
  ok(screen.includes('StageChip'), 'and the design\'s tone chip');
  ok(/total=\{view\.of\}/.test(screen),
    'with as many segments as there are pages, not a hard-coded seven');

  // The screenshot page really opens the photos. The design's button does not.
  ok(screen.includes('launchImageLibraryAsync'),
    'choosing a picture from the phone is real, not a mock');
  ok(screen.includes('requestMediaLibraryPermissionsAsync'),
    'and it asks permission first');
  ok(screen.includes('exif: false'),
    'and strips where the picture was taken before sending it');

  // Coming back re-reads the record. Without this the page is whatever it was
  // when the screen was first opened, which is the bug the whole item is about.
  // NOT just that the listener exists. Emptying its body passed that, which is
  // the whole failure this is here to catch: a screen that listens for a return
  // and then does nothing shows whatever it was showing when it was first opened.
  const focusBody = (screen.match(
    /addListener\('focus',\s*\(\)\s*=>\s*\{([\s\S]*?)\n {4}\}\)/,
  ) || [])[1] || '';
  ok(/loadShots\(/.test(focusBody),
    'a return to the screen re-reads the screenshots');
  ok(/getTask\(/.test(focusBody),
    'and re-reads the server’s record, which is what decides the page');

  // And nothing here promises a screenshot was accepted on its own.
  ok(/never\s+accepted without a person at Fayr/.test(screen.replace(/\s+/g, ' ')),
    'the screenshot page says a person decides');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
