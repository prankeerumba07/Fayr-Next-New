// DELIVERY FETCHES ITSELF — HOW OFTEN, AND THAT NOBODY IS ASKED. Phase 7, Task 4.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOOK_AGAIN_AFTER_MS, forgetEveryDeliveryLookTime, mayLookForDeliveryNow,
  rememberTheDeliveryLook,
} from './deliveryCadence.js';
import { journeyStepFor } from '../ui/journey.js';
import { STATES } from '../taskflow.js';

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

console.log('=== 1. THE CADENCE IS A NAMED CONSTANT WITH ITS REASON BESIDE IT ===');
{
  ok(Number.isInteger(LOOK_AGAIN_AFTER_MS) && LOOK_AGAIN_AFTER_MS === 10 * 60 * 1000,
    'ten minutes, which is the shop’s own delivery time');
  const src = read('src/journey/deliveryCadence.js');
  ok(/A QUICK-COMMERCE PARCEL ARRIVES IN ABOUT TEN MINUTES/.test(src)
    && /flat battery/.test(src) && /gets an account blocked/.test(src),
    'and the file says both halves of the trade beside the number');
  const code = withoutComments(read('src/screens/delivery.js'));
  ok(/mayLookForDeliveryNow\(taskId, Date\.now\(\)\)/.test(code),
    'and the screen asks it, rather than carrying a number of its own');
  ok(!/10 \* 60 \* 1000|600000/.test(code), 'and there is no ten minutes written in the screen');
}

console.log('\n=== 2. ONCE ON ARRIVAL, THEN NOT AGAIN UNTIL THE GAP HAS PASSED ===');
{
  forgetEveryDeliveryLookTime();
  const T = 1758000000000;
  ok(mayLookForDeliveryNow('task-1', T) === true, 'the first ask in a sitting may look');
  rememberTheDeliveryLook('task-1', T);
  ok(mayLookForDeliveryNow('task-1', T + 1) === false, 'and the next ask a moment later may not');
  ok(mayLookForDeliveryNow('task-1', T + LOOK_AGAIN_AFTER_MS - 1) === false, 'nor one millisecond short of the gap');
  ok(mayLookForDeliveryNow('task-1', T + LOOK_AGAIN_AFTER_MS) === true, 'and may again exactly at the gap');
  // KEYED BY TASK, for the reason deliveryLook.js gives.
  ok(mayLookForDeliveryNow('task-2', T + 1) === true, 'another claim is its own clock');
  for (const junk of [null, undefined, '', 7, {}]) {
    ok(mayLookForDeliveryNow(junk, T) === false, `${JSON.stringify(junk)} is no claim, so no look`);
  }
  forgetEveryDeliveryLookTime();
}

console.log('\n=== 3. DELIVERY ARRIVING ADVANCES THE JOURNEY WITH NO TAP ===');
{
  ok(journeyStepFor({ task: { state: STATES.DELIVERED }, inFayrShop: true }) === 'review',
    'DELIVERED ON A SHOP INSIDE FAYR IS THE REVIEW STEP, WITH NOBODY ASKED');
  ok(journeyStepFor({ task: { state: STATES.DELIVERED }, inFayrShop: true, saidItArrived: false }) === 'review',
    'and an unanswered question does not hold it');
  // THE FOUR OTHERS ARE STILL ASKED — the mutation that puts the screen back
  // for everybody is caught by the line above; this line is what keeps the fix
  // from being applied to them.
  ok(journeyStepFor({ task: { state: STATES.DELIVERED }, inFayrShop: false }) === 'delivered',
    'while the four other shops still see the question');
}

console.log('\n=== 4. THE DELIVERY SCREEN ASKS NOTHING FOR A SHOP INSIDE FAYR ===');
{
  const code = withoutComments(read('src/screens/delivery.js'));
  ok(/const asksNothing = shopsInsideFayr\(key\);/.test(code), 'the screen knows which shop it is drawing for');
  // THE QUESTION IS GATED WHERE THE FACE IS DECIDED, and nowhere else. The two
  // lines the frozen deliveryCheck.test.mjs pins — `looked ? 'nothing' :
  // 'asking'` and `const delivered = known && saidSo;` — are untouched; a shop
  // inside Fayr simply never has `asking` true, whatever `where` says.
  ok(/const asking = \(where === 'asking' \|\| mustAsk\) && !delivered && !asksNothing;/.test(code),
    'and the question is never up for one, whatever the screen\u2019s own state says');
  ok(/const delivered = known && saidSo;/.test(code) && /looked \? 'nothing' : 'asking'/.test(code),
    'while the two lines the frozen check pins are exactly as they were');
  ok(/if \(!asksNothing \|\| known \|\| taskId == null\) return;\s*if \(!mayLookForDeliveryNow\(taskId, Date\.now\(\)\)\) return;\s*rememberTheDeliveryLook\(taskId, Date\.now\(\)\);\s*setWhere\('reading'\);/.test(code),
    'THE READ IS STARTED BY THE SCREEN, on the cadence, with the note written before the move');
  // AND NOT THROUGH THE TAP'S PATH, whose once-per-sitting note would refuse the
  // ten minute re-look — the defect an adversarial review found on the first
  // writing of this effect.
  // BOTH ANCHORS MUST BE FOUND. An end anchor that is missing reads as -1, and
  // slice(start, -1) is the whole rest of the file — which passed, on 19
  // September 2026, for the wrong reason when the dependency list changed.
  // `tick` joined it with Phase 8A: an open screen asks the cadence again every
  // half minute, and the effect has to re-run for the ask to happen.
  const autoStart = code.indexOf('if (!asksNothing || known || taskId == null) return;');
  const autoEnd = code.indexOf('}, [asksNothing, known, taskId, campaignId, navigation, tick]);', autoStart);
  ok(autoStart > -1 && autoEnd > autoStart, 'the automatic look and its dependency list are both where expected');
  const auto = code.slice(autoStart, autoEnd);
  ok(auto.length > 50 && !/theySaidYes\(\)|alreadyLookedForDelivery|rememberWeLookedForDelivery/.test(auto),
    'and the automatic look is governed by the cadence alone, never by the per-sitting note');
  ok(/setInterval\(\(\) => setTick\(\(n\) => n \+ 1\), 30000\)/.test(code),
    'AND AN OPEN SCREEN ASKS AGAIN, every half minute, so the floor passing is noticed without a tap');
  ok(/navigation\.navigate\('LookingForIt', \{ campaignId, onlyThisOrder: itsOrder \}\)/.test(auto),
    'and it names the order, exactly as the tap\u2019s path does');
  // The two answer buttons are still drawn only under `asking`, which is false
  // for such a shop, so nothing is tapped — and the four other shops keep them.
  ok(/\{asking \? \(\s*<>\s*<Pill onPress=\{theySaidYes\}/.test(code),
    'and the two answers are drawn only when the question is up');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
