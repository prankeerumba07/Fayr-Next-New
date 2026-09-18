// THE POP-UP, THE CLOCK, AND THE ONE MESSAGE RULE, CHECKED UNDER NODE.
//
// Two halves, and the second is the one the owner asked for by name.
//
// THE PURE HALF puts the notice and the clock through moments a phone cannot be
// made to produce on demand: a task nobody took to the shop, a hold that ended a
// millisecond ago, a server that answered without the words in it.
//
// THE STRUCTURAL HALF READS THE SCREENS OFF DISK and asserts his rule: "There
// should not be any different messages for the same campaign on different
// pages." A rule nothing checks is a rule that lasted until the next screen.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countdownFor, holdIsOver, messageText, noticeFromTask } from './theNotice.js';
import { theSentenceTheyGaveUs } from './refusal.js';
import {
  COULD_NOT_START, EVERY_SENTENCE, HAVE_YOU_BOUGHT_IT, NOTHING_WAS_SPENT,
  NOT_YET, TIME_IS_UP, TRY_AGAIN, YES_I_HAVE, takeMeThere, timeLeftInWords,
} from '../ui/journeyWords.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/** One fixed moment, so nothing here depends on the real clock. */
const TAPPED = Date.UTC(2026, 8, 8, 6, 0);
const ENDS = TAPPED + 2 * 60 * 60 * 1000;
const iso = (t) => new Date(t).toISOString();

const NOTICE_TEXT = [
  'You have 2 hours',
  'Buy the product at Amazon, then come back here and tell us.',
  'Your place is held until 1:30 pm today.',
  'If you do not come back by then, this offer goes to somebody else. '
  + 'We cannot pay you after that, even if you bought the product.',
].join('\n\n');

const WENT = {
  wentToShopAt: iso(TAPPED),
  shopHoldEndsAt: iso(ENDS),
  shopVisitNoticeText: NOTICE_TEXT,
  message: {
    key: 'wentToShop',
    short: 'You went to Amazon. Tell us when you have bought it.',
    long: 'You went to Amazon. Tell us when you have bought it. '
      + 'Your place is held until 1:30 pm today. '
      + 'We cannot pay you after that, even if you bought the product.',
  },
};

console.log('=== 1. the pop-up comes from the server and nowhere else ===');
{
  const built = noticeFromTask(WENT, 'Amazon');
  ok(built != null, 'a recorded tap with words has a notice');
  ok(built.lines.length === 4, 'every paragraph the server sent is drawn');
  ok(built.lines[0] === 'You have 2 hours', 'the first line is the server own heading');
  ok(built.lines.join(' ').includes('1:30 pm today'),
    'THE REAL CLOCK TIME IS IN IT, because the server put it there');
  ok(built.button === 'OK, take me to Amazon', 'and the one button is named for the shop');
  ok(!built.lines.some((l) => l.includes('{')),
    'no line carries a placeholder, which would mean a template shipped as a promise');
}

console.log('\n=== 2. and NO notice at all when there is nothing to show ===');
{
  ok(noticeFromTask(null, 'Amazon') === null, 'no task, no notice');
  ok(noticeFromTask({}, 'Amazon') === null, 'no recorded tap, no notice');
  ok(noticeFromTask({ ...WENT, wentToShopAt: null }, 'Amazon') === null,
    'a task nobody took to the shop has no notice, whatever else it carries');
  ok(noticeFromTask({ ...WENT, shopVisitNoticeText: null }, 'Amazon') === null,
    'RECORDED BUT WORDLESS IS STILL NO NOTICE. A pop-up this side filled in itself '
    + 'is the one thing forbidden, so the answer is nothing');
  ok(noticeFromTask({ ...WENT, shopVisitNoticeText: '   ' }, 'Amazon') === null,
    'and whitespace is not words');
  ok(noticeFromTask(WENT, '').button === null,
    'with no shop name there is no button label, rather than a made up one');
}

console.log('\n=== 3. the clock is honest, and never counts what has not started ===');
{
  ok(countdownFor(WENT, TAPPED) === '2 hours left', 'at the tap there are two hours');
  ok(countdownFor(WENT, TAPPED + 60 * 60 * 1000) === '1 hour left', 'an hour in, an hour left');
  ok(countdownFor(WENT, ENDS - 60 * 1000) === '1 minute left', 'a minute before the end');
  ok(countdownFor(WENT, ENDS) === TIME_IS_UP, 'at the end there is no time left');
  ok(countdownFor(WENT, ENDS + 1) === TIME_IS_UP, 'and past the end it stays that way');
  ok(countdownFor({}, TAPPED) === null,
    'NEVER A COUNTDOWN FOR A TASK WITH NO RECORDED TAP, which is the owner own rule');
  ok(countdownFor({ wentToShopAt: iso(TAPPED) }, TAPPED) === null,
    'a tap with no hold counts nothing either, because half a row is not a hold');
  // FOUND BY BREAKING THE CODE ON PURPOSE. The check above tested a tap with no
  // hold, and this file never tested the OTHER half: a hold with no tap. So the
  // guard that reads wentToShopAt could be deleted and every check still passed,
  // which is exactly the rule the owner named -- never a countdown for a task
  // with no recorded tap.
  ok(countdownFor({ shopHoldEndsAt: iso(ENDS) }, TAPPED) === null,
    'A HOLD WITH NO RECORDED TAP COUNTS NOTHING, which is the half this check missed');
  ok(noticeFromTask({ shopHoldEndsAt: iso(ENDS), shopVisitNoticeText: NOTICE_TEXT }, 'Amazon')
    === null,
    'and a hold with no recorded tap gets no pop-up either');
  ok(countdownFor({ ...WENT, shopHoldEndsAt: 'not a date' }, TAPPED) === null,
    'and a date we cannot read counts nothing rather than guessing');
}

console.log('\n=== 4. is the hold over ===');
{
  ok(holdIsOver(WENT, ENDS) === false, 'at two hours exactly it is not over');
  ok(holdIsOver(WENT, ENDS + 1) === true, 'a millisecond later it is');
  ok(holdIsOver({}, ENDS + 1) === false,
    'a task that never started is NOT over, or an offer somebody could still act on closes');
}

console.log('\n=== 5. ONE MESSAGE, TWO LENGTHS, AND NO THIRD FORM ===');
{
  ok(messageText(WENT, 'short') === WENT.message.short, 'the short form is read, not rebuilt');
  ok(messageText(WENT, 'long') === WENT.message.long, 'and so is the long form');
  ok(WENT.message.long.startsWith(WENT.message.short),
    'THE SHORT FORM IS THE LONG FORM OWN OPENING, which is the whole rule');
  ok(messageText(WENT, 'medium') === null,
    'there is no third form, and an unknown one answers nothing rather than falling back');
  ok(messageText({}, 'short') === null, 'a task with no message has no message');
  ok(messageText(null, 'long') === null, 'and neither does no task');
}

console.log('\n=== 6. the clock words, including the ones that read wrong ===');
{
  ok(timeLeftInWords(60 * 1000) === '1 minute left', 'ONE MINUTE, NOT 1 MINUTES');
  ok(timeLeftInWords(2 * 60 * 1000) === '2 minutes left', 'and two minutes is plural');
  ok(timeLeftInWords(60 * 60 * 1000) === '1 hour left', 'one hour, not 1 hours');
  ok(timeLeftInWords(90 * 60 * 1000) === '1 hour and 30 minutes left', 'an hour and a half');
  ok(timeLeftInWords(61 * 60 * 1000) === '1 hour and 1 minute left',
    'and the one that would read worst of all is right');
  ok(timeLeftInWords(30 * 1000) === '1 minute left',
    'HALF A MINUTE ROUNDS UP, because somebody reading zero would stop trying');
  ok(timeLeftInWords(0) === TIME_IS_UP, 'zero is its own answer and not a count');
  ok(timeLeftInWords(-5) === TIME_IS_UP, 'and so is past zero');
  ok(timeLeftInWords(undefined) === TIME_IS_UP, 'and nothing at all');
}

console.log('\n=== 7. THE THREE PLACES READ THE ONE RECORD ===');
{
  // THE OWNER'S OWN RULE, CHECKED BY READING THE FILES. Each of the three has to
  // take its words from `message`, and none may hold those sentences itself.
  const bar = read('src/ui/waiting.js');
  const list = read('src/ui/tasklist.js');
  const row = read('src/MyProductsScreen.js');
  const opened = read('src/TaskScreen.js');

  ok(/task\.message/.test(bar),
    'the bar above the navigation reads task.message');
  ok(/status: fromServer \|\| words\.status/.test(bar),
    'and what the server said WINS over this file own wording');
  ok(/sent\.short/.test(list) && /sent\.long/.test(list),
    'the My Products list carries both forms off the record');
  ok(/row\.messageShort/.test(row),
    'the row draws the SHORT form');
  ok(/messageText\(authoritative, 'long'\)/.test(opened),
    'the opened screen draws the LONG form');
  ok(/countdownFor\(authoritative, now\)/.test(opened),
    'and its clock comes from the authoritative task, not the optimistic one');
  // WHY authoritative AND NOT task: src/taskStore.js builds the optimistic task
  // from a hand written whitelist that does not carry these fields, so reading
  // `task` here would silently show nothing for ever.
  ok(/wentToShopAt/.test(read('src/taskStore.js')) === false,
    'the optimistic whitelist does NOT carry these fields, which is why the '
    + 'screens read the authoritative task');
}

console.log('\n=== 8. AND NO SCREEN WRITES THOSE SENTENCES ITSELF ===');
{
  // The four sentences the server owns. If any screen holds one as a literal,
  // there are two sources for one message and they will drift.
  const SERVER_OWNS = [
    'Tell us when you have bought it',
    'Your two hours have run out',
    'We could not find your order',
    'We found your order',
  ];
  const SCREENS = [
    'src/ui/waiting.js', 'src/ui/tasklist.js', 'src/ui/stages.js',
    'src/MyProductsScreen.js', 'src/TaskScreen.js', 'src/ui/WaitingBox.js',
    'src/screens/buyinterstitial.js',
  ];
  for (const file of SCREENS) {
    const source = read(file);
    // Comments are stripped first: these files EXPLAIN the rule at length, and a
    // rule explained in a comment must not read as a breach of itself.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const sentence of SERVER_OWNS) {
      ok(!code.includes(sentence),
        `${file} does not write "${sentence}" itself`);
    }
  }
}

console.log('\n=== 9. the words the SCREEN owns are all in one file ===');
{
  // FORTY-FOUR SINCE 18 SEPTEMBER 2026, AND THE COUNT IS THE POINT OF IT.
  //
  // Twenty until the review half of the journey was written down at length in
  // REVIEW-FLOW-PROMPT.md, which put twenty six more sentences in front of a
  // person: the delivery question, the celebration, the day the review step was
  // shut for, the shop's own waiting period, the two answers under it, and the
  // three that say the money has moved.
  //
  // TWO CAME BACK OUT ON 18 SEPTEMBER 2026, and this is the first count in this
  // file that has ever gone DOWN. The owner removed the twenty-four hour lock on
  // the review step, so the two sentences that promised the wait —
  // "This opens one day after your product arrives." and "Use the product first.
  // We open this by itself when the day is up." — describe a rule the app no
  // longer has. They are deleted rather than reworded: there is nothing left for
  // them to say.
  //
  // A NUMBER AND NOT A "MORE THAN", so that adding a sentence — or removing one
  // — is something somebody has to come here and think about. That is the same
  // reason the look log's call sites are counted rather than bounded.
  ok(EVERY_SENTENCE.length === 44, `the list of them is complete (${EVERY_SENTENCE.length})`);
  // AND NEITHER OF THE TWO IS ANYWHERE IN THE APP'S WORDS ANY MORE.
  for (const gone of [
    'This opens one day after your product arrives.',
    'Use the product first. We open this by itself when the day is up.',
  ]) {
    ok(!EVERY_SENTENCE.includes(gone), `the app no longer says "${gone}"`);
  }
  for (const sentence of EVERY_SENTENCE) {
    ok(typeof sentence === 'string' && sentence.trim() !== '',
      `"${sentence}" is a real sentence`);
  }
  const screen = read('src/screens/buyinterstitial.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(code.includes('COULD_NOT_START') && !code.includes(COULD_NOT_START),
    'the buy screen NAMES the refusal sentence rather than holding a copy of it');
  ok(!code.includes(NOTHING_WAS_SPENT), 'and the same for the second half of it');
  ok([HAVE_YOU_BOUGHT_IT, YES_I_HAVE, NOT_YET, TRY_AGAIN, takeMeThere('Amazon')]
    .every((s) => EVERY_SENTENCE.includes(s)),
  'every word a person reads on these screens is in the walked list');
}

console.log('\n=== 10. THE SHOP DOES NOT OPEN UNLESS OUR SIDE RECORDED IT ===');
{
  const screen = read('src/screens/buyinterstitial.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/const answer = await goingToTheShop\(taskId\);/.test(code),
    'tapping Buy asks our own side first');
  const askIdx = code.indexOf('await goingToTheShop');
  const openIdx = code.indexOf('await openShopApp');
  ok(askIdx !== -1 && openIdx !== -1 && askIdx < openIdx,
    'and it asks BEFORE anything opens');
  ok(/if \(!answer \|\| !answer\.ok \|\| !answer\.task\) \{\s*setRefusal\(theSentenceTheyGaveUs\(answer\)\);\s*setCouldNotStart\(true\);\s*return;/
    .test(code),
    'A FAILED CALL RETURNS AND OPENS NOTHING, because a visit our side does not '
    + 'know about can never be paid');
  ok(/if \(built == null\) \{\s*setRefusal\(null\);\s*setCouldNotStart\(true\);\s*return;/.test(code),
    'and a recorded visit with no words is treated the same way, rather than '
    + 'drawing a pop-up of our own');
  // THE ONE WAY OUT. openShopApp must be reachable from exactly one place.
  ok((code.match(/openShopApp\(/g) || []).length === 1,
    'the shop is opened from exactly one place in this file');
  // ── AND IT OPENS THE SHOP BEFORE IT TAKES THE POP-UP DOWN ──────────────
  //
  // Measured on the owner's phone, 16 September 2026: this button did nothing at
  // all, while the SAME call from the review step opened Amazon. The difference
  // is that this one is inside a Modal, and pulling the Modal down in the same
  // tick that asks iOS to leave swallows the open. So the order is reversed, and
  // the dismissal is in a finally — because leaving somebody under a pop-up they
  // have already answered is worse than the shop not opening.
  //
  // UPDATED 18 SEPTEMBER 2026, AND NOT LOOSENED. A shop listed in
  // src/shop/insideFayr.js now opens INSIDE Fayr instead, which is a branch
  // ABOVE this one, so the try/finally is no longer the first thing in the
  // callback. What the measured rule actually pins is the try/finally itself —
  // the shop asked for first, the dismissal in a finally — and that is pinned
  // exactly as before. The callback is still checked for by name, so this cannot
  // pass by it having been renamed or removed.
  ok(/const leaveForTheShop = useCallback\(async \(\) => \{/.test(code),
    'the notice own button is still the one callback');
  ok(/try \{\s*await openShopApp\(key, opens\);\s*\} finally \{\s*setNotice\(null\);\s*theyReallyWent\(\);\s*\}/
    .test(code),
    'and that place is the notice own button, which opens the shop BEFORE it '
    + 'dismisses itself');
  // ── AND THE OTHER PATH IS THE OPPOSITE WAY ROUND, ON PURPOSE ────────────
  //
  // The measured bug above is a Modal dismissal in flight swallowing a request
  // to LEAVE THE APP. Going to one of Fayr's own screens asks the phone for
  // nothing, so there is nothing for a dismissal to swallow — and pushing a
  // screen while the Modal is still up would put the shop behind the pop-up. So
  // that branch takes the notice down FIRST, and the two orders are opposite for
  // a reason rather than by accident.
  ok(/if \(shopsInsideFayr\(key\)\) \{\s*setNotice\(null\);\s*navigation\.navigate\('Shop', \{ campaignId, marketplace: key \}\);\s*theyReallyWent\(\);\s*return;\s*\}/
    .test(code),
    'a listed shop takes the pop-up down first, then goes to Fayr own shop screen');

  // ── AND THE NOTE THAT SAYS "THEY WENT" IS WRITTEN WHEN THEY GO ───────────
  //
  // MEASURED 18 SEPTEMBER 2026, and it is the whole reason the owner never once
  // reached the shop inside Fayr. markVisitedShop(WENT_TO_BUY) used to be called
  // in openTheirApp, one line before the pop-up was raised. The journey's router
  // reads that note and turns it straight into a different step, JourneyScreen
  // re-renders on the store notify that the same callback had just caused, and
  // its stage is keyed on the design key — so THIS SCREEN WAS UNMOUNTED, taking
  // the Modal that holds the only way into the shop with it, in the same flush
  // that created it.
  //
  // His backend log: 15:43:36 claim, 15:43:43 going-to-the-shop, 15:43:47 the
  // order read. Four seconds, and no [fayr-shop] line anywhere in the run.
  //
  // SO IT IS WRITTEN IN ONE PLACE AND THAT PLACE IS THE DEPARTURE.
  ok((code.match(/markVisitedShop\(campaignId, WENT_TO_BUY\)/g) || []).length === 1,
    'the note is written in exactly one place');
  ok(/const theyReallyWent = useCallback\(\(\) => \{\s*if \(campaignId\) markVisitedShop\(campaignId, WENT_TO_BUY\);/
    .test(code),
    'and that place is its own callback, named for what it records');
  const recordsTheVisit = code.slice(code.indexOf('const openTheirApp = useCallback'),
    code.indexOf('const theyReallyWent = useCallback'));
  ok(!recordsTheVisit.includes('markVisitedShop'),
    'the callback that RECORDS the visit no longer writes it, which is the fix');
  ok(!recordsTheVisit.includes('theyReallyWent'),
    'and does not call the one that does');

  // ── AND THERE IS A WAY BACK IN, FOR A SHOP THAT IS INSIDE FAYR ───────────
  //
  // The second half of the same run. The pop-up is raised once, by the tap our
  // side keeps; anything interrupting the moment between the two — a reload, the
  // phone being put down — left somebody with a recorded visit and no route to
  // the shop at all.
  ok(/const backIntoTheShop = useCallback\(\(\) => \{\s*navigation\.navigate\('Shop', \{ campaignId, marketplace: key \}\);\s*theyReallyWent\(\);/
    .test(code),
    'a second door goes back into the shop and records the same note');
  ok(/\{shopsInsideFayr\(key\) \? \(\s*<Pill onPress=\{backIntoTheShop\}/.test(code),
    'and it is only drawn for a shop that shops inside Fayr');
  ok(/onRequestClose=\{\(\) => \{\}\}/.test(code),
    'THERE IS NO WAY PAST THE NOTICE: the phone own back control does nothing');
  ok(!/onDismiss|onBackdropPress|closeOnOverlay/.test(code),
    'and nothing dismisses it by tapping outside or swiping');
}

console.log('\n=== 11. AND THE BUY SCREEN CHANGES AFTER THEY HAVE GONE ===');
{
  // THE BUG THIS SECTION EXISTS FOR. The owner tapped Buy, went to Amazon, came
  // back to Fayr and saw the same screen with the same "OPEN AMAZON" button. The
  // new message was on Home and in My Products, and this was the one place he was
  // actually standing.
  const screen = read('src/screens/buyinterstitial.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // WATCHED, NOT READ ONCE. A single read at render time is why the screen could
  // not notice the visit it had itself just recorded.
  ok(/subscribe\(\(id\) => \{/.test(code),
    'the screen watches the store rather than reading it once');
  ok(/setAuthoritative\(getAuthoritative\(campaignId\)\)/.test(code),
    'and re-reads the authoritative task when it changes');
  ok(/setInterval\(\(\) => setNow\(Date\.now\(\)\), 30000\)/.test(code),
    'and keeps its own clock, so the countdown beside the message moves');

  // ONE RECORD, READ. Not a fourth wording of it.
  ok(/messageText\(authoritative, 'long'\)/.test(code),
    'THE SAME ONE MESSAGE the other three places show, in its long form');
  ok(/countdownFor\(authoritative, now\)/.test(code),
    'with the countdown from the same record');
  ok(/holdIsOver\(authoritative, now\)/.test(code),
    'and it asks separately whether the two hours are gone');
  ok(/wentToShopAt != null/.test(code),
    'and the whole thing turns on whether our side recorded the visit');

  // THE SHOP'S DOOR IS GONE ONCE THEY HAVE WALKED THROUGH IT. A second tap
  // records nothing new — our side keeps the first tap and cannot move it — so
  // all it could do is send somebody to buy the same thing twice.
  ok(/\{!hasGone && couldNotStart && refusal == null \?/.test(code),
    'the retry button is drawn only before the visit is recorded — and only when '
    + 'our side did NOT answer with a decision, because tapping again asks a '
    + 'question that has already been answered no');
  ok(/\{!hasGone && !couldNotStart \?/.test(code),
    'and so is the shop own door');
  // THE OWNER'S OWN WORDING, asked for on 16 September 2026. The design reads
  // "OPEN AMAZON" here; he is right that this is the step where somebody goes
  // and BUYS the product, and "open" describes what the phone does rather than
  // what the person is there to do. src/ui/shopApp.test.mjs holds the review
  // step to "OPEN", which is still exactly what that one is for.
  ok(/BUY ON \{shop\.toUpperCase\(\)\} →/.test(code),
    'AND THE BUTTON SAYS WHAT THE PERSON IS THERE TO DO');
  ok(/\{couldNotStart && !hasGone \?/.test(code),
    'and the refusal sentence cannot appear over a visit that did get recorded');

  // STEP SEVEN, AND ONLY WHILE THERE IS TIME LEFT.
  ok(/\{hasGone && !over \?/.test(code),
    'the question is asked only after they have gone AND while the hold is alive');
  ok(code.includes('HAVE_YOU_BOUGHT_IT') && !code.includes(HAVE_YOU_BOUGHT_IT),
    'the screen NAMES the question rather than holding a copy of it');
  ok(code.includes('YES_I_HAVE') && code.includes('NOT_YET')
    && !code.includes(YES_I_HAVE) && !code.includes(NOT_YET),
  'and both answers the same way');
  // NO PLACEHOLDER SENTENCE ANY MORE. Yesterday YES set a flag and the screen
  // said "we have not built the next step yet", which was true of the ROUTE and
  // not of the work: both order screens already existed and were reachable only
  // from returncatch.js. The sentence is gone from the words file too, because a
  // walked sentence nothing shows is a lie in the list of what people read.
  ok(!code.includes('NOT_BUILT_YET'),
    'and the placeholder sentence is gone, because YES now goes somewhere');

  // YES IS HONEST ABOUT LEADING NOWHERE, AND STEPS EIGHT TO TWELVE ARE NOT
  // HALF-BUILT HERE. Nothing on this screen reads an order, matches one, or moves
  // the task on.
  // ── YES NOW LOOKS FOR THE ORDER, AND THAT WAS THE ONE MISSING LINK ──────
  //
  // src/order/LookingForItScreen.js reads the shop's own list of orders from
  // inside the web view and hands the TEXT to our side to judge;
  // IsThisYourOrderScreen shows what came back. Both already existed. The whole
  // path was reachable only from src/screens/returncatch.js, so nobody arriving
  // from "I have bought it" could reach it.
  ok(/onPress=\{lookForTheOrder\}/.test(code),
    'YES looks for the order');
  ok(/navigation\.navigate\('LookingForIt', \{ campaignId \}\);/.test(code),
    'and that is a navigation to the waiting screen, and nothing else');
  for (const notHere of [
    'dispatch(', 'postTaskAction', 'confirmOrder', 'markReviewed', 'startHold',
    'releaseRefund', 'orderCandidates', 'submitEvidence', 'postEvidence',
  ]) {
    ok(!code.includes(notHere),
      `and it does not reach for ${notHere} — steps eight to twelve stay unbuilt`);
  }
  ok(/onPress=\{\(\) => goBackOrHome\(navigation\)\}/.test(code),
    'and NOT YET simply leaves, changing nothing');

  // THE RAN-OUT CASE OFFERS NOTHING ONWARD. Every button on the screen is inside
  // a block that refuses to draw when the hold is over.
  // FIVE SINCE 18 SEPTEMBER 2026: the way back into the shop for a shop that is
  // inside Fayr. It is inside step seven's own block, behind the same !over
  // guard as the two beside it, so the ran-out case still offers nothing onward.
  const buttons = code.match(/<Pill /g) || [];
  ok(buttons.length === 5,
    'there are exactly five buttons on this screen, and every one is accounted for');
  // Sliced to step seven's OWN block: from its guard to the shop door's guard
  // below it. Taking the rest of the file would have counted the two doors too,
  // which is how this check first read four and proved nothing.
  const from = code.indexOf('{hasGone && !over ?');
  const to = code.indexOf('{!hasGone && couldNotStart &&');
  ok(from !== -1 && to !== -1 && from < to, 'step seven is drawn above the shop door');
  const step7 = code.slice(from, to);
  ok((step7.match(/<Pill /g) || []).length === 3,
    'three of the five are step seven own, behind the !over guard');
  ok((step7.match(/shopsInsideFayr\(key\)/g) || []).length === 1,
    'and one of those three is the in-Fayr shop door, drawn for nobody else');
  // AND THE OTHER TWO ARE BOTH BEHIND !hasGone, so once the visit is recorded
  // there is no button on this screen that is not step seven's.
  const doors = code.slice(to);
  ok((doors.match(/<Pill /g) || []).length === 2,
    'and the other two are the shop own door, below it');
  ok((doors.match(/!hasGone/g) || []).length === 2,
    'each of those two refuses to draw once the visit is recorded');
  ok(/hasGone \? null : deadlineLine/.test(code),
    'AND THE CLAIM OWN HALF HOUR IS HIDDEN once they have tapped Buy, or it runs '
    + 'out while the two hours are still going and contradicts them');
}

console.log('\n=== 11. WHEN OUR SIDE SAYS WHY, THE PERSON IS TOLD WHY ===');
{
  // THE RUN THAT FORCED THIS, on the owner's phone, 16 September 2026. His thirty
  // minute claim had run out. Our side answered 400 with the sentence it keeps
  // for that, and the screen drew the GENERAL failure instead — which says "You
  // have not lost your place". He had lost his place. It then offered TRY AGAIN,
  // which asks the same question and gets the same 400, so he tapped it, read the
  // same words, and concluded the shop would not open.
  ok(typeof theSentenceTheyGaveUs === 'function',
    'the rule is a function in a file with no React in it, so this test can walk it');

  // A DECISION IS SHOWN.
  ok(theSentenceTheyGaveUs({ ok: false, status: 400, error: 'The time to tap Buy has run out.' })
    === 'The time to tap Buy has run out.',
  'a 400 with a sentence in it IS the sentence the person is shown');
  ok(theSentenceTheyGaveUs({ ok: false, status: 400, error: '  padded  ' }) === 'padded',
    'and it is trimmed, because a body carries whitespace');

  // ANYTHING THAT IS NOT A DECISION IS NOT. None of these is a sentence somebody
  // wrote for a person to read, and "Internal server error" in front of somebody
  // mid-purchase is worse than the general failure it would replace.
  for (const notADecision of [
    null,
    undefined,
    { ok: false, status: 0, error: 'no task' },
    { ok: false, status: 500, error: 'Internal server error' },
    { ok: false, status: 404, error: 'Task not found' },
    { ok: false, status: 401, error: 'Unauthorized' },
    { ok: false, status: 400 },
    { ok: false, status: 400, error: '' },
    { ok: false, status: 400, error: '   ' },
    { ok: false, status: 400, error: 7 },
  ]) {
    ok(theSentenceTheyGaveUs(notADecision) === null,
      `${JSON.stringify(notADecision)} is not a sentence written for a person`);
  }

  const screen = read('src/screens/buyinterstitial.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // AND THE SCREEN REALLY DRAWS IT, instead of the general words.
  ok(/\{refusal == null \? \(/.test(code),
    'the general words are the ELSE, not the only branch');
  ok(/<Text style=\{styles\.couldNotText\}>\{refusal\}<\/Text>/.test(code),
    "and our side's own sentence is what is printed when there is one");

  // AND TRY AGAIN IS NOT OFFERED AGAINST ONE. This is the half that cost the
  // owner his evening: a button that asks a question already answered no.
  ok(/\{!hasGone && couldNotStart && refusal == null \? \(/.test(code),
    'TRY AGAIN is offered only when trying again could actually come good');

  // AND IT STILL HOLDS ITS OWN COPY OF NOTHING. The sentence came off the wire,
  // so this screen has no wording of its own here either.
  ok(!code.includes('has run out'), 'the screen does not keep a copy of our own refusal wording');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
