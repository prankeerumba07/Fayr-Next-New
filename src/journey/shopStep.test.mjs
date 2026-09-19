// THE BUY STEP AFTER THE ORDER WAS WATCHED — Phase 8A, Tasks 3 and 6.
//
// Five faces, decided without a phone; the screen that draws them starts the
// read on the cadence and never a photograph; and the words it says pass through
// the one file the plain language rule reads.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOP_FACES, shopStepFace } from './shopStep.js';
import {
  LOOK_AGAIN_AFTER_MS, forgetEveryDeliveryLookTime, mayLookForDeliveryNow,
  rememberTheDeliveryLook, untilTheNextLook,
} from './deliveryCadence.js';
import {
  EVERY_SENTENCE, ORDER_PLACED_WE_SAW_IT, TELLING_OUR_SIDE, WE_CANNOT_COUNT_THIS_ORDER,
  notWrittenUpYet, openTheShopAgain, readingYourOrder, weLookAgainIn,
} from '../ui/journeyWords.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';

console.log('=== 1. WHICH FACE ===');
{
  ok(JSON.stringify(SHOP_FACES) === JSON.stringify(['enter', 'telling', 'read-now', 'waiting', 'refused']),
    'five faces, in the order somebody meets them');
  ok(shopStepFace({}) === 'enter', 'nothing watched: the door, exactly as Phase 7');
  ok(shopStepFace({ watchedOrderKey: null, mayLookNow: true }) === 'enter', 'and the cadence cannot open anything without a key');
  ok(shopStepFace({ watchedOrderKey: null, waitingForOurSide: true }) === 'telling',
    'A KEY PARKED FOR OUR SIDE IS "TELLING": the order was watched, and nothing can be read yet');
  ok(shopStepFace({ watchedOrderKey: KEY, mayLookNow: true }) === 'read-now',
    'a key on the record and the cadence saying yes: READ NOW, with no tap');
  ok(shopStepFace({ watchedOrderKey: KEY, mayLookNow: false }) === 'waiting',
    'a key and a look too recent: waiting, and it says when');
  ok(shopStepFace({ watchedOrderKey: KEY, blocker: 'order_out_of_window', mayLookNow: true }) === 'refused',
    'OUR SIDE’S REFUSAL BEATS THE CADENCE: another look cannot change a rule’s answer');
  ok(shopStepFace({ watchedOrderKey: KEY, waitingForOurSide: true, mayLookNow: true }) === 'read-now',
    'and once the record has the key, the outbox is not asked');
  ok(shopStepFace({ watchedOrderKey: '  ', mayLookNow: true }) === 'enter', 'a blank key is no key');
  ok(shopStepFace({ watchedOrderKey: KEY, blocker: '', mayLookNow: false }) === 'waiting', 'and a blank blocker is no refusal');
  ok(shopStepFace() === 'enter', 'and nothing at all is the door');
}

console.log('\n=== 2. THE CADENCE SAYS HOW LONG, WITHOUT DECIDING TWICE ===');
{
  forgetEveryDeliveryLookTime();
  const T = 1758000000000;
  ok(untilTheNextLook('task-1', T) === 0, 'nothing looked at yet: now');
  rememberTheDeliveryLook('task-1', T);
  ok(untilTheNextLook('task-1', T) === LOOK_AGAIN_AFTER_MS, 'the whole floor the moment a look starts');
  ok(untilTheNextLook('task-1', T + 60000) === LOOK_AGAIN_AFTER_MS - 60000, 'and less as time passes');
  ok(untilTheNextLook('task-1', T + LOOK_AGAIN_AFTER_MS) === 0, 'zero at the floor');
  ok(untilTheNextLook('task-1', T + LOOK_AGAIN_AFTER_MS + 5000) === 0, 'and never negative after it');
  // ONE ARITHMETIC, TWO READINGS: whenever the wait is zero the look is allowed, and never otherwise.
  for (const dt of [0, 1, 59999, LOOK_AGAIN_AFTER_MS - 1, LOOK_AGAIN_AFTER_MS, LOOK_AGAIN_AFTER_MS + 1]) {
    ok((untilTheNextLook('task-1', T + dt) === 0) === mayLookForDeliveryNow('task-1', T + dt),
      `at +${dt}ms the wait and the decision agree`);
  }
  ok(untilTheNextLook('task-2', T + 1) === 0, 'another claim is its own clock');
  for (const junk of [null, undefined, '', 7]) ok(untilTheNextLook(junk, T) === 0, `${JSON.stringify(junk)} waits nothing`);
  forgetEveryDeliveryLookTime();
}

console.log('\n=== 3. THE WORDS, IN THE ONE FILE THE PLAIN LANGUAGE RULE READS ===');
{
  ok(weLookAgainIn(1) === 'We look again in a minute.', 'one minute is "a minute"');
  ok(weLookAgainIn(0.2) === 'We look again in a minute.', 'and a fraction of one rounds UP, never to "now"');
  ok(weLookAgainIn(7.2) === 'We look again in 8 minutes.', 'seven and a bit is eight');
  ok(weLookAgainIn(10) === 'We look again in 10 minutes.', 'ten is ten');
  ok(weLookAgainIn(NaN) === 'We look again in a minute.' && weLookAgainIn(-4) === 'We look again in a minute.',
    'and junk is the smallest honest wait');
  ok(readingYourOrder('Zepto') === 'We are reading your Zepto order ourselves. There is nothing to tap.', 'reading');
  ok(notWrittenUpYet('Zepto') === 'Zepto has not finished writing your order up yet.', 'not settled');
  ok(openTheShopAgain('Zepto') === 'Open Zepto again', 'the one door');
  for (const s of [ORDER_PLACED_WE_SAW_IT, TELLING_OUR_SIDE, WE_CANNOT_COUNT_THIS_ORDER,
    readingYourOrder('Zepto'), notWrittenUpYet('Zepto'), weLookAgainIn(1), weLookAgainIn(8), openTheShopAgain('Zepto')]) {
    ok(EVERY_SENTENCE.includes(s), `"${s}" is in the list the rule walks`);
    // NOT ONE OF THEM CLAIMS THE PURCHASE COUNTED. The server decides that.
    ok(!/counted|confirmed|matched|verified|paid/i.test(s), `and "${s}" claims nothing about the purchase`);
  }
}

console.log('\n=== 4. THE SCREEN DRAWS THE FACE, STARTS THE READ, AND OFFERS NO PHOTOGRAPH ===');
{
  const code = withoutComments(read('src/screens/shop.js'));
  ok(/import \{ shopStepFace \} from '\.\.\/journey\/shopStep';/.test(code), 'the face is decided next door');
  ok(/import \{ theWatchedOrderKey \} from '\.\.\/order\/whichRead';/.test(code), 'the key is the record’s');
  ok(/import \{ pendingTaskIds \} from '\.\.\/backend\/evidenceSync';/.test(code), 'and the outbox is asked, not a second flag');
  ok(/const watchedOrderKey = theWatchedOrderKey\(task\);/.test(code), 'read off the task');
  ok(/waitingForOurSide = !!\(taskId && pendingTaskIds\(\)\.indexOf\(taskId\) !== -1\);/.test(code),
    'and "telling" is exactly "this task has a body parked in the outbox"');
  ok(/mayLookNow: taskId \? mayLookForDeliveryNow\(taskId, now\) : false,/.test(code),
    'the cadence is asked, with the screen’s clock');
  // THE DOOR OPENS ONLY ON THE DOOR FACE.
  ok(/if \(face !== 'enter'\) return;\s*void open\(\);/.test(code), 'the shop opens by itself only when nothing has been watched');
  // THE READ: note before the move, and the same read as the delivery step.
  const readNow = code.indexOf("if (face !== 'read-now' || !taskId || started.current) return;");
  ok(readNow > -1, 'the read starts on the read-now face and once');
  const noted = code.indexOf('rememberTheDeliveryLook(taskId, Date.now());', readNow);
  const moved = code.indexOf("navigation.navigate('LookingForIt', { campaignId })", readNow);
  ok(noted > -1 && moved > noted, 'the note is written before the move, so a screen that comes straight back does not start again');
  ok(!/onlyThisOrder/.test(code), 'and no order is named: whichRead.js reads the key off the record inside the look');
  // A CLOCK, SO AN OPEN SCREEN NOTICES THE FLOOR PASSING.
  ok(/setInterval\(\(\) => setNow\(Date\.now\(\)\), ASK_AGAIN_EVERY_MS\)/.test(code) && /const ASK_AGAIN_EVERY_MS = 30000;/.test(code),
    'it asks again every half minute');
  // THE WORDS ARE NAMED, NOT WRITTEN.
  for (const name of ['ORDER_PLACED_WE_SAW_IT', 'TELLING_OUR_SIDE', 'readingYourOrder(shop)', 'notWrittenUpYet(shop)',
    'weLookAgainIn(minutesToTheNextLook)', 'WE_CANNOT_COUNT_THIS_ORDER', 'openTheShopAgain(shop)']) {
    ok(code.includes(name), `the screen names ${name}`);
  }
  ok(!/Order placed\. We saw it\./.test(code), 'and holds no copy of the sentence');
  // OUR SIDE'S OWN WORDS ON A REFUSAL, and none invented.
  ok(/task && task\.blockerReason \? \(\s*<Text style=\{\[hSub, styles\.sub\]\}>\{task\.blockerReason\}<\/Text>\s*\) : null/.test(code),
    'a refusal shows our side’s own reason, when it gave one');
  // NO PHOTOGRAPH, NO QUESTION, NO READ OF ITS OWN.
  ok(!/ProofUpload|launchImageLibraryAsync|screenshot|Screenshot/.test(code), 'no photograph anywhere on the step');
  ok(!/Did you buy|purchased the product|HAVE_YOU_BOUGHT_IT|Is this your order/.test(code), 'and no question');
  ok(!/WebView|sendFoundOrders|orderhistory|readDetailStep|openOneOrderWith/.test(code), 'and it reads nothing itself');
  ok(!/dispatch\(|postEvidence|applyAuthoritative|confirmOrder/.test(code), 'and moves no task');
  // THE PHASE 7 DOOR IS UNCHANGED, which enterTheShop.test.mjs pins line by line; restated here.
  ok(/await enterTheShop\(\{ campaignId, marketplace, navigation \}\)/.test(code)
    && /if \(!went\.ok\) setRefusal\(went\.refusal\);/.test(code), 'and the door still records the consent through the one door');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
