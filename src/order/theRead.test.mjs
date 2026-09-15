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

import { landedPath, readDetailOutcome, readListOutcome } from '../orderhistory.js';
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

console.log('\n=== 4b. THE SHOP WANTS A SIGN IN: SENT BACK, NOT ASKED FOR A PHOTOGRAPH ===');
{
  // MEASURED, AND IT IS THE NORMAL CASE ON AMAZON. /your-orders redirects to
  // ap/signin?openid.pape.max_auth_age=0 — a demand for a FRESH password, which
  // the review and profile pages never make.
  //
  // THE FETCH FOLLOWS REDIRECTS, so the wall arrives as a 200 carrying the sign
  // in page and is indistinguishable from a real page by its status. The final
  // address is the only honest signal, which is why the script reports it.
  const at = (url) => tried(() => readListOutcome({
    ok: true, status: 200, html: '<html>sign in</html>', url,
  }).wantsSignIn);

  ok(at('https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0') === true,
    'THE REAL RE-AUTH WALL is recognised');
  ok(at('https://www.amazon.in/gp/sign-in.html') === true,
    "and Amazon's other sign in address");
  ok(at('https://www.flipkart.com/login') === true,
    'and another shop own, where its sign in sits at the top of the address');

  // ── AN HONEST LIMIT, RECORDED RATHER THAN PAPERED OVER ──────────────────
  //
  // SIGN_IN_PATH is anchored at the start of the path, deliberately, so a
  // shopping page merely holding one of those words cannot match. The cost is
  // that a shop whose sign in sits UNDER a prefix is not recognised:
  // /account/login does not match.
  //
  // It does not matter today. Amazon's two are /ap/signin and /gp/sign-in.html,
  // and both match; Amazon is the only shop whose order list this read is being
  // tested against. It WILL matter when the other shops are wired, and the fix
  // then is to widen SIGN_IN_PATH in one place with its own measured addresses —
  // not to add a second idea of a sign in page here.
  ok(at('https://www.flipkart.com/account/login') === false,
    'AND A SIGN IN UNDER A PREFIX IS NOT RECOGNISED, which is a real limit of the '
    + 'shared pattern and is written down rather than worked around here');

  // AND IT CANNOT MISTAKE A REAL PAGE FOR A WALL.
  for (const ordinary of [
    'https://www.amazon.in/your-orders/orders?_encoding=UTF8',
    'https://www.amazon.in/',
    'https://www.amazon.in/gp/your-account/order-details?orderID=403-1234567-8901234',
    'https://www.amazon.in/dp/B0F16X1NQ7',
    'not a url', '', null, undefined,
  ]) {
    ok(at(ordinary) === false,
      `${JSON.stringify(ordinary) ?? String(ordinary)} is not a sign in wall`);
  }

  // IT USES THE ONE EXISTING VOCABULARY, not a second idea of a sign in page.
  const hist = read('src/orderhistory.js');
  ok(/import \{ SIGN_IN_PATH \} from '\.\/connect\/pageQuestions\.js'/.test(hist),
    'the path test is the one the connect flow already uses');
  ok(/new RegExp\(SIGN_IN_PATH\)\.test\(path\)/.test(hist),
    'and it is applied to the path, which is what that pattern is anchored on');

  // AND THE SCRIPT REPORTS WHERE IT ENDED UP, or none of this can work.
  ok(/url: r\.url/.test(hist), 'the injected script reports the final address');
  ok(/send\(\{ ok:true, status:p\.status, html:p\.html, url:p\.url \}\)/.test(hist),
    'and posts it back');

  const screen = read('src/order/LookingForItScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/if \(outcome\.wantsSignIn === true\) \{/.test(code),
    'the screen asks whether the shop wants a sign in');
  ok(/setNeedsSignIn\(true\);\s*return;/.test(code),
    'AND STOPS, rather than handing back to the screenshot flow');
  // ASKED FIRST, because it is the one outcome with something to DO about it.
  const signInAt = code.indexOf('if (outcome.wantsSignIn === true)');
  const refusedAt = code.indexOf('if (outcome.whyNot != null)');
  const handBackAt = code.indexOf('if (!outcome.looked)');
  ok(signInAt !== -1 && signInAt < refusedAt && refusedAt < handBackAt,
    'and it is asked BEFORE the refusal and before the hand-back');
  // AND IT SENDS THEM TO A SIGN IN VISIT, which is the whole difference.
  ok(/toSignIn: true,/.test(code),
    'SENT BACK AS A SIGN IN VISIT, not a reading visit — that flag is the whole '
    + 'difference between the shop own sign in page and its shop front');
  ok(code.includes('SHOP_WANTS_A_SIGN_IN') && code.includes('THEN_WE_CAN_LOOK'),
    'and it names its words rather than holding copies');
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

console.log('\n=== 9. THE READ RAN SIGNED OUT, AND THAT WAS THE WHOLE OF IT ===');
{
  // ── WHAT FIVE DAYS OF "IT FETCHED NOTHING" ACTUALLY WAS ──────────────────
  //
  // The shape report of 15 September 2026, on a page the look had just fetched:
  //
  //   bytes=374257 tags=877 attrNames=2377 dataShapes=103
  //   words order-card=0 yourorders=2 orderCard=0 a-box-group=0 your-orders=8
  //   shape 23x data-csa-c-slot-id="nav_cs_##"
  //   shape  1x data-nav-role="signin"
  //
  // Eight hundred and seventy seven tags in three hundred and seventy four
  // kilobytes is a page that is almost all script, every slot id on it belongs to
  // Amazon's top navigation, and there is a sign in control on it. That is the
  // home page shell Amazon serves somebody it does not recognise. THE MARKUP HAD
  // NOT MOVED. The read was running in a web view that had never been handed the
  // login src/ConnectScreen.js saves.
  const screen = read('src/order/LookingForItScreen.js');

  ok(/import \{ restoreSession \} from '\.\.\/session';/.test(screen),
    'THE READ PUTS THE SHOP SESSION BACK. Without it the fetch asks as a stranger '
    + 'and the shop answers with the page it gives a stranger, which is what it did');
  ok(/restoreSession\(platform\.key, platform\.startUrl\)/.test(screen),
    'and it asks for it the same way the connect screen does, rather than a second '
    + 'idea of what a session is');

  // AND IT WAITS. A restore that has not finished is a restore that did not
  // happen, and the fetch would be out of the door before the cookie was in.
  ok(/const \[sessionReady, setSessionReady\] = useState\(false\);/.test(screen),
    'it holds a word for whether the session is back yet');
  ok(/if \(!sessionReady\) return undefined;/.test(screen),
    'AND NOTHING STARTS UNTIL IT IS. Not the timers and not the first fetch');
  ok(/\{job && sessionReady \? \(/.test(screen),
    'and the view itself cannot mount before it either, so there is no order in '
    + 'which the shop gets asked first');

  // THE GATE IS BEFORE THE CLOCK AND NOT AFTER IT. A look whose twenty seconds
  // were spent reading a snapshot off the phone is a look with less time for the
  // shop — the same mistake the connect screen made with its own fifteen.
  const body = screen.slice(screen.indexOf('if (!sessionReady) return undefined;'));
  const startsCounting = body.indexOf('const startedAt = Date.now();');
  ok(startsCounting > 0 && startsCounting < body.indexOf('const giveUp'),
    'and the clock starts after the session is in, so the budget is for the shop');

  // ── AND IT DELIBERATELY DOES NOT SAVE ONE ────────────────────────────────
  //
  // This screen creates no session, so it has nothing to save the connect screen
  // did not already save — and this bug proves it can land signed out, so a save
  // here would sometimes write a stranger's page over a working login and sign
  // somebody out of their own shop. ConnectScreen guards the identical hazard in
  // its own words: a failed load must not save a signed out snapshot over a good
  // one. A decision, asserted so it cannot be undone by accident.
  ok(!/persistSession/.test(screen),
    'THE READ NEVER SAVES A SESSION. It creates none, and it can land signed out, '
    + 'so saving from here could overwrite a good login with a stranger’s page');
  ok(/ConnectScreen/.test(screen) && /signed out/i.test(screen),
    'and the reason is written down in the screen rather than left to be guessed');
}

console.log('\n=== 10. AND THE LINE SAYS WHICH PAGE IT LANDED ON ===');
{
  // ONE FIELD, AND IT WOULD HAVE ENDED THIS IN ONE RUN. Every line written over
  // five days said status=200, a real byte count, whyNot=null and
  // wantsSignIn=false — all true, and all of them about the wrong page. The
  // address was already being fetched and carried all the way back here.
  const screen = read('src/order/LookingForItScreen.js');
  ok(/landed=\$\{outcome\.landed == null \? 'null' : outcome\.landed\}/.test(screen),
    'the list line says which page the fetch really landed on');

  // THE PATH AND NEVER THE QUERY, because a shop's address carries tokens in it
  // and this goes into a log that gets pasted.
  const withToken = 'https://www.amazon.in/gp/css/order-history?ref=x&token=SECRETVALUE';
  ok(landedPath(withToken) === '/gp/css/order-history',
    'and it is the path only');
  ok(!String(landedPath(withToken)).includes('SECRETVALUE'),
    'SO NOTHING FROM THE QUERY SURVIVES, which is where a shop puts a token');
  ok(!String(landedPath(withToken)).includes('?'),
    'and there is no question mark left to have anything after it');

  ok(landedPath('https://www.amazon.in/') === '/', 'a bare address is the root');
  for (const nothing of ['', null, undefined, 'not a url', 42, {}]) {
    ok(landedPath(nothing) === null,
      `${JSON.stringify(nothing) ?? String(nothing)} has no path, and says so rather than guessing`);
  }

  // AND THE OUTCOME CARRIES IT, which is the part that was being thrown away.
  const home = readListOutcome({
    ok: true, status: 200, html: '<html></html>', url: 'https://www.amazon.in/?ref=nav',
  });
  ok(home.landed === '/',
    'THE HOME PAGE SHELL READS AS "/" — the one line that would have said, on day '
    + 'one, that we were not on the orders page at all');
  const orders = readListOutcome({
    ok: true, status: 200, html: '<html></html>', url: 'https://www.amazon.in/gp/css/order-history?x=1',
  });
  ok(orders.landed === '/gp/css/order-history', 'and a real orders page reads as its own path');
  ok(readListOutcome({ ok: true, status: 200, html: '' }).landed === null,
    'and an answer with no address at all says nothing rather than something');

  // AND IT SURVIVES THE EARLY RETURNS, which is where it is needed most. A
  // refusal and a sign in wall both hand back before anything is read, and
  // "which page was that?" is exactly the question those two raise.
  const wall = readListOutcome({
    ok: true, status: 200, html: '<html></html>', url: 'https://www.amazon.in/ap/signin?x=1',
  });
  ok(wall.wantsSignIn === true && wall.landed === '/ap/signin',
    'a sign in wall still says which page it was');
  const refused = readListOutcome({
    ok: false, status: 503, html: '', url: 'https://www.amazon.in/gp/css/order-history',
  });
  ok(refused.whyNot != null && refused.landed === '/gp/css/order-history',
    'and so does a shop that refused');

  // THE ORDER PAGE READ GETS IT FROM THE SAME PLACE, so the two cannot end up
  // with different ideas of where they landed. It is one field on the shared
  // reader rather than a copy in each.
  const detail = readDetailOutcome({
    ok: true, status: 200, html: '<html></html>',
    url: 'https://www.amazon.in/gp/your-account/order-details?orderID=1',
  });
  ok(detail.landed === '/gp/your-account/order-details',
    'the order page read reports its landing too, from the one shared reader');
}

console.log('\n=== 11. THE LOOK GOES TO THE PAGE, AND STAYS THERE WHILE IT READS ===');
{
  const screen = read('src/order/LookingForItScreen.js');
  const code = screen
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // ── THE BUG THAT MEANT NO ORDER PAGE HAS EVER REACHED THE SERVER ────────
  //
  // onMessage cleared `job`; the web view was rendered on `job`; so the FIRST
  // answer unmounted the only view there was, and askAgain — which begins by
  // asking whether the view is still there — resolved null for every order page
  // after it. Every one of them read as "nothing on this page", the loop ran to
  // the end, and the person was asked for a photograph. It was written under a
  // comment promising one mount for the whole look.
  ok(!/setJob\(null\)/.test(code),
    'THE VIEW MUST NOT BE TORN DOWN ON THE FIRST ANSWER: every order page after '
    + 'it resolves null against a ref that has gone');
  ok(/if \(!web\.current\) \{ resolve\(null\); return; \}/.test(code),
    'and the guard that made it silent is still there, now that it is reachable');

  // WHERE THE VIEW GOES IS THE STEP'S ANSWER, not this screen's. A shop that
  // draws its own list is opened AT the list; the rest keep the front door and
  // the fetch. The screen may not know which is which — it may not write a
  // shop's name anywhere — so it asks.
  ok(/openTheListWith\(/.test(code), 'the screen asks where to go rather than deciding');
  ok(/source=\{\{ uri: job\.uri \}\}/.test(code), 'and points the view at the answer');
  ok(/injectedJavaScript=\{job\.script\}/.test(code), 'and runs the script that came with it');
  ok(!/source=\{\{ uri: platform\.startUrl \}\}/.test(code),
    'and the front door is no longer wired straight into the view');

  // AND AN ANSWER HAS TO BE OURS. The view sits on the shop's own page now.
  ok(/isOurAnswer\(payload, answerTag\.current\)/.test(code),
    'every message is checked against this look\u2019s own name');
  const handler = (code.match(/const onMessage[\s\S]*?\}, \[\]\);/) || [''])[0];
  ok(handler.indexOf('isOurAnswer') < handler.indexOf('waiting.current = null'),
    'and it is asked BEFORE the waiter is cleared, or a stranger loses the answer');
  ok(!/nativeEvent: \{ data: '\{"ok":false/.test(code),
    'and nothing on our own side pretends to be the page any more');

  // A PAGE CANNOT SEE ITS OWN STATUS CODE. The view says instead.
  ok(/onHttpError=/.test(code) && /httpStatus\.current/.test(code),
    'the view reports a failing status for the page it was sent to');
  ok(/answerWithStatus\(payload, httpStatus\.current\)/.test(code),
    'and it is put back into the answer on our side, where it can be checked');

  // AND IT IS NOT IN ANYBODY'S WAY. One point across, see through, off the side
  // of the screen — and now holding somebody's own orders.
  ok(/accessibilityElementsHidden/.test(code), 'it is out of the reading order');
  ok(/importantForAccessibility="no-hide-descendants"/.test(code), 'and everything in it');
}

console.log('\n=== 12. every reader is told WHICH SHOP, and told it by the screen ===');
{
  const screen = read('src/order/LookingForItScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ── THE HAZARD THIS CLOSES ───────────────────────────────────────────────
  //
  // Two shops are now read this way and each has its own number shape and its
  // own address. A reader called without the shop reads the page with NOTHING —
  // there is no default shop next door, deliberately — and a reader called with
  // the WRONG shop reads it with somebody else's shapes. The second is the one
  // that would be silent, and the screen is the only place that knows which.
  //
  // The screen may not write a shop's NAME (src/ui/funnyWait.test.mjs holds it
  // to that on every piece of text in the file), so the only thing it can pass
  // is the key it was handed. These lines say it really does.
  for (const [call, why] of [
    [/harvestRendered\(html, platformKey\)/, 'the ladder is told which shop'],
    [/pagesToOpen\(harvest\.numbers, platformKey\)/, 'and so is the cap that refuses off-shape numbers'],
    [/orderDetailPageFor\(platformKey, numbers\[i\]\)/, 'and so is the thing that builds an address'],
  ]) ok(call.test(code), why);
  const slots = (code.match(/countOrderCardSlots\(html, platformKey\)/g) || []).length;
  ok(slots === 3,
    `and all three card counts are told too (${slots}) — the line that tells the two `
    + 'empty answers apart, and the two shape reports under it');
  ok(!/countOrderCardSlots\(html\)/.test(code),
    'and not one of them is left asking without a shop');

  // AND THE KEY IS THE ONE THE SCREEN WAS GIVEN, never one it made up.
  ok(/const \{ platform[\s\S]{0,400}?platformKey/.test(screen)
    || /platformKey = /.test(code),
  'and platformKey is derived from what the screen was handed');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
