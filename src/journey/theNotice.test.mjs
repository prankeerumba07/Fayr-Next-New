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
  ok(EVERY_SENTENCE.length === 14, 'the list of them is complete');
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
  ok(/if \(!answer \|\| !answer\.ok \|\| !answer\.task\) \{\s*setCouldNotStart\(true\);\s*return;/
    .test(code),
    'A FAILED CALL RETURNS AND OPENS NOTHING, because a visit our side does not '
    + 'know about can never be paid');
  ok(/if \(built == null\) \{\s*setCouldNotStart\(true\);\s*return;/.test(code),
    'and a recorded visit with no words is treated the same way, rather than '
    + 'drawing a pop-up of our own');
  // THE ONE WAY OUT. openShopApp must be reachable from exactly one place.
  ok((code.match(/openShopApp\(/g) || []).length === 1,
    'the shop is opened from exactly one place in this file');
  ok(/const leaveForTheShop = useCallback\(async \(\) => \{\s*setNotice\(null\);\s*await openShopApp/
    .test(code),
    'and that place is the notice own button');
  ok(/onRequestClose=\{\(\) => \{\}\}/.test(code),
    'THERE IS NO WAY PAST THE NOTICE: the phone own back control does nothing');
  ok(!/onDismiss|onBackdropPress|closeOnOverlay/.test(code),
    'and nothing dismisses it by tapping outside or swiping');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
