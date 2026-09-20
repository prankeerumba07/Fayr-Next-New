// The return window, without a clock and without a phone.
//
// The thing worth proving hardest: no number and no date is ever invented. The
// design writes "5 DAYS" and "11 Jul" into the screen; this file exists so the app
// can never do that.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clockInIndia, daysUntil, shortDate, theWait, timeLeftOnTheWindow, toMillis,
  waitHeading, whenTheWindowEnds, windowLine,
} from './returnWindow.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
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

/**
 * A moment, given in the LOCAL time of whoever is running this.
 *
 * Written this way on purpose. The first version of these checks used fixed UTC
 * strings, and "later the same day" is not the same day everywhere: 23:59 in
 * London is already tomorrow morning in India, so the check passed or failed
 * depending on the machine's clock setting. The count is about calendar days as
 * the person holding the phone sees them, so the checks have to be too.
 */
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const iso = (...args) => at(...args).toISOString();

const NOW = at(2026, 9, 1, 10, 0).getTime();

console.log('=== 1. a date we were not given is never a number ===');
{
  for (const nothing of [undefined, null, '', 'soon', 42, {}, [], 'not-a-date']) {
    ok(toMillis(nothing) === null, `${JSON.stringify(nothing)} is not a date`);
    ok(shortDate(nothing) === null, `${JSON.stringify(nothing)} has no short date`);
    ok(daysUntil(nothing, NOW) === null, `${JSON.stringify(nothing)} is no number of days`);
  }
  // And a real date with no clock is still no answer: the caller has to hand one in.
  ok(daysUntil(iso(2026, 9, 6, 10, 0), undefined) === null,
    'a date with no clock handed in gives no number');
}

console.log('\n=== 2. the count of days ===');
{
  const days = (...when) => daysUntil(iso(...when), NOW);
  ok(days(2026, 9, 6, 10, 0) === 5, 'five whole days away is 5');
  ok(days(2026, 9, 2, 10, 0) === 1, 'tomorrow is 1');
  ok(days(2026, 9, 1, 10, 0) === 0, 'this very moment is 0');
  ok(days(2026, 8, 30, 10, 0) === 0, 'already past is 0, never a negative');
  // COUNTED IN CALENDAR DAYS, not hours divided by twenty four. A window that
  // closes at four tomorrow afternoon closes TOMORROW, which is one day, and a
  // person told "2 days" would plan for the wrong date.
  ok(days(2026, 9, 2, 16, 0) === 1, 'four tomorrow afternoon is 1 day, not 2');
  ok(days(2026, 9, 1, 23, 59) === 0, 'later the same day is 0, because it is today');
  ok(days(2026, 9, 2, 0, 1) === 1, 'one minute after midnight is 1, because it is tomorrow');
  ok(days(2026, 9, 1, 10, 0, 1) === 0, 'a second away is still today');
}

console.log('\n=== 3. the short date ===');
{
  ok(shortDate(iso(2026, 7, 11)) === '11 Jul', 'eleventh of July reads 11 Jul');
  ok(shortDate(iso(2026, 1, 1)) === '1 Jan', 'the first of January reads 1 Jan');
  ok(shortDate(iso(2026, 12, 31)) === '31 Dec', 'the last day reads 31 Dec');
  ok(!/undefined|NaN/.test(String(shortDate(iso(2026, 3, 9)))),
    'nothing missing reaches the screen');
}

console.log('\n=== 4. the sentence ===');
{
  const withBoth = windowLine({
    endsAt: iso(2026, 9, 6, 10, 0), shopName: 'Amazon', now: NOW,
  });
  ok(withBoth.includes('Amazon'), 'it names the shop');
  ok(withBoth.includes('6 Sep'), 'and the date');
  ok(!/\bfestival/i.test(withBoth),
    'and it does NOT copy the design’s festival promise, which Fayr does not do');

  const noDate = windowLine({ endsAt: null, shopName: 'Flipkart', now: NOW });
  ok(/do not have the closing date/.test(noDate),
    'with no date it says so rather than inventing one');
  ok(noDate.includes('Flipkart'), 'and still names the shop');

  const noShop = windowLine({ endsAt: iso(2026, 9, 6, 10, 0), now: NOW });
  ok(noShop.includes('6 Sep') && !/undefined|null/.test(noShop),
    'with no shop it still reads as a sentence');

  // A WINDOW CLOSING LATER THE SAME DAY NO LONGER SAYS "TODAY" — 20 Sep 2026.
  // It is under a day away, so it is said on the clock instead. See theWait and
  // section 6: "closes today, on 20 Sep" was true and told nobody anything, and
  // on the three shops that hold for three hours it was the only thing shown.
  const today = windowLine({
    endsAt: iso(2026, 9, 1, 18, 0), shopName: 'Amazon', now: NOW,
  });
  ok(/due at \d{1,2}:\d{2} (am|pm)/.test(today), 'a window closing in hours says the time');
  ok(!/closes today/.test(today), 'and not the day-shaped sentence any more');

  // AND A WAIT OF A DAY OR MORE IS WORD FOR WORD WHAT IT ALWAYS WAS.
  const tomorrow = windowLine({
    endsAt: iso(2026, 9, 3, 10, 0), shopName: 'Amazon', now: NOW,
  });
  ok(/After Amazon.s return window closes on 3 Sep\./.test(tomorrow),
    'two days out is still the shop’s own return window, in the old words');
}

console.log('\n=== 6. a wait that is not measured in days at all — Phase 8B-b ===');
{
  // THE OWNER, 19 September 2026: "[Zepto, Blinkit, Instamart] ... once the
  // product is delivered to the user, it cannot be sent back ... give them 2 or
  // 3 hours of time, and then we refund the money to the user."
  const three = theWait({ endsAt: iso(2026, 9, 1, 13, 0), now: NOW });
  ok(three.kind === 'hours', 'three hours out is an hours wait');
  ok(three.count === 3 && three.unit === 'HOURS', 'and it counts three of them');
  ok(/^\d{1,2}:\d{2} (am|pm)$/.test(three.at), `and it names the time: ${three.at}`);
  ok(three.day === 'today', 'and says which day');
  ok(waitHeading(three) === 'Your refund unlocks in 3 hours', 'the heading says hours');

  // ROUNDED UP AND NEVER DOWN: two hours and one minute is three, because being
  // early with somebody else's money is the direction that costs trust.
  const bit = theWait({ endsAt: iso(2026, 9, 1, 12, 1), now: NOW });
  ok(bit.kind === 'hours' && bit.count === 3, 'two hours and one minute rounds up to three');

  const soon = theWait({ endsAt: iso(2026, 9, 1, 10, 25), now: NOW });
  ok(soon.kind === 'minutes' && soon.count === 25, 'under an hour is counted in minutes');
  ok(soon.unit === 'MINUTES', 'and named in the plural');
  const one = theWait({ endsAt: new Date(NOW + 60000).toISOString(), now: NOW });
  ok(one.count === 1 && one.unit === 'MINUTE', 'one minute is singular');
  ok(waitHeading(one) === 'Your refund unlocks in a minute', 'and reads as a sentence');

  const over = theWait({ endsAt: iso(2026, 9, 1, 9, 0), now: NOW });
  ok(over.kind === 'due', 'a wait that has passed is due');
  ok(waitHeading(over) === 'Your refund is due now', 'and says so');

  // A DAY OR MORE IS COUNTED IN CALENDAR DAYS, exactly as it always was.
  const days = theWait({ endsAt: iso(2026, 9, 6, 10, 0), now: NOW });
  ok(days.kind === 'days' && days.count === daysUntil(iso(2026, 9, 6, 10, 0), NOW),
    'five days out is still counted the old way');
  ok(waitHeading(days) === 'Refund unlocks in 5 days', 'and reads the old way');

  // NOTHING IS INVENTED WHEN WE WERE NOT TOLD.
  for (const nothing of [{}, { endsAt: null, now: NOW }, { endsAt: iso(2026, 9, 6) }]) {
    const w = theWait(nothing);
    ok(w.kind === 'unknown' && w.count === null && w.at === null,
      `${JSON.stringify(nothing)} draws no number`);
  }
  ok(waitHeading(theWait({})) === 'Waiting for the return window', 'and says so plainly');

  // THE CLOCK IS INDIA'S, AND IT IS THE SAME CLOCK OUR SIDE ALREADY USES.
  //
  // THE OFFSET MOVED HOUSE ON 20 SEPTEMBER 2026, with Phase 8B-c, and this check
  // is what noticed. It was declared inside shop-visit-words.ts, and then a
  // second reader wanted it — the one that turns "25 Aug 2026, 9:02 PM" off a
  // shop's own order page into an instant. Two copies of the number that decides
  // what hour somebody is told about their money is one copy too many, so it now
  // lives in backend/src/common/india-clock.ts and the words file reads it from
  // there. The FACT this check is about has not changed by a minute.
  const clockFile = read('backend/src/common/india-clock.ts');
  const server = read('backend/src/tasks/engine/shop-visit-words.ts');
  ok(/const INDIA_OFFSET_MS = 330 \* 60 \* 1000;/.test(clockFile),
    'our side shifts by five and a half hours');
  // AND THERE IS STILL ONLY ONE OF IT ON OUR SIDE. The words file must read the
  // shared one and declare none of its own, or the move bought nothing.
  ok(/import \{ INDIA_OFFSET_MS \} from '\.\.\/\.\.\/common\/india-clock';/
    .test(withoutComments(server)),
  'and the pop-up\u2019s own words read that one rather than keeping a copy');
  ok(!/const INDIA_OFFSET_MS\s*=/.test(withoutComments(server)),
    'and nothing on our side declares a second copy of it');
  ok(/const INDIA_OFFSET_MS = 330 \* 60 \* 1000;/.test(read('src/ui/returnWindow.js')),
    'and so does the phone, by the same arithmetic');
  ok(/hour24 % 12 === 0 \? 12 : hour24 % 12/.test(server)
    && /hour24 % 12 === 0 \? 12 : hour24 % 12/.test(read('src/ui/returnWindow.js')),
  'and both read noon and midnight as twelve, which is where a naive clock prints nought');
  // Midnight and noon, proved rather than asserted from the source.
  const midnightUtc = Date.UTC(2026, 8, 20, 18, 30); // 12:00 am in India
  ok(clockInIndia(midnightUtc) === '12:00 am', `midnight reads 12:00 am, got ${clockInIndia(midnightUtc)}`);
  ok(clockInIndia(Date.UTC(2026, 8, 20, 6, 30)) === '12:00 pm', 'and noon reads 12:00 pm');

  // THE CLAIM'S OWN STATUS ROWS, MOVED HERE ON 20 SEPTEMBER 2026.
  ok(timeLeftOnTheWindow(NOW + 3 * 3600000, NOW) === '3 hours remaining',
    'three hours left reads in hours');
  ok(timeLeftOnTheWindow(NOW + 25 * 60000, NOW) === '25 minutes remaining',
    'AND THE LAST HOUR READS IN MINUTES — it used to read "0h remaining"');
  ok(timeLeftOnTheWindow(NOW + 60000, NOW) === '1 minute remaining', 'and one is singular');
  ok(timeLeftOnTheWindow(NOW + 5 * 86400000, NOW) === '5d 0h remaining',
    'while days and hours are word for word what they were');
  ok(timeLeftOnTheWindow(NOW - 1, NOW) === 'Return window has closed', 'and a closed window says so');
  for (const nothing of [[null, NOW], [NOW, null], [undefined, undefined], ['x', NOW]]) {
    ok(timeLeftOnTheWindow(...nothing) === null, `${JSON.stringify(nothing)} counts nothing`);
  }

  ok(whenTheWindowEnds(NOW + 3 * 3600000, NOW) === `${clockInIndia(NOW + 3 * 3600000)} today`,
    'a window ending this afternoon is a TIME, not a bare date');
  ok(/^\w{3} \w{3} \d{1,2} \d{4}$/.test(whenTheWindowEnds(NOW + 5 * 86400000, NOW)),
    'and one five days out is still a date');
  ok(whenTheWindowEnds(null, NOW) === null && whenTheWindowEnds(NaN, NOW) === null,
    'and nothing is never drawn as a date');

  // AND THE SCREEN READS ALL OF IT FROM THE ONE ANSWER.
  const screen = withoutComments(read('src/screens/returnwindow.js'));
  ok(/const wait = theWait\(\{ endsAt, now \}\);/.test(screen), 'the screen asks theWait');
  ok(/\{waitHeading\(wait\)\}/.test(screen), 'the heading comes from it');
  ok(/\{wait\.count\}/.test(screen) && /\{wait\.unit\}/.test(screen),
    'and so do the number and the word in the ring');
  ok(!/daysUntil/.test(screen), 'and the screen counts nothing itself');

  // AND THE CLAIM'S OWN SCREEN COUNTS NOTHING EITHER.
  // THE INSTANT IT HANDS OVER IS `windowEndsAt` SINCE 20 SEPTEMBER 2026, not
  // `view.windowEndsAt`: the screen now prefers the server's own window over the
  // one the frozen day-based policy works out. See the section at the foot of
  // this file for why. What these two hold is unchanged — the screen ASKS for
  // the words rather than doing the arithmetic itself.
  const task = withoutComments(read('src/TaskScreen.js'));
  ok(/timeLeftOnTheWindow\(windowEndsAt, now\)/.test(task),
    'TaskScreen asks for the count rather than working one out');
  ok(/whenTheWindowEnds\(windowEndsAt, now\)/.test(task),
    'and for the window row too');
  ok(!/function countdown\(/.test(task), 'and keeps no countdown of its own any more');
  ok(!/\$\{hours\}h remaining/.test(task), 'nor the arithmetic that said 0h for the last hour');
}

console.log('\n=== 5. nothing missing reaches the screen ===');
{
  for (const state of [undefined, null, {}, 'nonsense', 42, { endsAt: 1 },
                       { shopName: 7, endsAt: iso(2026, 9, 6, 10, 0), now: NOW }]) {
    let threw = null;
    let line = null;
    try { line = windowLine(state); } catch (e) { threw = e.message; }
    ok(!threw, `survives ${JSON.stringify(state)}` + (threw ? ` — threw ${threw}` : ''));
    if (threw) continue;
    ok(typeof line === 'string' && line.length > 20, 'and still says something');
    ok(!/undefined|null|NaN|\[object/.test(line), 'with nothing missing in it');
  }
}

// ── THE SCREEN SHOWS THE SERVER'S WINDOW, NOT ONE IT WORKED OUT ITSELF ──────
//
// 20 SEPTEMBER 2026, from the owner's own razor. His task screen said the return
// window had "6d 23h remaining" while his row on the server said:
//
//   deliveredAt   14:22:01
//   windowEndsAt  17:22:01     — three hours, exactly
//
// Both were honestly computed and one was wrong on screen. `view` comes from
// describe(task, now, POLICY), and POLICY is createPolicy() in the FROZEN
// src/taskflow.js, which knows only days — a default and a table by category. It
// cannot express the three hour quick-commerce hold that the server applies to
// Zepto, Blinkit and Instamart, so on those three the screen showed a week for a
// deadline that afternoon.
console.log('\n=== THE WINDOW ON SCREEN IS THE ONE THE SERVER SENT ===');
{
  const screen = withoutComments(read('src/TaskScreen.js'));

  ok(/const iso = authoritative && authoritative\.windowEndsAt;/.test(screen),
    'the screen reads the window off the authoritative snapshot');
  ok(/const windowEndsAt = serverWindowEndsAt != null \? serverWindowEndsAt : view\.windowEndsAt;/
    .test(screen),
    'and prefers it, falling back to its own arithmetic only when nothing was sent');

  // AND NOTHING STILL READS THE LOCAL ONE. This is the half that actually fixes
  // the screen: one leftover view.windowEndsAt and the row goes on saying a week.
  const leftovers = (screen.match(/view\.windowEndsAt/g) || []).length;
  ok(leftovers === 1,
    `only the fallback may name view.windowEndsAt — found ${leftovers}`);

  // The three places a person actually reads it.
  ok(/sub: windowEndsAt != null\s*\?\s*timeLeftOnTheWindow\(windowEndsAt, now\)/.test(screen),
    'the timeline row counts down the server’s window');
  ok(/whenTheWindowEnds\(windowEndsAt, now\)/.test(screen),
    'the "Window ends" row states the server’s window');
  ok(/windowClosed = windowEndsAt != null && now >= windowEndsAt/.test(screen),
    'and whether the hold is OVER is decided by it too, which is the one that '
    + 'gates the refund rather than merely describing it');
}

// ── THE TASK SCREEN ASKS THE SERVER, AND ASKS AGAIN ON THE WAY BACK ────────
//
// 21 September 2026, and it misled the owner three times in one night. The load
// effect read `if (!getTask(campaignId)) load();` — fetch only when nothing is
// cached — so once a task was in the store this screen never asked again. Every
// change that happened while he was looking at it was invisible:
//
//   the razor    wallet paid, ledger posted, screen still greyed out "Refund
//                confirmed" and still showed "Needs staff check"
//   the oil      state DELIVERED on the server, screen still said "Zepto has
//                not said your order arrived yet"
//
// Both times the app was right and the screen was lying, and the only cure was
// killing the app. The screen's own header rule already forbade this: "The
// BACKEND is the source of truth ... never a timer or a step counter that could
// drift from the server." A cache never refreshed is that drift.
console.log('\n=== THE TASK SCREEN REFETCHES, AND ON FOCUS ===');
{
  const screen = withoutComments(read('src/TaskScreen.js'));

  ok(!/if \(!getTask\(campaignId\)\) load\(\);/.test(screen),
    'it no longer fetches ONLY when the store happens to be empty');
  ok(/\n\s*load\(\);\n\s*sync\(\);/.test(screen),
    'it asks the server every time the screen is set up');

  // THE ONE THAT ACTUALLY MATTERS FOR THE JOURNEY. The interesting changes
  // happen while somebody is off in the shop rating a product, and coming back
  // is exactly when the screen must not still show what it drew before.
  ok(/addListener\('focus', \(\) => \{ load\(\); sync\(\); \}\)/.test(screen),
    'and asks again whenever the screen comes back into view');
  ok(/if \(unfocus\) unfocus\(\);/.test(screen),
    'and lets that listener go, so a closed screen keeps no subscription');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
