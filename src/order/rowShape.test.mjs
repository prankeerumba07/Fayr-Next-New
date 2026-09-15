// THE ROW REPORT, AND THE ONE THING IT MUST NEVER DO.
//
// This is the instrument the owner asked for before anybody writes the next
// selector: find every place an order number appears on the page the shop drew,
// and say what is wrapped around it.
//
// AND THE PAGE IT READS IS THE WORST ONE IN THE APP. A drawn order list carries
// the buyer's name, their delivery address, what they bought and what they paid,
// as WORDS, which the empty frame a fetch used to bring back never did. So most
// of what is checked here is what it refuses to say:
//
//   1. No text node content, ever. Text is READ, to ask whether it is an order
//      number, and never kept.
//   2. A plain attribute gives up its NAME only — title, alt, href, aria-label.
//   3. id and class give up their value, masked and allowlisted, one class word
//      at a time. Those two are what CSS is written against.
//   4. A data value must look like an identifier and not like a word. Stricter
//      than the report next door, on purpose: data-first-name="Prakash" is
//      short, has no space, and is not a selector.
//   5. The order number itself is never printed. Only its shape.
//   6. It says nothing at all unless __DEV__ is on.
//
// The fixture carries a name, a street, a city, a postcode, an email and a
// telephone number in every place a page can hold one, and the checks walk the
// whole report looking for any of them.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  MOST_ANCESTORS, NOT_AN_IDENTIFIER, aClassWord, aDataValue, aHookValue,
  attributesOfTag, describeOneElement, logRowShape, orderNumberSightings,
  rowShapeLines, runsInsideCode,
} from './rowShape.js';
import { NOT_A_SHAPE } from './pageShape.js';
import { ORDER_NUMBER_SHAPE } from './detailLook.js';

const { ok, equal } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const withoutComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const A_NAME = 'Prakash Tamang';
const A_STREET = '42 Some Road';
const A_CITY = 'Gurugram';
const A_POSTCODE = '122001';
const AN_EMAIL = 'someone@example.com';
const A_PHONE = '9876543210';
const PRIVATE_THINGS = [A_NAME, A_STREET, A_CITY, AN_EMAIL, A_PHONE, 'Tamang', 'Prakash'];

const FIRST = '403-1234567-8901234';
const SECOND = '408-5094957-4481129';

// A page shaped the way a drawn order list is, with somebody in every place a
// page can hold one: a text node, a plain attribute, a data attribute, a class
// and an id.
const PAGE = [
  '<div id="ordersContainer" data-page-type="yourorders">',
  '  <ul class="a-unordered-list" id="your-orders-list">',
  `    <li class="order-card a-box-group" data-order-id="${FIRST}" data-first-name="Prakash">`,
  `      <span class="a-color-base">${A_NAME}</span>`,
  `      <span>${A_STREET}, ${A_CITY} ${A_POSTCODE}</span>`,
  // A NAME AND AN ORDER NUMBER IN ONE RUN OF WORDS, which is how a real page
  // writes it — "Delivered to Prakash, order # ...". So the text this instrument
  // has to read in order to FIND a row is the same text that carries a person.
  `      <span>Delivered to ${A_NAME} \u00b7 ORDER # ${FIRST}</span>`,
  `      <a href="/your-orders/order-details?orderID=${FIRST}" title="${A_NAME}" alt="${A_STREET}" data-contact="${A_PHONE}" data-email="${AN_EMAIL}">Details</a>`,
  '    </li>',
  `    <li class="order-card a-box-group" data-order-id="${SECOND}" data-first-name="Prakash">`,
  `      <span>ORDER # ${SECOND}</span>`,
  `      <a href="/your-orders/order-details?orderID=${SECOND}">Details</a>`,
  '    </li>',
  '  </ul>',
  '</div>',
  `<script>var loaded=["409-1111111-2222222"];var who="${A_NAME}";</script>`,
].join('\n');

const REPORT = rowShapeLines(PAGE).join('\n');

console.log('\nit never says a word that came off the page');

it('NOT ONE OF THE BUYER’S DETAILS IS ANYWHERE IN THE REPORT', () => {
  for (const secret of PRIVATE_THINGS) {
    ok(!REPORT.includes(secret),
      `the report contains "${secret}", which came off the page and must never leave it`);
  }
});

it('AND NOT ONE REAL ORDER NUMBER EITHER, only its shape', () => {
  for (const number of [FIRST, SECOND, '409-1111111-2222222']) {
    ok(!REPORT.includes(number), `the report contains the order number ${number}`);
    // ...not even a piece of one. The digits are what identify the account.
    ok(!REPORT.includes(number.split('-')[1]), `a run of ${number} survived`);
  }
  ok(REPORT.includes('###-#######-#######'), 'it reads as its shape instead');
});

it('a text node is READ and never kept', () => {
  // The name sits between two tags, and so does the order number: one is how a
  // row is found, and the other must not come with it.
  const sightings = orderNumberSightings(PAGE);
  const inWords = sightings.filter((s) => s.where === 'text');
  ok(inWords.length >= 2, `both orders are found by their own words: ${inWords.length}`);
  // WALKED WHOLE, not spot-checked. The fixture puts a name in the SAME run of
  // words as an order number, so the text this has to read to find a row is the
  // text that carries a person.
  for (const one of sightings) {
    const said = JSON.stringify(one);
    for (const secret of PRIVATE_THINGS) {
      ok(!said.includes(secret), `a sighting carried "${secret}" off the page: ${said}`);
    }
    ok(one.shape === '###-#######-#######', `the number is masked at the source: ${one.shape}`);
  }
});

it('a plain attribute gives up its NAME and never its value', () => {
  ok(REPORT.includes('[title]'), 'the name of a title attribute is reported');
  ok(REPORT.includes('[href]'), 'and so is href');
  ok(!REPORT.includes('[title="'), 'and never with a value on it');
  ok(!REPORT.includes('/your-orders/order-details'),
    'not even an address, which is where a shop writes an order number');
});

console.log('\nand a data value must be an identifier, not a word');

it('A BARE WORD IS NOT A SELECTOR AND IS NOT PRINTED', () => {
  // THE HOLE THE REPORT NEXT DOOR STILL HAS, closed here because this instrument
  // has no older promises to keep. A value with no separator in it is a word: a
  // product type, a city, a first name. Masking the digits out of one does
  // nothing at all.
  equal(aDataValue('Prakash'), NOT_AN_IDENTIFIER);
  equal(aDataValue('SHOES'), NOT_AN_IDENTIFIER);
  equal(aDataValue('Gurugram'), NOT_AN_IDENTIFIER);
  ok(!REPORT.includes('data-first-name="Prakash"'), 'and the fixture proves it on a real shape');
  ok(REPORT.includes(`data-first-name="${NOT_AN_IDENTIFIER}"`),
    'the attribute is still visible, which is the point of the report');
});

it('but a real identifier is printed, masked', () => {
  equal(aDataValue('amzn1.yourorders.order-card.403-1234567-8901234'),
    'amzn#.yourorders.order-card.###-#######-#######');
  equal(aDataValue('order-card'), 'order-card');
  equal(aDataValue('nav_cs_books'), 'nav_cs_books');
});

it('and prose, an address and an email are refused outright', () => {
  equal(aDataValue('Prakash Tamang'), NOT_A_SHAPE);
  equal(aDataValue('someone@example.com'), NOT_A_SHAPE);
  equal(aDataValue('42 Some Road, Gurugram'), NOT_A_SHAPE);
  equal(aDataValue('{"a":"b"}'), NOT_A_SHAPE);
  equal(aDataValue(''), '');
  equal(aDataValue(null), '');
  ok(!REPORT.includes(AN_EMAIL), 'and the fixture’s email is nowhere');
  ok(REPORT.includes(`data-email="${NOT_A_SHAPE}"`), 'it is named and not quoted');
});

it('a telephone number in a data value never survives, and is refused twice over', () => {
  ok(!REPORT.includes(A_PHONE), 'a telephone number never survives');
  // AND IT IS THE SEPARATOR RULE THAT CATCHES IT, not the masking, which is
  // worth knowing: a run of digits with nothing in it is not an identifier, so
  // it never even reaches maskDigits. Masking is the third defence here and not
  // the first — see lookLog, which masks the whole assembled line last of all.
  ok(REPORT.includes(`data-contact="${NOT_AN_IDENTIFIER}"`),
    'it is named and not quoted');
  equal(aDataValue('9876543210'), NOT_AN_IDENTIFIER);
  // ...while the thing this report is actually for keeps its shape, because an
  // order number has separators in it.
  equal(aDataValue('403-1234567-8901234'), '###-#######-#######');
});

console.log('\nand id and class are markup, so they are shown');

it('a class list is split and each word allowlisted on its own', () => {
  const said = describeOneElement('li', attributesOfTag('class="order-card a-box-group" id="x1"'));
  equal(said, 'li.order-card.a-box-group#x#');
  // ONE LONG LIST CANNOT RIDE IN WHOLE. Split first, so a value with a space in
  // it is never one thing to look at.
  const risky = describeOneElement('li', attributesOfTag(`class="a ${A_NAME}"`));
  ok(!risky.includes('Tamang'), 'a name hiding in a class list does not ride in');
  ok(!risky.includes('Prakash'), 'nor a first name');
});

it('AND A CLASS WORD WRITTEN THE WAY A NAME IS WRITTEN IS NOT A CLASS', () => {
  // This check found a real hole in this file. The rule for data values — must
  // have a separator in it — cannot be used here, because half of all classes
  // are bare words and they are the thing this report exists to show. So the
  // refusal is narrow: one capital then lower case is a name's shape.
  equal(aClassWord('Prakash'), NOT_AN_IDENTIFIER);
  equal(aClassWord('Gurugram'), NOT_AN_IDENTIFIER);
  // ...and everything a class really is still comes through.
  equal(aClassWord('order-card'), 'order-card');
  equal(aClassWord('a-box-group'), 'a-box-group');
  equal(aClassWord('orderCard'), 'orderCard');
  equal(aClassWord('nav'), 'nav');
  equal(aClassWord('aok-hidden'), 'aok-hidden');
});

it('an id is masked, so an order number in one reads as its shape', () => {
  equal(aHookValue('orderCard-403-1234567-8901234'), 'orderCard-###-#######-#######');
  equal(aHookValue('ordersContainer'), 'ordersContainer');
  equal(aHookValue('a b'), NOT_A_SHAPE);
});

console.log('\nand the report answers the question it was built for');

it('IT SAYS WHAT WRAPS AN ORDER, WHICH IS WHAT A SELECTOR IS WRITTEN FROM', () => {
  ok(REPORT.includes('li.order-card.a-box-group'), `the row itself: ${REPORT}`);
  ok(REPORT.includes('ul.a-unordered-list#your-orders-list'), 'and what holds the rows');
  ok(REPORT.includes('div#ordersContainer'), 'and what holds that');
});

it('identical rows collapse into ONE line with a count against it', () => {
  // Ten orders drawn the same way is one fact about the markup and not ten.
  const line = rowShapeLines(PAGE).find((l) => /^2x text /.test(l));
  ok(line, `both rows are one row with a two against it:\n${REPORT}`);
});

it('and it never climbs further than it needs to', () => {
  const deep = `${'<div>'.repeat(12)}<span>ORDER ${FIRST}</span>${'</div>'.repeat(12)}`;
  for (const one of orderNumberSightings(deep)) {
    ok(one.path.length <= MOST_ANCESTORS,
      `a sighting reported ${one.path.length} levels, cap is ${MOST_ANCESTORS}`);
  }
});

it('a number in the page’s own code is COUNTED and never reported as a row', () => {
  // THE ANSWER THAT WOULD OTHERWISE BE INVISIBLE: "the orders are on the page,
  // but only inside its JavaScript". That is a different finding from "the
  // orders are not there at all" and it needs to be sayable.
  equal(runsInsideCode(PAGE), 1);
  const head = rowShapeLines(PAGE)[0];
  ok(head.includes('inCode=1'), `the head line says so: ${head}`);
  for (const one of orderNumberSightings(PAGE)) {
    ok(one.path.every((p) => !p.startsWith('script')), 'nothing is reported from inside a script');
  }
});

it('a page with no orders on it says exactly that', () => {
  const empty = rowShapeLines('<html><body><div class="nav">Sign in</div></body></html>');
  equal(empty.length, 1, 'one line and no rows');
  ok(empty[0].startsWith('sightings=0'), empty[0]);
});

it('and nothing at all is said about nothing at all', () => {
  for (const junk of [null, undefined, '', 0, {}, []]) {
    const lines = rowShapeLines(junk);
    ok(lines[0].startsWith('sightings=0'), `${String(junk)} reports an empty page`);
    equal(orderNumberSightings(junk).length, 0);
  }
});

it('it reports a bounded amount, and says what it held back', () => {
  const many = Array.from({ length: 60 }, (_, i) => {
    const n = `4${String(i).padStart(2, '0')}-1234567-890123${i % 10}`;
    return `<li data-k${i}="v${i}"><span>ORDER ${n}</span></li>`;
  }).join('');
  const lines = rowShapeLines(many);
  const rows = lines.filter((l) => /^\d+x /.test(l));
  ok(rows.length <= 40, `no more than the cap is printed, found ${rows.length}`);
  ok(lines.some((l) => l.includes('more not shown')),
    'AND IT SAYS WHAT IT HELD BACK, so a truncated report is never the whole page');
});

console.log('\nand it is off in a build a person gets');

it('it says nothing at all unless __DEV__ is on', () => {
  // __DEV__ is the phone's word and is not defined under node, so every line is
  // refused here — counted rather than read off a console.
  equal(logRowShape(PAGE), 0, 'nothing is said with the flag off');
  equal(logRowShape(''), 0);
});

it('AND IT ADDS NO SECOND WAY OUT OF THIS FOLDER', () => {
  // The comments come out first. A check that matches its own explanation has
  // happened four times in this project already.
  const source = withoutComments(read('./rowShape.js'));
  ok(!/console\./.test(source), 'there is no console call in this file');
  for (const wayOut of [
    /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/,
    /AsyncStorage/, /SecureStore/, /writeFileSync/, /\bnew File\b/, /\bPaths\./,
    /\brequire\s*\(/, /process\.std(out|err)/,
  ]) {
    ok(!wayOut.test(source), `there is no ${wayOut} in this file either`);
  }
  ok(/from '\.\/lookLog\.js'/.test(source),
    'and the one thing it writes through is the file that masks and guards');
});

it('and it takes its idea of an order number from the one place that holds it', () => {
  const source = withoutComments(read('./rowShape.js'));
  ok(/from '\.\/detailLook\.js'/.test(source), 'the shape comes from detailLook');
  ok(!/\\d\{3\}/.test(source), 'and is not typed out a second time here');
  ok(ORDER_NUMBER_SHAPE.test(FIRST), 'the fixture really uses that shape');
});

it('and the screen asks for it when there is nothing to find', () => {
  const screen = read('./LookingForItScreen.js');
  ok(/if \(countOrderCardSlots\(html\) === 0\) logRowShape\(html\);/.test(screen),
    'a page that is working prints no row report, so this cannot become noise');
  ok(/import \{ logRowShape \} from '\.\/rowShape\.js';/.test(screen),
    'and it really is wired in');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
