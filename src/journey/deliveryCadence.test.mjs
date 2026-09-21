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

console.log('\n=== 4. THE DELIVERY SCREEN ASKS AGAIN, AND LOOKS ONLY WHEN ASKED ===');
{
  // ── THE REVERSAL THIS SECTION NOW PINS — 21 SEPTEMBER 2026 ──────────────
  //
  // It used to pin the opposite: "THE DELIVERY SCREEN ASKS NOTHING FOR A SHOP
  // INSIDE FAYR", on the owner's instruction of 18 September ("delivery fetches
  // itself. No screen, no tap."). He reversed it in his own words:
  //
  //   "there should be a trigger ... 'We can see that you have completed your
  //    purchase. Once your order is delivered, please confirm yes or no.' Once
  //    someone clicks on yes, the backend actually goes and checks if the
  //    product is delivered or not."
  //
  // WHAT IS PINNED IS THE SHAPE OF THE REVERSAL, not merely that it happened:
  // the question is drawn, the screen no longer looks by itself, the tap is a
  // TRIGGER and never a verdict, and the camera door stays shut for a shop
  // inside Fayr. Those four together are what make a tap safe to allow.
  const code = withoutComments(read('src/screens/delivery.js'));

  // ONE FLAG HOLDS BOTH HALVES. The question being drawn and the screen not
  // looking by itself are two faces of one decision; split across two flags,
  // one can be flipped without the other and the screen asks a question it then
  // navigates away from before anybody can answer it.
  ok(/const theShopLooksWithoutBeingAsked = false;/.test(code),
    'THE SCREEN NO LONGER LOOKS BY ITSELF, and says so in one place');

  ok(/const asking = \(where === 'asking' \|\| mustAsk\) && !delivered && !wentBack\s*&& !theShopLooksWithoutBeingAsked;/.test(code),
    'and the question IS up for every shop, including one inside Fayr');
  // ── AND NEVER FOR AN ORDER THAT WENT BACK — 21 SEPTEMBER 2026 ──────────
  //
  // The owner cancelled a Zepto order on purpose. Fayr read it, the refund gate
  // had already refused it in its own words, and the journey was still about to
  // ask him whether it had been delivered. Asking anybody anything about an
  // order the shop says went back is asking for work towards money that cannot
  // come. `returned` is the SERVER's word, read off the shop's own page; only an
  // explicit true stops anybody, because the tri-state's null means the page
  // said nothing either way.
  ok(/const wentBack = task != null && task\.returned === true;/.test(code),
    'the screen knows when the shop says the order went back');
  ok(/'This order went back'/.test(code), 'and says so instead of asking');

  // ── AND THE FOOT OF IT OFFERS THE ONE THING THERE IS — 21 SEP 2026 ─────
  //
  // The owner on his own cancelled order: "why are we showing questions like
  // 'It is late' or 'There is a problem'? We already know that the order has
  // been cancelled or returned." And: "There is no back option on the page."
  //
  // Both of those controls ask about an order still on its way. An order the
  // shop says went back is not late, has no problem to report, and needs no
  // photograph — it has an outcome, which the screen states. What it needs is
  // a way out, which it had none of.
  ok(/\{wentBack \? \(\s*<TextBtn/.test(code),
    'a returned order gets a way out instead of the late-or-problem question');
  ok(/Back to the offer/.test(code), 'and it goes to the offer, where the next thing happens');
  ok(/!asksNothing && !wentBack \? \(\s*<Ghost/.test(code),
    'AND NO CAMERA IS OFFERED for an order that went back');

  // THE AUTOMATIC LOOK IS STILL THERE AND STILL CORRECT, and it is gated on the
  // same flag — so it is dead today and would come back whole, cadence and all,
  // if anybody ever sets the flag true. Deleting it would throw away the ten
  // minute floor that exists because repeated shop visits get accounts blocked.
  ok(/if \(!theShopLooksWithoutBeingAsked \|\| known \|\| taskId == null\) return;\s*if \(!mayLookForDeliveryNow\(taskId, Date\.now\(\)\)\) return;\s*rememberTheDeliveryLook\(taskId, Date\.now\(\)\);\s*setWhere\('reading'\);/.test(code),
    'the automatic look is kept whole, and gated on that one flag');
  const autoStart = code.indexOf('if (!theShopLooksWithoutBeingAsked || known || taskId == null) return;');
  const autoEnd = code.indexOf('}, [theShopLooksWithoutBeingAsked, known, taskId, campaignId, navigation, tick]);', autoStart);
  ok(autoStart > -1 && autoEnd > autoStart, 'the automatic look and its dependency list are both where expected');
  const auto = code.slice(autoStart, autoEnd);
  ok(auto.length > 50 && !/theySaidYes\(\)|alreadyLookedForDelivery|rememberWeLookedForDelivery/.test(auto),
    'and it is still governed by the cadence alone, never by the per-sitting note');
  ok(/navigation\.navigate\('LookingForIt', \{ campaignId, onlyThisOrder: itsOrder \}\)/.test(auto),
    'and it still names the order, exactly as the tap’s path does');

  // THE TWO LINES THE FROZEN CHECK PINS ARE UNTOUCHED, as they were before.
  ok(/const delivered = known && saidSo;/.test(code) && /looked \? 'nothing' : 'asking'/.test(code),
    'while the two lines the frozen check pins are exactly as they were');

  // THE CAMERA DOOR IS A DIFFERENT QUESTION AND IT STAYS SHUT. A photograph is
  // the same question asked of a camera, and for a shop inside Fayr the watched
  // order's own page is read again instead — that page is the only evidence
  // there is. This is why the reversal needed a SECOND flag and not an edit to
  // this one.
  ok(/const asksNothing = shopsInsideFayr\(key\);/.test(code),
    'the screen still knows which shop it is drawing for');
  ok(/\{!reading && !asking && !delivered && !asksNothing && !wentBack \? \(\s*<Ghost/.test(code),
    'AND NO PICTURE IS ASKED OF A SHOP INSIDE FAYR, which the tap does not change');

  ok(/\{asking \? \(\s*<>\s*<Pill onPress=\{theySaidYes\}/.test(code),
    'and the two answers are drawn only when the question is up');

  // THE TAP IS A TRIGGER AND NEVER A VERDICT. deliveryCheck.test.mjs owns this
  // rule in full; this line is here so that a change made in THIS section
  // cannot quietly hand the tap a verdict without that file being opened.
  const yesStart = code.indexOf('const theySaidYes = useCallback(');
  const yesEnd = code.indexOf('}, [', yesStart);
  const yes = code.slice(yesStart, yesEnd);
  ok(yesStart > -1 && yesEnd > yesStart, 'the answer handler is where expected');
  ok(!/submitEvidence|sendFoundOrders|markReviewed|applyAuthoritative|delivery:/.test(yes),
    'AND THE TAP SETTLES NOTHING: it writes a note and opens the read, and that is all');

  // AND WHAT FAYR ALREADY KNOWS IS SAID BEFORE IT ASKS. Named from
  // journeyWords.js, never retyped into the screen — the plain-language walk
  // reads that file off disk and cannot see a sentence typed here.
  ok(/\{asking \? `\$\{ORDER_PLACED_WE_SAW_IT\} ` : null\}/.test(code),
    'and the screen says what it already knows before it asks anything');
  ok(!/We can see that you have completed your purchase/.test(code),
    'with no sentence typed into the screen itself');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
