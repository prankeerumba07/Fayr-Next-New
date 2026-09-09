// THE READ: WHAT IT REPORTS, AND WHAT IT MUST NEVER SAY.
//
// ── THE ONE THING THE OWNER IS ACTUALLY TESTING ────────────────────────────
//
// "can Fayr read his Amazon order history and come back with the ORDER NUMBER,
// the ORDER AMOUNT, the ORDER DATE and the PRODUCT NAME, matched to the campaign"
//
// THE PATH THAT DOES THAT ALREADY EXISTED AND NOTHING COULD REACH IT.
// src/order/LookingForItScreen.js reads the shop's own list of orders inside the
// web view and hands the TEXT to our side, which parses it and decides;
// src/order/IsThisYourOrderScreen.js shows what came back. Both were reachable
// only from src/screens/returncatch.js, so nobody arriving from "I have bought
// it" could get to either. The missing link was a navigation.
//
// ── AND THE SENTENCE THAT MUST NEVER BE SAID BY MISTAKE ────────────────────
//
// "We could not find your order" and "the shop is not letting us look right now"
// send a person to two different places, and only one of them is about their
// money. Every shop refusal used to collapse into the first.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readListOutcome } from '../orderhistory.js';
import { A_DEAD_END, A_PUZZLE, TOO_MANY_ASKS } from '../connect/shopRefusing.js';
import {
  NOTHING_IS_WRONG_WITH_YOUR_ORDER, SHOP_WILL_NOT_LET_US_LOOK, TAKING_LONGER,
  TRY_IN_A_FEW_MINUTES,
} from '../ui/journeyWords.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}
const tried = (fn) => { try { return fn(); } catch (e) { return 'THREW'; } };

console.log('=== 1. THE THREE FACES OF A SHOP SAYING NO, READ OFF THE PAGE ===');
{
  // All three measured from the owner's own log of 9 September 2026.
  const at = (answer) => tried(() => readListOutcome(answer).whyNot);

  ok(at({ ok: true, status: 503, html: '' }) === TOO_MANY_ASKS,
    'THE 503 AMAZON REALLY SENT is recognised');
  ok(at({ ok: true, status: 429, html: '' }) === TOO_MANY_ASKS,
    'and the same message said properly');
  ok(at({
    ok: true, status: 200,
    html: '<html><body>Click the button below to continue shopping</body></html>',
  }) === A_DEAD_END, 'THE DEAD END PAGE is recognised');
  ok(at({ ok: true, status: 200, html: '<html>Enter the characters you see</html>' })
    === A_PUZZLE, 'and the robot puzzle by its own words');
  ok(at({
    ok: true, status: 200,
    html: '<html><a href="/errors_page/validateCaptcha">x</a></html>',
  }) === A_PUZZLE, "AND BY AMAZON'S OWN PUZZLE ADDRESS, not just Flipkart's");
  ok(at({ ok: true, status: 200, html: '<html>/errors/validateCaptcha</html>' })
    === A_PUZZLE, 'and by Flipkart own, because both shops are real');

  // EVERY PUZZLE WORDING, NOT JUST THE FIRST. FOUND BY BREAKING THE CODE: this
  // section tested one phrase and the addresses, so half the wordings could be
  // deleted with everything green.
  for (const said of [
    'Enter the characters you see below',
    'Type the characters you see in this image',
    'Are you a human?',
    'I am not a robot',
    'we have detected unusual traffic from your network',
    'Please verify you are human to continue',
  ]) {
    ok(at({ ok: true, status: 200, html: `<html><body>${said}</body></html>` })
      === A_PUZZLE, `"${said}" is the puzzle`);
  }
}

console.log('\n=== 2. AND AN ORDINARY FAILURE IS NOT A REFUSAL ===');
{
  // This is the half that keeps the honest sentence honest. If everything read as
  // a refusal, "we could not find your order" would never be said at all — and
  // that IS the right thing to say when the list is simply empty.
  const at = (answer) => tried(() => readListOutcome(answer).whyNot);
  for (const ordinary of [
    { ok: false, status: 0, html: '' },
    { ok: true, status: 200, html: '' },
    { ok: true, status: 404, html: '<html>not found</html>' },
    { ok: true, status: 500, html: '<html>we broke</html>' },
    { ok: true, status: 200, html: '<div class="order-card">nothing parseable</div>' },
    {}, null, undefined,
  ]) {
    ok(at(ordinary) == null,
      `${JSON.stringify(ordinary) ?? String(ordinary)} is not the shop refusing`);
  }
  // ── THE TWO GUARDS ISOLATED, BECAUSE EACH WAS MASKING THE OTHER ─────────
  //
  // FOUND BY BREAKING THE CODE. This section had one long page carrying "Continue
  // shopping for more deals", which the exact-sentence pattern never matched and
  // the length guard rejected anyway. So EITHER guard could be deleted and every
  // check stayed green. Each now has a page built to isolate it.

  // ONLY THE LENGTH SAVES THIS ONE: long, and carrying the whole sentence. An
  // Amazon help page explaining the interruption would look like this.
  const longWithTheSentence = `<html><head><title>Help</title></head><body>
    <p>Click the button below to continue shopping if you arrived here by mistake.</p>
    ${'<span>Recommended for you in Electronics</span>'.repeat(120)}</body></html>`;
  ok(longWithTheSentence.length > 4000, '  (long, and carrying the whole sentence)');
  ok(at({ ok: true, status: 200, html: longWithTheSentence }) == null,
    'A LONG PAGE IS NOT THE DEAD END even carrying the exact sentence, because '
    + 'the page Amazon sent was one sentence and nothing else');

  // ONLY THE EXACT SENTENCE SAVES THIS ONE: short, and merely mentioning the
  // words. A shop's own empty-orders page could say this.
  const shortAndMerelyMentioning =
    '<html><body><p>You have no orders yet. Continue shopping.</p></body></html>';
  ok(shortAndMerelyMentioning.length < 4000, '  (short, and merely mentioning it)');
  ok(at({ ok: true, status: 200, html: shortAndMerelyMentioning }) == null,
    'AND A SHORT PAGE MERELY MENTIONING IT IS NOT THE DEAD END — that is a shop '
    + 'saying there are no orders, which is a real answer and not a refusal');

  const realOrders = `<html><body><div class="order-card">Order placed 12 August 2026
    Total 1,299.00 Delivered Wireless Earbuds Continue shopping for more deals
    ${'<span>Recommended for you</span>'.repeat(200)}</div></body></html>`;
  ok(realOrders.length > 4000, '  (a real orders page is long)');
  ok(at({ ok: true, status: 200, html: realOrders }) == null,
    'A REAL ORDERS PAGE saying "continue shopping" in it is not a refusal');
}

console.log('\n=== 3. and the old answer is unchanged, so nothing else broke ===');
{
  // `looked` and `blocks` are what the screen has always used. Adding `whyNot`
  // must not have moved either of them.
  const empty = readListOutcome({ ok: false, status: 0, html: '' });
  ok(empty.looked === false && Array.isArray(empty.blocks) && empty.blocks.length === 0,
    'a failed answer still looks at nothing');
  const refused = readListOutcome({ ok: true, status: 503, html: '' });
  ok(refused.looked === false, 'and so does a refusal');
  ok(Array.isArray(refused.blocks), 'and it still answers with a list of blocks');
}

console.log('\n=== 4. THE SCREEN STOPS AND SAYS SO, RATHER THAN ASKING FOR A PHOTOGRAPH ===');
{
  const screen = read('src/order/LookingForItScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok(/if \(outcome\.whyNot != null\) \{/.test(code),
    'the screen asks why it could not look');
  ok(/setRefused\(outcome\.whyNot\);\s*return;/.test(code),
    'AND STOPS THERE, rather than handing back to the screenshot flow');
  // THE ORDER OF THE TWO BRANCHES IS THE WHOLE POINT. The refusal has to be
  // asked BEFORE the silent hand-back, or it can never be reached.
  const refusedAt = code.indexOf('if (outcome.whyNot != null)');
  const handBackAt = code.indexOf('if (!outcome.looked)');
  ok(refusedAt !== -1 && handBackAt !== -1 && refusedAt < handBackAt,
    'and it is asked BEFORE the silent hand-back, or it could never be reached');

  // AND THE HARD LIMIT CANNOT REPLACE THE MESSAGE A SECOND LATER.
  ok(/stopTheClock\(\);\s*setRefused/.test(code),
    'the twenty second limit is stopped, so a refusal shown at nineteen seconds '
    + 'is not replaced by the journey at twenty');

  // EVERY WORD IS NAMED, NOT WRITTEN.
  for (const [name, sentence] of [
    ['SHOP_WILL_NOT_LET_US_LOOK', SHOP_WILL_NOT_LET_US_LOOK],
    ['NOTHING_IS_WRONG_WITH_YOUR_ORDER', NOTHING_IS_WRONG_WITH_YOUR_ORDER],
    ['TRY_IN_A_FEW_MINUTES', TRY_IN_A_FEW_MINUTES],
    ['TAKING_LONGER', TAKING_LONGER],
  ]) {
    ok(code.includes(name), `it names ${name}`);
    ok(!code.includes(sentence), `  and holds no copy of "${sentence}"`);
  }
  // AND IT NEVER NAMES THE SHOP. The owner's rule, and also the honest wording:
  // we asked twice in four minutes, and a shop that declines is being reasonable.
  for (const sentence of [
    SHOP_WILL_NOT_LET_US_LOOK, NOTHING_IS_WRONG_WITH_YOUR_ORDER,
    TRY_IN_A_FEW_MINUTES, TAKING_LONGER,
  ]) {
    ok(!/amazon|flipkart|meesho|myntra|blinkit|zepto|instamart/i.test(sentence),
      `"${sentence}" names no shop`);
  }
}

console.log('\n=== 5. IT IS SLOW AFTER TEN SECONDS AND DEAD AFTER TWENTY ===');
{
  const screen = read('src/order/LookingForItScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/export const SLOW_AFTER_MS = 10000;/.test(code),
    'ten seconds is the top of normal for this read, so that is where it says so');
  ok(/export const MOST_TIME_MS = 20000;/.test(code),
    'AND TWENTY IS THE HARD STOP, which the owner asked for by name');
  ok(/export const LEAST_TIME_MS = 1600;/.test(code),
    'and it is on screen long enough to have been seen');
  ok(/setTimeout\(\(\) => setSlow\(true\), SLOW_AFTER_MS\)/.test(code),
    'the slow line is on a clock of its own');
  ok(/\{slow \? <Text style=\{styles\.slow\}>\{TAKING_LONGER\}<\/Text> : null\}/.test(code),
    'and it is drawn under the turning line, not instead of it');
  // THE RULE THIS SCREEN HAS ALWAYS HAD. It must never say a shop account is
  // being looked at, and the slow line must not be the first thing to break it.
  ok(!/order|account|amazon|shop/i.test(TAKING_LONGER),
    'AND THE SLOW LINE SAYS NOTHING ABOUT WHAT IS HAPPENING');
}

console.log('\n=== 6. AND THE WHOLE PATH IS REACHABLE FROM "I HAVE BOUGHT IT" ===');
{
  // THE MISSING LINK, AND IT WAS ONE NAVIGATION. Both order screens existed and
  // were reachable only from src/screens/returncatch.js.
  const buy = read('src/screens/buyinterstitial.js');
  ok(/navigation\.navigate\('LookingForIt', \{ campaignId \}\)/.test(buy),
    'the buy screen sends them to the read');
  const app = read('App.js');
  ok(/name="LookingForIt"/.test(app) && /name="IsThisYourOrder"/.test(app),
    'and both screens are registered');
  const look = read('src/order/LookingForItScreen.js');
  ok(/moveOn\(matched\.length > 0 \? 'IsThisYourOrder' : 'Journey'\)/.test(look),
    'a match leads to "is this your order?", and nothing else does');

  // AND THE SCREENSHOT IS THE FALLBACK, NOT THE FIRST THING.
  // LookingForIt hands back to the journey ONLY when the read found nothing, and
  // the journey works its own step out from the record.
  const handBacks = (look.match(/moveOn\('Journey'\)/g) || []).length;
  ok(handBacks >= 1, 'the journey is handed back to when the read finds nothing');
  const code = look.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/screenshot|Screenshot|photo|Photo|proof|Proof/.test(code),
    'AND THIS SCREEN NEVER OFFERS A SCREENSHOT ITSELF, so it cannot be the first '
    + 'thing anybody is asked for');
}

console.log('\n=== 7. "CHECK AMAZON" CHECKS AMAZON ===');
{
  // He tapped it, got the "Continue shopping" page, and landed on Amazon's home
  // page. It navigated to the connect screen's route WITHOUT toSignIn, and
  // src/signin.js hands back the shop's own start page for a visit that is not a
  // sign in visit.
  const task = read('src/TaskScreen.js');
  // COMMENTS STRIPPED, and this is the THIRD check today that needed it. This
  // file explains what the old navigation did, and the first writing of the check
  // below read that explanation as the thing it forbids.
  const code = task.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/const goMarketplace = \(\) => navigation\.navigate\('LookingForIt', \{ campaignId \}\);/
    .test(code),
  'it now runs our own read instead of opening the shop front');
  ok(!/navigation\.navigate\(campaign\.marketplace, \{ campaignId \}\)/.test(code),
    'and the old navigation to the shop front is gone');
  // IT COSTS AMAZON ONE PAGE RATHER THAN A SIGN IN VISIT, which matters: every
  // visit to a sign in page brings the robot block closer.
  ok(!/toSignIn: true/.test(code),
    'and it asks for no sign in page, which is what brings the block closer');
}

console.log('\n=== 8. WHAT "MATCHED" MEANS, STATED WHERE THE RULE LIVES ===');
{
  // The owner: "THE MATCHING RULE IS THE PART MOST LIKELY TO FAIL, so state
  // plainly in the code what 'match' means". The rule is on our side, in
  // backend/src/ocr/order-comparison.ts, and the app must hold no second opinion.
  const api = read('src/backend/orderCandidatesApi.js');
  ok(/THIS CLIENT SENDS TEXT AND NOTHING ELSE/.test(api),
    'the phone sends text and never an opinion about what matched');
  const look = read('src/order/LookingForItScreen.js');
  const code = look.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // IT READS THE SERVER'S ANSWER AND NEVER COMPUTES ONE.
  ok(/o\.matches === true/.test(code),
    'and it reads the server own `matches`, never working one out');
  for (const noSecondOpinion of [
    'sameProductName', 'toLowerCase().includes', 'matchOrder', 'productName ===',
  ]) {
    ok(!code.includes(noSecondOpinion),
      `and it does not ${noSecondOpinion} — a second opinion is the defect class`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
