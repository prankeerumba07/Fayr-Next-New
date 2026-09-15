// THE SHAPE REPORT, AND THE ONE THING IT MUST NEVER DO.
//
// Amazon's order list stopped matching the selector on 15 September 2026: a
// whole healthy 374KB page, signed in, no refusal, and not one order card slot.
// This reports what the page is MADE OF so the next selector is written from
// what Amazon really sends rather than guessed the way the last one was.
//
// AND AN ORDER PAGE CARRIES THE BUYER'S NAME AND THEIR DELIVERY ADDRESS. So the
// promises checked here are mostly about what it refuses to say:
//
//   1. Nothing outside a tag is ever visited, so text nodes cannot reach it.
//   2. For anything but a data attribute, only the NAME is reported.
//   3. A data value that looks like prose is replaced, not masked — because
//      taking the digits out of somebody's name does nothing at all.
//   4. Every digit in a reported value is gone, so an order number reads as its
//      shape and is nobody's order number.
//   5. It says nothing at all unless __DEV__ is on.
//
// The fixture below deliberately carries a name, a street, a city, a postcode,
// an email and a telephone number, in every place a page can hold one, and the
// checks walk the whole report looking for any of them.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  A_DIGIT, LONGEST_VALUE_WORTH_SEEING, MOST_SHAPES_REPORTED, NOT_A_SHAPE,
  WORDS_WORTH_COUNTING, attributeNames, attributesIn, dataShapes, isAShape,
  logPageShape, maskDigits, shapeLines, withoutCode, wordCounts,
} from './pageShape.js';

const { ok, equal, deepEqual } = assert;
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

// A page shaped like Amazon's, holding somebody's details in every place a page
// can hold them: a text node, a plain attribute, and a data attribute.
const A_NAME = 'Prakash Tamang';
const A_STREET = '42 Some Road';
const A_CITY = 'Gurugram';
const A_POSTCODE = '122001';
const AN_EMAIL = 'someone@example.com';
const A_PHONE = '9876543210';
const PRIVATE_THINGS = [A_NAME, A_STREET, A_CITY, AN_EMAIL, A_PHONE, 'Tamang', 'Prakash'];

const PAGE = [
  '<div data-csa-c-slot-id="amzn1.yourorders.order-card.403-1234567-8901234" class="a-box-group">',
  `  <span class="a-color-base">${A_NAME}</span>`,
  `  <span>${A_STREET}, ${A_CITY} ${A_POSTCODE}</span>`,
  `  <a href="/gp/buyer/${A_NAME}" title="${A_NAME}" alt="${A_STREET}">Order details</a>`,
  '</div>',
  '<div data-csa-c-slot-id="amzn1.yourorders.order-card.408-5094957-4481129" class="a-box-group">',
  `  <span>Delivered to ${A_NAME}</span>`,
  `  <li data-a-popover='{"buyer":"${A_NAME}","line1":"${A_STREET}"}'>x</li>`,
  `  <li data-buyer-address="${A_STREET}, ${A_CITY}">x</li>`,
  `  <li data-contact="${A_PHONE}" data-email="${AN_EMAIL}">x</li>`,
  '</div>',
  '<span data-testid="order-info">x</span>',
  // ── AND A SCRIPT, BECAUSE EVERY REAL PAGE HAS ONE AND THIS FILE READ IT ────
  //
  // Minified code is full of `a<b` and `c>d`, so an expression looking for "a <
  // then a letter, then anything, up to a >" finds pseudo tags all the way
  // through it and reports whatever is inside them as markup. From the owner's
  // own device, 15 September 2026:
  //
  //   shape names class(542) a(483) e(432) function(429) ... var(278) ...
  //                                        return(185) ... typeof(83)
  //
  // Those are JavaScript keywords being printed as HTML attribute names. On a
  // page the shop has DRAWN — which is the page this now reads — the same
  // expression reaches the personalisation the shop's own code writes, and
  // attributeNames does not mask what it reports because a name is markup and
  // markup is not a person. So this line puts a real one exactly where one of
  // those pseudo tags picks it up, and the walk above fails on it.
  `<script>var t='<li data-greeting-name="Prakash">'+x;if(a<b){return c>d}</script>`,
  // A STYLE BLOCK, WHOSE CONTENT IS ALSO FULL OF < AND >. The `>` in a child
  // rule and a quoted string of markup in a content property are both enough for
  // the same expression to find a tag that is not there.
  '<style>.a > .b { content: "<i data-css-name=\'Prakash\'>" }</style>',
  `<!-- <div title="${A_NAME}" data-old-city="${A_CITY}"> -->`,
].join('\n');

const REPORT = shapeLines(PAGE).join('\n');

console.log('\nit never says a word that came off the page');

it('NOT ONE OF THE BUYER’S DETAILS IS ANYWHERE IN THE REPORT', () => {
  for (const secret of PRIVATE_THINGS) {
    ok(!REPORT.includes(secret),
      `the report contains "${secret}", which came off the page and must never leave it`);
  }
});

it('and a text node is never visited at all, which is why', () => {
  // The name sits between two tags in the fixture. attributesIn only ever looks
  // INSIDE a < ... >, so there is no filtering step that could be forgotten.
  const values = attributesIn(PAGE).map((a) => a.value).join(' ');
  ok(!values.includes('Delivered to'), 'text between tags is not an attribute value');
  ok(!values.includes('Order details'), 'and neither is the text of a link');
});

it('a plain attribute gives up its NAME and never its value', () => {
  const names = attributeNames(PAGE).map((n) => n.name);
  ok(names.includes('title'), 'the name of a title attribute is reported');
  ok(names.includes('href'), 'and so is href');
  ok(names.includes('alt'), 'and alt');
  // ...and none of their values, which is where a page puts a person.
  const line = shapeLines(PAGE).find((l) => l.startsWith('names '));
  ok(line, 'there is a line of attribute names');
  for (const secret of PRIVATE_THINGS) {
    ok(!line.includes(secret), `the names line never carries "${secret}"`);
  }
});

it('a data value that reads like prose is replaced, not masked', () => {
  // TAKING THE DIGITS OUT OF A NAME DOES NOTHING. This is the rule that covers
  // the case masking cannot: a value with a space in it is content, whatever it
  // holds, and content is never reported.
  const shapes = dataShapes(PAGE).map((s) => s.shape);
  ok(shapes.some((s) => s.startsWith('data-a-popover=') && s.includes(NOT_A_SHAPE)),
    'the popover blob is reported as its name and a marker');
  ok(shapes.some((s) => s.startsWith('data-buyer-address=') && s.includes(NOT_A_SHAPE)),
    'and so is an address with a space in it');
  ok(!shapes.join(' ').includes(A_STREET), 'and the street itself is nowhere');
});

it('but a value with no space in it is still masked, so nothing rides on the rule alone', () => {
  // An address written with no spaces would pass isAShape. The digits still go,
  // and the assembled line still goes through the mask, so there are three
  // defences and not one.
  const shapes = dataShapes(PAGE).map((s) => s.shape).join(' ');
  ok(!shapes.includes(A_PHONE), 'a telephone number in a data value never survives');
  ok(shapes.includes('data-contact="##########"'), 'it reads as its shape instead');
  // THIS ONE FAILED ON THE FIRST DRAFT AND IT WAS A REAL HOLE. An email is short
  // and has no space in it, so the old "no whitespace" test let it through, and
  // masking digits does nothing to one. isAShape is an allowlist now.
  ok(!shapes.includes(AN_EMAIL), 'and an email address is not reported either');
  ok(shapes.includes(`data-email="${NOT_A_SHAPE}"`),
    'it is reported as its name and a marker, so the attribute is still visible');
  ok(!isAShape('somebody@example.com'), 'an @ is not something an identifier has in it');
  ok(!isAShape('{"a":"b"}'), 'and neither are braces and quotes');
  ok(!isAShape('one,two'), 'nor a comma, which is how an address is written');
  ok(isAShape('amzn1.yourorders.order-card.403-1234567-8901234'),
    'while Amazon\u2019s own identifier passes, which is the point of the list');
});

console.log('\nand the page\u2019s own code is not read as markup');

it('NOT ONE JAVASCRIPT WORD IS REPORTED AS AN ATTRIBUTE NAME', () => {
  const names = attributeNames(PAGE).map((n) => n.name);
  for (const word of ['function', 'var', 'return', 'typeof', 'if', 'catch', 'x', 'b', 'c', 'd']) {
    ok(!names.includes(word), `"${word}" came out of a script and was called an attribute`);
  }
});

it('and neither is anything a script wrote into a string of markup', () => {
  const shapes = dataShapes(PAGE).map((s) => s.shape).join(' ');
  ok(!shapes.includes('data-greeting-name'),
    'a data attribute written inside a script reached the report');
});

it('a style block and a comment are not markup either', () => {
  const names = attributeNames(PAGE).map((n) => n.name);
  ok(!names.includes('data-css-name'), 'a CSS rule is not a tag');
  ok(!names.includes('data-old-city'), 'a commented out tag is not on the page');
  const shapes = dataShapes(PAGE).map((x) => x.shape).join(' ');
  ok(!shapes.includes('data-css-name'), 'and nothing written inside one is reported');
  ok(!shapes.includes('data-old-city'), 'nor anything inside a comment');
});

it('withoutCode takes out exactly the four things and nothing else', () => {
  equal(withoutCode('<b>keep</b>'), '<b>keep</b>');
  ok(!withoutCode('<b>a</b><script>gone</script>').includes('gone'));
  ok(!withoutCode('<b>a</b><style>gone</style>').includes('gone'));
  ok(!withoutCode('<b>a</b><noscript>gone</noscript>').includes('gone'));
  ok(!withoutCode('<b>a</b><!-- gone -->').includes('gone'));
  ok(withoutCode('<b>a</b><script>x</script><i>keep</i>').includes('keep'),
    'and it carries on past the end of one');
  // ── AND PAST THE END OF EACH OF THE OTHERS, WHICH IS NOT THE SAME CHECK ───
  //
  // Found by breaking this file on purpose: taking the style rule out changes
  // nothing visible, because the LAST rule — the one that drops an unclosed tag
  // and everything after it — then eats the style block too, and the page with
  // it. The two guards overlap, so each one needs the case that separates them:
  // a CLOSED block must leave what follows it alone.
  ok(withoutCode('<b>a</b><style>x</style><i>keep</i>').includes('keep'),
    'a closed style block does not take the rest of the page with it');
  ok(withoutCode('<b>a</b><noscript>x</noscript><i>keep</i>').includes('keep'),
    'and neither does a closed noscript');
  // A PAGE CUT OFF HALFWAY is exactly where this would go wrong otherwise:
  // there is nothing after an unclosed script that can be trusted to be markup.
  ok(!withoutCode('<b>a</b><script>var x=1;y<z>w').includes('z'),
    'an unclosed script takes the rest of the page with it');
  for (const junk of [null, undefined, 5, {}, '']) equal(withoutCode(junk), '');
});

it('and the tags count counts markup, which is what the word means', () => {
  const line = shapeLines('<b>x</b><script>if(a<b){c>d}</script>')[0];
  ok(line.includes('tags=1'), `one tag on that page, not three: ${line}`);
  // BYTES IS STILL THE WHOLE PAGE. It answers "was there a page at all", and
  // what arrived includes its code.
  ok(line.includes('bytes=37'), `bytes is the whole page: ${line}`);
});

console.log('\nand the shape it DOES report is the one being looked for');

it('every order card collapses to ONE row with a count against it', () => {
  const shapes = dataShapes(PAGE);
  const card = shapes.find((s) => s.shape.includes('order-card'));
  ok(card, 'the order card slot is reported');
  equal(card.count, 2, 'both cards on the page are counted as one shape');
  ok(card.shape.includes('###-#######-#######'),
    `the order number reads as its shape: ${card.shape}`);
  ok(!/\d/.test(card.shape), 'and there is not one digit left in it');
});

it('the digits go and nothing else does', () => {
  equal(maskDigits('403-1234567-8901234'), '###-#######-#######');
  equal(maskDigits('amzn1.yourorders.order-card.403-1'), 'amzn#.yourorders.order-card.###-#');
  equal(maskDigits('no digits here'), 'no digits here');
  equal(maskDigits(''), '');
  equal(maskDigits(null), '');
  equal(A_DIGIT, '#');
});

it('a shape is short and has no whitespace in it, and that is the whole test', () => {
  ok(isAShape('amzn1.yourorders.order-card.403-1234567-8901234'));
  ok(!isAShape('Prakash Tamang'), 'a space means content');
  ok(!isAShape('a\nb'), 'and so does a newline');
  ok(!isAShape('a\tb'), 'and a tab');
  ok(!isAShape('x'.repeat(LONGEST_VALUE_WORTH_SEEING + 1)), 'and so does being long');
  ok(isAShape('x'.repeat(LONGEST_VALUE_WORTH_SEEING)), 'right up to the cut itself');
  ok(!isAShape(''), 'and nothing at all is not a shape');
});

it('the words worth knowing about are COUNTED and never quoted', () => {
  const counts = wordCounts(PAGE);
  deepEqual(Object.keys(counts).sort(), [...WORDS_WORTH_COUNTING].sort());
  equal(counts['order-card'], 2, 'both order cards are counted');
  equal(counts.yourorders, 2);
  equal(counts['a-box-group'], 2);
  equal(counts['order-info'], 1);
  equal(counts.orderCard, 0, 'and a spelling that is not there counts nought');
  equal(counts['your-orders'], 0);
  // This is the line that would have answered the question in one run.
  const line = shapeLines(PAGE).find((l) => l.startsWith('words '));
  ok(line && line.includes('order-card=2') && line.includes('orderCard=0'),
    `the words line says which spellings are on the page: ${line}`);
});

it('and a page that has been rebuilt says so, with nought against every one', () => {
  const rebuilt = '<div class="new-thing" data-new-id="1234"><span>hello</span></div>';
  const counts = wordCounts(rebuilt);
  for (const word of WORDS_WORTH_COUNTING) equal(counts[word], 0, `${word} is gone`);
  const shapes = dataShapes(rebuilt);
  equal(shapes.length, 1, 'and whatever IS there is reported instead');
  equal(shapes[0].shape, 'data-new-id="####"');
});

console.log('\nit reports a bounded amount, and says when it held something back');

it('at most the top shapes are shown, most common first', () => {
  const many = Array.from({ length: MOST_SHAPES_REPORTED + 12 },
    (_, i) => `<i data-k${i}="v${i}"></i>`).join('');
  const lines = shapeLines(many);
  const shown = lines.filter((l) => l.startsWith('shape ') && !l.includes('not shown'));
  equal(shown.length, MOST_SHAPES_REPORTED, 'no more than the cap is printed');
  ok(lines.some((l) => l.includes('and 12 more not shown')),
    'AND IT SAYS WHAT IT HELD BACK, so a truncated report is never read as the whole page');
});

it('the most common shape is first, which is what makes one run enough', () => {
  const html = '<i data-rare="a"></i>' + '<i data-common="b"></i>'.repeat(5);
  const shapes = dataShapes(html);
  equal(shapes[0].shape, 'data-common="b"');
  equal(shapes[0].count, 5);
});

it('and nothing at all is said about nothing at all', () => {
  for (const nothing of [null, undefined, '', 0, {}, []]) {
    const lines = shapeLines(nothing);
    ok(lines[0].startsWith('bytes=0'), `${String(nothing)} reports an empty page`);
    deepEqual(attributesIn(nothing), []);
    deepEqual(dataShapes(nothing), []);
  }
});

console.log('\nand it is off in a build a person gets');

it('it says nothing at all unless __DEV__ is on', () => {
  // __DEV__ is the phone's word and is not defined under node, so every line is
  // refused here — which is the same guard lookLog keeps and is checked the same
  // way: by counting what it said rather than by reading a console.
  equal(logPageShape(PAGE), 0, 'nothing is said with the flag off');
  equal(logPageShape(''), 0);
});

it('AND IT ADDS NO SECOND WAY OUT OF THIS FOLDER', () => {
  // THE COMMENTS COME OUT FIRST, and that is not tidiness. The first draft of
  // this check read the whole file and went red because the prose ABOVE explains
  // that this file writes through lookLog's one console.log. A check that matches
  // its own explanation is the fourth of its kind in this project.
  const source = withoutComments(read('./pageShape.js'));
  // It writes through lookLog, which holds the one console call and masks every
  // line as its last act. A second way out here would sit outside both.
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

it('and the screen only asks for it when there is nothing to find', () => {
  const screen = read('./LookingForItScreen.js');
  ok(/if \(countOrderCardSlots\(html\) === 0\) logPageShape\(html\);/.test(screen),
    'a page that is working prints no shape report, so this cannot become noise');
  ok(/import \{ logPageShape \} from '\.\/pageShape\.js';/.test(screen),
    'and it really is wired in');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
