// THE FOUR FACTS ON AN "IS THIS YOUR ORDER?" CARD.
//
// The owner asked for exactly these, in plain words: the order number, the date,
// the amount, and the product name. Four rows and no more — anything else on that
// card would be something to read rather than something to answer.
//
// EVERY VALUE COMES FROM THE SERVER'S OWN RECORD of the order, which read it off
// the shop's own page. Nothing here works anything out. It turns a whole number of
// paise into rupees and a day into words a person says out loud, and that is all.
//
// A MISSING VALUE IS SAID, NEVER LEFT BLANK. A row that simply had nothing in it
// would read as a mistake, and somebody deciding whether an order is theirs needs
// to know which parts we could not read.
//
// PURE. One import, with an extension, so a plain node test can read every rule.

import { rupeesFromPaise } from './theme.js';

/** The months, written out, because "21/08/2026" is a code and this is not. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-08-21" as "21 August 2026". Null for anything else. */
export function dayInWords(day) {
  if (typeof day !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** A whole number of paise, written as text, as "₹368". Null for anything else. */
export function amountInWords(paise) {
  if (typeof paise !== 'string' && typeof paise !== 'number') return null;
  const text = String(paise).trim();
  if (!/^\d+$/.test(text)) return null;
  return `₹${rupeesFromPaise(text)}`;
}

/**
 * What the order says was on it, in one line.
 *
 * One product is its name. Several is the first one and how many more, because
 * naming all of them would turn a row into a list, and the question on this card
 * is about the ORDER rather than about each thing on it.
 */
export function productInWords(items, fallback) {
  const list = Array.isArray(items) ? items.filter((i) => i && typeof i.name === 'string' && i.name.trim() !== '') : [];
  if (list.length === 0) {
    return typeof fallback === 'string' && fallback.trim() !== '' ? fallback.trim() : null;
  }
  const first = list[0].name.trim();
  if (list.length === 1) return first;
  const more = list.length - 1;
  return `${first} and ${more} more ${more === 1 ? 'thing' : 'things'}`;
}

/**
 * The four rows, in the owner's own order.
 *
 * `known` is false where the shop's page did not say. The screen greys those and
 * the words still read as a sentence.
 */
export function orderCardRows(order, options) {
  const o = order && typeof order === 'object' ? order : {};
  const opts = options && typeof options === 'object' ? options : {};

  const number = typeof o.orderNumber === 'string' && o.orderNumber.trim() !== ''
    ? o.orderNumber.trim() : null;
  const day = dayInWords(o.orderDate);
  const amount = amountInWords(o.totalPaise);
  const product = productInWords(o.items, opts.productFallback);

  return [
    {
      label: 'Order number',
      value: number || 'The shop did not show one',
      known: number != null,
    },
    {
      label: 'Order date',
      value: day || 'We could not read the date',
      known: day != null,
    },
    {
      label: 'Amount',
      value: amount || 'We could not read the amount',
      known: amount != null,
    },
    {
      label: 'Product',
      value: product || 'We could not read the product',
      known: product != null,
    },
  ];
}
