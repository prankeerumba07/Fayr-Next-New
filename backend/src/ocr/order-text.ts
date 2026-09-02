/**
 * READING AN ORDER SCREEN THAT HOLDS MORE THAN ONE PRODUCT.
 *
 * WHY THIS FILE EXISTS. The reader we had assumed one order with one product on
 * it, because that is what an Amazon order page looks like. A real Zepto order is
 * not that shape at all: one order, split into several shipments, with a product
 * and a price under each shipment heading and one bill block at the end. Read by
 * the old assumption, an order like that gave up one product and lost the rest,
 * and the one it kept was whichever the model happened to name first.
 *
 * WHAT IT IS. A pure function over TEXT. Nothing here opens an image, calls a
 * model, or touches a database, so every rule in it is checked by a test that
 * reads a text file — see order-text.spec.ts and the fixture it reads. The image
 * half stays where it was: something else turns a picture into text, and this
 * turns text into an order.
 *
 * MONEY IS PAISE THE MOMENT IT IS READ. Every figure on the screen is rupees, and
 * every figure that leaves this file is integer paise, converted by
 * paiseFromRupees in order-comparison.ts and by nothing else. There is no second
 * sum anywhere in here.
 *
 * WHAT IT WILL NOT DO. It never guesses. A figure it cannot read is null, a
 * product it cannot name is left out, and a scrap of an order number is thrown
 * away rather than kept — because a half-read order number does not stay unknown,
 * it gets compared, and then it disagrees with the real one and the person is
 * told their own order is not theirs.
 */

import { dayFromText, paiseFromRupees } from './order-comparison';

/** One product on the order, with its own price in integer paise. */
export interface ParsedOrderItem {
  name: string;
  pricePaise: bigint;
}

/**
 * One order, however many products are on it.
 *
 * `totalPaise` and `itemTotalPaise` are two different figures and both are kept:
 * the item total is what the products came to, the total bill is what was
 * actually charged, and on a quick commerce order they differ by delivery and
 * handling. `shipments` is how many shipment headings the screen showed, which is
 * how we know a screen like this was read as the several parts it really has.
 */
export interface ParsedOrder {
  orderNumber: string | null;
  /** The day the order was placed, as "2026-08-21". Never a delivery date. */
  orderDate: string | null;
  /** The total bill — what was charged. Integer paise. */
  totalPaise: bigint | null;
  /** What the products alone came to, where the screen states it. Integer paise. */
  itemTotalPaise: bigint | null;
  shipments: number;
  items: ParsedOrderItem[];
}

/**
 * THE LINES IN A BILL BLOCK THAT ARE NOT PRODUCTS.
 *
 * Named and exported so the next shop's wording is added in one place a person
 * can read, instead of being typed into a regular expression in the middle of the
 * reader. Every one of these has been seen on an Indian order screen. They are
 * matched on the start of the line, lower case, with the spacing collapsed.
 */
export const BILL_LABELS: readonly string[] = [
  'item total',
  'items total',
  'item(s) subtotal',
  'item subtotal',
  'subtotal',
  'sub total',
  'handling charge',
  'handling fee',
  'delivery fee',
  'delivery charge',
  'shipping fee',
  'shipping charge',
  'packaging charge',
  'packing charge',
  'small cart charge',
  'rain fee',
  'surge fee',
  'gst',
  'taxes',
  'tax',
  'discount',
  'coupon',
  'coupon discount',
  'savings',
  'promo',
  'tip',
  'total bill',
  'bill total',
  'grand total',
  'order total',
  'total amount',
  'amount paid',
  'total paid',
  'to pay',
  'you pay',
  // BARE "TOTAL", which is what a row in a LIST of orders prints. It has no bill
  // block of its own — just the order, the products and one figure — so without
  // this a list row's total would be read as a product called "Total".
  'total',
];

/** The labels that mean "what the products came to". */
const ITEM_TOTAL_LABELS: readonly string[] = [
  'item total',
  'items total',
  'item(s) subtotal',
  'item subtotal',
  'subtotal',
  'sub total',
];

/** The labels that mean "what was actually charged". */
const TOTAL_BILL_LABELS: readonly string[] = [
  'total bill',
  'bill total',
  'grand total',
  'order total',
  'total amount',
  'amount paid',
  'total paid',
  'to pay',
  'you pay',
  // Last, so a page that says both "Total" and "Total Bill" is read on the more
  // specific one first.
  'total',
];

/** Where the products stop and the bill starts. */
const BILL_HEADINGS: readonly RegExp[] = [
  /^bill\s+details$/i,
  /^bill\s+summary$/i,
  /^price\s+details$/i,
  /^payment\s+details$/i,
  /^order\s+summary$/i,
  /^payment\s+summary$/i,
];

/** "Order ID SOSIJGGRL26770", "Order ID: 12345678", "Order Number 998877". */
const ORDER_NUMBER_LABEL = /^order\s*(?:id|no\.?|number)\b\s*[:#-]?\s*(.*)$/i;
/** "Order# 402-3925017-7784521", which is how Amazon writes it. */
const ORDER_HASH_LABEL = /^order\s*#\s*(.*)$/i;

/**
 * "Placed on 21 Aug 2026, 7:42 PM" and "Ordered on 2 Jul 2026".
 *
 * Deliberately not "Delivered on", which sits two lines away on a Zepto screen
 * and carries a date of its own. A delivery date read as an order date would make
 * an order look as though it was placed after it arrived.
 */
const ORDER_DATE_LABEL =
  /^(?:placed\s+on|ordered\s+on|order\s+placed\s+on|order(?:ed)?\s+date|placed)\b\s*[:\-]?\s*(.*)$/i;

/** A shipment heading — "Shipment 1 of 2". */
const SHIPMENT_HEADING = /^shipment\b/i;

/** Lines that describe what is happening to the parcel, never a product. */
const STATUS_LINE =
  /^(?:delivered|delivery|out\s+for\s+delivery|arriving|arrives|shipped|dispatched|cancelled|canceled|returned|refunded|placed|ordered|paid|payment|need\s+help|track|invoice|download)\b/i;

/** How a rupee figure is written, in any of the three ways shops write it. */
const RUPEES = '(?:₹|rs\\.?|inr)\\s*([\\d,]+(?:\\.\\d{1,2})?)';
const MONEY_ONLY = new RegExp(`^${RUPEES}$`, 'i');
const QUANTITY_AND_PRICE = new RegExp(`^(\\d+)\\s*[x×*]\\s*${RUPEES}$`, 'i');
const NAME_AND_MONEY = new RegExp(`^(.*?)\\s*${RUPEES}$`, 'i');

/** Collapse the spacing so a label matches however the screen was laid out. */
function low(line: string): string {
  return line.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A rupee figure as a plain number of rupees, or null. */
function rupees(figure: string | undefined): number | null {
  if (typeof figure !== 'string') return null;
  const n = Number(figure.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Paise from a rupee figure on the screen, through the one converter. */
function paise(figure: string | undefined): bigint | null {
  return paiseFromRupees(rupees(figure));
}

/** A line that is nothing but a price. */
function moneyOnly(line: string): bigint | null {
  const m = MONEY_ONLY.exec(line.trim());
  return m ? paise(m[1]) : null;
}

/** A line that is a count and a price — "1 x ₹149". The price is the item's own. */
function quantityAndPrice(line: string): bigint | null {
  const m = QUANTITY_AND_PRICE.exec(line.trim());
  return m ? paise(m[2]) : null;
}

/**
 * Does this line begin with this label, as a whole word?
 *
 * Whole word matters: "Totally Awesome Headband ₹499" begins with the letters of
 * "total", and reading that as the order's total would lose a product and invent
 * a figure.
 */
function startsWithLabel(line: string, label: string): boolean {
  const l = low(line);
  if (!l.startsWith(label)) return false;
  const next = l.charAt(label.length);
  return next === '' || !/[a-z0-9]/.test(next);
}

/** Does this line start with one of the bill block's labels? */
function isBillLabel(line: string): boolean {
  return BILL_LABELS.some((label) => startsWithLabel(line, label));
}

/**
 * Could this line be a product's name?
 *
 * Everything a product name is not: a heading, a shipment, a status, a bill line,
 * a label, a price, a bare number, or something too short to be a name at all.
 */
function looksLikeAName(line: string): boolean {
  const text = line.trim();
  if (text.length < 3) return false;
  const letters = text.replace(/[^a-z]/gi, '').length;
  if (letters < 2) return false;
  if (SHIPMENT_HEADING.test(text)) return false;
  if (STATUS_LINE.test(text)) return false;
  if (isBillLabel(text)) return false;
  if (ORDER_NUMBER_LABEL.test(text)) return false;
  if (ORDER_HASH_LABEL.test(text)) return false;
  if (ORDER_DATE_LABEL.test(text)) return false;
  if (MONEY_ONLY.test(text)) return false;
  if (QUANTITY_AND_PRICE.test(text)) return false;
  for (const heading of BILL_HEADINGS) if (heading.test(text)) return false;
  return true;
}

/**
 * A product name and its price on one line — "Boldfit Sports Headband ₹149",
 * which is how a narrow screen lays a row out.
 */
function nameAndPriceOnOneLine(
  line: string,
): { name: string; pricePaise: bigint } | null {
  const text = line.trim();
  if (MONEY_ONLY.test(text)) return null;
  if (QUANTITY_AND_PRICE.test(text)) return null;
  const m = NAME_AND_MONEY.exec(text);
  if (!m) return null;
  const name = m[1].trim();
  if (!looksLikeAName(name)) return null;
  const p = paise(m[2]);
  return p == null || p <= 0n ? null : { name, pricePaise: p };
}

/**
 * An order number, or null.
 *
 * A value is only accepted when it looks like an order number: no spaces in it,
 * at least five letters and digits, and at least one digit. That last rule is
 * what stops "Order ID" with the value missing from picking up whatever heading
 * happens to sit on the next line.
 */
function acceptableOrderNumber(value: string): string | null {
  const text = value.trim().replace(/^[:#\-\s]+/, '').trim();
  if (text === '' || /\s/.test(text)) return null;
  const bare = text.replace(/[^a-z0-9]/gi, '');
  if (bare.length < 5) return null;
  if (!/\d/.test(bare)) return null;
  return text;
}

/** The empty answer, so "we read nothing" is one shape and not several. */
function nothing(): ParsedOrder {
  return {
    orderNumber: null,
    orderDate: null,
    totalPaise: null,
    itemTotalPaise: null,
    shipments: 0,
    items: [],
  };
}

/** The money on a labelled bill line, or on the line under it. */
function moneyForLabels(
  lines: readonly string[],
  from: number,
  labels: readonly string[],
): bigint | null {
  for (let i = from; i < lines.length; i += 1) {
    if (!labels.some((label) => startsWithLabel(lines[i], label))) continue;
    const sameLine = NAME_AND_MONEY.exec(lines[i].trim());
    if (sameLine) {
      const p = paise(sameLine[2]);
      if (p != null) return p;
    }
    const under = moneyOnly(lines[i + 1] ?? '');
    if (under != null) return under;
  }
  return null;
}

/**
 * One order screen, read as text.
 *
 * Always returns the shape, never null: a caller asking "what is on this screen"
 * gets an answer it can read every field of, and "we could not read it" is an
 * order with no number and no products rather than a missing object.
 */
export function parseOrderText(text: string | null | undefined): ParsedOrder {
  if (typeof text !== 'string' || text.trim() === '') return nothing();

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return nothing();

  // WHERE THE PRODUCTS STOP. Everything from the bill heading down is the bill,
  // and a bill line is never a product however much it looks like one — "Item
  // Total ₹368" has exactly the shape of a product with a price beside it.
  let billStart = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    if (BILL_HEADINGS.some((h) => h.test(lines[i]))) { billStart = i; break; }
  }

  // ── the order number ──────────────────────────────────────────────────────
  let orderNumber: string | null = null;
  for (let i = 0; i < lines.length && orderNumber == null; i += 1) {
    const m = ORDER_NUMBER_LABEL.exec(lines[i]) ?? ORDER_HASH_LABEL.exec(lines[i]);
    if (!m) continue;
    orderNumber = acceptableOrderNumber(m[1] ?? '')
      ?? acceptableOrderNumber(lines[i + 1] ?? '');
  }

  // ── the day it was placed ─────────────────────────────────────────────────
  let orderDate: string | null = null;
  for (let i = 0; i < lines.length && orderDate == null; i += 1) {
    const m = ORDER_DATE_LABEL.exec(lines[i]);
    if (!m) continue;
    // A quick commerce screen writes the time after a comma. The time is not
    // wanted and the date reader is deliberately narrow, so it is cut off here
    // rather than taught to ignore it.
    const written = (m[1] ?? '').split(',')[0].trim();
    orderDate = dayFromText(written) ?? dayFromText(lines[i + 1] ?? '');
  }

  // ── how many shipments the screen showed ──────────────────────────────────
  const shipments = lines.filter((l) => SHIPMENT_HEADING.test(l)).length;

  // ── the products ──────────────────────────────────────────────────────────
  const items: ParsedOrderItem[] = [];
  let i = 0;
  while (i < billStart) {
    const line = lines[i];

    // The name and the price on one line.
    const together = nameAndPriceOnOneLine(line);
    if (together) { items.push(together); i += 1; continue; }

    if (looksLikeAName(line)) {
      // A name, then "1 x ₹149", then often the line's own total underneath. The
      // count and price line is the item's OWN price, which is the figure a
      // campaign states, so that is the one kept. What the line came to is part
      // of the bill, and the bill is read separately.
      const counted = quantityAndPrice(lines[i + 1] ?? '');
      if (counted != null && counted > 0n) {
        items.push({ name: line, pricePaise: counted });
        i += moneyOnly(lines[i + 2] ?? '') != null ? 3 : 2;
        continue;
      }
      // A name with the price on the line under it.
      const under = moneyOnly(lines[i + 1] ?? '');
      if (under != null && under > 0n) {
        items.push({ name: line, pricePaise: under });
        i += 2;
        continue;
      }
    }
    i += 1;
  }

  // WHERE TO LOOK FOR THE TOTALS. Inside the bill block when there is one. When
  // there is not — which is every ROW IN A LIST of orders, where the whole order
  // is a number, a day, a product and one figure — the whole thing is looked at,
  // because a labelled total is a labelled total wherever it sits.
  const totalsFrom = billStart < lines.length ? billStart : 0;

  return {
    orderNumber,
    orderDate,
    totalPaise: moneyForLabels(lines, totalsFrom, TOTAL_BILL_LABELS),
    itemTotalPaise: moneyForLabels(lines, totalsFrom, ITEM_TOTAL_LABELS),
    shipments,
    items,
  };
}
