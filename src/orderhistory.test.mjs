// Reading a shop's own list of recent orders, on the phone.
//
// The whole of the pure half is checked here, with no phone and no shop: a page
// of markup goes in, one piece of text per order comes out. What any of that text
// MEANS is the server's business and is checked over there, in
// backend/src/ocr/order-text.spec.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LIST_TIMEOUT_MS, MOST_RECENT_ORDERS, ORDER_LIST_PAGES, buildOrderListScript,
  orderListPageFor, pageToLines, readListOutcome, readOrderBlocks,
} from './orderhistory.js';

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.deepStrictEqual(a, b, what); };

// ── 1. the cap is a named number, and it is the owner's ──────────────────────
eq(MOST_RECENT_ORDERS, 20, 'twenty orders back, as the owner asked');
ok(Number.isInteger(MOST_RECENT_ORDERS) && MOST_RECENT_ORDERS > 0, 'a real count');

// ── 2. which shops can be looked at, and which honestly cannot ───────────────
eq(orderListPageFor('zepto'), 'https://www.zepto.com/account/orders',
  'zepto has a page of text listing orders');
ok(orderListPageFor('amazon').startsWith('https://www.amazon.in/'),
  'amazon has one too');
// The four that cannot be read this way answer null rather than a wrong address.
for (const key of ['flipkart', 'blinkit', 'instamart', 'myntra']) {
  eq(orderListPageFor(key), null, `${key} cannot be looked at this way, and says so`);
}
// A shop Fayr has never heard of is null, not a crash.
for (const junk of [null, undefined, '', 'ebay', 5, {}]) {
  eq(orderListPageFor(junk), null, 'an unknown shop is null');
}
// Every address is a real web address on the shop's own site, and carries no
// marker of any kind. The rule about never adding a tracking marker to a shop
// address applies to these too.
for (const [key, url] of Object.entries(ORDER_LIST_PAGES)) {
  ok(/^https:\/\//.test(url), `${key} is fetched over a secure address`);
  ok(!/utm_|tag=|affid|aff_|ref=fayr|source=fayr/i.test(url),
    `${key} carries no tracking or affiliate marker`);
}

// ── 3. the fetch script is the one that already exists ───────────────────────
const script = buildOrderListScript('https://www.zepto.com/account/orders');
ok(script.includes('window.ReactNativeWebView.postMessage'),
  'it answers the one way the app listens');
ok(script.includes("credentials: 'include'"),
  'it uses the sign in that is already in the web view');
ok(script.includes('if (sent) return; sent = true;'),
  'it answers exactly once, whatever happens');
ok(script.includes(String(LIST_TIMEOUT_MS)), 'it gives up after the stated wait');
// ONE ATTEMPT. A retry is what pushing against a shop looks like.
eq(script.match(/fetch\(/g).length, 1, 'it fetches once and does not try again');
ok(!/setInterval|for\s*\(|while\s*\(/.test(script), 'there is no loop in it');
// The address is written in as text, so a strange address cannot become code.
ok(buildOrderListScript('"); alert(1); ("').includes('\\"'),
  'the address is quoted, so nothing in it can run');
// NO CREDENTIAL, TOKEN OR KEY IS ANYWHERE NEAR THIS.
for (const word of ['token', 'password', 'Bearer', 'cookie', 'authorization']) {
  ok(!new RegExp(word, 'i').test(script), `the script never mentions ${word}`);
}
// ── AND FAYR TYPES NOTHING INTO A SHOP'S PAGE ────────────────────────────────
//
// The standing rule, and nothing checked it for THIS script until now. The
// plain-language check on the backend holds a fixed list of five files and this
// is not one of them, so a page script here carrying a click passed everything.
// The same walk runs against the drawn-list script next door.
for (const typing of [
  '.click(', '.focus(', '.blur(', '.submit(', '.value', 'dispatchEvent',
  'document.forms', 'execCommand', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
  'scrollTo', 'scrollIntoView', 'requestSubmit', 'localStorage', 'sessionStorage',
]) {
  ok(!script.includes(typing), `the script contains "${typing}", which is typing or tapping`);
}
// ── AND EVERY ANSWER CARRIES THE NAME OF THE LOOK THAT ASKED FOR IT ─────────
//
// The web view now sits on a shop's own page for part of a look rather than on
// its front door, and every frame on that page posts into the one handler with
// nothing to say who sent it. See anAnswerTag in src/order/drawnList.js.
const named = buildOrderListScript('https://www.zepto.com/account/orders', 'look-7-abc');
ok(named.includes('o.tag = "look-7-abc"'), 'the answer says which look it belongs to');
// STAMPED INSIDE send(), which is the one place every answer passes through, so
// it cannot matter which of the four ways out a future edit adds a fifth beside.
eq((named.match(/o\.tag = /g) || []).length, 1, 'and it is stamped in one place only');
ok(buildOrderListScript('https://x/', '"); alert(1); ("').includes('\\"'),
  'the name is quoted too, so nothing in it can run');
ok(script.includes('o.tag = ""'), 'and a look with no name says so rather than guessing');

// ── 4. a page becomes the lines a person would see ───────────────────────────
eq(pageToLines('<div>Hello</div><div>World</div>'), ['Hello', 'World'],
  'two boxes are two lines, never one sentence');
eq(pageToLines('<script>var a = "Order ID 1"</script><p>Real</p>'), ['Real'],
  'instructions in the page are not words on it');
eq(pageToLines('<style>.a{content:"Order"}</style><p>Real</p>'), ['Real'],
  'and neither is styling');
eq(pageToLines('<!-- Order ID 999 --><p>Real</p>'), ['Real'],
  'and neither is a note left in the markup');
eq(pageToLines('<p>Total &#8377;368</p>'), ['Total ₹368'],
  'a rupee written as a number becomes a rupee');
eq(pageToLines('<p>Tea &amp; Biscuits</p>'), ['Tea & Biscuits'],
  'an and written out becomes an and');
eq(pageToLines('<p>a&nbsp;&nbsp;b</p>'), ['a b'], 'stuck together spaces collapse');
for (const junk of [null, undefined, 5, {}, '']) {
  eq(pageToLines(junk), [], 'anything that is not a page is no lines');
}

// ── 5. one piece of text per order ───────────────────────────────────────────
const TWO_ORDERS = `
<div class="orders">
  <h1>Your Orders</h1>
  <div class="row">
    <span>Order ID</span><span>SOSIJGGRL26770</span>
    <span>Placed on 21 Aug 2026</span>
    <span>Boldfit Strapless Sports Headband</span><span>1 x &#8377;149</span>
    <span>Total &#8377;368</span>
  </div>
  <div class="row">
    <span>Order ID</span><span>SOSABCDEF12345</span>
    <span>Placed on 14 Aug 2026</span>
    <span>Hammer Nova earphones</span><span>1 x &#8377;219</span>
    <span>Total &#8377;219</span>
  </div>
</div>`;
const blocks = readOrderBlocks(TWO_ORDERS);
eq(blocks.length, 2, 'two orders on the page are two pieces of text');
ok(blocks[0].includes('SOSIJGGRL26770'), 'the newest order is first');
ok(blocks[1].includes('SOSABCDEF12345'), 'the older one is second');
// AND NOTHING LEAKS BETWEEN THEM. This is the whole job of this file: an order
// carrying a price that belongs to a different order is how somebody gets told
// their own order is not theirs.
ok(!blocks[0].includes('SOSABCDEF12345'), 'the first order holds none of the second');
ok(!blocks[0].includes('219'), 'nor the second order’s price');
ok(!blocks[1].includes('149'), 'and the second holds none of the first');
ok(!blocks[0].includes('Your Orders'), 'the page’s own heading is not part of an order');

// ── 5b. the other layout, where the day comes BEFORE the number ─────────────
// Amazon's cards print the day at the top and the number lower down. A reader
// that cut only on numbers would leave each card's day at the bottom of the card
// ABOVE it, handing the server one order's date beside another order's price.
const DATE_FIRST = `
<div>
  <h1>Your Orders</h1>
  <div class="card">
    <span>ORDER PLACED</span><span>5 June 2026</span>
    <span>TOTAL</span><span>&#8377;1,326.00</span>
    <span>ORDER #</span><span>402-3925017-7784521</span>
    <span>Prestige Induction Cooktop 1900W Black</span>
  </div>
  <div class="card">
    <span>ORDER PLACED</span><span>2 May 2026</span>
    <span>TOTAL</span><span>&#8377;499.00</span>
    <span>ORDER #</span><span>408-1112223-3334445</span>
    <span>Boldfit Strapless Sports Headband</span>
  </div>
</div>`;
const cards = readOrderBlocks(DATE_FIRST);
eq(cards.length, 2, 'two cards are two orders, whichever way round they are laid out');
ok(cards[0].includes('5 June 2026'), 'the first card keeps its own day');
ok(cards[0].includes('402-3925017-7784521'), 'and its own number');
ok(!cards[0].includes('2 May 2026'), 'and none of the next card’s day');
ok(!cards[0].includes('499'), 'and none of the next card’s price');
ok(cards[1].includes('2 May 2026'), 'the second card keeps its own day');
ok(!cards[0].includes('Your Orders'), 'the page’s heading belongs to no order');

// ── 6. the cap is really applied ─────────────────────────────────────────────
const many = Array.from({ length: 45 }, (_, i) => (
  `<div><span>Order ID</span><span>ORDER${1000 + i}</span>`
  + `<span>Placed on 1 Aug 2026</span><span>Total &#8377;${100 + i}</span></div>`
)).join('');
const capped = readOrderBlocks(many);
eq(capped.length, MOST_RECENT_ORDERS, 'never more than the cap, however long the page');
ok(capped[0].includes('ORDER1000'), 'and it is the most recent that are kept');
ok(!capped.some((b) => b.includes('ORDER1020')), 'the twenty first is not kept');

// ── 7. a page with no orders on it ───────────────────────────────────────────
eq(readOrderBlocks('<p>Please sign in to see your orders</p>'), [],
  'a page that is really a sign in wall holds no orders');
eq(readOrderBlocks('<p>You have not placed any orders yet</p>'), [],
  'an empty list holds no orders');
for (const junk of [null, undefined, 5, {}, '']) {
  eq(readOrderBlocks(junk), [], 'anything that is not a page holds no orders');
}

// ── 8. what one look ended in ────────────────────────────────────────────────
let out = readListOutcome({ ok: true, status: 200, html: TWO_ORDERS });
eq(out.looked, true, 'a page that came back with orders on it is a look');
eq(out.blocks.length, 2, 'and it carries both');
// A SIGN IN WALL IS NOT AN ERROR TO SHOW ANYBODY. It is "we could not look", and
// the journey asks the person instead.
for (const bad of [
  { ok: false, status: 0, html: '' },
  { ok: true, status: 302, html: '' },
  { ok: true, status: 401, html: '<p>Sign in</p>' },
  { ok: true, status: 500, html: '' },
  { ok: true, status: 200, html: '<p>Sign in to continue</p>' },
  null, undefined, {},
]) {
  const r = readListOutcome(bad);
  eq(r.looked, false, 'we could not look');
  eq(r.blocks, [], 'and there is nothing to send');
}

// ── 9. this file reads no shop's rules and writes none ───────────────────────
const src = readFileSync(new URL('./orderhistory.js', import.meta.url), 'utf8');
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');
// It must not grow its own opinion about what an order says. Those words belong
// to the server, once, in backend/src/ocr/order-text.ts.
for (const word of ['pricePaise', 'totalPaise', 'matchOrderToCampaign', 'paiseFromRupees']) {
  ok(!code.includes(word),
    `orderhistory.js must not read fields itself: it mentions ${word}`);
}
// And it must not have been allowed to edit either frozen file.
ok(code.includes("from './platforms.js'"), 'it reads platforms.js');
ok(!code.includes('fetchScript'), 'it does not use or change the shop scripts');

// ── THREE MONTHS OF LOOKING AT AN EMPTY LIST ────────────────────────────────
//
// Measured on the owner's own signed-in account, 15 September 2026. Without a
// time filter the shop answers "0 orders placed in past 3 months"; with
// ?timeFilter=year-2026 the SAME address answers with thirteen, including the
// order the campaign was written for. Every drew=false and rows=0/0 in five days
// of logs was a correct reading of a page that had nothing on it.
ok(/[?&]timeFilter=year-\d{4}\b/.test(ORDER_LIST_PAGES.amazon),
  'THE LIST ASKS FOR A WHOLE YEAR. Without it the shop shows the last three '
  + 'months, which is empty for anybody who has not bought recently');
ok(ORDER_LIST_PAGES.amazon.includes(`year-${new Date().getFullYear()}`),
  'and the year comes off the clock, not out of the file — a written down year '
  + 'starts showing nothing again on the first of January');
ok(ORDER_LIST_PAGES.amazon.startsWith('https://www.amazon.in/your-orders/orders'),
  'and it is still the same page, with one more question asked of it');

console.log(`orderhistory: ${checks} checks passed`);
