// READING THE ORDER'S OWN PAGE: THE HALF THAT CAN BE CHECKED WITHOUT A PHONE.
//
// WHY THIS EXISTS AT ALL. Amazon's list of orders is filled in by its own code
// after the page arrives, and a fetch runs none of it, so the cards come back as
// empty frames. Measured twice, fourteen minutes apart in one session: eight
// matched products, then none. The ONE thing that survives is each card's own
// attribute carrying the order number, because an attribute is in the markup as
// sent — so the list is worth exactly the numbers, and everything else is on the
// order's own server-rendered page.
//
// WHAT IS CHECKED HERE is the harvesting, the address building and the politeness
// limits. What CANNOT be checked here is what a real Amazon order page says; that
// is a fixture at best, and the check that reads the text lives with the server's
// own reader where the one reader for all of this lives.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  AMAZON_ORDER_DETAIL_PAGE, GAP_BETWEEN_FETCHES_MS, MOST_DETAIL_PAGES,
  HOW_EACH_SHOP_NAMES_AN_ORDER, ORDER_ID_PARAM, ORDER_NUMBER_RUN,
  AMAZON_ORDER_NUMBER_SHAPE, SHOPS_READ_ONE_ORDER_AT_A_TIME, howThisShopNamesAnOrder,
  countOrderCardSlots, harvestByShape, harvestFromOrderLinks, harvestOrderNumbers,
  harvestRendered,
  orderDetailPageFor, pagesToOpen, readsOrderPages, waitBeforeFetch,
} from './detailLook.js';
import { readDetailOutcome, readListOutcome } from '../orderhistory.js';

const { ok, equal, deepEqual } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

/** A card as Amazon really sends it: the number in the attribute, no text. */
const card = (number) =>
  `<div class="order-card js-order-card" data-csa-c-slot-id="amzn1.yourorders.order-card.${number}">`
  + '<div class="a-box-inner"><span class="a-color-secondary"></span></div></div>';

const listPage = (...numbers) =>
  `<html><head><title>Your Orders</title></head><body><div id="ordersContainer">${
    numbers.map(card).join('')}</div></body></html>`;

console.log('\nharvesting the order numbers out of the empty frames');

it('finds every order number, in the order the page had them', () => {
  const html = listPage('408-5094957-4481129', '402-3925017-7784521');
  deepEqual(harvestOrderNumbers(html, 'amazon'), [
    '408-5094957-4481129', '402-3925017-7784521',
  ]);
});

it('NEWEST FIRST, because the page is, and nothing here sorts', () => {
  // Amazon lists its orders newest first. Sorting here would need a date, and no
  // date survives on this page to sort by — which is the whole reason the order
  // pages have to be opened at all.
  const html = listPage('403-0000001-0000001', '403-0000002-0000002');
  equal(harvestOrderNumbers(html, 'amazon')[0], '403-0000001-0000001');
});

it('each one once, however many times the page names it', () => {
  const n = '408-5094957-4481129';
  deepEqual(harvestOrderNumbers(listPage(n, n, n), 'amazon'), [n]);
});

it('IGNORES anything that is not an order number rather than fetching it', () => {
  // This value goes into an address. An address built out of whatever a page
  // happened to contain is the one thing that must not happen here.
  const html = listPage(
    'junk', '', '408-5094957-4481129', '12345', '../../etc/passwd',
    '408-5094957-448112', '408-5094957-44811299',
  );
  deepEqual(harvestOrderNumbers(html, 'amazon'), ['408-5094957-4481129']);
});

it('is not fooled by a different slot id on the same page', () => {
  const html = '<div data-csa-c-slot-id="amzn1.yourorders.filter.408-5094957-4481129"></div>'
    + card('402-3925017-7784521');
  deepEqual(harvestOrderNumbers(html, 'amazon'), ['402-3925017-7784521']);
});

it('reads single quotes as well as double, because a page is written by anything', () => {
  const html = "<div data-csa-c-slot-id='amzn1.yourorders.order-card.408-5094957-4481129'></div>";
  deepEqual(harvestOrderNumbers(html, 'amazon'), ['408-5094957-4481129']);
});

it('and answers nothing at all for nothing at all', () => {
  for (const junk of [null, undefined, '', 42, {}, [], '<html></html>']) {
    deepEqual(harvestOrderNumbers(junk, 'amazon'), []);
  }
});

it('ANSWERS THE SAME TWICE, so a remembered position cannot change it', () => {
  // A global expression remembers where it stopped. A shared one would give a
  // different answer the second time it was asked about the same page.
  const html = listPage('408-5094957-4481129', '402-3925017-7784521');
  deepEqual(harvestOrderNumbers(html, 'amazon'), harvestOrderNumbers(html, 'amazon'));
});

console.log('\nthe address of one order');

it('builds the order page address from the number', () => {
  equal(
    orderDetailPageFor('amazon', '408-5094957-4481129'),
    `${AMAZON_ORDER_DETAIL_PAGE}408-5094957-4481129`,
  );
});

it('is the server-rendered page, not the list one', () => {
  ok(AMAZON_ORDER_DETAIL_PAGE.includes('/gp/your-account/order-details'));
  ok(AMAZON_ORDER_DETAIL_PAGE.startsWith('https://'));
});

it('NULL, never a guessed address, for anything that is not an order number', () => {
  for (const junk of [
    null, undefined, '', 'junk', '12345', 42, {},
    '408-5094957-4481129 OR 1=1', 'http://elsewhere.invalid',
  ]) {
    equal(orderDetailPageFor('amazon', junk), null);
  }
});

it('and it trims, because a page carries whitespace', () => {
  equal(
    orderDetailPageFor('amazon', '  408-5094957-4481129  '),
    `${AMAZON_ORDER_DETAIL_PAGE}408-5094957-4481129`,
  );
});

console.log('\nthe politeness limits, which exist because Amazon blocks us');

it('OPENS AT MOST SIX PAGES, whatever the list held', () => {
  const many = Array.from({ length: 20 }, (unused, i) =>
    `40${i % 10}-000000${i % 10}-000000${i % 10}`);
  equal(MOST_DETAIL_PAGES, 6);
  equal(pagesToOpen(many, 'amazon').length, MOST_DETAIL_PAGES);
});

it('and it is the FIRST six, which are the newest', () => {
  const numbers = ['401-0000001-0000001', '402-0000002-0000002', '403-0000003-0000003',
    '404-0000004-0000004', '405-0000005-0000005', '406-0000006-0000006',
    '407-0000007-0000007'];
  deepEqual(pagesToOpen(numbers, 'amazon'), numbers.slice(0, 6));
});

it('refuses anything that is not an order number even here', () => {
  deepEqual(pagesToOpen(['junk', '408-5094957-4481129', null, 7], 'amazon'), [
    '408-5094957-4481129',
  ]);
  deepEqual(pagesToOpen(null, 'amazon'), []);
});

it('WAITS A REAL GAP between fetches, and never before the first', () => {
  // The ordinary case is one order page, matched. A gap before the first would
  // make every single look slower and buy nothing.
  equal(waitBeforeFetch(0), 0);
  equal(waitBeforeFetch(1), GAP_BETWEEN_FETCHES_MS);
  equal(waitBeforeFetch(5), GAP_BETWEEN_FETCHES_MS);
  ok(GAP_BETWEEN_FETCHES_MS >= 1000, 'a token gap is not a gap');
});

it('and six pages with their gaps still fit inside the screen own ceiling', () => {
  // The screen sends everybody onward at twenty seconds whatever happens. The
  // gaps alone must not eat that, or a full look would always be cut off.
  const gaps = (MOST_DETAIL_PAGES - 1) * GAP_BETWEEN_FETCHES_MS;
  ok(gaps < 20000 / 2, `the gaps alone come to ${gaps}ms`);
});

it('junk index waits nothing rather than throwing', () => {
  for (const junk of [null, undefined, NaN, -1, 'two']) {
    equal(waitBeforeFetch(junk), 0);
  }
});

console.log('\nwhich shops are read this way');

it('the two whose lists are empty frames, and nobody else', () => {
  // ZEPTO JOINED ON 15 SEPTEMBER 2026. Its list is drawn like Amazon's and
  // carries no product name at all, so the list alone can never match a
  // campaign and each order's own page has to be opened.
  deepEqual(SHOPS_READ_ONE_ORDER_AT_A_TIME, ['amazon', 'zepto']);
  equal(readsOrderPages('amazon'), true);
  equal(readsOrderPages('AMAZON'), true);
  equal(readsOrderPages('zepto'), true);
  equal(readsOrderPages('ZEPTO'), true);
  // MEESHO'S LIST REALLY DOES CARRY ITS ORDERS AS TEXT, so reading it a page at
  // a time would be more requests for an answer already in hand. And Myntra is
  // dormant: its entry is preserved untouched and it is not read at all.
  for (const other of ['meesho', 'flipkart', 'blinkit', 'instamart',
    'myntra', '', null, undefined, 7]) {
    equal(readsOrderPages(other), false);
  }
  // AND THE LIST IS THE RECORD'S OWN KEYS, so a shop cannot be remembered in one
  // place and forgotten in the other.
  deepEqual(SHOPS_READ_ONE_ORDER_AT_A_TIME, Object.keys(HOW_EACH_SHOP_NAMES_AN_ORDER));
  // AND IT IS DERIVED IN THE FILE AND NOT TYPED OUT BESIDE IT. Said honestly:
  // the two spellings give the SAME value today, so nothing a check can call
  // tells them apart. This reads the file, because the property being kept is
  // that they cannot drift apart tomorrow.
  const file = readFileSync(new URL('./detailLook.js', import.meta.url), 'utf8');
  ok(file.includes(
    'export const SHOPS_READ_ONE_ORDER_AT_A_TIME = Object.keys(HOW_EACH_SHOP_NAMES_AN_ORDER);',
  ), 'the list of shops is the record own keys, so one cannot be added to only one of them');
});

it('and each shop is named by its OWN shape and its OWN address', () => {
  const amazon = howThisShopNamesAnOrder('amazon');
  const zepto = howThisShopNamesAnOrder('zepto');
  // THE WORD WE COUNT WITH COMES OFF THE ADDRESS WE ASK WITH, for both, which is
  // the rule this file has always followed and the reason neither is typed twice.
  equal(amazon.param, 'orderID=');
  ok(amazon.detail.endsWith(amazon.param), 'Amazon names its order in the query');
  equal(zepto.param, '/order/');
  ok(zepto.detail.endsWith(zepto.param), 'and Zepto names its order in the path');
  // THE TWO SHAPES ARE REALLY DIFFERENT, and neither accepts the other's.
  ok(amazon.shape.test('408-5094957-4481129'));
  ok(!amazon.shape.test('01a0397a-bbb4-7cd7-b611-0e68227a15f1'));
  ok(zepto.shape.test('01a0397a-bbb4-7cd7-b611-0e68227a15f1'));
  ok(!zepto.shape.test('408-5094957-4481129'));
  // LOWER CASE ONLY, WHICH IS WHAT WAS MEASURED. A case this file has never seen
  // is a guess, and widening a shape that goes into an address is how a page
  // nobody asked for gets opened. The tell if the measurement was ever wrong is
  // a line reading linked=8 opening=0 — every link found, every id refused.
  ok(!zepto.shape.test('01A0397A-BBB4-7CD7-B611-0E68227A15F1'),
    'an upper case uuid is not a shape this file has measured');
  ok(!zepto.shape.test('01a0397a-bbb4-7cd7-b611-0e68227a15f1x'));
  ok(!zepto.shape.test('x01a0397a-bbb4-7cd7-b611-0e68227a15f1'));
  // THE ADDRESSES, BOTH HALVES. Zepto's number sits in the MIDDLE of its address.
  equal(
    orderDetailPageFor('zepto', '01a0397a-bbb4-7cd7-b611-0e68227a15f1'),
    'https://www.zepto.com/order/01a0397a-bbb4-7cd7-b611-0e68227a15f1?isArchived=false',
  );
  equal(amazon.tail, '', 'and Amazon has no tail, so its address is what it always was');
  // AND NEITHER SHOP'S NUMBER EVER BUILDS THE OTHER SHOP'S ADDRESS.
  equal(orderDetailPageFor('zepto', '408-5094957-4481129'), null);
  equal(orderDetailPageFor('amazon', '01a0397a-bbb4-7cd7-b611-0e68227a15f1'), null);
  // AND A SHOP THIS FILE DOES NOT KNOW BUILDS NOTHING, rather than being handed
  // Amazon's shapes. There is no default shop anywhere in this file.
  for (const other of ['meesho', 'flipkart', '', null, undefined]) {
    equal(orderDetailPageFor(other, '408-5094957-4481129'), null);
    equal(howThisShopNamesAnOrder(other), null);
    deepEqual(harvestRendered('<a href="/o?orderID=402-3925017-7784521">x</a>', other).numbers, []);
    deepEqual(pagesToOpen(['408-5094957-4481129'], other), []);
  }
});

it('and the word before the number is taken as itself, not as an expression', () => {
  // ── WHY THIS IS NOT THEORETICAL ──────────────────────────────────────────
  //
  // The word is sliced off an ADDRESS, and an address is allowed a question
  // mark. Dropped into an expression unescaped, `orderID?=` would quietly make
  // the D optional and the word stop meaning what it says. Neither shop's word
  // has a metacharacter in it today, so nothing else here can tell.
  //
  // A SHOP IS ADDED FOR THE LENGTH OF THIS CHECK AND TAKEN OUT AGAIN, which is
  // the only way to ask the real function a question the real shops cannot pose.
  const invented = 'a-shop-that-is-not-real';
  HOW_EACH_SHOP_NAMES_AN_ORDER[invented] = {
    shape: /^\d{3}$/,
    run: '\\d{3}',
    detail: 'https://example.test/o?x+y=',
    tail: '',
    param: 'x+y=',
    card: null,
    theShapeAloneIsEnough: false,
  };
  try {
    deepEqual(harvestFromOrderLinks('<a href="/o?x+y=123">a</a>', invented), ['123'],
      'the word matches itself, plus sign and all');
    deepEqual(harvestFromOrderLinks('<a href="/o?xy=123">a</a>', invented), [],
      'AND IT IS NOT AN EXPRESSION: a page missing that character matches nothing');
    deepEqual(harvestFromOrderLinks('<a href="/o?xxxxy=123">a</a>', invented), [],
      'nor does one repeating the character before it');
  } finally {
    delete HOW_EACH_SHOP_NAMES_AN_ORDER[invented];
  }
  equal(howThisShopNamesAnOrder(invented), null, 'and the invented shop is gone again');
});

it('and a uuid is never harvested by its shape alone, only out of a link', () => {
  // ── THE REFUSAL THIS RECORD EXISTS FOR ────────────────────────────────────
  //
  // A Zepto page is full of uuids — products, images, whatever its own code was
  // handed. Harvesting by shape there would take an image's id, build a real
  // address out of it, and then open it: a request to a shop for a page nobody
  // asked for, built out of a string that happened to be lying on another one.
  const id = '01a0397a-bbb4-7cd7-b611-0e68227a15f1';
  const stray = `<span>${id}</span>`;
  deepEqual(harvestByShape(stray, 'zepto'), [], 'a bare uuid on a page is not an order');
  deepEqual(harvestRendered(stray, 'zepto').numbers, [], 'and the ladder finds nothing in it');
  equal(howThisShopNamesAnOrder('zepto').theShapeAloneIsEnough, false);
  // AND OUT OF THE SHOP'S OWN LINK IT IS AN ORDER, which is the only rung it has.
  const row = `<a href="/order/${id}?isArchived=false"></a>`;
  deepEqual(harvestFromOrderLinks(row, 'zepto'), [id]);
  const found = harvestRendered(row, 'zepto');
  deepEqual(found.numbers, [id]);
  equal(found.how, 'link', 'and the report says which rung answered');
  equal(found.marked, 0, 'a shop with no card attribute marks nothing');
  equal(countOrderCardSlots(row, 'zepto'), 0, 'and counts no cards, because it has none');
  // AND AMAZON KEEPS ALL THREE RUNGS, which is what that flag is protecting.
  equal(howThisShopNamesAnOrder('amazon').theShapeAloneIsEnough, true);
  deepEqual(harvestByShape('<span>403-1234567-8901234</span>', 'amazon'), ['403-1234567-8901234']);
});

it('and THE SCREEN NEVER WRITES A SHOP NAME, it asks this instead', () => {
  // The waiting screen may not name a shop anywhere, including in a comparison.
  // funnyWait.test.mjs enforces that on every piece of text in the file; this
  // states the other half — that the screen asks the question rather than
  // inlining the answer, so removing this file's answer cannot be papered over
  // by typing the name back into the screen.
  const src = readFileSync(new URL('./LookingForItScreen.js', import.meta.url), 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  ok(code.includes('readsOrderPages(platformKey)'),
    'the screen asks which shops are read one order at a time');
});

console.log('\none order page, as the text the server will read');

/** An order page in the shape a real one arrives in: chrome, then the order. */
const orderPage = (over = {}) => {
  const bits = {
    number: '408-5094957-4481129',
    placed: '2 June 2026',
    total: '₹1,299.00',
    product: 'boAt Rockerz 255 Pro Plus',
    ...over,
  };
  return '<html><head><title>Order Details</title>'
    + '<script>window.x=1</script><style>.a{}</style></head><body>'
    + '<nav>Hello, sign in Account &amp; Lists Returns &amp; Orders</nav>'
    + '<h1>Order Details</h1>'
    + `<span>Order placed</span><span>${bits.placed}</span>`
    + `<span>Order # ${bits.number}</span>`
    + `<span>Order Total</span><span>${bits.total}</span>`
    + `<span>${bits.product}</span><span>1 x ${bits.total}</span>`
    + '<span>Delivered 5 June 2026</span>'
    + '<footer>Conditions of Use Privacy Notice</footer></body></html>';
};

const answered = (html, url = 'https://www.amazon.in/gp/your-account/order-details?orderID=408-5094957-4481129') =>
  ({ ok: true, status: 200, html, url });

it('drops the page own furniture and keeps the order', () => {
  const out = readDetailOutcome(answered(orderPage()));
  equal(out.looked, true);
  equal(out.whyNot, null);
  equal(out.wantsSignIn, false);
  ok(out.text.includes('Order # 408-5094957-4481129'));
  ok(out.text.includes('boAt Rockerz 255 Pro Plus'));
  ok(out.text.includes('2 June 2026'));
  // The menu and the heading above the order are furniture and go.
  ok(!out.text.includes('Account & Lists'), 'the menu is still in it');
  ok(!out.text.includes('window.x'), 'a script is still in it');
});

it('THE DEAD END IS REPORTED, not read as an order with nothing on it', () => {
  const out = readDetailOutcome(answered(
    '<html><body><p>Click the button below to continue shopping</p></body></html>',
  ));
  equal(out.whyNot, 'theDeadEndPage');
  equal(out.looked, false);
});

it('a 503 is reported, and it is the shop asking us to slow down', () => {
  const out = readDetailOutcome({ ok: true, status: 503, html: 'busy', url: 'u' });
  equal(out.whyNot, 'tooManyAsks');
  equal(out.looked, false);
});

it('the robot puzzle is reported', () => {
  const out = readDetailOutcome(answered(
    '<html><body>Enter the characters you see below</body></html>',
  ));
  equal(out.whyNot, 'aPuzzle');
});

it('AND A SIGN IN WALL IS ITS OWN ANSWER, from the address it ended at', () => {
  // The fetch follows redirects, so a sign in wall arrives as a 200 carrying the
  // sign in page. The final address is the only honest signal.
  const out = readDetailOutcome(answered(
    '<html><body>Sign in</body></html>',
    'https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0',
  ));
  equal(out.wantsSignIn, true);
});

it('nothing came back at all is not a refusal with a name', () => {
  const out = readDetailOutcome({ ok: false, status: 0, html: '', url: '' });
  equal(out.looked, false);
  equal(out.whyNot, null);
  equal(out.wantsSignIn, false);
});

it('and junk in is an empty answer out, never a throw', () => {
  for (const junk of [null, undefined, 'text', 42, {}]) {
    const out = readDetailOutcome(junk);
    equal(out.looked, false);
    equal(out.text, '');
  }
});

it('READING THE LIST STILL WORKS, so the shops that do not need this are unharmed', () => {
  const html = '<html><body><span>Order placed</span><span>2 June 2026</span>'
    + '<span>Order # 408-5094957-4481129</span><span>Total</span><span>₹1,299.00</span>'
    + '</body></html>';
  const out = readListOutcome(answered(html));
  equal(out.looked, true);
  equal(out.blocks.length, 1);
});

it('and both readers give the SAME name to the same refusal', () => {
  // One vocabulary for this, not two. The first writing of the order-page read
  // had its own idea of what a dead end was.
  const busy = { ok: true, status: 503, html: 'busy', url: 'u' };
  equal(readDetailOutcome(busy).whyNot, readListOutcome(busy).whyNot);
  const wall = answered('<html/>', 'https://www.amazon.in/ap/signin');
  equal(readDetailOutcome(wall).wantsSignIn, readListOutcome(wall).wantsSignIn);
});

console.log('\nthe shape of an order number');

it('is three, seven, seven — the shape proven on a real account', () => {
  ok(AMAZON_ORDER_NUMBER_SHAPE.test('408-5094957-4481129'));
  ok(AMAZON_ORDER_NUMBER_SHAPE.test('402-3925017-7784521'));
  ok(!AMAZON_ORDER_NUMBER_SHAPE.test('40-5094957-4481129'));
  ok(!AMAZON_ORDER_NUMBER_SHAPE.test('408-509495-4481129'));
  ok(!AMAZON_ORDER_NUMBER_SHAPE.test('408-5094957-448112'));
  ok(!AMAZON_ORDER_NUMBER_SHAPE.test('x408-5094957-4481129'));
  ok(!AMAZON_ORDER_NUMBER_SHAPE.test('408-5094957-4481129x'));
});

console.log('\nthe ladder: three ways to find a number, strongest first');

// A row as the shop DRAWS it: the number in the words, and in a link to the
// order's own page. Neither is in the markup a fetch brings back.
const drawnRow = (number) =>
  `<li class="order-card a-box-group"><span>ORDER # ${number}</span>`
  + `<a href="/your-orders/order-details?orderID=${number}">Details</a></li>`;

it('THE SHAPE IS DERIVED FROM THE ONE DEFINITION AND NOT TYPED OUT AGAIN', () => {
  // The day an order number changes shape, every rung, every address and the
  // ceiling all change together — because there is one source and everything
  // points at it. A second copy typed here is how those drift apart.
  equal(new RegExp(`^${ORDER_NUMBER_RUN}$`).source, AMAZON_ORDER_NUMBER_SHAPE.source);
  equal(ORDER_ID_PARAM, 'orderID=');
  ok(AMAZON_ORDER_DETAIL_PAGE.endsWith(ORDER_ID_PARAM),
    'and the word comes off the address this file builds');
});

it('RUNG ONE, the card attribute, is completely unchanged', () => {
  deepEqual(harvestOrderNumbers(listPage('408-5094957-4481129'), 'amazon'), ['408-5094957-4481129']);
  // The distinction this rung exists for: the cards are there and the ids in
  // them are refused. A shape-only harvest would quietly lose it.
  const wrongKind =
    '<div data-csa-c-slot-id="amzn1.yourorders.filter.408-5094957-4481129"></div>';
  deepEqual(harvestOrderNumbers(wrongKind, 'amazon'), [], 'a filter is not an order card');
});

it('RUNG TWO takes the number the shop itself wrote into a link to the order', () => {
  deepEqual(harvestFromOrderLinks(drawnRow('402-3925017-7784521'), 'amazon'), ['402-3925017-7784521']);
  deepEqual(harvestFromOrderLinks('<a href="/x?orderID=nonsense">y</a>', 'amazon'), [],
    'and a link to nonsense builds no address');
  deepEqual(harvestFromOrderLinks('<a href="/x?orderID=408-5094957-44811299">y</a>', 'amazon'), [],
    'nor a run that is part of a longer one');
  deepEqual(harvestFromOrderLinks('<a href="/x?ORDERID=402-3925017-7784521">y</a>', 'amazon'),
    ['402-3925017-7784521'], 'however the shop happens to spell it');
  deepEqual(harvestFromOrderLinks('', 'amazon'), []);
});

it('RUNG THREE takes the number\u2019s own shape, which no markup change can move', () => {
  deepEqual(harvestByShape('<span>ORDER # 403-1234567-8901234</span>', 'amazon'), ['403-1234567-8901234']);
  deepEqual(harvestByShape('<span>1408-5094957-44811299</span>', 'amazon'), [],
    'a piece of a longer run is not an order number');
  deepEqual(harvestByShape('<span>408-509495-4481129</span>', 'amazon'), [], 'and neither is a near miss');
  // THE PAGE'S OWN CODE IS NOT THE PAGE. A drawn page carries its orders twice,
  // once as markup and once inside the data its script was handed, and the
  // second copy is in a different order from the one a person sees.
  deepEqual(harvestByShape('<script>var o=["409-1111111-2222222"]</script>', 'amazon'), [],
    'a number inside a script is not on the page');
});

it('THE LADDER SAYS WHICH RUNG ANSWERED, and that one word is the finding', () => {
  const slot = harvestRendered(listPage('408-5094957-4481129'), 'amazon');
  equal(slot.how, 'slot', 'the old marker still being there is the best news there is');
  const link = harvestRendered('<a href="/o?orderID=402-3925017-7784521">x</a>', 'amazon');
  equal(link.how, 'link');
  const shape = harvestRendered('<span>403-1234567-8901234</span>', 'amazon');
  equal(shape.how, 'shape', 'and this one says go and read the row report');
  equal(harvestRendered('<html><body>Sign in</body></html>', 'amazon').how, 'none');
  for (const junk of [null, undefined, 5, {}, '']) {
    equal(harvestRendered(junk, 'amazon').how, 'none', `${String(junk)} finds nothing`);
  }
});

it('and the strongest rung is asked first, so a decoy cannot displace a real card', () => {
  const page = listPage('408-5094957-4481129') + '<span>403-1234567-8901234</span>';
  const found = harvestRendered(page, 'amazon');
  equal(found.how, 'slot', 'the card is what answered');
  equal(found.numbers[0], '408-5094957-4481129', 'and its number comes first');
});

it('one number found twice is opened once', () => {
  const both = listPage('408-5094957-4481129') + drawnRow('408-5094957-4481129');
  const found = harvestRendered(both, 'amazon');
  deepEqual(found.numbers, ['408-5094957-4481129']);
  equal(found.marked, 1);
  equal(found.linked, 1, 'and the counts still say it was seen by two rungs');
  equal(found.shaped, 1);
});

it('and the page order is kept, because the shop lists its orders newest first', () => {
  const page = drawnRow('408-5094957-4481129') + drawnRow('402-3925017-7784521');
  deepEqual(harvestRendered(page, 'amazon').numbers, ['408-5094957-4481129', '402-3925017-7784521']);
});

it('nothing found anywhere still builds no address', () => {
  const found = harvestRendered('<html><body>nothing here</body></html>', 'amazon');
  deepEqual(pagesToOpen(found.numbers, 'amazon'), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
