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
  /**
   * The day it was DELIVERED, as "2026-06-05". Never the order date.
   *
   * Two dates, kept apart on purpose. An order placed on 2 June and delivered on
   * 5 June has both printed on its page, and reading one as the other would make
   * an order look as though it was placed after it turned up — and would compare
   * it against the wrong window. ORDER_DATE_LABEL refuses "Delivered" for exactly
   * this reason; this is the field that reads it as the separate thing it is.
   *
   * NULL WHEN THE PAGE DID NOT SAY, and null also when it said it without a
   * year: "Delivered 5 June" is not a date, and a year filled in from today's
   * would be an invention. That is a real and known limit of Amazon's own page.
   */
  deliveryDate: string | null;
  /**
   * WHETHER IT WAS SENT BACK. TRI-STATE, and every state is something the page
   * really said:
   *
   *   true   the page states a COMPLETED return, refund or cancellation.
   *   false  the page talks about returns — a window, an eligibility — and
   *          states none completed. This is the ordinary answer on a delivered
   *          order, and it is worth having: it is the page saying "not returned".
   *   null   the page said nothing that could be one, so we do not know.
   *
   * The distinction matters because null and false are treated differently
   * wherever a refund is decided (see Task.returned, which is tri-state for the
   * same reason). "We did not look" and "we looked and it was not" are not the
   * same fact.
   */
  returned: boolean | null;
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
  // ── AND THE ONES AMAZON PRINTS, MEASURED ON A REAL ORDER PAGE ───────────
  //
  // 15 September 2026. Without these, "Shipping: ₹80.00" and "Marketplace Fee:
  // ₹5.00" were read as two PRODUCTS on his order — a name with a price under
  // it is exactly what a product looks like, and nothing said these were the
  // bill. The list had 'shipping fee' and 'shipping charge' but not the bare
  // word this page uses.
  'shipping',
  'marketplace fee',
  'promotion applied',
  'promotions applied',
  'free delivery',
  'cashback',
  'total mrp',
  'convenience fee',
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

/**
 * THE SAME LABEL, ANYWHERE ON THE LINE RATHER THAN AT THE START OF IT.
 *
 * Measured on the owner's own Amazon order page, 15 September 2026. It writes
 * both facts on ONE line:
 *
 *   Order placed 2 June 2026  Order number 408-1509645-3524313
 *
 * so the line begins "Order placed", the anchored test above never matches, and
 * the order number — the single field this whole read exists to produce — came
 * back null on a page that prints it in full.
 *
 * ANCHORED ONE REMAINS AND IS ASKED FIRST, because a line that begins with the
 * label is the stronger statement. This is the fallback, and it takes only the
 * run of non-space characters after the label so a sentence mentioning an order
 * number cannot drag the rest of itself in.
 */
const ORDER_NUMBER_ANYWHERE =
  /\border\s*(?:id|no\.?|number|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,})/i;
/** "Order# 402-3925017-7784521", which is how Amazon writes it. */
const ORDER_HASH_LABEL = /^order\s*#\s*(.*)$/i;

/**
 * "Placed on 21 Aug 2026, 7:42 PM" and "Ordered on 2 Jul 2026".
 *
 * Deliberately not "Delivered on", which sits two lines away on a Zepto screen
 * and carries a date of its own. A delivery date read as an order date would make
 * an order look as though it was placed after it arrived. See DELIVERY_LABEL
 * below, which reads that date as the separate thing it is.
 *
 * ── "ORDER PLACED", WITH NO "ON" AFTER IT ─────────────────────────────────
 *
 * Which is exactly how Amazon writes it on an order's own page, and the "on" was
 * required. Measured, not guessed: the order page text read
 *
 *   Order placed / 2 June 2026 / Order # 408-… / Order Total / ₹1,299.00
 *
 * and came back with the number, the total and the product, and no date at all —
 * one of the four fields the whole read exists to produce. So the "on" is now
 * optional. It is the same heading with the same meaning on the list page, where
 * the date sits under it in the same way.
 */
/*
 * ── AND "AT", NOT ONLY "ON" ───────────────────────────────────────────────
 *
 * Measured on the owner's own Zepto order page, 15 September 2026, signed in:
 *
 *   Order Placed at / 25 Aug 2026, 8:42 PM
 *
 * The word is "at" and the label ended at "on", so "at" fell into the captured
 * group, read as the date itself, failed to parse, and the line under it was
 * never reached in a shape the date reader could take. The read came back with
 * an order number, a total and no date at all.
 */
const ORDER_DATE_LABEL =
  /^(?:placed\s+(?:on|at)|ordered\s+(?:on|at)|order\s+placed(?:\s+(?:on|at))?|order(?:ed)?\s+date|placed)\b\s*[:\-]?\s*(.*)$/i;

/**
 * "Delivered 5 June 2026", "Delivered on 5 Jun 2026", "Delivered" then the date.
 *
 * DELIBERATELY NOT "arriving" OR "out for delivery". Those are a promise about
 * the future, not a record of an arrival, and writing a promise into a delivery
 * date would put a date on an order that has not turned up. "Out for delivery"
 * cannot match anyway because this is anchored at the start of the line, which
 * is the other reason it is anchored.
 *
 * ── AND "delivery" IS LEFT OUT, THOUGH NOTHING CATCHES IT ─────────────────
 *
 * Said honestly: adding "delivery" here fails no check, and the reason is worth
 * knowing rather than hiding. The loop that uses this keeps going while the date
 * is still null, so a line like "Delivery fee ₹40" matches, yields no date, and
 * the search carries on to the real "Delivered 5 June 2026" further down. The
 * looser word is therefore harmless AS THIS LOOP IS WRITTEN — and it stops being
 * harmless the moment the loop stops at the first matching label. It is left out
 * because "delivery" is a subject a page discusses and "delivered" is a thing
 * that happened, and only one of those is a date.
 */
/*
 * ── AND THE LINE MAY OPEN WITH "ORDER" ────────────────────────────────────
 *
 * This is anchored at the start of the line, which is deliberate and is also
 * what made it miss the one page that carries the arrival. From the owner's own
 * Zepto order page, 15 September 2026:
 *
 *   Order Arrived at / 25 Aug 2026, 9:02 PM
 *
 * "Order" first, so nothing matched, and the delivery date was null on an order
 * whose page states the minute it turned up. The word "Delivered" DOES appear
 * higher on that page as a status with no date under it — which is why the loop
 * that uses this keeps going while the date is still null, and why it has to.
 */
/*
 * ── AND A SHIPMENT MAY ARRIVE INSTEAD OF AN ORDER ─────────────────────────
 *
 * An order split into two parcels does not print "Order Arrived at" anywhere.
 * From the owner's own Zepto order of 21 July 2026, the one carrying the
 * campaign product:
 *
 *   Order Placed at / 21 Jul 2026, 5:07 PM
 *   Shipment 1 Arrived at / 21 Jul 2026, 5:32 PM
 *   Shipment 2 Arrived at / 21 Jul 2026, 5:46 PM
 *
 * The word "Delivered" is on that page twice, as a status under each shipment
 * heading with no date beside it. So without this the delivery date was null on
 * an order that states the minute each half of it turned up — and that is the
 * field the whole delivery question is answered from.
 *
 * THE FIRST ARRIVAL IS THE ONE TAKEN, because the loop stops at the first date
 * it can read. Said plainly rather than left to be discovered: for an order in
 * two parcels that is the EARLIER arrival. Both of his were the same evening,
 * so nothing here measures which is the right one for a return window. When a
 * real order arrives on two different days, this is the line to argue about.
 */
const DELIVERY_LABEL =
  /^(?:order\s+|shipment\s*\d*\s*(?:of\s*\d+\s*)?)?(?:delivered|arrived)\b\s*(?:on|at)?\s*[:\-]?\s*(.*)$/i;

/**
 * A RETURN THAT REALLY HAPPENED. The completed forms only.
 *
 * The same phrases the on-device reader has used against these pages since it
 * was written, and its comment records why the list is what it is: every order
 * page carries chrome like "Return window closed" and "Return items: Eligible
 * through", which contain "Return" and never "Returned". A looser test reported
 * every order as returned.
 */
const RETURN_COMPLETED =
  /\b(?:returned|refunded|cancelled|canceled)\b|\brefund\s+issued\b|\breturn\s+complete[d]?\b/i;

/**
 * ANY MENTION OF A RETURN AT ALL, including the chrome above.
 *
 * This is what separates "we looked and it was not returned" from "the page said
 * nothing about returns". A page that discusses a return window has told us
 * there was no return; a page that never mentions one has told us nothing.
 */
const RETURN_MENTIONED = /\b(?:return|refund|cancel)[a-z]*\b/i;

/** A shipment heading — "Shipment 1 of 2", "Shipment 1", "SHIPMENT 2". */
const SHIPMENT_HEADING = /^shipment\b/i;

/** The number on a shipment heading, when it carries one. */
const SHIPMENT_NUMBER = /^shipment\s*(\d+)\b/i;

/**
 * HOW MANY PARCELS THIS ORDER CAME IN, COUNTED BY NUMBER AND NOT BY HEADING.
 *
 * ── MEASURED: COUNTING HEADINGS SAID SIX FOR AN ORDER IN TWO ──────────────
 *
 * A screenshot writes each shipment's heading once, so counting lines was right
 * for as long as screenshots were the only thing being read. The page Zepto
 * draws writes the same two shipments SIX times — a tab strip at the top
 * ("Shipment 1", "Shipment 2"), a heading over each block ("SHIPMENT 1",
 * "SHIPMENT 2"), and an arrival line for each ("Shipment 1 Arrived at").
 *
 * So the NUMBERS are counted rather than the lines, which reads both layouts
 * correctly: "Shipment 1 of 2" and "Shipment 2 of 2" is two, and so is the
 * same order drawn six times. A heading with no number on it counts as its own
 * parcel, because there is nothing else it could be.
 */
function countShipments(lines: readonly string[]): number {
  const seen = new Set<string>();
  lines.forEach((line, at) => {
    if (!SHIPMENT_HEADING.test(line)) return;
    const numbered = SHIPMENT_NUMBER.exec(line);
    seen.add(numbered ? `n${Number(numbered[1])}` : `line${at}`);
  });
  return seen.size;
}

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
 * A LINE THAT IS ONLY A COUNT AND A MEASURE — "1 pc", "1 unit", "1 pack (500 g)".
 *
 * ── WHY THIS HAD TO EXIST, AND IT COST EVERY PRODUCT NAME ─────────────────
 *
 * A quick commerce order page writes a product over several lines. Measured, on
 * the owner's own Zepto page on 15 September 2026:
 *
 *   Gillette Fusion Manual Shaving Razor For Men
 *   1 pc
 *   1 unit
 *   ₹340
 *   ₹425
 *
 * The name is three lines above its price. The reader looked one line under a
 * name for money, found "1 pc", gave up on that name, walked on, and eventually
 * found "1 unit" sitting directly above ₹340 — which passed every test for a
 * name it had. SIX PRODUCTS CAME BACK ALL NAMED "1 unit". Every price was right
 * and not one name was, so no campaign could ever have matched.
 *
 * ── AND IT IS DELIBERATELY NARROW ─────────────────────────────────────────
 *
 * The WHOLE line must be a number, a measure, and at most a parenthetical. A
 * real product called "5 Pack Cotton Socks For Men" carries words after the
 * measure and is not touched. Anchored at both ends for exactly that reason.
 */
const MEASURE_ONLY =
  /^\d+(?:\.\d+)?\s*(?:pc|pcs|piece|pieces|pack|packs|packet|packets|unit|units|ct|count|nos?|box|boxes|bottle|bottles|kg|g|gm|gms|mg|ml|l|ltr|litre|litres|liter|liters)\s*(?:\([^)]*\))?$/i;

/** Is this line only a count and a measure, and so never a product's name? */
function measureOnly(line: string): boolean {
  return MEASURE_ONLY.test(line.trim());
}

/**
 * THE SHOP'S OWN WORDS ABOUT A PRODUCT, WHICH ARE NOT THE PRODUCT.
 *
 * ── MEASURED, AND IT COST EVERY ITEM ON AN AMAZON ORDER ───────────────────
 *
 * From the owner's own order page, 15 September 2026, one product:
 *
 *   Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf & ...
 *   Sold by: Lukzer
 *   Return window closed on 19 June 2026
 *   ₹938.00
 *   ₹938.00
 *   Buy It Again
 *
 * Three lines between the name and its price, and every one of them passes for a
 * name: they are prose, they are long enough, and none of them is a measure. So
 * the reader walked past the real name looking for money, and the LAST line
 * before the price — "Return window closed on 19 June 2026" — is what it would
 * have called the product if anything had matched at all.
 *
 * These are the shop's furniture around an item, listed as the openings of
 * lines rather than as words anywhere in them, so a product whose NAME happens
 * to contain one of these words is untouched.
 */
const AROUND_A_PRODUCT =
  /^(?:sold\s+by|shipped\s+by|dispatched\s+by|fulfilled\s+by|return\s+window|return\s+or\s+replace|returns?\s+closed|buy\s+it\s+again|view\s+your\s+item|write\s+a\s+product\s+review|ask\s+product\s+question|get\s+product\s+support|leave\s+seller\s+feedback|archive\s+order|track\s+package|problem\s+with\s+order|package\s+was\s+handed|your\s+package)\b/i;

/** Is this the shop talking about a product, rather than naming one? */
function aroundAProduct(line: string): boolean {
  return AROUND_A_PRODUCT.test(line.trim());
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
  if (measureOnly(text)) return false;
  if (aroundAProduct(text)) return false;
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

/**
 * THE DAY ON THE LINE UNDER A LABEL, WHICH MAY CARRY A TIME AFTER IT.
 *
 * The line beside a label already had its time cut off at the comma. The line
 * UNDER a label did not, and that is where a quick commerce page puts it:
 * "Order Placed at" on one line and "25 Aug 2026, 8:42 PM" on the next. The
 * whole string went to a date reader that is deliberately narrow, which refused
 * it, and the date came back null.
 *
 * THE WHOLE LINE IS TRIED FIRST, and the trimmed one only after, because some
 * shops write "Mon, 25 Aug 2026" — where the comma is inside the date and
 * cutting at the last one would leave a weekday.
 */
function dayUnder(line: string): string | null {
  const text = String(line ?? '').trim();
  const whole = dayFromText(text);
  if (whole != null) return whole;
  const parts = text.split(',');
  if (parts.length < 2) return null;
  return dayFromText(parts.slice(0, -1).join(',').trim());
}

/**
 * THE DAY AT THE FRONT OF A PIECE OF TEXT, WITH WHATEVER FOLLOWS IT DROPPED.
 *
 * Only the shapes dayFromText already accepts, and only from the very start, so
 * this can never turn a number further down a sentence into a date.
 */
function theDayAtTheFront(text: string): string {
  const t = String(text ?? '').trim();
  const front = t.match(/^(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4}|[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})/);
  return front ? front[1] : t;
}

/** The empty answer, so "we read nothing" is one shape and not several. */
function nothing(): ParsedOrder {
  return {
    orderNumber: null,
    orderDate: null,
    totalPaise: null,
    itemTotalPaise: null,
    deliveryDate: null,
    returned: null,
    shipments: 0,
    items: [],
  };
}

/**
 * THE AMOUNT ACTUALLY PAID, WHERE A SCREEN PRINTS TWO FIGURES FOR ONE THING.
 *
 * ── MEASURED, AND IT WAS SENDING THE WRONG MONEY TO A MONEY DECISION ──────
 *
 * A shop that discounts prints the was-price and the paid price next to each
 * other, and the two are not written in the same order in the two places they
 * appear. From the owner's own Zepto order page on 15 September 2026:
 *
 *   Gillette Fusion Manual Shaving Razor For Men   Total Bill
 *   1 pc                                           ₹1739
 *   1 unit                                         ₹1079
 *   ₹340      <- paid, FIRST
 *   ₹425      <- was                               paid is SECOND
 *
 * Paid first on a product row, paid second on the bill. Taking "the first one"
 * read ₹1739 as the total of an order that cost ₹1079 — a four hundred rupee
 * error, in the field a refund is decided from.
 *
 * ── SO NEITHER POSITION IS TRUSTED, THE SMALLER IS TAKEN ──────────────────
 *
 * Which is not a trick about layout but the only thing a struck pair can mean:
 * the price that was struck through is the higher one, or striking it through
 * would say nothing. Two equal figures answer the same either way.
 *
 * ONLY EVER AN ADJACENT PAIR. One money line stays one money line, so every
 * page that prints a single total is read exactly as it was before.
 *
 * Answers the figure and the index it read through, so a caller walking a list
 * of products knows where the next one starts.
 */
function amountPaidAt(
  lines: readonly string[],
  at: number,
): { paise: bigint; through: number } | null {
  const first = moneyOnly(lines[at] ?? '');
  if (first == null) return null;
  const second = moneyOnly(lines[at + 1] ?? '');
  if (second == null) return { paise: first, through: at };
  return { paise: first <= second ? first : second, through: at + 1 };
}

/** The money on a labelled bill line, or on the line under it. */
/**
 * ── THE MORE SPECIFIC LABEL WINS, WHEREVER IT SITS ON THE PAGE ─────────────
 *
 * This used to walk the LINES and take the first one carrying any of the labels.
 * Measured on the owner's own Amazon order page, 15 September 2026:
 *
 *   Total:         ₹1,411.00
 *   Promotion Applied: -₹80.00
 *   Grand Total:   ₹1,331.00
 *
 * "Total" comes first on the page, so it won, and the order was read as ₹1,411
 * when ₹1,331 left his account. Eighty rupees, in the field a refund is paid
 * from. The list is already written most specific first, with bare "total" last
 * and a comment saying why — it just was not being read in that order.
 */
function moneyForLabels(
  lines: readonly string[],
  from: number,
  labels: readonly string[],
): bigint | null {
  for (const label of labels) {
    const found = moneyForOneLabel(lines, from, label);
    if (found != null) return found;
  }
  return null;
}

function moneyForOneLabel(
  lines: readonly string[],
  from: number,
  label: string,
): bigint | null {
  const labels = [label];
  for (let i = from; i < lines.length; i += 1) {
    if (!labels.some((l) => startsWithLabel(lines[i], l))) continue;
    const sameLine = NAME_AND_MONEY.exec(lines[i].trim());
    if (sameLine) {
      const p = paise(sameLine[2]);
      if (p != null) return p;
    }
    const under = amountPaidAt(lines, i + 1);
    if (under != null) return under.paise;
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
    const m = ORDER_NUMBER_LABEL.exec(lines[i])
      ?? ORDER_HASH_LABEL.exec(lines[i])
      ?? ORDER_NUMBER_ANYWHERE.exec(lines[i]);
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
    // AND ONLY THE DATE OUT OF IT. Amazon writes "2 June 2026  Order number
    // 408-…" on one line, so the captured tail carries the next fact with it and
    // the date reader — which is deliberately strict — refused the whole thing.
    const written = theDayAtTheFront((m[1] ?? '').split(',')[0].trim());
    orderDate = dayFromText(written) ?? dayUnder(lines[i + 1] ?? '');
  }

  // ── the day it ARRIVED, which is a different date ─────────────────────────
  let deliveryDate: string | null = null;
  for (let i = 0; i < lines.length && deliveryDate == null; i += 1) {
    const m = DELIVERY_LABEL.exec(lines[i]);
    if (!m) continue;
    // The same comma trick as the order date: a screen writes the time after it.
    const written = (m[1] ?? '').split(',')[0].trim();
    deliveryDate = dayFromText(written) ?? dayUnder(lines[i + 1] ?? '');
  }

  // ── whether it was sent back ──────────────────────────────────────────────
  //
  // Read over the WHOLE text rather than line by line, because a phrase like
  // "refund issued" can be split across a layout and because none of the three
  // answers depends on where in the page the words were.
  const whole = lines.join(' ');
  const returned = RETURN_COMPLETED.test(whole)
    ? true
    : (RETURN_MENTIONED.test(whole) ? false : null);

  // ── how many shipments the screen showed ──────────────────────────────────
  const shipments = countShipments(lines);

  // ── the products ──────────────────────────────────────────────────────────
  // ── AND THE PRODUCTS ARE LOOKED FOR OVER THE WHOLE PAGE ─────────────────
  //
  // It used to stop at the bill heading, because on a quick commerce screen the
  // bill is printed UNDER the products and "Item Total ₹368" has exactly the
  // shape of a product with a price beside it.
  //
  // AMAZON PRINTS IT THE OTHER WAY ROUND. Measured, 15 September 2026: Order
  // Summary, then the totals, and THEN the two things he bought. Stopping at the
  // heading meant the scan covered the address and the payment method and not
  // one product, and the answer was an order with no items on it.
  //
  // WHAT KEPT THE BILL OUT IS NOT THE CUT, AND NEVER WAS. looksLikeAName already
  // refuses every bill label, every heading and every bare figure by name, which
  // is why the fixtures that print their bill last read exactly as before. The
  // cut was a second guard doing the same job in a way that happened to also cut
  // off half of Amazon's page.
  const items: ParsedOrderItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // The name and the price on one line.
    const together = nameAndPriceOnOneLine(line);
    if (together) { items.push(together); i += 1; continue; }

    if (looksLikeAName(line)) {
      // ── THE SIZE AND THE COUNT SIT BETWEEN THE TWO ────────────────────
      //
      // On a quick commerce page a product's price is not the line under its
      // name; "1 pc" and "1 unit" are in the way. Those lines are stepped over
      // here and nothing else is: only a line that is ENTIRELY a count and a
      // measure is skipped, so no prose is ever walked past in search of a
      // figure. A shop that puts the price directly under the name skips
      // nothing and behaves exactly as it did.
      let at = i + 1;
      while (at < lines.length
        && (measureOnly(lines[at]) || aroundAProduct(lines[at]))) at += 1;

      // A name, then "1 x ₹149", then often the line's own total underneath. The
      // count and price line is the item's OWN price, which is the figure a
      // campaign states, so that is the one kept. What the line came to is part
      // of the bill, and the bill is read separately.
      const counted = quantityAndPrice(lines[at] ?? '');
      if (counted != null && counted > 0n) {
        items.push({ name: line, pricePaise: counted });
        i = at + (moneyOnly(lines[at + 1] ?? '') != null ? 2 : 1);
        continue;
      }
      // A name with the price on the line under it — or the paid price out of a
      // struck pair, which is the same question asked once, above.
      const under = amountPaidAt(lines, at);
      if (under != null && under.paise > 0n) {
        items.push({ name: line, pricePaise: under.paise });
        i = under.through + 1;
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
    deliveryDate,
    returned,
    shipments,
    items,
  };
}
