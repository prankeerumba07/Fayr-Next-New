// MEASUREMENT MODE, FOR THE TWO SHOPS NOBODY HAS EVER MEASURED — Phase 8B-b.
//
// The owner buys one thing on Blinkit and one on Instamart, inside Fayr, and
// that run IS the measurement. What is proved here: it writes the page down, it
// writes it down for nobody else, it cannot write anything at all in a build a
// person has, nothing of it reaches the server, and no telephone number or email
// address survives a single line of it.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { holdsANumber, MASK } from '../maskNumbers.js';
import {
  AT_MOST_PER_LINE,
  AT_MOST_PER_PAGE,
  EMAIL_MASK,
  MEASURE_REPORT_KEY,
  TAG,
  maskEmails,
  measureBlock,
  measureLine,
  measureTheWholePageScript,
  shouldMeasure,
  whatTheMeasurerSaid,
} from './measureLog.js';

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

console.log('=== 1. M3 — WHO IT FIRES FOR, AND IT IS ONE SHOP ON A DEVELOPMENT BUILD ===');
{
  ok(shouldMeasure({ key: 'blinkit', dev: true }) === true, 'blinkit has never been measured, so it is measured');

  // ── AND INSTAMART TURNED ITSELF OFF ON 22 SEPTEMBER 2026 ────────────────
  //
  // This is the whole design of shouldMeasure working: it reads the order table
  // rather than naming shops, so the moment the owner's real purchase filled
  // Instamart's marks in, the measuring stopped on its own. Nobody edited this
  // decision — filling the table WAS the edit. The comment further down already
  // said that: "filling in blinkit's order marks is the one and only thing that
  // turns it off."
  ok(shouldMeasure({ key: 'instamart', dev: true }) === false,
    'AND INSTAMART NO LONGER IS, because its purchase has been watched');

  // ZEPTO IS MEASURED ALREADY, and turning this on for it would print a whole
  // page of somebody's real order for no reason at all.
  ok(shouldMeasure({ key: 'zepto', dev: true }) === false,
    'ZEPTO IS ALREADY MEASURED AND IS NEVER WRITTEN DOWN');

  // AND NEITHER IS ANY SHOP THAT DOES NOT SHOP INSIDE FAYR.
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(shouldMeasure({ key, dev: true }) === false, `${key} never comes here, so it is never measured`);
  }

  // AND NOT IN A BUILD A PERSON HAS.
  for (const dev of [false, undefined, null, 0, 'true', 1]) {
    ok(shouldMeasure({ key: 'blinkit', dev }) === false,
      `dev=${JSON.stringify(dev)} is not a development build, so nothing is written`);
  }
  for (const junk of [undefined, null, {}, { dev: true }, { key: '', dev: true },
    { key: 7, dev: true }, { key: 'nonsense', dev: true }]) {
    ok(shouldMeasure(junk) === false, `${JSON.stringify(junk)} measures nothing`);
  }

  // THE DAY BLINKIT IS MEASURED, THIS STOPS ON ITS OWN. Proved against the real
  // table rather than asserted: the answer is read off insideFayr.js, so filling
  // in blinkit's order marks is the one and only thing that turns it off.
  const table = withoutComments(read('src/shop/insideFayr.js'));
  ok(/blinkit:\s*\{[^}]*orderPlaced:\s*\{\s*\}/.test(table), 'blinkit’s order table is still empty');
  ok(!/instamart:\s*\{[^}]*orderPlaced:\s*\{\s*\}/.test(table),
    'while instamart’s is filled in, which is what turned its measuring off');
  const mine = withoutComments(read('src/shop/measureLog.js'));
  ok(/anybodyHasMeasured\(key\) === false/.test(mine),
    'and the decision reads that table rather than naming the two shops');
  ok(!/'blinkit'|'instamart'/.test(mine), 'so neither shop is written into this file at all');
}

console.log('\n=== 2. M1 — EVERY LINE CARRIES THE TAG, AND EVERY LINE IS MASKED ===');
{
  ok(TAG === '[fayr-measure]', 'the tag is its own, and not the shop log’s');

  const lines = measureBlock({
    url: 'https://blinkit.com/order/1',
    title: 'Order placed',
    text: [
      'Delivered to Prakash',
      'prakash.tamang@example.co.in',
      '+91 98765 43210',
      '9876543210',
      'Item Total ₹149',
    ].join('\n'),
  });
  ok(lines.length >= 5, `it wrote ${lines.length} lines`);
  ok(lines.every((l) => l.startsWith(TAG)),
    'EVERY LINE BEGINS WITH THE TAG, so none of them can be mistaken for something a screen says');
  ok(lines.every((l) => !holdsANumber(l)),
    'AND NOT ONE OF THEM STILL HOLDS A TELEPHONE NUMBER');
  ok(!lines.some((l) => l.includes('@example')),
    'AND NO EMAIL ADDRESS SURVIVES ONE EITHER');
  ok(lines.some((l) => l.includes(MASK)), `the number mask really ran: ${MASK}`);
  ok(lines.some((l) => l.includes(EMAIL_MASK)), `and so did the email mask: ${EMAIL_MASK}`);
  // THE PRICE IS STILL THERE. A mask that ate the thing being measured would be
  // a mask somebody switches off.
  ok(lines.some((l) => l.includes('Item Total ₹149')), 'and the bill line came through whole');

  // THE ADDRESS AND THE TITLE GO FIRST.
  ok(/^\S+ \S+ PAGE url=https:\/\/blinkit\.com\/order\/1 title="Order placed"$/.test(lines[0]),
    `the first line places the page: ${lines[0]}`);

  // NO LINE IS LONGER THAN IT SAYS.
  const longest = Math.max(...lines.map((l) => l.length));
  ok(longest <= TAG.length + AT_MOST_PER_LINE + 40,
    `and no line runs away with the terminal (longest ${longest})`);

  // A PAGE LONGER THAN THE CAP SAYS SO, WITH THE COUNT.
  const huge = measureBlock({ url: 'u', title: 't', text: 'y'.repeat(AT_MOST_PER_PAGE + 1234) });
  const last = huge[huge.length - 1];
  ok(/\.\.\. 1234 more characters not shown$/.test(last),
    `a cut page says how much was cut: ${last.slice(-44)}`);
  ok(huge.every((l) => l.startsWith(TAG)), 'and the note carries the tag like everything else');

  // AND NOTHING MISSING IS EVER DRAWN AS A WORD.
  for (const nothing of [undefined, null, {}, { url: null, title: null, text: null }, 'x', 7]) {
    const out = measureBlock(nothing);
    ok(out.length >= 1 && out.every((l) => l.startsWith(TAG) && !/undefined|\[object/.test(l)),
      `${JSON.stringify(nothing)} still writes a readable line`);
  }

  // THE MASKS RUN IN THE RIGHT ORDER, and the number mask is LAST.
  ok(/maskNumbers\(maskEmails\(/.test(mineSource()),
    'maskNumbers wraps maskEmails, so the number rule is the last thing to run');
  ok(maskEmails('write to a.b+c@shop.co.in please') === `write to ${EMAIL_MASK} please`,
    'and an address with a plus and two dots in it is still an address');
  ok(maskEmails('no address here') === 'no address here', 'while ordinary words are left alone');
}

function mineSource() {
  return withoutComments(read('src/shop/measureLog.js'));
}

console.log('\n=== 3. ONE WAY OUT, AND IT IS A CONSOLE LINE ===');
{
  const mine = mineSource();
  ok((mine.match(/console\.log\(/g) || []).length === 1,
    'there is exactly one call to console.log in the file');
  ok(/function say\(line\) \{\s*\n?\s*\/\/[^\n]*\n?\s*console\.log\(line\);/.test(read('src/shop/measureLog.js'))
    || /function say\(line\) \{[\s\S]{0,120}console\.log\(line\);/.test(mine),
  'and it is inside say()');
  ok(/if \(!measureLogIsOn\(\)\) return 0;/.test(mine),
    'and nothing is said at all unless the commentary is on');
  // A WORDS FILE THAT CAN REACH A NETWORK IS NOT A WORDS FILE.
  for (const wayOut of [/\bfetch\s*\(/, /XMLHttpRequest/, /AsyncStorage/, /SecureStore/, /from 'react/]) {
    ok(!wayOut.test(mine), `and it cannot reach ${String(wayOut)}`);
  }
}

console.log('\n=== 4. THE SCRIPT READS AND POSTS, AND DOES NOTHING ELSE ===');
{
  const script = measureTheWholePageScript();
  ok(typeof script === 'string' && script.length > 200, 'the script is a STRING, for Hermes');
  ok(script.includes('document.body.innerText'), 'it reads the page’s own text');
  ok(script.includes('ReactNativeWebView.postMessage'), 'and posts it back over the bridge');
  ok(script.trim().endsWith('true;'), 'and ends in true, so the view does not warn');
  // IT TAPS NOTHING, TYPES NOTHING AND READS NOTHING IT SHOULD NOT.
  for (const never of ['.click(', '.submit(', 'document.cookie', 'localStorage',
    'sessionStorage', 'fetch(', 'XMLHttpRequest', '.value =']) {
    ok(!script.includes(never), `the script never touches ${never}`);
  }
  ok(/if \(window\.__fayrMeasuring\) return;/.test(script), 'and it installs itself once');
  ok(/if \(now === last\) return;/.test(script), 'and says the same page only once');

  // AND WHAT COMES BACK IS COERCED, because a page can put anything in a message.
  ok(whatTheMeasurerSaid(null) === null, 'nothing is not a report');
  ok(whatTheMeasurerSaid({ __fayrTitle: { title: 't' } }) === null,
    'and the title watcher’s report is not this one');
  const said = whatTheMeasurerSaid({ [MEASURE_REPORT_KEY]: { title: 7, url: null, text: {} } });
  ok(said.title === '' && said.url === '' && said.text === '',
    'and anything that is not a string becomes an empty one');
}

console.log('\n=== 5. M2 — NOTHING NEW IS POSTED TO THE SERVER ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  // THE COUNT IS PINNED. Two calls reach Fayr's side from this screen, and they
  // are the two that were there before measurement mode existed: the sign in
  // report, and the one evidence post that carries the watched order key.
  const calls = [
    ...(screen.match(/\breportShopSignIn\(/g) || []),
    ...(screen.match(/\bsyncEvidence\(/g) || []),
  ];
  ok(calls.length === 2, `the screen makes exactly two calls to our side, found ${calls.length}`);
  ok(!/\bfetch\s*\(/.test(screen), 'and reaches the network no other way');
  // AND THE MEASUREMENT GOES NOWHERE NEAR THEM.
  const handler = screen.slice(screen.indexOf('const measured = whatTheMeasurerSaid(msg);'),
    screen.indexOf('const reported = whatTheTitleWatcherSaid(msg);'));
  ok(handler.length > 20, 'the measurement branch is where expected');
  ok(/logMeasure\(measured\);\s*return;/.test(handler),
    'a measurement is logged and the handler stops there');
  for (const never of ['syncEvidence', 'reportShopSignIn', 'fetch', 'setLastPage', 'setPageTitle']) {
    ok(!handler.includes(never), `and a measurement never reaches ${never}`);
  }
  // AND THE UNTAUGHT-SHOP LINE IS STILL WRITTEN, as it was before.
  ok(/logShop\('NOTHING MEASURED FOR THIS SHOP'/.test(screen),
    'the NOTHING MEASURED line stays exactly where it was');
  // THE SCRIPT IS ADDED ONLY WHEN THE DECISION SAYS SO.
  ok(/shouldMeasure\(\{ key, dev: typeof __DEV__ !== 'undefined' && __DEV__ === true \}\)/.test(screen),
    '__DEV__ is read once, at the call site, and handed in');
  ok(/\? measureTheWholePageScript\(\)\s*:\s*''/.test(screen),
    'and a shop that is not being measured gets no script at all');
}

console.log('\n=== 6. M4 — AN UNMEASURED SHOP HANDS BACK, AND NEVER READS A LIST ===');
{
  const look = withoutComments(read('src/order/LookingForItScreen.js'));
  // THE DECISION IS MADE BEFORE ANYTHING IS OPENED, and NOWHERE hands straight
  // back. Moved above the no-list guard on 20 September 2026 — see whichRead.test.mjs.
  const decided = look.indexOf('const how = howToLook({');
  const nowhere = look.indexOf('if (how.path === NOWHERE) {');
  const noList = look.indexOf('if (!taskId || !theList || !platform) {');
  ok(decided > -1 && nowhere > decided && noList > nowhere,
    'decided, then NOWHERE, then the no-list guard');
  ok(/if \(how\.path === NOWHERE\) \{\s*logLook\('watched', 'opened=0 why=nowhere'\);\s*await settle\(\);\s*if \(alive\) moveOn\('Journey'\);\s*return;\s*\}/.test(look),
    'A KEY WITH NO PAGE BEHIND IT READS NOTHING AND HANDS BACK TO THE JOURNEY');

  // AND THERE IS NO LIST PAGE FOR EITHER SHOP TO READ IN THE FIRST PLACE.
  const history = withoutComments(read('src/orderhistory.js'));
  const pages = history.slice(history.indexOf('ORDER_LIST_PAGES'), history.indexOf('export function orderListPageFor'));
  ok(pages.length > 10, 'the list of list pages is where expected');
  ok(!/blinkit/.test(pages) && !/instamart/.test(pages),
    'neither blinkit nor instamart has an order list page, so no list can be read');

  // AND THE SHOP SCREEN HANDS BACK RATHER THAN SITTING THERE.
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/whereToHandOver\(\{ orderKey \}\)/.test(screen), 'the shop screen asks where to hand over');
  const watched = withoutComments(read('src/shop/theWatchedOrder.js'));
  ok(/return \{ to: 'LookingForIt', writesTheLookedNote: true \};/.test(watched),
    'and with no key it goes to the read, with the note that stops the journey re-opening the shop');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
