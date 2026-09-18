// A NOTE BELONGS TO A CLAIM, NOT TO AN OFFER — WALKED, NOT READ.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The rule used to be two template strings inside shopVisits.js, and the only
// check on it read them as text: shopVisits.js reaches for expo-file-system on
// its first line, so nothing could ever RUN it. A check that matches the shape
// of a string proves the string has that shape and nothing about what happens
// when a person claims the same offer twice.
//
// src/journey/noteNames.js is that rule by itself and it opens under node. This
// walks it against a closed claim and a fresh one, and then walks the step the
// journey lands on with those notes in hand.
//
// ── AND THE RUN OF 18 SEPTEMBER 2026, WHICH IS NOT WHAT IT LOOKED LIKE ──────
//
// The phase this file was written for asked for the note keying to be fixed,
// on the reading that a note about a finished task was speaking for a new one.
// IT WAS NOT. That bug was real on 16 September, it was fixed the same day, and
// the backend log of the 18th shows why the symptom came back anyway:
//
//   15:43:36  POST /tasks                          a fresh claim
//   15:43:43  POST .../going-to-the-shop           seven seconds later
//   15:43:47  the order read starts                four seconds after that
//
// A fresh claim reached the BUY step correctly — the note was empty, exactly as
// this file's rule says it should be. What happened next is in
// src/journey/theNotice.test.mjs: the note was written by the tap that RECORDED
// the visit rather than by the one that made it, and the journey moved off the
// buy step while its pop-up was still being raised.
//
// SO THE CHECKS BELOW ARE A GUARD AND NOT A FIX. The fix they guard already
// existed. They are here because nothing was walking it.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BETWEEN, noteIsForTheClaim, noteNameFor } from './noteNames.js';
import { journeyStepFor } from '../ui/journey.js';
import { STATES } from '../taskflow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** The code, without the prose. This project has been bitten nine times. */
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const OFFER = 'campaign-boldfit';
const OLD_CLAIM = 'task-that-is-closed';
const NEW_CLAIM = 'task-claimed-just-now';
const WENT_TO_BUY = 'buy';
const SAID_THEY_BOUGHT = 'bought';
const SIGNED_IN = 'signin';

console.log('=== 1. a note written under one claim cannot answer for another ===');
{
  const old = noteNameFor(OFFER, OLD_CLAIM, WENT_TO_BUY);
  const fresh = noteNameFor(OFFER, NEW_CLAIM, WENT_TO_BUY);
  ok(old !== fresh, 'the same offer and the same reason under two claims are two notes');
  ok(!noteIsForTheClaim(old, OFFER, NEW_CLAIM, WENT_TO_BUY),
    'so the closed claim’s note does not answer for the fresh one');
  ok(noteIsForTheClaim(old, OFFER, OLD_CLAIM, WENT_TO_BUY),
    'and still answers for its own');
  for (const why of [WENT_TO_BUY, SAID_THEY_BOUGHT, 'review', 'saidarrived']) {
    ok(noteNameFor(OFFER, OLD_CLAIM, why) !== noteNameFor(OFFER, NEW_CLAIM, why),
      `and that holds for ${why} as well, not only for the first one`);
  }
  ok(noteNameFor(OFFER, NEW_CLAIM, WENT_TO_BUY)
    !== noteNameFor(OFFER, NEW_CLAIM, SAID_THEY_BOUGHT),
    'and two reasons under one claim are still two notes');
  ok(noteNameFor('another-offer', NEW_CLAIM, WENT_TO_BUY)
    !== noteNameFor(OFFER, NEW_CLAIM, WENT_TO_BUY),
    'and two offers are still two notes');
}

console.log('\n=== 2. with no claim, the offer’s own name — and the leak only runs one way ===');
{
  const beforeAnyClaim = noteNameFor(OFFER, null, SIGNED_IN);
  ok(beforeAnyClaim === `${OFFER}${BETWEEN}${SIGNED_IN}`,
    'signing in can happen before a claim exists, so it can be named then');
  for (const nothing of [null, undefined, '', 0, false, {}]) {
    ok(noteNameFor(OFFER, nothing, SIGNED_IN) === beforeAnyClaim,
      `${JSON.stringify(nothing)} is "no claim" and not half a name`);
  }
  // THE DIRECTION IS THE WHOLE SAFETY ARGUMENT. A note written with no claim is
  // asked for again with no claim. The moment a claim exists the name wanted
  // carries the claim's id, so the older shorter name cannot answer it — which
  // means a stale note can only ever FAIL to be found, showing somebody a page
  // they have already seen, and can never claim a purchase that did not happen.
  ok(!noteIsForTheClaim(beforeAnyClaim, OFFER, NEW_CLAIM, SIGNED_IN),
    'and once there is a claim, the claimless note no longer answers');
}

console.log('\n=== 3. a name with a hole in it is never made ===');
{
  for (const bad of [null, undefined, '', 7, {}, []]) {
    ok(noteNameFor(bad, NEW_CLAIM, WENT_TO_BUY) === null,
      `${JSON.stringify(bad)} is no offer, so there is no note`);
    ok(noteNameFor(OFFER, NEW_CLAIM, bad) === null,
      `${JSON.stringify(bad)} is no reason, so there is no note`);
  }
  // A note called "undefined::buy" would be ONE note shared by every offer on
  // the phone, which is the failure this file exists to prevent, made worse.
  ok(noteNameFor(undefined, undefined, undefined) === null, 'and nothing at all is no note');
  ok(!noteIsForTheClaim(null, OFFER, NEW_CLAIM, WENT_TO_BUY), 'nothing matches nothing');
}

console.log('\n=== 4. THE CHECK THE PHASE ASKED FOR: a closed claim and a fresh one ===');
{
  // A campaign that has been claimed before, whose claim is closed, and claimed
  // again. The old claim's notes are still in the file under their own names.
  const notesOnThePhone = new Set([
    noteNameFor(OFFER, OLD_CLAIM, WENT_TO_BUY),
    noteNameFor(OFFER, OLD_CLAIM, SAID_THEY_BOUGHT),
  ]);
  const asksFor = (claim, why) => notesOnThePhone.has(noteNameFor(OFFER, claim, why));

  ok(asksFor(OLD_CLAIM, WENT_TO_BUY) === true, 'the closed claim did go to the shop');
  ok(asksFor(NEW_CLAIM, WENT_TO_BUY) === false, 'the fresh claim has not');
  ok(asksFor(NEW_CLAIM, SAID_THEY_BOUGHT) === false, 'and has not said it bought anything');

  // AND THE STEP THAT FALLS OUT OF THAT IS THE BUY STEP.
  const freshTask = { state: STATES.CLAIMED };
  ok(journeyStepFor({
    task: freshTask,
    connected: true,
    wentToBuy: asksFor(NEW_CLAIM, WENT_TO_BUY),
    saidTheyBought: asksFor(NEW_CLAIM, SAID_THEY_BOUGHT),
  }) === 'buy', 'A CAMPAIGN WITH A CLOSED TASK AND A FRESH CLAIM SHOWS THE BUY STEP');

  // THE SHAPE OF THE BUG IT PREVENTS, walked rather than described: filed under
  // the offer, the very same notes send a brand new claim to "show us a
  // screenshot" — no "before you go", no shop, no "did you buy it".
  const asOffer = new Set([`${OFFER}${BETWEEN}${WENT_TO_BUY}`, `${OFFER}${BETWEEN}${SAID_THEY_BOUGHT}`]);
  ok(journeyStepFor({
    task: freshTask,
    connected: true,
    wentToBuy: asOffer.has(`${OFFER}${BETWEEN}${WENT_TO_BUY}`),
    saidTheyBought: asOffer.has(`${OFFER}${BETWEEN}${SAID_THEY_BOUGHT}`),
  }) === 'purchase-shot', 'while an offer-keyed note would send it straight past the shop');

  // AND THE CLOSED CLAIM ITSELF IS UNCHANGED, so this is not a rule that simply
  // forgets everything.
  ok(journeyStepFor({
    task: { state: STATES.CLAIMED },
    connected: true,
    wentToBuy: asksFor(OLD_CLAIM, WENT_TO_BUY),
    saidTheyBought: asksFor(OLD_CLAIM, SAID_THEY_BOUGHT),
  }) === 'purchase-shot', 'and the old claim still remembers what it did');
}

console.log('\n=== 5. and shopVisits.js really asks this file, with the claim ===');
{
  const code = withoutComments(read('src/journey/shopVisits.js'));
  ok(/import \{ noteNameFor \} from '\.\/noteNames\.js'/.test(code),
    'shopVisits takes the naming rule from here');
  ok(/return noteNameFor\(campaignId, getTaskId\(campaignId\), why\);/.test(code),
    'and hands it the claim, asked of the task store inside noteName');
  ok(!/`\$\{campaignId\}::/.test(code),
    'and keeps no second copy of the rule to drift from this one');
  // A NULL NAME IS NEVER LOOKED UP AND NEVER WRITTEN.
  ok(/if \(name == null\) return;/.test(code), 'an unnameable note is not written');
  ok(/return name != null && set\.has\(name\);/.test(code), 'and not looked for either');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
