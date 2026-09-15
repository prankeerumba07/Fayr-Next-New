// WHAT IS AN ORDER ROW MARKED WITH? ASKED OF THE PAGE THE SHOP ACTUALLY DREW.
//
// ── WHY THE REPORT NEXT DOOR IS NOT ENOUGH ─────────────────────────────────
//
// src/order/pageShape.js answers "what is this page made of": the attribute
// names on it and its forty commonest data attribute shapes. That was the right
// question for a page with no orders on it, and it answered it — the words line
// said order-card=0 and settled that Amazon had rebuilt the list.
//
// It is the wrong question for the page we can now read. A drawn order list has
// thousands of attributes on it and the forty commonest belong to the menu at
// the top. "What wraps an order" is a different question, and a person reading
// forty rows of nav furniture cannot answer it.
//
// ── SO THIS ASKS ABOUT THE ORDERS THEMSELVES ───────────────────────────────
//
// It finds every place on the page where an order number appears — in the words
// of the page or inside an attribute — and reports WHAT IS AROUND IT: the tag,
// its id, its classes, its data attributes, and the same for the few elements
// above it. Identical surroundings collapse into one row with a count, so ten
// orders drawn the same way read as one line saying ten.
//
// THAT IS WHAT A SELECTOR IS WRITTEN FROM, and one run of it is enough. The
// owner asked to see this before anybody writes the next selector, and this is
// the thing he asked to see.
//
// ── AN ORDER NUMBER IS THE ONE THING IT LOOKS FOR, AND IT NEVER PRINTS ONE ──
//
// The number is how a row is FOUND. What gets printed is maskDigits of it —
// ###-#######-####### — which is the shape and is nobody's order.
//
// ── AND EVERYTHING ELSE IT REFUSES TO SAY ──────────────────────────────────
//
// This page carries the buyer's name, their delivery address, what they bought
// and what they paid. So, and every one of these is checked next door against a
// fixture that carries all of them:
//
//   NO TEXT, EVER. A text node is READ, to ask whether it is an order number,
//   and never kept. Nothing between two tags reaches a line.
//   A PLAIN ATTRIBUTE GIVES UP ITS NAME ONLY. title, alt, href, aria-label.
//   id AND class GIVE UP THEIR VALUE, masked and allowlisted. Those two are
//   what CSS is written against; they are markup by definition. A class list is
//   split and each word allowlisted on its own, so one long list cannot ride in
//   whole.
//   A data ATTRIBUTE MUST LOOK LIKE AN IDENTIFIER AND NOT A WORD. Stricter than
//   the report next door, deliberately: data-csa-c-product-type="SHOES" and
//   data-first-name="Prakash" are both short, both allowlisted, and neither is
//   a selector. A value with no separator in it at all is printed as <word>.
//
// It writes through lookLog, which is off unless __DEV__ and masks every line as
// its last act. There is no second way out of this folder.

import { ORDER_NUMBER_RUN } from './detailLook.js';
import { logLook } from './lookLog.js';
import {
  LONGEST_VALUE_WORTH_SEEING, MOST_SHAPES_REPORTED, NOT_A_SHAPE, isAShape,
  maskDigits, withoutCode,
} from './pageShape.js';

/** What a data value with no separator in it is called instead of its content. */
export const NOT_AN_IDENTIFIER = '<word>';

/**
 * HOW FAR UP FROM THE ORDER NUMBER IS WORTH REPORTING.
 *
 * A selector is written from the row and the thing holding the rows. Four is
 * already more levels than anybody writes, and it keeps one line one line.
 */
export const MOST_ANCESTORS = 4;

/** Tags that never hold anything, so they never go on the stack. */
const HOLDS_NOTHING = [
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
];

/** The separators a real identifier is built out of. */
const HAS_A_SEPARATOR = /[-._:/]/;

/**
 * A WORD WRITTEN THE WAY A NAME IS WRITTEN: one capital, then lower case.
 *
 * ── ITS OWN CHECK FOUND THIS, WHICH IS WHY THE FIXTURE CARRIES A NAME ──────
 *
 * The rule below for data values — "it must have a separator in it or it is a
 * word" — cannot be used for a class, because a class is exactly the thing this
 * report exists to show and half of them are bare words. So `class="a Prakash"`
 * came through as `.a.Prakash`, and the fixture next door, which puts a real
 * name in every place a page can hold one, went red on it.
 *
 * SO THE REFUSAL IS NARROW AND SAYS WHAT IT CLAIMS. A class is written lower
 * case or camel case — order-card, a-box-group, orderCard, aok-hidden — and a
 * person's name is written Prakash. One capital followed by nothing but lower
 * case letters is a name's shape and is not a class's, so that and only that is
 * refused.
 *
 * WHAT IS STILL POSSIBLE, said rather than left to be found: a name in capitals,
 * a name of one letter, a surname run together with a first name. What bounds
 * those is the same thing that bounds the report next door — this whole file is
 * development only and writes to a developer's own window and nowhere else.
 */
const LOOKS_LIKE_A_NAME = /^[A-Z][a-z]+$/;

/**
 * A data attribute's value, or a word saying why it is not shown.
 *
 * Three answers and not two: its shape, `<prose>` for something with a space or
 * a character an identifier does not have, and `<word>` for a bare word. That
 * third one is the rule this file adds — a bare word is where a shop writes a
 * product type, a city or a first name, and masking the digits out of one does
 * nothing at all.
 */
export function aDataValue(value) {
  if (typeof value !== 'string' || value === '') return '';
  if (!isAShape(value)) return NOT_A_SHAPE;
  if (!HAS_A_SEPARATOR.test(value)) return NOT_AN_IDENTIFIER;
  return maskDigits(value);
}

/**
 * ONE CLASS WORD, OR AN ID. Markup by definition, so shown rather than refused —
 * these two are what a selector is actually written against, and a report that
 * hid them would answer nothing.
 *
 * Except a word written the way a name is written. See LOOKS_LIKE_A_NAME.
 */
export function aClassWord(value) {
  if (typeof value !== 'string' || value === '') return '';
  if (!isAShape(value)) return NOT_A_SHAPE;
  if (!HAS_A_SEPARATOR.test(value) && LOOKS_LIKE_A_NAME.test(value)) return NOT_AN_IDENTIFIER;
  return maskDigits(value);
}

/** An id, which is one word rather than a list, and is read the same way. */
export function aHookValue(value) {
  return aClassWord(value);
}

/** Every attribute written inside one tag, as { name, value }. */
export function attributesOfTag(inside) {
  const found = [];
  if (typeof inside !== 'string') return found;
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m = pattern.exec(inside);
  while (m !== null) {
    found.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' });
    m = pattern.exec(inside);
  }
  return found;
}

/**
 * ONE ELEMENT, WRITTEN THE WAY A SELECTOR IS WRITTEN.
 *
 *   li.a-box-group.order-card#orderCard-###[data-order-id="###"][aria-label]
 *
 * Tag, then its classes, then its id, then its data attributes with their
 * shapes, then the NAMES of everything else in square brackets with no value at
 * all. A person can read a selector straight off it.
 */
export function describeOneElement(name, attrs) {
  const parts = [String(name || '').toLowerCase()];
  const names = [];
  for (const one of Array.isArray(attrs) ? attrs : []) {
    if (one.name === 'class') {
      for (const word of String(one.value).split(/\s+/).filter((w) => w !== '')) {
        parts.push(`.${aClassWord(word)}`);
      }
    } else if (one.name === 'id') {
      parts.push(`#${aHookValue(one.value)}`);
    } else if (one.name.startsWith('data-')) {
      const shown = aDataValue(one.value);
      parts.push(shown === '' ? `[${one.name}]` : `[${one.name}="${shown}"]`);
    } else {
      names.push(one.name);
    }
  }
  for (const plain of names) parts.push(`[${plain}]`);
  const whole = parts.join('');
  return whole.length > LONGEST_VALUE_WORTH_SEEING * 2
    ? `${whole.slice(0, LONGEST_VALUE_WORTH_SEEING * 2)}…`
    : whole;
}

/**
 * EVERY PLACE AN ORDER NUMBER APPEARS, AND WHAT IS AROUND IT.
 *
 * One pass over the markup keeping a stack of what is open. A text run between
 * two tags is tested and thrown away; a tag's attribute value is tested and the
 * attribute's NAME kept. Either way what comes back is the masked shape of the
 * number and a list of element descriptions, innermost first.
 *
 * PURE, OVER A STRING, which is the whole reason this is not a walk of a live
 * document. This project's checks are plain node with no browser in them, so a
 * version that took a document could never be broken on purpose and watched to
 * fail — and an instrument nobody can prove is an instrument nobody should
 * believe. The page is serialised in the web view and read here.
 */
export function orderNumberSightings(html) {
  const sightings = [];
  const markup = withoutCode(html);
  if (markup === '') return sightings;
  const number = new RegExp(`\\b${ORDER_NUMBER_RUN}\\b`);
  const everyTag = /<(\/?)([a-zA-Z][-a-zA-Z0-9]*)([^>]*)>/g;
  const open = [];
  const path = () => open.slice(-MOST_ANCESTORS).reverse().map((el) => el.said);

  let at = 0;
  let tag = everyTag.exec(markup);
  let guard = 0;
  while (tag !== null && guard < 20000) {
    guard += 1;
    // THE WORDS BETWEEN THE LAST TAG AND THIS ONE. Tested, never kept.
    const between = markup.slice(at, tag.index);
    const inWords = between.match(number);
    if (inWords) sightings.push({ where: 'text', attr: '', shape: maskDigits(inWords[0]), path: path() });
    at = tag.index + tag[0].length;

    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    const inside = tag[3] || '';
    if (!closing) {
      // The first word inside a tag is the tag's own name, not an attribute, and
      // attributesOfTag is given only what follows it.
      const attrs = attributesOfTag(inside);
      const said = describeOneElement(name, attrs);
      for (const one of attrs) {
        const found = String(one.value).match(number);
        if (found) {
          sightings.push({
            where: 'attr',
            attr: one.name,
            shape: maskDigits(found[0]),
            path: [said, ...path()].slice(0, MOST_ANCESTORS),
          });
        }
      }
      const shuts = inside.trim().endsWith('/') || HOLDS_NOTHING.indexOf(name) !== -1;
      if (!shuts) open.push({ name, said });
    } else {
      for (let i = open.length - 1; i >= 0; i -= 1) {
        if (open[i].name === name) { open.length = i; break; }
      }
    }
    tag = everyTag.exec(markup);
  }
  return sightings;
}

/** How many order-number runs are in the page's own code rather than its markup. */
export function runsInsideCode(html) {
  const all = typeof html === 'string' ? html : '';
  const pattern = new RegExp(`\\b${ORDER_NUMBER_RUN}\\b`, 'g');
  const inAll = (all.match(pattern) || []).length;
  const inMarkup = (withoutCode(all).match(new RegExp(pattern.source, 'g')) || []).length;
  return Math.max(0, inAll - inMarkup);
}

/**
 * THE REPORT, AS LINES, BUILT AND NOT PRINTED so it can be walked next door.
 *
 * Identical surroundings collapse into one row with a count, because ten orders
 * drawn the same way is ONE fact about the markup and not ten.
 */
export function rowShapeLines(html) {
  const sightings = orderNumberSightings(html);
  const inCode = runsInsideCode(html);
  const howMany = new Map();
  for (const one of sightings) {
    const head = one.where === 'attr'
      ? `attr ${one.attr} ${one.shape}`
      : `text ${one.shape}`;
    const key = [head, ...one.path].join('\n    in ');
    howMany.set(key, (howMany.get(key) || 0) + 1);
  }
  const rows = [...howMany.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const text = sightings.filter((s) => s.where === 'text').length;
  const lines = [
    `sightings=${sightings.length} text=${text} attr=${sightings.length - text}`
    + ` inCode=${inCode} distinct=${rows.length}`,
  ];
  for (const [key, count] of rows.slice(0, MOST_SHAPES_REPORTED)) {
    lines.push(`${count}x ${key}`);
  }
  if (rows.length > MOST_SHAPES_REPORTED) {
    lines.push(`...and ${rows.length - MOST_SHAPES_REPORTED} more not shown`);
  }
  return lines;
}

/**
 * Say the report, if the commentary is on. Answers how many lines it said, so a
 * check can prove the guard works without reading the console.
 */
export function logRowShape(html) {
  let said = 0;
  for (const line of rowShapeLines(html)) {
    if (logLook('rows', line)) said += 1;
  }
  return said;
}
