// WHAT SHAPE IS AMAZON'S ORDER LIST PAGE TODAY? COUNTS AND SHAPES, NEVER WORDS.
//
// ── WHY THIS EXISTS, FROM THE OWNER'S OWN DEVICE, 15 SEPTEMBER 2026 ─────────
//
//   [fayr-look] list    status=200 bytes=374862 looked=false whyNot=null
//                       wantsSignIn=false
//   [fayr-look] numbers slots=0 shaped=0 opening=0
//
// A whole, healthy three hundred and seventy four kilobyte order page. Signed
// in. No refusal, no sign in wall, no puzzle. And NOT ONE match for
//
//   data-csa-c-slot-id="amzn1.yourorders.order-card.<number>"
//
// countOrderCardSlots was built to tell exactly these two apart, and it did its
// job: slots=0 says the attribute is not on the page, not that the session is
// bad. Amazon has moved the markup.
//
// ── AND WHY A LOOK RATHER THAN A NEW GUESS ──────────────────────────────────
//
// The pattern that just stopped matching was itself written from a page somebody
// looked at once, months ago, and nothing has looked since. Writing a second
// pattern the same way would buy the same silence again, on a day nobody is
// watching. So this reports the page's SHAPE and a person picks the selector
// from what Amazon really sends.
//
// ── WHAT IT MAY REPORT, AND IT IS A SHORT LIST ──────────────────────────────
//
// An Amazon order page carries the buyer's NAME, their DELIVERY ADDRESS, what
// they bought and what they paid. So:
//
//   ATTRIBUTE NAMES ONLY, for every attribute. A name is a fact about the
//   markup. A value can be anything at all.
//
//   FOR data-* ATTRIBUTES, THE VALUE WITH EVERY DIGIT REPLACED. That is the one
//   place a value is worth seeing, because it is where a selector is written
//   from — and with the digits gone, an order number reads as its SHAPE,
//   ###-#######-#######, which is the thing being looked for and is nobody's
//   order number.
//
//   NOTHING IS READ OUTSIDE A TAG. Every attribute is taken from inside a
//   < ... > and text nodes are never visited at all, so a name or an address
//   sitting between two tags cannot reach this.
//
//   AND A VALUE THAT LOOKS LIKE PROSE IS NOT REPORTED. A selector's value is
//   short and has no spaces in it; a data attribute carrying a sentence, a JSON
//   blob or somebody's address does. Those are reported as their name and a
//   marker, so the shape is still visible and the words are not. This is a rule
//   this file adds on top of what was asked for, because masking digits does
//   nothing to a name.
//
// ── THE SAME TWO GUARDS AS lookLog.js, FOR THE SAME REASONS ─────────────────
//
// Every line is assembled in one place and masked as its LAST act, so it cannot
// matter which argument a future caller puts a page's answer into. And it is off
// in a build a person gets. It writes through lookLog's one console.log and adds
// no second way out of this folder.

import { logLook } from './lookLog.js';

/** What stands in for a digit, so a shape is visible and a number is not. */
export const A_DIGIT = '#';

/** How many distinct data attribute shapes are worth reporting in one go. */
export const MOST_SHAPES_REPORTED = 40;

/**
 * A value longer than this is not a selector, it is content.
 *
 * An order card's slot id is about forty five characters. A data attribute
 * holding a popover's JSON runs to thousands. The cut is well above the first
 * and far below the second.
 */
export const LONGEST_VALUE_WORTH_SEEING = 120;

/** What a value that was not reported is called instead. Never its content. */
export const NOT_A_SHAPE = '<prose>';

/**
 * The words worth knowing the page still contains, counted and never quoted.
 *
 * Each one is a thing the old selector or its neighbours were built on. A count
 * of nought for all of them says the page was rebuilt; a count for one of them
 * says where to look next.
 */
export const WORDS_WORTH_COUNTING = [
  'order-card', 'yourorders', 'orderCard', 'order-info', 'a-box-group', 'your-orders',
];

/** Every digit replaced, so a shape survives and a number does not. */
export function maskDigits(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[0-9]/g, A_DIGIT);
}

/**
 * WHAT A SELECTOR'S VALUE IS ALLOWED TO BE MADE OF. Letters, digits, and the
 * four separators Amazon's own identifiers use.
 *
 * AN ALLOWLIST AND NOT A BLOCKLIST, and this one is the safe direction round: it
 * refuses everything nobody has thought of, rather than admitting it. The first
 * draft of this file asked only "has it any whitespace in it", which is the
 * question that let an email address through — see isAShape.
 */
const ONLY_THESE_CHARACTERS = /^[A-Za-z0-9._:/-]+$/;

/**
 * IS THIS VALUE A SHAPE OR IS IT CONTENT? The one question that keeps words out.
 *
 * ── IT WAS WRONG ON ITS FIRST DRAFT AND ITS OWN CHECK CAUGHT IT ────────────
 *
 * It asked only whether the value was short and had no whitespace. An email
 * address is short and has no whitespace, and taking the digits out of one does
 * nothing at all, so `data-email="somebody@example.com"` went straight into the
 * report. The fixture next door carries a name, a street, a postcode, an email
 * and a telephone number precisely so that would fail, and it did.
 *
 * So the test is now what the value is MADE OF. An identifier is letters,
 * digits, dots, dashes, underscores, colons and slashes. An email has an @ in
 * it. A JSON blob has braces and quotes. An address has commas. None of them can
 * pass, and neither can anything else nobody has pictured yet.
 *
 * ── WHAT IS STILL POSSIBLE, SAID PLAINLY RATHER THAN LEFT TO BE FOUND ──────
 *
 * A single bare word of letters passes this, so a data attribute holding a first
 * name with nothing else in it would be reported. We have not proved Amazon has
 * no such attribute on its orders list, only that none has been seen. What
 * bounds it is that this whole file is development only, never reaches a build a
 * person gets, and writes to the developer's own window and nowhere else.
 */
export function isAShape(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.length > LONGEST_VALUE_WORTH_SEEING) return false;
  if (/\s/.test(value)) return false;
  return ONLY_THESE_CHARACTERS.test(value);
}

/**
 * THE PAGE WITH ITS OWN CODE TAKEN OUT, BEFORE ANYTHING IS READ AS MARKUP.
 *
 * ── THIS FILE WAS WRONG, AND THE OWNER'S OWN REPORT SAID SO IN PLAIN SIGHT ──
 *
 * From his device, 15 September 2026:
 *
 *   shape names class(542) a(483) e(432) function(429) b(374) n(359) c(355)
 *               t(333) var(278) d(232) r(226) return(185) ... typeof(83) ...
 *
 * `function`, `var`, `return`, `typeof`, `if`, `for`, `catch`. Those are not
 * attribute names. They are JavaScript, read as markup, because the expression
 * below looks for `<` then a letter then anything up to a `>` and a minified
 * script is full of exactly that: `if(a<b){return c>a}` offers up the pseudo tag
 * `<b){return c>` and the "attributes" `return` and `c`.
 *
 * MEASURED ON A REAL PAGE AMAZON SERVED, the same day: 2337 distinct attribute
 * names as sent, 43 once script and style are taken out. Fifty four times too
 * many, and the `names` line — whose whole job is to show a person what to write
 * the next selector from — was almost entirely noise. So was `tags=`.
 *
 * ── AND ON A PAGE THE SHOP HAS DRAWN IT IS A LEAK, NOT ONLY NOISE ───────────
 *
 * attributeNames reports NAMES without masking them, because a name is markup
 * and markup is not a person. That is true of real attribute names. It is not
 * true of whatever a regular expression scrapes out of the middle of a script —
 * and the page this now reads is the one carrying the buyer's own orders, where
 * the shop's own code writes their name into its own variables.
 *
 * THE SAME THREE REPLACES src/orderhistory.js ALREADY DOES at pageToLines. A
 * second copy, and said out loud rather than left to be found: that file is
 * pinned by several checks and is not opened for this.
 *
 * AN UNCLOSED SCRIPT TAKES THE REST OF THE PAGE WITH IT. A page cut off halfway
 * is exactly where this would otherwise go wrong, and there is nothing after an
 * unclosed script tag that can be trusted to be markup.
 */
export function withoutCode(html) {
  if (typeof html !== 'string' || html === '') return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Whatever is left open runs to the end of what we were given.
    .replace(/<(script|style|noscript)\b[\s\S]*$/i, ' ');
}

/**
 * EVERY ATTRIBUTE, TAKEN FROM INSIDE TAGS ONLY.
 *
 * Answers a list of { name, value }. Nothing between two tags is ever visited,
 * which is what keeps a buyer's name and address out of this by construction
 * rather than by filtering afterwards.
 *
 * AND NOTHING INSIDE THE PAGE'S OWN CODE IS VISITED EITHER. See withoutCode
 * above for what that was doing to this report before it was there.
 */
export function attributesIn(html) {
  if (typeof html !== 'string' || html === '') return [];
  const found = [];
  const tags = withoutCode(html).match(/<[a-zA-Z][^>]*>/g) || [];
  for (const tag of tags) {
    const inside = tag.slice(1, -1);
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let first = true;
    let m = pattern.exec(inside);
    while (m !== null) {
      // The first word inside a tag is the tag's own name, not an attribute.
      if (!first) {
        found.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' });
      }
      first = false;
      m = pattern.exec(inside);
    }
  }
  return found;
}

/** Every distinct attribute NAME on the page, in order of how often it appears. */
export function attributeNames(html) {
  const howMany = new Map();
  for (const one of attributesIn(html)) {
    howMany.set(one.name, (howMany.get(one.name) || 0) + 1);
  }
  return [...howMany.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

/**
 * EVERY DISTINCT data-* SHAPE, most common first.
 *
 * A shape is the attribute's name and its value with the digits taken out, so
 * every order card on the page collapses into one row with a count against it -
 * which is exactly the signal being looked for.
 */
export function dataShapes(html) {
  const howMany = new Map();
  for (const one of attributesIn(html)) {
    if (!one.name.startsWith('data-')) continue;
    const value = isAShape(one.value) ? maskDigits(one.value) : NOT_A_SHAPE;
    const shape = one.value === '' ? one.name : `${one.name}="${value}"`;
    howMany.set(shape, (howMany.get(shape) || 0) + 1);
  }
  return [...howMany.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([shape, count]) => ({ shape, count }));
}

/** How many times each word worth knowing about appears. A count and never a quote. */
export function wordCounts(html) {
  const text = typeof html === 'string' ? html : '';
  const counts = {};
  for (const word of WORDS_WORTH_COUNTING) {
    const pattern = new RegExp(word.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&'), 'g');
    counts[word] = (text.match(pattern) || []).length;
  }
  return counts;
}

/**
 * THE WHOLE REPORT, AS LINES, BUILT AND NOT PRINTED so it can be walked here.
 *
 * Every line is a count, a shape or an attribute name. There is no line in here
 * that can carry a word off the page.
 */
export function shapeLines(html) {
  const bytes = typeof html === 'string' ? html.length : 0;
  const names = attributeNames(html);
  const shapes = dataShapes(html);
  const words = wordCounts(html);
  const lines = [
    // BYTES IS THE WHOLE PAGE AND TAGS IS ONLY ITS MARKUP, and the two are
    // deliberately measured over different things. A page's length is a fact
    // about what arrived. A tag count taken over the same string would count a
    // minified script's `if(a<b){return c>` as a tag, which is what it used to
    // do — see withoutCode.
    `bytes=${bytes} tags=${(withoutCode(html).match(/<[a-zA-Z][^>]*>/g) || []).length}`
    + ` attrNames=${names.length} dataShapes=${shapes.length}`,
    `words ${WORDS_WORTH_COUNTING.map((w) => `${w}=${words[w]}`).join(' ')}`,
    `names ${names.slice(0, MOST_SHAPES_REPORTED).map((n) => `${n.name}(${n.count})`).join(' ')}`,
  ];
  for (const one of shapes.slice(0, MOST_SHAPES_REPORTED)) {
    lines.push(`shape ${one.count}x ${one.shape}`);
  }
  if (shapes.length > MOST_SHAPES_REPORTED) {
    lines.push(`shape ...and ${shapes.length - MOST_SHAPES_REPORTED} more not shown`);
  }
  return lines;
}

/**
 * Say the report, if the commentary is on. Answers how many lines it said, so a
 * check can prove the guard works without reading the console.
 *
 * It writes through lookLog, which masks every line as its last act and is the
 * one console call in this folder. This file adds no second way out.
 */
export function logPageShape(html) {
  let said = 0;
  for (const line of shapeLines(html)) {
    if (logLook('shape', line)) said += 1;
  }
  return said;
}
