// The return window, without a clock and without a phone.
//
// The thing worth proving hardest: no number and no date is ever invented. The
// design writes "5 DAYS" and "11 Jul" into the screen; this file exists so the app
// can never do that.
import { daysUntil, shortDate, toMillis, windowLine } from './returnWindow.js';

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

  const today = windowLine({
    endsAt: iso(2026, 9, 1, 18, 0), shopName: 'Amazon', now: NOW,
  });
  ok(/closes today/.test(today), 'a window closing today says today');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
