// "LOAD MORE" — THE LIMIT, THE THREE STOPS, AND WHERE THEY REALLY ARE.
//
// Task 4 of 18 September 2026, and it came out of a run where nothing was
// broken: eight list rows read, eight order pages opened, eight 200s, every one
// posted, matched=0 seven times. The order was sixty rows back, behind a button.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOAD_MORE_WORDS, PRESSES_AT_MOST, ROWS_A_PRESS_ADDS, loadMoreWordsFor,
  shopPressesForMore, shouldPressAgain, whyItStopped,
} from './loadMore.js';
import { MOST_DETAIL_PAGES } from '../order/detailLook.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

console.log('=== 1. THE LIMIT IS A NAMED CONSTANT, NOT A LITERAL IN A LOOP ===');
{
  ok(typeof PRESSES_AT_MOST === 'number' && Number.isInteger(PRESSES_AT_MOST),
    'the limit is a whole number');
  ok(PRESSES_AT_MOST === 7,
    'and it is seven, which is the MEASURED number that exhausts the owner’s account');
  // NOT A ROUND NUMBER SOMEBODY LIKED. ZEPTO-BRIEF.md, 15 September 2026:
  // "Seven presses loads all 64 orders, back to November 2024."
  const brief = read('ZEPTO-BRIEF.md');
  ok(/Seven presses loads all 64 orders/.test(brief),
    'and the measurement it comes from is on the record, in the brief');
  ok(PRESSES_AT_MOST * ROWS_A_PRESS_ADDS + ROWS_A_PRESS_ADDS === 64,
    'seven presses of eight, on top of the first eight, is the 64 the brief counted');

  // AND IT IS A BACKSTOP, NOT A POLICY. On any account smaller than the limit the
  // button runs out first, so the number never bites at all.
  const code = withoutComments(read('src/order/drawnList.js'));
  ok(code.includes('${PRESSES_AT_MOST}'),
    'the script is built with the named constant and not with a 7');
  ok(!/presses < 7/.test(code), 'there is no bare number in the loop');
  ok(/import \{\s*PRESSES_AT_MOST, loadMoreWordsFor, shopPressesForMore,\s*\} from '\.\.\/shop\/loadMore\.js'/
    .test(code), 'and it takes all three from the file that owns them');
}

console.log('\n=== 2. THE THREE STOPS, AND ANY ONE OF THEM ENDS IT ===');
{
  const going = { pressesSoFar: 0, buttonIsThere: true, orderFound: false };
  ok(shouldPressAgain(going) === true, 'with a button, room and nothing found, it presses');

  // STOP ONE: the order was found.
  ok(shouldPressAgain({ ...going, orderFound: true }) === false,
    'the order was found, so there is nothing left to look for');
  ok(whyItStopped({ ...going, orderFound: true }) === 'the order was found', 'and it says so');
  // IT OUTRANKS THE OTHERS. A found order stops it even with a button and room.
  ok(shouldPressAgain({ pressesSoFar: 0, buttonIsThere: true, orderFound: true }) === false,
    'and it outranks a button that is still there');

  // STOP TWO: the button is gone. The ORDINARY ending.
  ok(shouldPressAgain({ ...going, buttonIsThere: false }) === false,
    'no button means the shop has no more to give');
  ok(whyItStopped({ ...going, buttonIsThere: false }) === 'the button is gone', 'and it says so');
  for (const notThere of [undefined, null, 0, '', 'yes', {}]) {
    ok(shouldPressAgain({ ...going, buttonIsThere: notThere }) === false,
      `${JSON.stringify(notThere)} is not a button, so it stops`);
  }

  // STOP THREE: the limit.
  ok(shouldPressAgain({ ...going, pressesSoFar: PRESSES_AT_MOST - 1 }) === true,
    'one press short of the limit still presses');
  ok(shouldPressAgain({ ...going, pressesSoFar: PRESSES_AT_MOST }) === false,
    'AND THE LIMIT STOPS IT — an unbounded loop on somebody’s phone is not acceptable');
  ok(shouldPressAgain({ ...going, pressesSoFar: PRESSES_AT_MOST + 40 }) === false,
    'and nothing past it starts again');
  ok(whyItStopped({ ...going, pressesSoFar: PRESSES_AT_MOST })
    === 'the limit of 7 presses was reached', 'and it says which limit');

  // AND AN INPUT IT CANNOT READ STOPS, rather than counting as zero.
  for (const junk of [undefined, null, '3', NaN, Infinity, {}, []]) {
    ok(shouldPressAgain({ ...going, pressesSoFar: junk }) === false,
      `${JSON.stringify(junk)} presses is not a number, so it stops`);
  }
  ok(shouldPressAgain() === false, 'and asked nothing at all, it stops');
  ok(shouldPressAgain({}) === false, 'and so does an empty question');
  ok(whyItStopped({ pressesSoFar: 2, buttonIsThere: true, orderFound: false })
    === 'it has not stopped', 'while a run still going says that plainly');
}

console.log('\n=== 3. only the shop whose button was measured presses at all ===');
{
  ok(shopPressesForMore('zepto') === true, 'zepto’s button was measured');
  ok(loadMoreWordsFor('zepto').join(',') === 'load more', 'and these are its words');
  // BLINKIT AND INSTAMART SHOP INSIDE FAYR AND ARE NOT HERE, which is the same
  // rule the empty order tables run on: nobody has looked at either order list.
  for (const key of ['blinkit', 'instamart', 'amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(shopPressesForMore(key) === false, `nobody has measured ${key}’s order list`);
    ok(loadMoreWordsFor(key).length === 0, `so ${key} has no words to look for`);
  }
  for (const junk of [undefined, null, '', 7, {}, 'ZEPTO ']) {
    ok(shopPressesForMore(junk) === false, `${JSON.stringify(junk)} is not a shop`);
  }
  ok(Object.keys(LOAD_MORE_WORDS).join(',') === 'zepto',
    'and the whole table is one shop, so a second cannot arrive unmeasured');
  // THE WORDS ARE LOWER CASE, because the page's label is lowered before it is
  // compared, and a capitalised entry would simply never match.
  for (const words of Object.values(LOAD_MORE_WORDS)) {
    for (const w of words) ok(w === w.toLowerCase(), `"${w}" is written lower case`);
  }
  // AND NOTHING HERE IS AN ADDRESS. This file names a button, never a page.
  ok(!/https?:\/\//.test(read('src/shop/loadMore.js')),
    'there is no shop address anywhere in this file');
}

console.log('\n=== 4. AND WHAT PRESSING DOES NOT BUY, WRITTEN DOWN RATHER THAN FOUND OUT ===');
{
  // A HONEST LIMIT ON THE HONEST LIMIT. Expanding the list to 64 rows does not
  // mean 64 orders are read: the detail phase slices to MOST_DETAIL_PAGES. This
  // is checked so that the day somebody raises one number they see the other.
  ok(MOST_DETAIL_PAGES < PRESSES_AT_MOST * ROWS_A_PRESS_ADDS,
    'the read can now SEE far more rows than it can open, and that is the real bound');
  const said = read('src/shop/loadMore.js');
  ok(/MOST_DETAIL_PAGES/.test(said) && /MOST_TIME_MS/.test(said),
    'and this file names both numbers that cap it, so the trade is not a surprise');
  ok(/does NOT mean 64 orders are read/.test(said),
    'and says plainly what pressing does not buy');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
