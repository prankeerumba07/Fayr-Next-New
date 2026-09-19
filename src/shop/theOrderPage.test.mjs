// ONE TAP COPIES THE REVIEW AND OPENS THAT ORDER — Phase 7, Task 5.
//
// The only genuinely new behaviour of the phase. Three things are pinned: the
// copy is the box's own text, the review step lands on the ORDER's page, and 6A's
// shopping session still lands on the front page and never an order list.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { theOrderPage } from './theOrderPage.js';
import { whereToLand } from './insideFayr.js';

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

/** Zepto's measured shape, read off the frozen detailLook.js and not typed here. */
const ZEPTO = (() => {
  const src = read('src/order/detailLook.js');
  const detail = (src.match(/export const ZEPTO_ORDER_DETAIL_PAGE = '([^']+)'/) || [])[1];
  const tail = (src.match(/export const ZEPTO_ORDER_DETAIL_TAIL = '([^']*)'/) || [])[1];
  return { detail, tail };
})();
const ZEPTO_START = (() => {
  const src = read('src/platforms.js');
  return (src.match(/\nconst zepto\s*=\s*\{[\s\S]*?startUrl:\s*'([^']+)'/) || [])[1]
    || 'https://www.zepto.com/account/orders';
})();

console.log('=== 1. THE ORDER PAGE IS BUILT FROM THE MEASURED SHAPE AND THE NUMBER ===');
{
  ok(ZEPTO.detail === 'https://www.zepto.com/order/', 'the shape was read off detailLook.js');
  const url = theOrderPage(ZEPTO, 'a1b2c3d4-0000-4000-8000-000000000000');
  ok(url === 'https://www.zepto.com/order/a1b2c3d4-0000-4000-8000-000000000000?isArchived=false',
    'the number goes in the middle, with the tail the shop’s own links carry');
  for (const bad of ['', null, undefined, 7, '../account', 'x/y', 'a?b', 'a b', 'abc#']) {
    ok(theOrderPage(ZEPTO, bad) === null, `${JSON.stringify(bad)} is not an order number, so nowhere`);
  }
  ok(theOrderPage(null, 'abc') === null && theOrderPage({}, 'abc') === null,
    'a shop with no measured shape has nowhere to send anybody');
  ok(!/https?:\/\//.test(read('src/shop/theOrderPage.js')), 'and the file holds no address of its own');
}

console.log('\n=== 2. THE REVIEW STEP LANDS ON THE ORDER’S PAGE, NOT THE SHOP’S HOME ===');
{
  const orderUrl = theOrderPage(ZEPTO, 'a1b2c3d4-0000-4000-8000-000000000000');
  const land = whereToLand('zepto', { orderUrl, startUrl: ZEPTO_START });
  ok(land != null && land.kind === 'order', 'a session handed an order address lands on an order');
  ok(land.url === orderUrl, 'exactly that one');
  ok(/\/order\//.test(land.url) && !/\/account\/orders/.test(land.url),
    'which is the order’s own page and not the order list');
  // REFUSED, NOT REDIRECTED, when it cannot be trusted.
  ok(whereToLand('zepto', { orderUrl: 'https://evil.example/order/x', startUrl: ZEPTO_START }) === null,
    'an order address on another site is nowhere, not the home page');
  ok(whereToLand('zepto', { orderUrl: 'javascript:alert(1)', startUrl: ZEPTO_START }) === null,
    'and so is one the view would not load');
  ok(whereToLand('amazon', { orderUrl: 'https://www.amazon.in/order/1', startUrl: 'https://www.amazon.in/' }) === null,
    'and a shop outside Fayr has no order landing either');
}

console.log('\n=== 3. 6A’S SHOPPING SESSION STILL LANDS ON THE HOME PAGE, NEVER AN ORDER LIST ===');
{
  const shopping = whereToLand('zepto', { productUrl: null, startUrl: ZEPTO_START });
  ok(shopping.kind === 'shop' && shopping.url === 'https://www.zepto.com/',
    'no order address handed in means the front page');
  ok(!/order/i.test(new URL(shopping.url).pathname), 'with no order path of any shape');
  ok(whereToLand('zepto', { orderUrl: '', productUrl: null, startUrl: ZEPTO_START }).kind === 'shop',
    'and an empty order address is the same as none');
}

console.log('\n=== 4. ONE TAP DOES BOTH, AND THE COPIED STRING IS THE BOX’S OWN TEXT ===');
{
  const screen = withoutComments(read('src/review/WriteReviewScreen.js'));
  const tap = screen.slice(screen.indexOf('const copyAndOpenTheOrder = useCallback'),
    screen.indexOf('}, [text, campaignId, taskId, campaign, navigation]);'));
  ok(tap.length > 50, 'the one tap is where expected');
  ok(/setCopied\(copyToClipboard\(text\)\);/.test(tap), 'THE TAP COPIES `text` ITSELF');
  ok(!/text\.trim\(\)|text\.replace\(|text\.normalize\(|\.trimEnd\(|\.trimStart\(/.test(tap),
    'and never trims, replaces or normalises it');
  // THE KEY, NOT THE NUMBER — corrected 19 September 2026, Phase 8A. This
  // pinned `orderId`, the order NUMBER the page prints, and a Zepto order's page
  // is addressed by the UUID in its link. The record carries that key now.
  ok(/navigation\.navigate\('Shop', \{[\s\S]*land: 'order',[\s\S]*orderKey,/.test(tap),
    'AND THE SAME TAP OPENS THE SHOP ON THAT ORDER, by the key in its address');
  ok(/const orderKey = theWatchedOrderKey\(task\);/.test(tap),
    'and the key is the record’s, read by the one helper that reads it');
  ok(!/orderId/.test(tap), 'and the order NUMBER is not handed over as an address');
  ok(tap.indexOf('copyToClipboard(text)') < tap.indexOf("navigate('Shop'"),
    'copy first, then open, so a navigation that fails still leaves the words on the clipboard');
  // THE PLAIN COPY IS THE SAME COPY.
  const plain = screen.slice(screen.indexOf('const copy = useCallback'), screen.indexOf('const copyAndOpenTheOrder'));
  ok(/setCopied\(copyToClipboard\(text\)\);/.test(plain), 'and the plain copy is the identical call');
  ok((screen.match(/copyToClipboard\(text\)/g) || []).length === 2 && !/copyToClipboard\([^t]/.test(screen),
    'so the clipboard is only ever handed `text` itself, from two places');
  ok(/onPress=\{copyAndOpenTheOrder\}/.test(screen), 'and the tap is on a control');
  // AND THE SCREEN TELLS OUR SIDE, without refusing when it cannot.
  ok(/markVisitedShop\(campaignId, WENT_TO_REVIEW\);/.test(tap) && /await goingToTheReview\(taskId\);/.test(tap),
    'the note and the record are written, as the old door wrote them');
  // NOTHING ASKS FOR A NUMBER OR A WORD.
  ok(!/useState\([1-5]\)/.test(screen), 'and nothing pre-selects a number of stars');
}

console.log('\n=== 5. COMING BACK RUNS THE READ, AND NOBODY IS ASKED ===');
{
  const shop = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/const landingOnAnOrder = params\.land === 'order'\s*&& typeof params\.orderKey === 'string' && params\.orderKey !== '';/.test(shop),
    'the shop screen knows which door it came in by, and an order door needs a key');
  ok(/theOrderPage\(howThisShopNamesAnOrder\(key\), params\.orderKey\)/.test(shop),
    'and builds the order page from the measured shape and the KEY in the record');
  ok(!/params\.orderId/.test(shop), 'and never from the order number');
  // ENDED AT THE CALLBACK'S OWN DEPENDENCY LIST. The first writing ended it at
  // `if (!landing || !platform)`, which also appears EARLIER in the file, so
  // the slice ran backwards and was empty — and the check failed on correct
  // code. Caught on its first run, not by a mutation, but the same lesson.
  const leaveStart = shop.indexOf('const leave = useCallback');
  const leave = shop.slice(leaveStart, shop.indexOf('}, [saveSession, navigation, landingOnAnOrder', leaveStart));
  ok(leave.length > 100, 'the leave callback is where expected');
  // THE SAME ONE PAGE, READ AGAIN — corrected 19 September 2026, Phase 8A. This
  // pinned LookingForReview, which walks a shop's public review list; these
  // shops have none, so it looked at nothing. The read on the way back is the
  // watched order's own page, and the server reads the rated signal off it.
  ok(/if \(landingOnAnOrder && campaignId\) \{[\s\S]*navigation\.replace\('LookingForIt', \{ campaignId \}\);/.test(leave),
    'LEAVING THE ORDER PAGE RE-READS THAT PAGE, and the server decides what it saw');
  ok(!/LookingForReview/.test(shop), 'and the shop screen no longer names the review-list read at all');
  ok(!/HAVE_YOU_POSTED|Have you posted|Alert\.alert/.test(shop), 'and asks nothing on the way');
  // The review step's asking faces are gone for a shop inside Fayr.
  const guide = withoutComments(read('src/screens/reviewguide.js'));
  ok(/inFayrShop: shopsInsideFayr\(key\),/.test(guide), 'the review guide tells the face-decider which shop this is');
  ok(/\{!shopsInsideFayr\(key\) \? \(\s*<>\s*<Pill onPress=\{goingToWriteIt\}/.test(guide),
    'and the two doors to the shop’s own APP are drawn only for the four other shops');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
