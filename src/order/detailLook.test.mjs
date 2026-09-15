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
  ORDER_ID_PARAM, ORDER_NUMBER_RUN, ORDER_NUMBER_SHAPE, SHOPS_READ_ONE_ORDER_AT_A_TIME,
  harvestByShape, harvestFromOrderLinks, harvestOrderNumbers, harvestRendered,
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
  deepEqual(harvestOrderNumbers(html), [
    '408-5094957-4481129', '402-3925017-7784521',
  ]);
});

it('NEWEST FIRST, because the page is, and nothing here sorts', () => {
  // Amazon lists its orders newest first. Sorting here would need a date, and no
  // date survives on this page to sort by — which is the whole reason the order
  // pages have to be opened at all.
  const html = listPage('403-0000001-0000001', '403-0000002-0000002');
  equal(harvestOrderNumbers(html)[0], '403-0000001-0000001');
});

it('each one once, however many times the page names it', () => {
  const n = '408-5094957-4481129';
  deepEqual(harvestOrderNumbers(listPage(n, n, n)), [n]);
});

it('IGNORES anything that is not an order number rather than fetching it', () => {
  // This value goes into an address. An address built out of whatever a page
  // happened to contain is the one thing that must not happen here.
  const html = listPage(
    'junk', '', '408-5094957-4481129', '12345', '../../etc/passwd',
    '408-5094957-448112', '408-5094957-44811299',
  );
  deepEqual(harvestOrderNumbers(html), ['408-5094957-4481129']);
});

it('is not fooled by a different slot id on the same page', () => {
  const html = '<div data-csa-c-slot-id="amzn1.yourorders.filter.408-5094957-4481129"></div>'
    + card('402-3925017-7784521');
  deepEqual(harvestOrderNumbers(html), ['402-3925017-7784521']);
});

it('reads single quotes as well as double, because a page is written by anything', () => {
  const html = "<div data-csa-c-slot-id='amzn1.yourorders.order-card.408-5094957-4481129'></div>";
  deepEqual(harvestOrderNumbers(html), ['408-5094957-4481129']);
});

it('and answers nothing at all for nothing at all', () => {
  for (const junk of [null, undefined, '', 42, {}, [], '<html></html>']) {
    deepEqual(harvestOrderNumbers(junk), []);
  }
});

it('ANSWERS THE SAME TWICE, so a remembered position cannot change it', () => {
  // A global expression remembers where it stopped. A shared one would give a
  // different answer the second time it was asked about the same page.
  const html = listPage('408-5094957-4481129', '402-3925017-7784521');
  deepEqual(harvestOrderNumbers(html), harvestOrderNumbers(html));
});

console.log('\nthe address of one order');

it('builds the order page address from the number', () => {
  equal(
    orderDetailPageFor('408-5094957-4481129'),
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
    equal(orderDetailPageFor(junk), null);
  }
});

it('and it trims, because a page carries whitespace', () => {
  equal(
    orderDetailPageFor('  408-5094957-4481129  '),
    `${AMAZON_ORDER_DETAIL_PAGE}408-5094957-4481129`,
  );
});

console.log('\nthe politeness limits, which exist because Amazon blocks us');

it('OPENS AT MOST SIX PAGES, whatever the list held', () => {
  const many = Array.from({ length: 20 }, (unused, i) =>
    `40${i % 10}-000000${i % 10}-000000${i % 10}`);
  equal(MOST_DETAIL_PAGES, 6);
  equal(pagesToOpen(many).length, MOST_DETAIL_PAGES);
});

it('and it is the FIRST six, which are the newest', () => {
  const numbers = ['401-0000001-0000001', '402-0000002-0000002', '403-0000003-0000003',
    '404-0000004-0000004', '405-0000005-0000005', '406-0000006-0000006',
    '407-0000007-0000007'];
  deepEqual(pagesToOpen(numbers), numbers.slice(0, 6));
});

it('refuses anything that is not an order number even here', () => {
  deepEqual(pagesToOpen(['junk', '408-5094957-4481129', null, 7]), [
    '408-5094957-4481129',
  ]);
  deepEqual(pagesToOpen(null), []);
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

it('AMAZON, and only Amazon, because only its list is empty frames', () => {
  deepEqual(SHOPS_READ_ONE_ORDER_AT_A_TIME, ['amazon']);
  equal(readsOrderPages('amazon'), true);
  equal(readsOrderPages('AMAZON'), true);
  for (const other of ['meesho', 'zepto', 'flipkart', 'blinkit', 'instamart',
    'myntra', '', null, undefined, 7]) {
    equal(readsOrderPages(other), false);
  }
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
  ok(ORDER_NUMBER_SHAPE.test('408-5094957-4481129'));
  ok(ORDER_NUMBER_SHAPE.test('402-3925017-7784521'));
  ok(!ORDER_NUMBER_SHAPE.test('40-5094957-4481129'));
  ok(!ORDER_NUMBER_SHAPE.test('408-509495-4481129'));
  ok(!ORDER_NUMBER_SHAPE.test('408-5094957-448112'));
  ok(!ORDER_NUMBER_SHAPE.test('x408-5094957-4481129'));
  ok(!ORDER_NUMBER_SHAPE.test('408-5094957-4481129x'));
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
  equal(new RegExp(`^${ORDER_NUMBER_RUN}$`).source, ORDER_NUMBER_SHAPE.source);
  equal(ORDER_ID_PARAM, 'orderID=');
  ok(AMAZON_ORDER_DETAIL_PAGE.endsWith(ORDER_ID_PARAM),
    'and the word comes off the address this file builds');
});

it('RUNG ONE, the card attribute, is completely unchanged', () => {
  deepEqual(harvestOrderNumbers(listPage('408-5094957-4481129')), ['408-5094957-4481129']);
  // The distinction this rung exists for: the cards are there and the ids in
  // them are refused. A shape-only harvest would quietly lose it.
  const wrongKind =
    '<div data-csa-c-slot-id="amzn1.yourorders.filter.408-5094957-4481129"></div>';
  deepEqual(harvestOrderNumbers(wrongKind), [], 'a filter is not an order card');
});

it('RUNG TWO takes the number the shop itself wrote into a link to the order', () => {
  deepEqual(harvestFromOrderLinks(drawnRow('402-3925017-7784521')), ['402-3925017-7784521']);
  deepEqual(harvestFromOrderLinks('<a href="/x?orderID=nonsense">y</a>'), [],
    'and a link to nonsense builds no address');
  deepEqual(harvestFromOrderLinks('<a href="/x?orderID=408-5094957-44811299">y</a>'), [],
    'nor a run that is part of a longer one');
  deepEqual(harvestFromOrderLinks('<a href="/x?ORDERID=402-3925017-7784521">y</a>'),
    ['402-3925017-7784521'], 'however the shop happens to spell it');
  deepEqual(harvestFromOrderLinks(''), []);
});

it('RUNG THREE takes the number\u2019s own shape, which no markup change can move', () => {
  deepEqual(harvestByShape('<span>ORDER # 403-1234567-8901234</span>'), ['403-1234567-8901234']);
  deepEqual(harvestByShape('<span>1408-5094957-44811299</span>'), [],
    'a piece of a longer run is not an order number');
  deepEqual(harvestByShape('<span>408-509495-4481129</span>'), [], 'and neither is a near miss');
  // THE PAGE'S OWN CODE IS NOT THE PAGE. A drawn page carries its orders twice,
  // once as markup and once inside the data its script was handed, and the
  // second copy is in a different order from the one a person sees.
  deepEqual(harvestByShape('<script>var o=["409-1111111-2222222"]</script>'), [],
    'a number inside a script is not on the page');
});

it('THE LADDER SAYS WHICH RUNG ANSWERED, and that one word is the finding', () => {
  const slot = harvestRendered(listPage('408-5094957-4481129'));
  equal(slot.how, 'slot', 'the old marker still being there is the best news there is');
  const link = harvestRendered('<a href="/o?orderID=402-3925017-7784521">x</a>');
  equal(link.how, 'link');
  const shape = harvestRendered('<span>403-1234567-8901234</span>');
  equal(shape.how, 'shape', 'and this one says go and read the row report');
  equal(harvestRendered('<html><body>Sign in</body></html>').how, 'none');
  for (const junk of [null, undefined, 5, {}, '']) {
    equal(harvestRendered(junk).how, 'none', `${String(junk)} finds nothing`);
  }
});

it('and the strongest rung is asked first, so a decoy cannot displace a real card', () => {
  const page = listPage('408-5094957-4481129') + '<span>403-1234567-8901234</span>';
  const found = harvestRendered(page);
  equal(found.how, 'slot', 'the card is what answered');
  equal(found.numbers[0], '408-5094957-4481129', 'and its number comes first');
});

it('one number found twice is opened once', () => {
  const both = listPage('408-5094957-4481129') + drawnRow('408-5094957-4481129');
  const found = harvestRendered(both);
  deepEqual(found.numbers, ['408-5094957-4481129']);
  equal(found.marked, 1);
  equal(found.linked, 1, 'and the counts still say it was seen by two rungs');
  equal(found.shaped, 1);
});

it('and the page order is kept, because the shop lists its orders newest first', () => {
  const page = drawnRow('408-5094957-4481129') + drawnRow('402-3925017-7784521');
  deepEqual(harvestRendered(page).numbers, ['408-5094957-4481129', '402-3925017-7784521']);
});

it('nothing found anywhere still builds no address', () => {
  const found = harvestRendered('<html><body>nothing here</body></html>');
  deepEqual(pagesToOpen(found.numbers), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
