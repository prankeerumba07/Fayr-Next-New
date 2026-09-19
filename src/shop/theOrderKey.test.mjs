// THE KEY IN THE ADDRESS, READ OUT OF THE OWNER'S OWN PURCHASE — Phase 8A, Task 1.
//
// Every address here is off .local-logs/run.log, 18 September 2026. The thing
// worth proving hardest is the one that broke: that the live order page is
// PLACED and the bare order page is NOT, for the same key, in the same rule
// order — and that the key comes out of the first and never out of the second.
//
// AND THAT BLINKIT AND INSTAMART ARE STILL EMPTY. The owner: "Blinkit and
// Instamart have EMPTY order tables and KEEP them in this prompt." This file
// fails the day either table stops being empty.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOPS_INSIDE_FAYR, anybodyHasMeasured } from './insideFayr.js';
import {
  AN_ORDER_KEY, BECAUSE_ORDER, CANNOT_TELL, NOT_PLACED, PLACED, markMatches,
  pathKeepingCase, theOrderKeyInTheAddress, whatTheOrderPageSays,
} from './theOrderPlaced.js';

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

const UUID = '01a0b4d7-870c-7dca-b701-e038477c5106';
const LIVE = `https://www.zepto.com/order/status/${UUID}?referrer=home&from=ProcessOrder`;
const OWN = `https://www.zepto.com/order/${UUID}?child=true`;
const LIST = 'https://www.zepto.com/account/orders';

console.log('=== 1. THE REAL CONFIRMATION ADDRESS IS PLACED, AND THE KEY COMES OUT OF IT ===');
{
  const out = whatTheOrderPageSays('zepto', { title: 'none', url: LIVE });
  ok(out.said === PLACED, 'the live order page is PLACED');
  ok(out.because === BECAUSE_ORDER.THE_ADDRESS_SAYS_SO, 'by the address');
  ok(out.orderKey === UUID, 'AND THE KEY IS THE UUID IN THE ADDRESS');
  ok(theOrderKeyInTheAddress('zepto', LIVE) === UUID, 'read by the one reader, off the path');
  ok(theOrderKeyInTheAddress('zepto', `https://www.zepto.com/order/status/${UUID}`) === UUID,
    'with nothing after it too');
  ok(theOrderKeyInTheAddress('zepto', `https://www.zepto.com/order/status/${UUID}/track#x`) === UUID,
    'and cut at the next slash or hash');
  ok(theOrderKeyInTheAddress('zepto', 'https://www.zepto.com/order/status/ABC-def.1_2?x=1') === 'ABC-def.1_2',
    'WITH ITS CASE KEPT: a key is an address part, and lower-casing it changes what is opened');
  ok(theOrderKeyInTheAddress('zepto', 'HTTPS://WWW.ZEPTO.COM/ORDER/STATUS/abc') === 'abc',
    'while the fragment is found whatever case the shop wrote it in');
}

console.log('\n=== 2. THE LIST AND THE BARE ORDER PAGE ARE NOT PLACED, AND GIVE OUT NO KEY ===');
{
  const list = whatTheOrderPageSays('zepto', { title: 'My Orders', url: LIST });
  ok(list.said === NOT_PLACED && list.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN,
    'the list is NOT_PLACED, by name');
  ok(list.orderKey === null, 'and gives out no key');
  const own = whatTheOrderPageSays('zepto', { title: 'none', url: OWN });
  ok(own.said === NOT_PLACED && own.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN,
    'the bare order page — the same key, without /status/ — is NOT_PLACED, by name');
  ok(own.orderKey === null, 'AND GIVES OUT NO KEY: a key comes only off a page that placed an order');
  ok(whatTheOrderPageSays('zepto', { title: 'none', url: `https://www.zepto.com/order/${UUID}?isArchived=false` }).said === NOT_PLACED,
    'and so is the order page in the shape the shop’s own links carry');
  // THE SAME KEY, TWO PAGES, TWO ANSWERS. This is the bug of 18 September 2026
  // stated as one line: '/order/' used to swallow '/order/status/'.
  ok(whatTheOrderPageSays('zepto', { title: 'none', url: LIVE }).said === PLACED
    && whatTheOrderPageSays('zepto', { title: 'none', url: OWN }).said === NOT_PLACED,
  'THE LIVE PAGE AND THE OWN PAGE FOR ONE KEY ANSWER DIFFERENTLY, and the right way round');
  ok(whatTheOrderPageSays('zepto', { title: 'x', url: `https://www.zepto.com/ProcessOrder?order_id=${UUID}` }).said === CANNOT_TELL,
    'and the payment-processing page before it is CANNOT TELL, not a purchase');
}

console.log('\n=== 3. THE KEY IS NEVER GUESSED, AND NEVER SOMETHING THAT COULD STEER A VIEW ===');
{
  for (const bad of [
    'https://www.zepto.com/order/status/', 'https://www.zepto.com/order/status/?x=1',
    'https://www.zepto.com/order/status/a%20b', 'https://www.zepto.com/order/status/a+b',
    'https://www.zepto.com/order/status/a:b',
  ]) {
    ok(theOrderKeyInTheAddress('zepto', bad) === null, `${bad.slice(22)} yields no key`);
  }
  for (const notWeb of ['upi://pay?tr=x', 'about:blank', '/order/status/abc', '', null, 7, {}]) {
    ok(theOrderKeyInTheAddress('zepto', notWeb) === null, `${JSON.stringify(notWeb)} is not a web address, so no key`);
  }
  ok(theOrderKeyInTheAddress('zepto', `https://www.zepto.com/orders/status/${UUID}`) === null,
    'a fragment that is almost the right one is not the right one');
  ok(AN_ORDER_KEY.source === '^[A-Za-z0-9._-]+$',
    'the shape is the same one theOrderPage.js accepts before putting a key in a URL');
  ok(/^\[A-Za-z0-9._-\]\+\$/.test(read('src/shop/theOrderPage.js').match(/\/\^(\[A-Za-z0-9._-\]\+)\$\//)?.[0]?.slice(2) ?? '')
    || /\^\[A-Za-z0-9\._-\]\+\$/.test(read('src/shop/theOrderPage.js')),
  'and theOrderPage.js still holds that exact shape');
  ok(pathKeepingCase('https://www.zepto.com/Order/Status/AbC?q=1') === '/Order/Status/AbC?q=1',
    'the path is read with its case, query and all');
  ok(pathKeepingCase('/relative') === null && pathKeepingCase(null) === null,
    'and a thing that is not a web address has no path');
}

console.log('\n=== 4. THE ANSWER’S SHAPE: said, because, orderKey — AND NOTHING ELSE ===');
{
  const keys = (out) => Object.keys(out).sort().join(',');
  ok(keys(whatTheOrderPageSays('zepto', { title: 'none', url: LIVE })) === 'because,orderKey,said',
    'a PLACED answer carries the three fields');
  ok(keys(whatTheOrderPageSays('zepto', { title: 'none', url: LIST })) === 'because,orderKey,said',
    'and so does a NOT_PLACED one, with the key null');
  ok(keys(whatTheOrderPageSays('amazon', {})) === 'because,orderKey,said',
    'and a shop that is not taught, so callers reading said/because see what they saw before');
  // orderKey IS NULL UNLESS PLACED, walked over every rule that does not place.
  for (const [key, page] of [
    ['amazon', { title: 'Order Placed', url: 'https://x.in/order/status/abc' }],
    ['zepto', {}],
    ['zepto', { title: 'none', url: LIST }],
    ['zepto', { title: 'none', url: OWN }],
    ['zepto', { title: 'Order Placed', url: 'https://www.zepto.com/' }],
    ['blinkit', { title: 'Order Placed', url: 'https://x.in/order/status/abc' }],
  ]) {
    const out = whatTheOrderPageSays(key, page);
    ok(out.said !== PLACED && out.orderKey === null, `${key} ${JSON.stringify(page.url)}: not PLACED, so no key`);
  }
}

console.log('\n=== 5. A MARK IS A FRAGMENT OR A SHAPE, AND NEVER AN ADDRESS ===');
{
  ok(markMatches('/account/orders', '/account/orders?x=1') === true, 'a string fragment matches anywhere in the path');
  ok(markMatches('/order/', '/order/status/abc') === true,
    'and the OLD bare fragment really did match the live page — which is the bug, stated');
  ok(markMatches(/^\/order\/(?!status\/)/, '/order/status/abc') === false,
    'while the shape that replaced it does not');
  ok(markMatches(/^\/order\/(?!status\/)/, `/order/${UUID}?child=true`) === true,
    'and still matches the bare order page');
  for (const junk of [null, undefined, 7, {}, [], '']) {
    ok(markMatches(junk, '/order/x') === false, `${JSON.stringify(junk)} is not a mark and matches nothing`);
  }
  ok(markMatches('/order/', null) === false, 'and no path matches nothing');
  // NO ADDRESS IN EITHER FILE. The domain lives once, in the frozen platforms.js.
  ok(!/https?:\/\//.test(withoutComments(read('src/shop/insideFayr.js'))),
    'insideFayr.js holds no web address');
  ok(!/zepto\.com|zeptonow|blinkit\.com|swiggy/.test(withoutComments(read('src/shop/insideFayr.js'))),
    'and names no shop domain');
  ok(!/zepto\.com|zeptonow|blinkit\.com|swiggy/.test(withoutComments(read('src/shop/theOrderPlaced.js'))),
    'and neither does theOrderPlaced.js');
  ok(!/from '\.\.\/platforms|from '\.\.\/order\//.test(withoutComments(read('src/shop/theOrderPlaced.js'))),
    'and it reads neither the frozen platforms.js nor the order reader');
}

console.log('\n=== 6. BLINKIT AND INSTAMART: CANNOT TELL, EVERYWHERE, AND THEIR TABLES STAY EMPTY ===');
{
  for (const key of ['blinkit', 'instamart']) {
    ok(Object.keys(SHOPS_INSIDE_FAYR[key].orderPlaced).length === 0,
      `${key}’S ORDER TABLE IS EMPTY — this is the line that fails the day it is not`);
    ok(anybodyHasMeasured(key) === false, `and nobody has measured ${key}`);
    for (const url of [
      `https://x.in/order/status/${UUID}`, `https://x.in/order/${UUID}`, 'https://x.in/account/orders',
    ]) {
      const out = whatTheOrderPageSays(key, { title: 'Order Placed', url });
      ok(out.said === CANNOT_TELL, `${key} cannot tell from ${url.slice(12)}`);
      ok(out.because === BECAUSE_ORDER.NOTHING_MEASURED_YET, `and says why: nobody has watched ${key} place an order`);
      ok(out.orderKey === null, `and ${key} yields no key`);
      ok(theOrderKeyInTheAddress(key, url) === null, `not even asked directly`);
    }
  }
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra', 'ebay', null]) {
    ok(theOrderKeyInTheAddress(key, LIVE) === null, `${JSON.stringify(key)} has no key to give`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
