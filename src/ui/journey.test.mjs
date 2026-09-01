// The claim journey as twelve steps — every decision, without React.
//
// The thing worth proving hardest: coming back from the shop lands on the step
// somebody was on. It cannot land at the beginning, because there is no local
// pointer to lose — the step is worked out from the server's record every time.
//
// REWRITTEN ON 1 SEPTEMBER 2026, when the journey's eleven screens moved out of
// src/journey/JourneyScreen.js into src/screens/, one file each. Two things changed
// about what this file may check:
//
//   journey.js no longer holds a heading, a body or a button label. Those are the
//   screens' own words now, so the checks that read them here are gone; what
//   replaced them is stricter, because every step must name a design screen that
//   really exists on disk.
//
//   the last section used to grep ONE file for thirteen things. The drawing lives
//   in eleven files now, so each of those thirteen is checked against the file that
//   actually carries it, and the router is checked for NOT carrying them.
import { readFileSync } from 'node:fs';
import { STATES } from '../taskflow.js';
import {
  DESIGN_KEYS,
  JOURNEY,
  JOURNEY_KEYS,
  OF,
  checkLine,
  designKeyFor,
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

console.log('=== 1. twelve steps, in the order the journey runs in ===');
{
  ok(OF === 12, `twelve steps, found ${OF}`);
  ok(JSON.stringify(JOURNEY_KEYS) === JSON.stringify([
    'join', 'connect', 'buy', 'returncatch', 'purchase-shot', 'checking',
    'order-details', 'delivered', 'review', 'review-shot', 'window', 'refund',
  ]), 'in exactly the order asked for');
  ok(new Set(JOURNEY_KEYS).size === OF, 'no step twice');

  for (const step of JOURNEY) {
    ok(typeof step.next === 'string' && step.next.length > 10,
      `${step.key} says what happens next`);
    ok(typeof step.from === 'string' && step.from.length > 3,
      `${step.key} names the design screen it came from`);
    ok(typeof step.short === 'string' && step.short.length > 3,
      `${step.key} has a short label for the tracker`);
  }
}

console.log('\n=== 1b. NO STEP DECIDES WHAT A SCREEN LOOKS LIKE ===');
{
  // The whole point of the split. A heading or a button label here would be a
  // second copy of a sentence that is already on a screen, and two copies of one
  // sentence drift. Checked on the shape rather than on the source, so a heading
  // reintroduced under any name is caught.
  for (const step of JOURNEY) {
    ok(step.title === undefined, `${step.key} carries no heading`);
    ok(step.body === undefined, `${step.key} carries no body text`);
    ok(step.act === undefined, `${step.key} carries no button label`);
  }
  const src = readFileSync(new URL('./journey.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\btitle:/.test(src), 'and the file has no title field at all');
  ok(!/\bact:/.test(src), 'and no button label field');
}

console.log('\n=== 1c. EVERY STEP NAMES A DESIGN SCREEN THAT REALLY EXISTS ===');
{
  // This is the one join between the journey machine and the eleven screens. A
  // step naming a key with no file behind it would render nothing at all, and the
  // router has no way to know better.
  ok(DESIGN_KEYS.length === OF, 'one design key per step');
  ok(new Set(DESIGN_KEYS).size === OF,
    'and no two steps are drawn by the same screen');
  for (const step of JOURNEY) {
    ok(designKeyFor(step.key) === step.designKey,
      `${step.key} resolves to ${step.designKey}`);
    let exists = true;
    try {
      readFileSync(new URL(`../screens/${step.designKey}.js`, import.meta.url));
    } catch (e) { exists = false; }
    ok(exists, `src/screens/${step.designKey}.js exists`);
  }
  ok(designKeyFor('not-a-step') === null, 'a step we do not know resolves to nothing');
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
    'bought, with nothing to confirm: straight to has it arrived');
  ok(at({ task: { state: STATES.CLAIMED, order: { id: 'o1' } }, connected: true })
      === 'order-details',
    'an order we could read counts as bought, whatever the state says');

  ok(at({ task: { state: STATES.DELIVERED } }) === 'review', 'delivered: write the review');
  ok(at({ task: { state: STATES.REVIEWED } }) === 'review-shot',
    'reviewed: send the picture of it');
  ok(at({ task: { state: STATES.HOLDING } }) === 'window', 'holding: the return window');
  ok(at({ task: { state: STATES.REFUNDED } }) === 'refund', 'refunded: the last page');
}

console.log('\n=== 3b. AN ORDER NOBODY HAS SAID IS THEIRS GETS ITS OWN STEP ===');
{
  // Added when the journey was split. The engine has always had a gate here —
  // CONFIRM_ORDER, "this is my order" — and the design has always had a screen for
  // it, but the app had none, so the tap that fired the gate sat on the DELIVERY
  // screen under the words "Yes, it is delivered". Two different facts under one
  // button. Splitting made keeping that impossible, and this is the step that
  // replaced it.
  const order = { id: '402-1', product: 'A thing' };
  ok(journeyStepFor({ task: { state: STATES.PURCHASED, order }, connected: true })
      === 'order-details',
    'an unconfirmed order stops on its own step');

  // BOTH SHAPES. The server's record carries the flag inside the order; the engine
  // task carries it at the top. journeyStepFor is handed whichever the caller has.
  ok(journeyStepFor({
    task: { state: STATES.PURCHASED, order: { ...order, orderConfirmed: true } },
    connected: true,
  }) === 'delivered', 'confirmed on the server’s shape moves on');
  ok(journeyStepFor({
    task: { state: STATES.PURCHASED, order, orderConfirmed: true },
    connected: true,
  }) === 'delivered', 'confirmed on the engine’s shape moves on too');

  // And it never gets in the way of somebody with no order at all to confirm.
  ok(journeyStepFor({ task: { state: STATES.PURCHASED }, connected: true })
      === 'delivered',
    'no order means nothing to confirm, so the step is skipped');

  // Nor does it reappear after delivery, a review, or the money.
  for (const later of [STATES.DELIVERED, STATES.REVIEWED, STATES.HOLDING,
                       STATES.REFUNDED]) {
    ok(journeyStepFor({ task: { state: later, order }, connected: true })
        !== 'order-details',
      `${later} is past confirming an order`);
  }
}

console.log('\n=== 3c. THE FOUR STEPS THE PHONE MAY DECIDE, AND ONLY THOSE FOUR ===');
{
  // Before the shop has told Fayr anything there is no record to read, so three
  // small notes on the phone move somebody between four screens. The rule that
  // matters: the moment the server says anything, the notes are ignored entirely.
  const claimed = { task: { state: STATES.CLAIMED } };
  ok(journeyStepFor({ ...claimed, connected: false }) === 'connect',
    'nothing done yet: connect the shop account');
  ok(journeyStepFor({ ...claimed, connected: true }) === 'buy',
    'connected: go and buy it');
  ok(journeyStepFor({ ...claimed, connected: true, wentToBuy: true }) === 'returncatch',
    'been to the shop and back: did you buy it?');
  ok(journeyStepFor({
    ...claimed, connected: true, wentToBuy: true, saidTheyBought: true,
  }) === 'purchase-shot', 'said they bought it: show us the order');

  // AND THE SERVER ALWAYS WINS. Every note set, and an order on file, still lands
  // on the order the server can see. This is the guarantee that the notes cannot
  // move anybody past the point where money is decided.
  const allNotes = { connected: true, wentToBuy: true, saidTheyBought: true };
  ok(journeyStepFor({
    task: { state: STATES.PURCHASED, order: { id: 'o1' } }, ...allNotes,
  }) === 'order-details', 'an order on file beats every note on the phone');
  for (const later of [STATES.DELIVERED, STATES.REVIEWED, STATES.HOLDING,
                       STATES.REFUNDED]) {
    const step = journeyStepFor({ task: { state: later }, ...allNotes });
    ok(!['connect', 'buy', 'returncatch', 'purchase-shot'].includes(step),
      `${later} is past anything the phone may decide, and is ${step}`);
  }
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
  ok(view.key === 'review', 'it knows which step');
  ok(view.designKey === 'reviewguide', 'and which design screen draws it');
  ok(view.where === 'Step 9 of 12', 'and says where you are');
  ok(view.stepNumber === 9 && view.of === 12, 'with the numbers to draw it');
  ok(view.track.length === 12, 'one segment per step');
  ok(view.track.filter((t) => t.state === 'done').length === 8, 'eight behind');
  ok(view.track.filter((t) => t.state === 'here').length === 1, 'one here');
  ok(view.track.filter((t) => t.state === 'todo').length === 3, 'three to come');
  ok(view.product === 'Prestige cooktop', 'it carries the product');

  const waiting = journeyView({ task: { state: STATES.HOLDING } });
  ok(waiting.waiting === true, 'a waiting step says so');

  const busy = journeyView({
    task: { state: STATES.DELIVERED }, connected: true, busy: true,
  });
  ok(busy.busy === true, 'and it says when something is in flight');
  ok(busy.action === undefined,
    'there is no button label here any more — the screen owns its own words');
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
    ok(typeof view.next === 'string' && view.next !== '', `${label}: and what comes next`);
    ok(/^Step \d+ of 12$/.test(view.where), `${label}: and where you are`);
    ok(typeof view.designKey === 'string' && view.designKey !== '',
      `${label}: and which screen draws it`);
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

console.log('\n=== 10. THE ROUTER DECIDES WHICH SCREEN, AND DRAWS NONE OF THEM ===');
{
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const router = read('../journey/JourneyScreen.js');

  ok(/journeyView\(/.test(router), 'the router asks journey.js which step this is');
  ok(!/const JOURNEY\s*=/.test(router), 'and holds no copy of the steps itself');
  ok(!/'Step ' \+|`Step \$/.test(router),
    'the step wording comes from journey.js, not from a second copy here');

  // ONE DERIVATION. Asking journeyStepFor as well as journeyView would be a second
  // copy of the same decision, which is the defect class this project keeps finding.
  ok(!/journeyStepFor\(/.test(router),
    'the router derives the step ONCE, through journeyView');

  // It resolves the screen from the registry rather than importing eleven of them.
  ok(/screenFor\(/.test(router), 'it looks the screen up by the design’s own key');
  ok(/from '\.\.\/screens'/.test(router), 'from the one registry');

  // AND IT DRAWS NONE OF THE ELEVEN. Every heading, card and button belongs to a
  // screen now. A stray one here would be a twelfth version of a screen.
  for (const gone of ['Buy exactly this', 'Delivered?', 'Share your honest review',
                      'Grab a screenshot', 'Connect your']) {
    ok(!router.includes(gone), `the router does not draw "${gone}" any more`);
  }
  ok(!/launchImageLibraryAsync/.test(router),
    'and it opens no photo library: the screens that need one do that');

  // The remount key, which is load-bearing: two adjacent steps can be two
  // different components, and React keeps an instance when the type is the same.
  ok(/key=\{designKey\}/.test(router),
    'the stage is keyed on the design key, so stepping really remounts');

  // COMING BACK RE-READS THE RECORD. Without this the screen is whatever it was
  // when it was first opened, which is the bug the whole journey exists to avoid.
  // NOT just that the listener exists: emptying its body used to pass.
  const focusBody = (router.match(
    /addListener\('focus',\s*\(\)\s*=>\s*\{([\s\S]*?)\n {4}\}\)/,
  ) || [])[1] || '';
  ok(/loadShots\(/.test(focusBody), 'a return to the router re-reads the screenshots');
  ok(/getTask\(/.test(focusBody),
    'and re-reads the server’s record, which is what decides the step');

  // The design's own progress parts, reused rather than redrawn, with as many
  // segments as there are steps.
  ok(/StepTracker/.test(router), 'it draws the design’s segment tracker');
  ok(/StageChip/.test(router), 'and the design’s tone chip');
  ok(/total=\{view\.of\}/.test(router),
    'with as many segments as there are steps, not a hard-coded seven');
}

console.log('\n=== 11. EACH OF THE THIRTEEN CHECKS MOVED TO THE FILE THAT OWNS IT ===');
{
  // Section 10 used to grep ONE file for all of this. It is eleven files now, and a
  // check pointed at the wrong one passes for the wrong reason.
  const read = (key) => readFileSync(
    new URL(`../screens/${key}.js`, import.meta.url), 'utf8',
  );
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // THE PICTURE IS REAL. The design's upload button on the review-proof screen has
  // nothing behind it; this one opens the phone's photos.
  const reviewproof = strip(read('reviewproof'));
  ok(/launchImageLibraryAsync/.test(reviewproof),
    'reviewproof really opens the photos');
  ok(/requestMediaLibraryPermissionsAsync/.test(reviewproof),
    'and asks permission first');
  ok(/exif: false/.test(reviewproof),
    'and strips where the picture was taken before sending it');

  // A PERSON DECIDES, ALWAYS. Neither screen may imply a reading was enough.
  for (const key of ['ocrconfirm', 'reviewproof']) {
    const flat = strip(read(key)).replace(/\s+/g, ' ');
    ok(/never accepted without a person at Fayr/.test(flat),
      `${key} says a person at Fayr decides`);
  }

  // ONE SCREEN OWNS THE ORDER GATE. Two screens firing CONFIRM_ORDER is exactly
  // what the split was meant to end: the delivery screen used to fire it under the
  // words "Yes, it is delivered", which is a different fact.
  const firing = ['confirm', 'linkaccount', 'buyinterstitial', 'returncatch',
    'proofprimer', 'ocrconfirm', 'underreview', 'delivery', 'reviewguide',
    'reviewproof', 'returnwindow', 'reward', 'emailconnect', 'emailcode',
    'orderverified', 'imagesuploaded']
    .filter((key) => /CONFIRM_ORDER/.test(strip(read(key))));
  ok(JSON.stringify(firing) === JSON.stringify(['ocrconfirm']),
    `exactly one screen confirms an order, and it is ocrconfirm (found: ${firing.join(', ') || 'none'})`);

  // NO SCREEN INVENTS A NUMBER THE DESIGN WROTE INTO ITSELF.
  const wrote = [
    ['returnwindow', /\b5\s*DAYS\b|\b11 Jul\b/i, 'the design’s "5 DAYS" and "11 Jul"'],
    ['ocrconfirm', /1269146612|2 Jul 2026/, 'the design’s order number and order date'],
    ['proofprimer', /402-3925017-7784521/, 'the design’s sample order number'],
    ['confirm', /48\s*hours/i, 'the design’s "48 hours"'],
  ];
  for (const [key, bad, what] of wrote) {
    ok(!bad.test(strip(read(key))), `${key} does not copy ${what}`);
  }

  // AND NONE OF THEM DECIDES WHICH STEP IT IS. That is the router's job, and a
  // screen that worked it out again could disagree with the record.
  for (const key of ['linkaccount', 'buyinterstitial', 'returncatch', 'proofprimer',
                     'ocrconfirm', 'underreview', 'delivery', 'reviewguide',
                     'reviewproof', 'returnwindow', 'emailconnect', 'emailcode',
                     'orderverified', 'imagesuploaded']) {
    ok(!/journeyStepFor|journeyView/.test(strip(read(key))),
      `${key} does not work out which step it is`);
  }

  // THE TWO SCREENS THAT SAY A THING IS NOT BUILT MUST SAY IT ON THE SCREEN, not
  // only in a comment. The owner asked for exactly this: anything not yet working
  // said plainly on the screen rather than faked.
  for (const key of ['emailconnect', 'emailcode']) {
    const src = strip(read(key));
    ok(/[Nn]ot (ready|built) yet/.test(src),
      `${key} says on the screen that it is not built yet`);
    // And neither may claim an inbox got connected or a code got sent.
    ok(!/\bconnected!|inbox is connected\b/.test(src),
      `${key} never claims an inbox was connected`);
    ok(!/setTimeout/.test(src),
      `${key} runs no pretend timer, which is how the design fakes it`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
