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

import {
  clockFromText, instantInIndia, type ClockReading,
} from '../common/india-clock';
import { dayFromMillis, dayFromText, paiseFromRupees } from './order-comparison';

/** One product on the order, with its own price in integer paise. */
export interface ParsedOrderItem {
  name: string;
  pricePaise: bigint;
  /**
   * THE PRICE THAT WAS STRUCK THROUGH BESIDE IT, when the page printed a pair.
   *
   * MEASURED ON THE OWNER'S OWN ZEPTO ORDER PAGES, 15 SEPTEMBER 2026. Every
   * product on both drawn fixtures prints two figures, the paid one and the one
   * it was before the shop's own discount:
   *
   *   Gillette Fusion Manual Shaving Razor For Men
   *   1 pc
   *   1 unit
   *   ₹340      <- paid, and this is pricePaise
   *   ₹425      <- was, and this is the field
   *
   * `pricePaise` has always been the smaller of the two and still is — see
   * amountPaidAt for why neither position is trusted. This carries the OTHER
   * figure, which until now was read and thrown away.
   *
   * WHAT IT IS FOR, AND IT IS ONE THING: saying WHY a price differed from the
   * offer's, in words a person can check against the page. A paid price below
   * the offer's with a struck figure above it is the shop's own discount, and
   * the page says so in print; the same price with no struck figure beside it is
   * something nobody has measured. See engine/watched-price.ts, which is the
   * only reader of this field and decides no money with it.
   *
   * NULL when the page printed one figure, which is every list row and every
   * page that does not discount. Never inferred from a total.
   *
   * OPTIONAL rather than required, and the reason is a stored row: a candidate
   * written down before this field existed has no was-price and never will, and
   * a shape that demanded one would make every old row unreadable. Absent and
   * null mean the same thing — the page stated none — and watched-price.ts
   * treats them the same, answering 'unknown' rather than inventing a reason.
   */
  wasPricePaise?: bigint | null;
  /**
   * HOW MANY OF IT THE PAGE SAID WERE BOUGHT, when it said so at all.
   *
   * ── WHY THIS HAD TO BE READ, AND IT IS A MONEY QUESTION ───────────────────
   *
   * MEASURED, the owner's own Zepto order #LRGSKOMA18669, 15 September 2026:
   *
   *   Korean Kab's Jackpot 2x Hot and Spicy Instant Noodles Non Veg
   *   1 pack (100 g)
   *   2 units          <- and the count was read and thrown away
   *   ₹74              <- which is the price of BOTH of them
   *   ₹100
   *
   * ₹74 is the line, not the unit: one of them cost ₹37. A refund is always for
   * ONE unit (see charged-amount.ts, "NEVER ASSUME 1"), so handing ₹74 on as a
   * per-unit price would pay twice what a unit cost. The count was sitting on
   * the page the whole time; MEASURE_ONLY already matched the line in order to
   * step over it, and this keeps the number instead of dropping it.
   *
   * THE LARGEST COUNT BETWEEN THE NAME AND THE PRICE, because a quick-commerce
   * page states two: "1 pack (100 g)" is the container and "2 units" is how many
   * were bought. Taking the larger is the direction that refuses rather than the
   * direction that pays.
   *
   * NULL when the page stated no count at all — which is every Amazon line and
   * every list row — and null is NOT one. Nothing here turns an unstated count
   * into a quantity; watched-price.ts refuses an amount it cannot divide and the
   * refund is held for a person, exactly as it is today for every other amount
   * that could not be worked out.
   */
  unitsStated?: number | null;
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
   * WHAT THE SHOP ADDED ON TOP, ADDED UP — delivery, handling, shipping.
   *
   * Integer paise. ZERO is a real answer and the commonest one: every delivery
   * and handling line on every fixture on disk was waived, printed as a struck
   * figure with the word FREE under it. NULL is the different statement that the
   * page named no such charge at all.
   *
   * ONLY THE LABELS IN FEE_LABELS, every one of them read off a real page. See
   * the note above that list for why it is four labels and not twenty-four, and
   * for why an unread fee cannot reach anybody's refund.
   */
  feesPaise: bigint | null;
  /**
   * A DISCOUNT TAKEN OFF THE WHOLE BILL rather than off one product, as a
   * positive number of paise. Null when the page printed none.
   *
   * Measured once, on Amazon: "Promotion Applied:" / "-₹80.00". No quick
   * commerce page has ever printed one — Zepto discounts each product on its own
   * line instead, which is what wasPricePaise carries. See BILL_DISCOUNT_LABELS.
   */
  billDiscountPaise: bigint | null;
  /**
   * The day it was DELIVERED, as "2026-06-05". Never the order date.
   *
   * Two dates, kept apart on purpose. An order placed on 2 June and delivered on
   * 5 June has both printed on its page, and reading one as the other would make
   * an order look as though it was placed after it turned up — and would compare
   * it against the wrong window. ORDER_DATE_LABEL refuses "Delivered" for exactly
   * this reason; this is the field that reads it as the separate thing it is.
   *
   * ── THE YEAR, WHEN AMAZON DOES NOT PRINT ONE ──────────────────────────────
   *
   * This used to be null whenever the page said "Delivered 5 June", and the
   * reason written here was that a year filled in from today's would be an
   * invention. That was right while nothing else on the page was being read. It
   * is not right now: the ORDER date is read off the SAME page, in full — "2
   * June 2026" — so the year is not invented. It is the order's own, and a
   * delivery that reads earlier than its order is rolled into the next year,
   * which is the 31 December to 2 January case and nothing else.
   *
   * IT IS THE RULE THE DEVICE HAS ALWAYS USED. src/taskflow.js:184,
   * resolveDeliveryDate, does exactly this and has since it was written, down to
   * the rollover and down to refusing when there is no anchor. One purchase read
   * two ways has to give one date.
   *
   * WITH ONE THING THE DEVICE DOES NOT HAVE: a bound. See theYearFromTheOrder
   * for the case that needs it and for where the two therefore differ.
   *
   * STILL NULL WHEN THERE IS NOTHING TO BORROW FROM. No order date is no year,
   * and no year is null. Nothing here falls back to the current year.
   */
  deliveryDate: string | null;
  /**
   * THE MINUTE IT ARRIVED, as an ISO instant, or null when the page printed only
   * a day — Phase 8B-c, 20 September 2026.
   *
   * ── WHAT WAS BEING THROWN AWAY ────────────────────────────────────────────
   *
   * A quick commerce page states the time beside the date and always has. From
   * the owner's own pages, all three measured:
   *
   *   Order Arrived at / 25 Aug 2026, 9:02 PM
   *   Shipment 1 Arrived at / 21 Jul 2026, 5:32 PM
   *   Order Arrived at / 23 Aug 2026, 6:09 AM
   *
   * Only the day was kept, and the day became an instant at noon UTC — half past
   * five in the evening in India. That is the right thing to do with a date being
   * COMPARED and the wrong thing to do with the moment a hold is counted from:
   * with a three hour hold it released a refund before the parcel arrived, and a
   * page read in the morning carried a delivery seven hours in the FUTURE, which
   * the plausibility gate refused outright. See common/india-clock.ts.
   *
   * ── IT IS BESIDE deliveryDate AND DOES NOT REPLACE IT ─────────────────────
   *
   * The day is still the day, and the order window rule still compares days.
   * This is the extra precision, present only when the page printed it, and
   * everything that wants a day goes on asking for one.
   *
   * INDIA'S CLOCK, because the page was printed by an Indian shop for somebody
   * standing in India. NULL when the page printed no time, which is every Amazon
   * page and every list row.
   */
  deliveryAt: string | null;
  /**
   * THE DAY THE SHOP'S OWN RETURN WINDOW CLOSES, as "2026-06-19", or null.
   *
   * ── MEASURED, AND NOTHING WAS READING IT ──────────────────────────────────
   *
   * On the owner's own Amazon order page, 15 September 2026, in plain words:
   * "Return window closed on 19 June 2026". WITH a year, unlike the delivery
   * line three lines above it. It is the date the payout waits for, and until
   * now the only answer to that question was the return-policy table in
   * engine/return-policy.ts — which says of itself that "no marketplace exposes
   * a return-window end date, so this is the OPERATOR's policy table". For
   * Amazon that is no longer true, and this is the shop saying it.
   *
   * A YEAR IS REQUIRED AND IS NEVER INFERRED, which is deliberately not what
   * deliveryDate does. The asymmetry is the cost of refusing: a delivery date
   * with no year leaves a refund held for ever, so borrowing one buys something
   * real; a return-window date with no year costs nothing, because the policy
   * table still computes a window. There is no reason to guess where refusing is
   * free, and this is the date the money waits for.
   *
   * IT IS STILL CHROME EVERYWHERE ELSE. AROUND_A_PRODUCT keeps refusing this
   * line as a product's name — the comment above it records that without that,
   * every item on an Amazon order came back named after this very line — and
   * RETURN_MENTIONED keeps reading it as "the page discusses returns and states
   * none completed". Reading a date off it changes neither.
   */
  returnWindowEndsDate: string | null;
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

  /**
   * DID THE PAGE SAY, IN WORDS, THAT THE ORDER ARRIVED — WITHOUT DATING IT?
   *
   * ── MEASURED ON THE OWNER'S OWN CHILLI OIL, 21 SEPTEMBER 2026 ────────────
   *
   * Zepto's order LIST states the status and never the moment:
   *
   *   Order delivered   ₹225   Placed at 21st Sep 2026, 12:37 am
   *
   * "Placed at" is the ORDER time, not the arrival. So `deliveryDate` and
   * `deliveryAt` both come back null on a card that says the thing arrived, and
   * deliveryFromALaterLook bails on `fragment.delivery == null`. Fayr read a page
   * that says in plain words the order was delivered and recorded nothing. The
   * owner watched it happen twice.
   *
   * THIS IS THE STATUS AND NOTHING ELSE. It never becomes a date here: a page
   * that states no instant has stated no instant, and inventing one is the thing
   * this file refuses everywhere else. What it lets the caller do is tell "the
   * shop has not said it arrived" apart from "the shop said it arrived and did
   * not say when" — two facts this parser could not previously distinguish.
   */
  deliveredSaid: boolean | null;
  /**
   * WHETHER THE ORDER HAS BEEN RATED AT THE SHOP. TRI-STATE, and every state is
   * something the page really said:
   *
   *   true   the page carries "You rated:" and does NOT carry "Rate Order".
   *   false  the page carries "Rate Order" and does not say it was rated.
   *   null   the page said neither, or said both, so we do not know.
   *
   * ── MEASURED, ON THE OWNER'S OWN ZEPTO ORDER PAGES, 15 SEPTEMBER 2026 ────
   *
   * ZEPTO-BRIEF.md, off his signed-in account: an unrated order's page carries
   * "Rate Order"; a rated one carries "You rated:" and no "Rate Order". Both
   * pages are fixtures under backend/test/fixtures, and this field is checked
   * against both of them rather than against a sentence typed here.
   *
   * ── WHAT IT IS FOR, AND WHAT IT MUST NEVER BE ────────────────────────────
   *
   * Zepto, Blinkit and Instamart publish no review text: all a shop of that kind
   * takes is a private star on the order, and the words are written inside Fayr.
   * So "did they review it" has exactly one answer the shop's own page gives,
   * and this is it. It moves a task from DELIVERED to REVIEWED, by the same
   * funnel every other fact travels.
   *
   * IT SAYS NOTHING ABOUT THE NUMBER OF STARS. The page prints no number, this
   * reads none, and none is wanted: a low rating passes exactly as a high one.
   * Fayr never reads, scores or checks what was posted at the shop.
   */
  rated: boolean | null;
  shipments: number;
  items: ParsedOrderItem[];
}

/**
 * "You rated:" — THE ONE PHRASE A RATED ORDER'S PAGE CARRIES, and "Rate Order" —
 * THE INVITATION AN UNRATED ONE CARRIES INSTEAD. Both measured; see
 * ParsedOrder.rated. Whole words, so a product called "Rate Orderly Socks"
 * cannot be read as an invitation and a line saying "you rated" inside a
 * review of somebody else's cannot be — there are none on an order page.
 *
 * ── AND ZEPTO DOES NOT SAY "YOU RATED" — MEASURED 20 SEPTEMBER 2026 ────────
 *
 * The owner rated his razor on Zepto and the task would not move. His order
 * list, read off his own device, says this on the rated order:
 *
 *   Order delivered   ₹360   Placed at 20th Sep 2026, 07:45 pm
 *   Your delivery experience rating:  ★★★★★
 *   Order Again
 *
 * and this on an unrated one, two cards below it:
 *
 *   Order delivered   ₹480   Placed at 18th Sep 2026, 08:47 pm
 *   Rate order        Order Again
 *
 * So the invitation half was already right — an unrated Zepto order does say
 * "Rate order", and it DISAPPEARS once rated, replaced by the rating row. What
 * was missing is the positive half: "you rated" appears nowhere on Zepto, so a
 * rated order read as neither rated nor unrated, `rated` came back null, and
 * ratedFromALaterLook returned before it could move anything. He rated the
 * product, Fayr read the page, and the app went on asking him to review it.
 *
 * THE PHRASE IS THE SHOP'S OWN AND IT IS NOT A NEAR MISS. "your delivery
 * experience rating" is eleven syllables of Zepto's own label, it sits directly
 * beside the stars, and it is absent from every unrated card on the same page —
 * which is what makes it a signal rather than a word that happens to be there.
 */
const RATED_SAID = /\byou\s+rated\b|\byour\s+delivery\s+experience\s+rating\b/i;
const RATE_INVITED = /\brate\s+order\b/i;

/**
 * THE ITEM TOTAL OF AN ORDER THAT HOLDS EXACTLY ONE PRODUCT.
 *
 * Answers that product's own stated price, or null for anything else. See the
 * note at itemTotalPaise: this fills a hole a page left, it never overrides a
 * labelled figure, and it refuses the moment there is more than one product or
 * the page stated a count above one.
 */
function theOnlyProductsOwnPrice(items: readonly ParsedOrderItem[]): bigint | null {
  if (items.length !== 1) return null;
  const only = items[0];
  if (only == null) return null;
  // A stated count of anything but one leaves the figure ambiguous between a
  // unit price and a line total, and those are different money.
  if (only.unitsStated != null && only.unitsStated !== 1) return null;
  return only.pricePaise;
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

/**
 * THE CHARGES A SHOP ADDS ON TOP, AND ONLY THE ONES A REAL PAGE HAS SHOWN.
 *
 * Four labels, and every one of them has been read off a page somebody actually
 * bought something on:
 *
 *   delivery fee      zepto-order-page-drawn.txt, …-two-shipments.txt,
 *                     zepto-order-two-shipments.txt, and order #LRGSKOMA18669
 *                     inline in this file's own spec — the only sample anywhere
 *                     where one was genuinely CHARGED (₹30 of a ₹104 bill).
 *   handling fee      both drawn Zepto fixtures, and #LRGSKOMA18669.
 *   handling charge   zepto-order-two-shipments.txt ("Handling Charge ₹0").
 *   shipping          amazon-order-page-garment-rack.txt ("Shipping: ₹0.00").
 *
 * ── AND THE TWENTY OTHERS IN BILL_LABELS ARE DELIBERATELY NOT HERE ────────
 *
 * 'platform fee', 'small cart charge', 'rain fee', 'surge fee', 'convenience
 * fee', 'packaging charge', 'tip', 'gst' and the rest are in BILL_LABELS so a
 * line carrying one is not read as a PRODUCT, which is a job that needs no
 * measurement — the label being there at all is enough. Reading a FIGURE off
 * one is a different job: it would put a number nobody has ever seen printed
 * into an arithmetic that explains somebody's money. Not one fixture on disk
 * shows any of them. They stay unparsed until a real page shows one, and until
 * then a bill carrying one simply does not add up, which watched-price.ts
 * answers with 'unknown' rather than with a guess.
 *
 * NOTHING HERE REACHES A REFUND. The refund base is built from the PRODUCT's
 * own price (see engine/watched-price.ts); a fee that went unread cannot leak
 * into it, because no fee is ever subtracted from anything to get there.
 */
const FEE_LABELS: readonly string[] = [
  'delivery fee',
  'handling fee',
  'handling charge',
  'shipping',
];

/**
 * A DISCOUNT TAKEN OFF THE WHOLE BILL RATHER THAN OFF ONE PRODUCT.
 *
 * ONE LABEL, MEASURED ONCE: the owner's own Amazon order page, 15 September
 * 2026, prints
 *
 *   Total:              ₹1,411.00
 *   Promotion Applied:    -₹80.00
 *   Grand Total:        ₹1,331.00
 *
 * and that is the only bill-level discount line anybody has captured, on any
 * shop. 'coupon', 'coupon discount', 'discount', 'savings' and 'promo' are in
 * BILL_LABELS and are NOT here, for the reason written above FEE_LABELS: no
 * page on disk has ever printed one, so there is nothing to check a reader
 * against.
 *
 * NO QUICK-COMMERCE PAGE HAS EVER SHOWN ONE AT ALL. Zepto's discounting is
 * entirely per product — its Item Total is exactly the sum of the paid figures
 * beside the products — so on a watched order this is null today, every time,
 * and the share apportioned to any one product is zero. The arithmetic is
 * written and checked anyway, because the day a quick-commerce page prints a
 * coupon is not the day to start writing it.
 */
const BILL_DISCOUNT_LABELS: readonly string[] = [
  'promotion applied',
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
 * THE LATER ARRIVAL IS THE ONE TAKEN — Phase 8B-c, 20 September 2026, and this
 * is the line that was left to be argued about. It used to be the EARLIER,
 * because the loop stopped at the first date it could read. Both of his arrived
 * the same evening, so nothing measured it either way.
 *
 * THE ORDER IS DELIVERED WHEN ALL OF IT IS. A hold counted from the first parcel
 * starts running while the second is still out for delivery, and on an order
 * that arrives on two different days it would release the refund before the rest
 * of the thing turned up. The later arrival is also the safe direction if the
 * reading is wrong at all: later holds the money longer.
 */
const DELIVERY_LABEL =
  /^(?:order\s+|shipment\s*\d*\s*(?:of\s*\d+\s*)?)?(?:delivered|arrived)\b\s*(?:on|at)?\s*[:\-]?\s*(.*)$/i;

/**
 * "Return window closed on 19 June 2026" — MEASURED, on the owner's own Amazon
 * order page, 15 September 2026. The exact line, in his order, three lines under
 * the product name, carrying the year the delivery line above it does not.
 *
 * Anchored at the start of the line like every other label in this file, so a
 * sentence that merely mentions a return window cannot drag a date in.
 */
const RETURN_WINDOW_CLOSED =
  /^returns?\s+(?:window|period)\s+(?:closed?|closes|ends?|ended|expired?|expires)\b\s*(?:on|at)?\s*[:\-]?\s*(.*)$/i;

/**
 * "Return items: Eligible through 3 July 2026" — the OPEN form of the same fact,
 * which is what the page says while the window is still running.
 *
 * NOT MEASURED ON A LIVE PAGE, and said so rather than left to be assumed. It is
 * the wording already written into order-text.spec.ts as chrome, where it has
 * carried a full date that nothing read. Kept as its own pattern rather than
 * folded into the one above, because a single regular expression that matches
 * two shapes is one nobody can read afterwards.
 */
const RETURN_ELIGIBLE_THROUGH =
  /^returns?(?:\s+or\s+replace)?\s+items?\s*[:\-]?\s*eligible\s+(?:through|until|till)\s*[:\-]?\s*(.*)$/i;

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

/**
 * THE PAGE SAYING, IN WORDS, THAT THE ORDER ARRIVED.
 *
 * Measured on the owner's own Zepto order list, 21 September 2026. The three
 * states a card goes through, in his own account, all on the same screen:
 *
 *   Your order is getting packed
 *   Order on the way
 *   Order delivered            ← this one, and it prints no time beside it
 *
 * WHOLE PHRASES, NOT THE WORD "DELIVERED" ON ITS OWN, and the difference is the
 * whole safety of this line. Zepto's own chrome says "delivered in minutes*" on
 * every page of the site, its search placeholder offers "Groceries in Minutes",
 * and a bare /delivered/ would read the shop's advertising as a statement about
 * somebody's parcel. "order delivered" and "delivery completed" are things a
 * page says about ONE order.
 *
 * AND IT IS DELIBERATELY NOT "out for delivery" OR "arriving", which are the
 * states immediately before this one and mean the opposite.
 */
const DELIVERED_SAID =
  /\border\s+delivered\b|\bdelivery\s+completed\b|\bdelivered\s+on\b/i;

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

/** The count on that same line — the "1" of "1 x ₹149" — or null. */
function countOnThePriceLine(line: string): number | null {
  const m = QUANTITY_AND_PRICE.exec(line.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
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
 * THE NUMBER ON A COUNT-AND-MEASURE LINE — the "2" of "2 units".
 *
 * Read off the same match that decides the line is a count at all, so there is
 * one idea of what such a line looks like and not two. A fraction ("1.5 kg") is
 * a weight and not a number of things, and answers null: dividing a price by one
 * and a half is not a per-unit anything.
 */
function countOnAMeasureLine(line: string): number | null {
  const m = MEASURE_ONLY.exec(line.trim());
  if (!m) return null;
  const n = Number(/^(\d+(?:\.\d+)?)/.exec(line.trim())?.[1] ?? '');
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
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
 * A LABEL WITH ITS VALUE ON THE NEXT LINE, WHICH IS HOW THE APP ACTUALLY SEES IT.
 *
 * ── THE BUG THIS ENDS, AND IT WAS IN EVERY AMAZON ORDER ───────────────────
 *
 * Every note in this file about Amazon's product block was written from the
 * page's innerText, where it reads:
 *
 *   Lukzer | Heavy-Duty Metal Garment Rack ...
 *   Sold by: Lukzer                  <- ONE line, label and value together
 *   Return window closed on 19 June 2026
 *   ₹938.00
 *
 * THAT IS NOT WHAT THE APP SENDS. The app fetches the order page and cuts it
 * into lines at every tag — src/orderhistory.js, pageToLines — and the label and
 * the seller are different elements, so they arrive as TWO lines:
 *
 *   Nike M PROMINA Extra Wide Black/White
 *   Sold by:                         <- the label, alone
 *   Westbury Sportswear              <- the seller, alone
 *   Return window closed on 26 February 2026
 *   ₹4,995.00
 *   ₹4,995.00
 *
 * MEASURED on the owner's own account, 16 September 2026, by reproducing the
 * app's exact fetch inside his signed-in browser and running this reader over
 * what came back.
 *
 * What it did to the read: the walk from the product's name steps over
 * "Sold by:" because AROUND_A_PRODUCT names it, lands on "Westbury Sportswear",
 * which is neither furniture nor money, and gives up on the product. Then the
 * scan reaches that same line, decides it looks like a name, steps over the
 * return-window line, finds ₹4,995.00 — and files THE SELLER as the thing he
 * bought, at exactly the right price:
 *
 *   ITEMS = 1
 *      - 499500 | "Westbury Sportswear"
 *
 * So the server answered product_name_not_found on a page with the product
 * printed on it, and it had nothing to do with the campaign's name, the search,
 * or the match. It read the wrong line. Every Amazon order goes through this.
 *
 * ── THE FIX IS TO PUT THE LINE BACK TOGETHER, NOT TO TEACH THE WALK ───────
 *
 * Folding here makes the app's lines the same shape as the innerText this
 * reader's rules were written against, so the walk, looksLikeAName and every
 * fixture in the checks all keep behaving exactly as they were reasoned about.
 * Teaching the walk to skip a second line instead would have left the seller
 * still looking like a name to the scan that comes after it — which is the half
 * that actually filed it.
 *
 * ONLY LABELS THAT NAME A SELLER, and only when the line is JUST the label.
 * A page that already writes "Sold by: Lukzer" together is untouched, because
 * that line is not bare. Nothing here folds a bill label: those carry money, the
 * bill reader already looks on the line under them, and folding them would be a
 * change to how money is read.
 */
const A_BARE_SELLER_LABEL =
  /^(?:sold|shipped|dispatched|fulfilled)\s+by\s*:?\s*$/i;

/** Put a bare "Sold by:" back together with the seller underneath it. */
export function foldBareSellerLabels(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const here = lines[i];
    const under = i + 1 < lines.length ? lines[i + 1] : null;
    if (A_BARE_SELLER_LABEL.test(here) && under != null) {
      out.push(`${here.replace(/\s*:?\s*$/, '')}: ${under}`);
      i += 1;
      continue;
    }
    out.push(here);
  }
  return out;
}

/**
 * THE SHOP'S OWN FURNITURE, WHICH CARRIES A PRICE AND IS NOT A PURCHASE.
 *
 * ── MEASURED, AND IT PUT SEVENTEEN THINGS ON AN ORDER OF TWO ──────────────
 *
 * An Amazon order page is not only the order. It carries the cart flyout at the
 * top of every page the shop serves, and two carousels of things it would like
 * sold, at the bottom. Read as text, all three look exactly like a product with
 * a price under it:
 *
 *   Go to Cart          <- the cart flyout, captured in the owner's own page
 *   ₹849.00                text on 16 September 2026
 *   Quantity is 1
 *   Limited time deal
 *   ₹1,299.00
 *
 *   Amazon Basics Wooden Hangers, Pack of 20     <- a carousel tile
 *   M.R.P: ₹1,999.00
 *   ₹1,299.00
 *
 * The order had TWO things on it and the reader answered with NINETEEN. Two of
 * them were his purchase. Two were the cart. Fifteen were called "M.R.P:" —
 * because a carousel prints the struck price as a labelled line, the label is
 * three letters and two dots, and nothing said a label is not a name.
 *
 * ── WHY THESE ARE NOT IN THE LIST ABOVE, WHICH LOOKS LIKE THE SAME LIST ───
 *
 * AROUND_A_PRODUCT is also consulted when the reader is WALKING from a name to
 * its price, so a line in it is a line the walk steps OVER. That is right for
 * "Sold by:" — the price two lines down really is that product's. It would be
 * wrong for every line here: stepping over a carousel's label would hand the
 * tile's own price to whatever name sat above it. So this list is asked in one
 * place only, where a line is being considered AS a name, and never in the walk.
 *
 * ── AND IT GROWS ONLY FROM A MEASUREMENT ──────────────────────────────────
 *
 * Four openings, and each one was read off a page rather than imagined: three
 * from the order page above, and "Quantity is" from the cart flyout captured in
 * backend/test/fixtures/amazon-review-garment-rack.txt. Openings rather than
 * words anywhere in a line, so a product whose name contains one is untouched.
 */
const THE_SHOPS_OWN_FURNITURE =
  /^(?:go\s+to\s+cart|quantity\s+is\b|limited\s+time|m\.?r\.?p\.?\b)/i;

/** Is this line the shop's own furniture rather than anything anybody bought? */
function shopFurniture(line: string): boolean {
  return THE_SHOPS_OWN_FURNITURE.test(line.trim());
}

/**
 * WHERE THE ORDER STOPS AND THE THINGS THE SHOP WOULD LIKE SOLD BEGIN.
 *
 * ── A SECOND GUARD, FOR THE LAYOUT THE FIRST ONE CANNOT SEE ───────────────
 *
 * The furniture list above answers the carousel that was measured, where the
 * struck price is labelled and the tile's own name never reaches a figure. It
 * answers nothing at all about a tile laid out the other way round:
 *
 *   Lukzer | Heavy-Duty Metal Garment Rack ...     <- a SUGGESTION, not a buy
 *   ₹938.00
 *
 * which is a product name with a price under it and is indistinguishable from a
 * purchase by any rule about one line. It matters more than tidiness: a shop
 * recommends things LIKE the thing on the page, so the tile most likely to be
 * laid out beside an order is the campaign's own product at the campaign's own
 * price — which is precisely the pair a match is made on.
 *
 * ── AND "BUY IT AGAIN" IS DELIBERATELY NOT IN THIS LIST ───────────────────
 *
 * It is a carousel heading on some pages AND the button printed under every
 * purchased item on this one — it sits between his two products in the captured
 * page. Cutting there would throw away the second thing he bought. Same for the
 * shop's "Buy Again" in the navigation, which is above everything.
 *
 * ── IT CAN ONLY EVER TAKE JUNK AWAY, BY CONSTRUCTION ──────────────────────
 *
 * Whole lines, anchored both ends, so a product whose name contains one of these
 * phrases is not a heading. And if cutting here would leave NO products at all,
 * the cut is abandoned and the page is read exactly as it was before: a heading
 * matched somewhere unexpected costs the junk it was already costing, and never
 * the order.
 */
const SOMEBODY_ELSES_PRODUCTS: readonly RegExp[] = [
  // ── THE THREE THAT WERE MISSING, AND THE LEAK THEY LET THROUGH ──────────
  //
  // MEASURED ON THE OWNER'S OWN NIKE ORDER PAGE, 16 September 2026. That page
  // carries no "Recommended for you" heading at all. Its carousels are headed
  // "Pick up where you left off" and "Recommended based on your shopping
  // trends", neither of which was in this list, so the cut never happened and
  // the page was left to the furniture rule alone.
  //
  // The furniture rule catches a tile whose struck price is LABELLED. It cannot
  // catch one laid out as a plain name with a plain price under it, and one tile
  // on that page is exactly that:
  //
  //   FIG Living Mini Serenity Table Lamp | European Linen Lampshade with ...
  //   ₹2,999.00
  //
  // It came back as an item on his order, at ₹2,999, on an order that cost
  // ₹4,995 and held one pair of shoes. Harmless there only because the name has
  // to match as well — which is the accident this list exists so as not to rely
  // on. A shop recommends things LIKE the thing on the page.
  //
  // "See more" IS GLUED TO THE HEADING in the page's own text — the line reads
  // "Pick up where you left offSee more" with no space — so the tail is part of
  // the pattern rather than a separate line. Measured, not guessed.
  /^pick\s+up\s+where\s+you\s+left\s+off(?:\s*see\s+(?:more|all))?$/i,
  /^recommended\s+based\s+on\s+your\s+shopping\s+trends$/i,
  /^recommended\s+for\s+you$/i,
  /^customers\s+who\s+(?:viewed|bought)\b.*$/i,
  /^related\s+to\s+items\s+you'?(?:ve)?\s+viewed$/i,
  /^products\s+related\s+to\s+this\s+item$/i,
  /^inspired\s+by\s+your\s+browsing\s+history$/i,
  /^more\s+items\s+to\s+explore$/i,
];

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
  // THE SHOP'S OWN FURNITURE, ASKED HERE AND NOWHERE ELSE. See the note beside
  // THE_SHOPS_OWN_FURNITURE for why it is not next to the line above it.
  if (shopFurniture(text)) return false;
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
): ParsedOrderItem | null {
  const text = line.trim();
  if (MONEY_ONLY.test(text)) return null;
  if (QUANTITY_AND_PRICE.test(text)) return null;
  const m = NAME_AND_MONEY.exec(text);
  if (!m) return null;
  const name = m[1].trim();
  if (!looksLikeAName(name)) return null;
  const p = paise(m[2]);
  // ONE LINE IS ONE FIGURE, so there is no struck price to carry. A page that
  // writes the name and the money together has stated no was-price at all, and
  // inventing one from a later line would be reading two products as one.
  // AND NO COUNT EITHER: a name and a figure on one line state how much, never
  // how many. Null is "the page did not say", which is not one.
  return p == null || p <= 0n
    ? null
    : { name, pricePaise: p, wasPricePaise: null, unitsStated: null };
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

/**
 * A DAY AND A MONTH AT THE FRONT OF A PIECE OF TEXT, WITH NO YEAR ON IT.
 *
 * "5 June", "5 Jun", "June 5", "Jun 5" — the shapes Amazon prints beside
 * "Delivered". Anchored at the very start and nowhere else, so this can never
 * turn a number further down a sentence into a date.
 *
 * ANYTHING WITH A YEAR ALREADY ON IT IS REFUSED HERE, by the lookahead, and left
 * to dayFromText — which is asked first anyway. Two readers for one shape is how
 * the two end up disagreeing about a page they both understood.
 */
function theDayAndMonthAtTheFront(text: string): string | null {
  const t = String(text ?? '').trim();
  // THE WORD BOUNDARY IS LOAD BEARING and is not tidying. Without it the engine
  // backtracks: "5 June 2025" fails the lookahead on "June", shortens the month
  // to "Jun", and then the lookahead sees "e 2025" and passes — so a line that
  // states its own year gets that year thrown away and the order's put in. With
  // the boundary, "Jun" cannot end the match while an "e" follows it.
  const front = t.match(/^(\d{1,2}\s+[A-Za-z]{3,}|[A-Za-z]{3,}\s+\d{1,2})\b(?!\s*\d)/);
  return front ? front[1] : null;
}

/**
 * A DAY THAT IS REALLY ON THE CALENDAR, or null.
 *
 * dayFromText does not check: hand it "29 February 2027" and it hands back
 * "2027-02-29", which is not a day. That has never mattered, because until now
 * every date it read came printed on a page. A date this file BUILDS — by
 * putting a year next to a day and a month — can be built out of nothing, and a
 * delivery date silently a day out is a return window silently a day out.
 */
function aRealCalendarDay(day: string | null): string | null {
  if (day == null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const date = Number(parts[3]);
  const built = new Date(Date.UTC(year, month - 1, date));
  if (built.getUTCFullYear() !== year) return null;
  if (built.getUTCMonth() !== month - 1) return null;
  if (built.getUTCDate() !== date) return null;
  return day;
}

/** A day some number of days after another, as "2026-09-01". */
function theDayAfter(day: string, days: number): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  return dayFromMillis(
    Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + days),
  );
}

/**
 * HOW LONG AFTER ITS ORDER A DELIVERY MAY BE, FOR A YEAR TO BE BORROWED.
 *
 * Ninety days, and the number is not doing fine work — see theYearFromTheOrder
 * for what it is separating, which is a few days from a few hundred.
 */
const MOST_DAYS_A_BORROWED_YEAR_MAY_SPAN = 90;

/**
 * THE DELIVERY DAY, WITH ITS YEAR BORROWED FROM THE ORDER'S.
 *
 * The rule the device reader has used since it was written — src/taskflow.js:184,
 * resolveDeliveryDate — brought here so one purchase read two ways gives one
 * date. Its own comment is the record of why it exists: "Resolving it naively
 * against the current year silently produces windows a year wrong."
 *
 * REFUSES WHEN THERE IS NO ANCHOR. No order date is no year, and no year is
 * null. Nothing falls back to today's year, and such a fallback would put an
 * invented year on the date a return window is judged against.
 *
 * ROLLS FORWARD, NEVER BACK. A delivery cannot precede its order, so a day that
 * reads earlier than the order fell in the FOLLOWING year — ordered 31 December,
 * delivered 2 January.
 *
 * ── AND IT IS BOUNDED, WHICH THE DEVICE'S COPY IS NOT ─────────────────────
 *
 * The rollover is right for 31 December to 2 January and wrong for everything
 * that merely looks like it. An order placed 2 June whose page reads "Delivered
 * 1 June" is one day short of its own order date — a stray line, a second order
 * on the same page, a word read slightly wrong — and rolling it produces 1 June
 * of the FOLLOWING year. A 364-day delivery, silently, on the date a payout
 * waits for. The whole span is bounded rather than the roll alone, because a
 * borrowed year can be wrong in the same way without rolling: a "Delivered 30
 * December" picked up off an order placed in June is 211 days and no rollover.
 *
 * REFUSING IS FREE, WHICH IS WHY THE BOUND IS SAFE. Outside the bound this
 * returns null, and null is precisely what this whole function returns today for
 * every page that omits the year. A bound can therefore take nothing away — it
 * can only decline to add something. That is not true of the unbounded rule,
 * which adds a wrong date to a page that currently has none.
 *
 * WHICH WAY A WRONG ANSWER WOULD RUN, since a bound is only worth having if the
 * thing it refuses is worth refusing: every wrong answer this rule can give is
 * LATER than the truth, never earlier, because it only ever rolls forward. Later
 * holds the money longer. So the bound is not protecting a payout from going out
 * early — it is protecting a task from a return window a year away that nobody
 * can clear, and a person from being told their refund is due next June.
 *
 * ── SO THE DEVICE AND THE SERVER CAN DISAGREE, IN ONE CASE, SAID PLAINLY ──
 *
 * On a page with no delivery year whose delivery reads more than ninety days
 * from its order, the device produces a date and this produces null. That is a
 * deliberate difference, not a missed port: null is the answer the server gave
 * for that page yesterday, and the device's copy predates anybody having looked
 * at what an unbounded roll does. The two agree on every page anybody has
 * measured. Bounding the device's copy to match is a one-line change and its own
 * commit, in an app file, and is not being smuggled into a backend parser.
 */
function theYearFromTheOrder(
  written: string,
  orderDate: string | null,
): string | null {
  if (orderDate == null) return null;
  const dayAndMonth = theDayAndMonthAtTheFront(written);
  if (dayAndMonth == null) return null;
  const year = Number(orderDate.slice(0, 4));
  if (!Number.isInteger(year)) return null;

  // THE ORDER'S OWN YEAR FIRST. Refused outright when that is not a day — 29
  // February in a year without one — rather than tried again a year later, which
  // would answer a leap-day question with a date twelve months away.
  const sameYear = aRealCalendarDay(dayFromText(`${dayAndMonth} ${year}`));
  if (sameYear == null) return null;

  const day = sameYear >= orderDate
    ? sameYear
    : aRealCalendarDay(dayFromText(`${dayAndMonth} ${year + 1}`));
  if (day == null) return null;

  // Both are "YYYY-MM-DD", zero padded and fixed width, so comparing them as
  // text is comparing them as dates.
  const latest = theDayAfter(orderDate, MOST_DAYS_A_BORROWED_YEAR_MAY_SPAN);
  if (latest == null) return null;
  if (day < orderDate || day > latest) return null;
  return day;
}

/**
 * THE TIME OF DAY PRINTED AFTER A DATE, AS AN INSTANT — Phase 8B-c.
 *
 * `day` is the day already read out of this same piece of text, so nothing here
 * decides what day it was; it only decides what o'clock, and only when the text
 * carries a clock face immediately after the date it stated.
 *
 * ANCHORED TO THE DATE'S OWN TAIL. The date is found at the front, exactly as
 * the day readers find it, and the time is looked for in what is left — so
 * "Order Arrived at / 25 Aug 2026, 9:02 PM" reads, and a page whose next number
 * is a price, a quantity or half an order number reads nothing. A delivery
 * instant invented out of a figure further along a line would move the moment
 * somebody is paid.
 *
 * BOTH DATE SHAPES, because both reach here. A day with a year on it is what
 * theDayAtTheFront finds; a day with no year is what theYearFromTheOrder works
 * from, and a page printing "Delivered 5 June, 9:02 PM" states a time as plainly
 * as any other.
 */
function theTimeAfterTheDay(day: string, text: string): number | null {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  const withYear = theDayAtTheFront(t);
  const lead = withYear !== t ? withYear : (theDayAndMonthAtTheFront(t) ?? '');
  if (lead === '') return null;
  const clock: ClockReading | null = clockFromText(t.slice(lead.length));
  return instantInIndia(day, clock);
}

/**
 * THE LAST OF THE ARRIVALS READ OFF ONE PAGE, or null when there were none.
 *
 * THE LATEST DAY FIRST, and only then the latest time on that day. Doing it the
 * other way round — one comparison over "the instant, or noon when there is not
 * one" — would let a parcel that arrived at nine in the evening on Monday beat
 * one whose Tuesday line printed no time at all, because noon on Tuesday sorts
 * after nine on Monday only if you remember to look at the day first.
 *
 * A DAY WITH NO TIME ON IT DOES NOT ERASE A TIME. If the last day carries two
 * readings and only one states a clock, that clock is the best thing the page
 * said about when the order finished arriving, and it is kept. The day is the
 * same either way, so nothing is claimed that the page did not print.
 */
function theLastArrival(
  arrivals: readonly { day: string; at: number | null }[],
): { day: string; at: number | null } | null {
  if (arrivals.length === 0) return null;
  // Both are "YYYY-MM-DD", zero padded and fixed width, so comparing them as
  // text is comparing them as dates — the same trick theYearFromTheOrder uses.
  const day = arrivals.reduce((latest, a) => (a.day > latest ? a.day : latest), arrivals[0].day);
  const at = arrivals
    .filter((a) => a.day === day && a.at != null)
    .reduce<number | null>((latest, a) => (
      latest == null || (a.at as number) > latest ? (a.at as number) : latest
    ), null);
  return { day, at };
}

/** The empty answer, so "we read nothing" is one shape and not several. */
function nothing(): ParsedOrder {
  return {
    orderNumber: null,
    orderDate: null,
    totalPaise: null,
    itemTotalPaise: null,
    feesPaise: null,
    billDiscountPaise: null,
    deliveryDate: null,
    deliveryAt: null,
    returnWindowEndsDate: null,
    returned: null,
    deliveredSaid: null,
    rated: null,
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
): { paise: bigint; was: bigint | null; through: number } | null {
  const first = moneyOnly(lines[at] ?? '');
  if (first == null) return null;
  const second = moneyOnly(lines[at + 1] ?? '');
  if (second == null) return { paise: first, was: null, through: at };
  // AND THE OTHER ONE IS NOT THROWN AWAY ANY MORE. It was, and that made the
  // shop's own discount invisible to everything downstream: a product at ₹77
  // with ₹110 struck through beside it arrived as "₹77, and nobody knows why".
  // See ParsedOrderItem.wasPricePaise for the one thing that reads it.
  const paid = first <= second ? first : second;
  const was = first <= second ? second : first;
  return { paise: paid, was, through: at + 1 };
}

/**
 * WHAT A FEE LINE ACTUALLY COST, WHERE "FREE" IS ONE OF THE TWO FIGURES.
 *
 * ── MEASURED ON THE OWNER'S OWN ZEPTO ORDER PAGES, 15 SEPTEMBER 2026 ──────
 *
 * A waived charge is printed as a struck price and the WORD free, not as a
 * second figure:
 *
 *   Delivery Fee
 *   ₹30        <- what it would have been
 *   FREE       <- what it was
 *
 * amountPaidAt cannot help here and would do harm: moneyOnly('FREE') is null,
 * so the pair rule never fires and it answers ₹30 — a waived fee read as a
 * charged one. Both drawn fixtures print exactly this shape twice.
 *
 * AND A FEE THAT WAS REALLY CHARGED LOOKS DIFFERENT. The same account, order
 * #LRGSKOMA18669, also 15 September 2026: "Delivery Fee / ₹30 / Handling Fee"
 * — one figure, no FREE under it, and ₹30 is genuinely part of the ₹104 that
 * left his account. So a single figure is the charge and a figure followed by
 * FREE is nothing, and those are the only two shapes anybody has measured.
 */
const SAYS_FREE = /^free$/i;

function feeChargedAt(
  lines: readonly string[],
  at: number,
): bigint | null {
  if (SAYS_FREE.test((lines[at] ?? '').trim())) return 0n;
  const figure = moneyOnly(lines[at] ?? '');
  if (figure == null) return null;
  if (SAYS_FREE.test((lines[at + 1] ?? '').trim())) return 0n;
  return figure;
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
 * WHAT ONE FEE LINE COST, IN ANY OF THE THREE SHAPES A PAGE WRITES IT IN.
 *
 * All three measured, all three on real pages:
 *
 *   Handling Charge ₹0            label and figure on one line
 *   Delivery Fee FREE             label and the word, on one line
 *   Delivery Fee / ₹30 / FREE     label, the struck figure, the word under it
 *   Delivery Fee / ₹30            label and the figure, and it was charged
 *
 * Null means this page printed no such line, which is not the same as a line
 * that says nothing was charged — a page that never mentions delivery and a
 * page that says delivery was free are different statements, and only the
 * second one is a zero.
 */
function feeForLabel(
  lines: readonly string[],
  from: number,
  label: string,
): bigint | null {
  for (let i = from; i < lines.length; i += 1) {
    if (!startsWithLabel(lines[i], label)) continue;
    const text = lines[i].trim();
    // The word on the label's own line: "Delivery Fee FREE".
    if (SAYS_FREE.test(low(text).slice(label.length).trim())) return 0n;
    const sameLine = NAME_AND_MONEY.exec(text);
    if (sameLine) {
      const p = paise(sameLine[2]);
      if (p != null) return p;
    }
    return feeChargedAt(lines, i + 1);
  }
  return null;
}

/**
 * EVERY CHARGE THE SHOP ADDED ON TOP, ADDED UP — or null when it named none.
 *
 * A sum rather than one figure because a page prints several: delivery AND
 * handling, both on the same bill. Only the labels in FEE_LABELS are counted,
 * and the note above that list is the whole argument for why it is short.
 */
function feesTotal(lines: readonly string[], from: number): bigint | null {
  let found = false;
  let sum = 0n;
  for (const label of FEE_LABELS) {
    const one = feeForLabel(lines, from, label);
    if (one == null) continue;
    found = true;
    sum += one;
  }
  return found ? sum : null;
}

/** Money with a minus sign in front of it, which is how a deduction is printed. */
const MONEY_SIGNED = new RegExp(`^-\\s*${RUPEES}$`, 'i');

/**
 * A DISCOUNT TAKEN OFF THE WHOLE BILL, AS A POSITIVE NUMBER OF PAISE.
 *
 * Measured written as a negative — "Promotion Applied:" then "-₹80.00" — which
 * MONEY_ONLY cannot read at all, because RUPEES carries no sign. Answered as a
 * magnitude because that is what it is used for: a figure to take away. The
 * sign is the page's way of saying which direction, and the direction is
 * already in the label.
 */
function billDiscountAt(lines: readonly string[], at: number): bigint | null {
  const text = (lines[at] ?? '').trim();
  const signed = MONEY_SIGNED.exec(text);
  if (signed) return paise(signed[1]);
  return moneyOnly(text);
}

/** Every bill-level discount the page printed, added up, or null for none. */
function billDiscountTotal(
  lines: readonly string[],
  from: number,
): bigint | null {
  let found = false;
  let sum = 0n;
  for (const label of BILL_DISCOUNT_LABELS) {
    for (let i = from; i < lines.length; i += 1) {
      if (!startsWithLabel(lines[i], label)) continue;
      const sameLine = NAME_AND_MONEY.exec(lines[i].trim());
      const one = sameLine ? paise(sameLine[2]) : billDiscountAt(lines, i + 1);
      if (one == null) break;
      found = true;
      sum += one < 0n ? -one : one;
      break;
    }
  }
  return found ? sum : null;
}

/**
 * One order screen, read as text.
 *
 * Always returns the shape, never null: a caller asking "what is on this screen"
 * gets an answer it can read every field of, and "we could not read it" is an
 * order with no number and no products rather than a missing object.
 */
/**
 * WHICH OF THE READER'S OWN PHRASES A PAGE CARRIES. FOR A LOG LINE, NEVER FOR A
 * DECISION — nothing branches on this and nothing may start to.
 *
 * ── THE EVENING IT EXISTS FOR ──────────────────────────────────────────────
 *
 * 21 September 2026. A Zepto order page, delivered and rated hours earlier,
 * came back `rated=null delivered=null` read after read, and the two possible
 * causes are opposite problems with opposite fixes:
 *
 *   THE PAGE ARRIVED HALF DRAWN   the phrases are there and we read the page
 *                                 before they were. Fix the waiting.
 *   THE WORDING HAS MOVED         the page is whole and says something else.
 *                                 Fix the phrase.
 *
 * A length cannot tell them apart and neither can a null. This can: the last
 * two probes are not the reader's phrases at all, they are words that sit
 * FURTHER DOWN the same page, so "bill-heading=yes you-rated=no" is a whole page
 * whose wording moved and "bill-heading=no" is a page we did not wait for.
 *
 * IT CARRIES NO CONTENT. Six fixed names and six yes/no, built from the
 * reader's own expressions so a phrase cannot be checked here and matched
 * differently next door.
 */
export function whichMarkersAppear(text: string | null | undefined): string {
  const whole = typeof text === 'string' ? text.replace(/\s+/g, ' ') : '';
  const probes: readonly (readonly [string, RegExp])[] = [
    ['you-rated', RATED_SAID],
    ['rate-order', RATE_INVITED],
    ['order-delivered', DELIVERED_SAID],
    // AND THE THREE THAT ARE NOT DECISIONS, only landmarks further down the page.
    ['the-word-delivered', /\bdelivered\b/i],
    ['bill-heading', /\bbill\s+summary\b/i],
    ['item-total', /\bitem\s+total\b/i],
    // ── AND THREE ABOUT THE ORDER'S OWN DATE, WHICH IS THE OPEN QUESTION ────
    //
    // 21 September 2026. The owner's order card shows "Order date: Not
    // available" while the SAME page gave up a delivery instant of 00:57 am.
    // A page that dates the arrival very likely dates the purchase, so the
    // question is not "is the date there" but "is it there in a shape the
    // reader accepts" — ORDER_DATE_LABEL is anchored to the START of a line,
    // and Zepto's list writes "Placed at 20th Sep 2026, 07:45 pm" in the MIDDLE
    // of one, after the amount.
    //
    // THESE THREE SEPARATE THE TWO ANSWERS. placed-at or ordered-on saying yes
    // while the stored orderDate is still null means the words are on the page
    // and the anchor is what refused them — one expression, not a second read
    // of a second page. All three saying no means the page really is silent
    // about when the order was made, and the date has to come off the list.
    ['placed-at', /\bplaced\s+at\b/i],
    ['ordered-on', /\border(?:ed)?\s+on\b/i],
    ['a-day-and-month', /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i],
  ];
  return probes.map(([name, probe]) => `${name}=${probe.test(whole) ? 'yes' : 'no'}`).join(' ');
}

export function parseOrderText(text: string | null | undefined): ParsedOrder {
  if (typeof text !== 'string' || text.trim() === '') return nothing();

  const lines = foldBareSellerLabels(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l !== ''),
  );
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
  //
  // EVERY ARRIVAL ON THE PAGE IS READ, AND THE LATEST WINS. See DELIVERY_LABEL
  // for why: an order split into parcels is delivered when the last of it is.
  // This used to stop at the first date it could read, which on a two shipment
  // page is the EARLIER arrival.
  const arrivals: { day: string; at: number | null }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = DELIVERY_LABEL.exec(lines[i]);
    if (!m) continue;
    // The same comma trick as the order date: a screen writes the time after it.
    const beside = (m[1] ?? '').split(',')[0].trim();
    // AND THE WHOLE TAIL, UNCUT, KEPT BESIDE IT. The cut above is what makes the
    // DAY readable; the time is the thing on the other side of that comma, and
    // it is read from this. Two variables rather than one because the day's
    // reading is not being changed by a hair.
    const besideWhole = (m[1] ?? '').trim();
    // AND THE SAME theDayAtTheFront, which the order branch had and this one did
    // not. The asymmetry was real, not cosmetic: Amazon's own page prints
    // "Delivered 8 June" and then "Return window closed on 19 June 2026", and a
    // layout that runs the two together handed the whole tail to a date reader
    // that is deliberately strict — which refused it, on a page stating the day.
    const under = lines[i + 1] ?? '';
    // THE LABEL'S OWN LINE IS EXHAUSTED FIRST, both ways, before the line under
    // it is looked at at all. The order is deliberate: the line the label sits on
    // is the stronger statement about the label, so a year-less day beside
    // "Delivered" beats a full date that merely happens to sit underneath — which
    // on an Amazon page is as likely to be the ORDER's date as the delivery's.
    const fromBeside = dayFromText(theDayAtTheFront(beside))
      ?? theYearFromTheOrder(beside, orderDate);
    if (fromBeside != null) {
      // THE TIME COMES OFF THE SAME TEXT THE DAY CAME OFF, never off the other
      // one. A time read from the line under a day read from the line beside is
      // two halves of two different statements stitched into one instant.
      arrivals.push({ day: fromBeside, at: theTimeAfterTheDay(fromBeside, besideWhole) });
      continue;
    }
    const fromUnder = dayUnder(under) ?? theYearFromTheOrder(under, orderDate);
    if (fromUnder != null) {
      arrivals.push({ day: fromUnder, at: theTimeAfterTheDay(fromUnder, under) });
    }
  }
  const theArrival = theLastArrival(arrivals);
  const deliveryDate = theArrival?.day ?? null;
  const deliveryAt = theArrival?.at == null
    ? null
    : new Date(theArrival.at).toISOString();

  // ── the day the SHOP'S OWN return window closes ───────────────────────────
  //
  // A YEAR IS REQUIRED HERE AND NEVER BORROWED. See ParsedOrder's own comment on
  // returnWindowEndsDate for why this one refuses where the delivery date above
  // it infers: refusing this costs nothing, because the operator's policy table
  // still computes a window, and this is the date the money waits for.
  let returnWindowEndsDate: string | null = null;
  for (let i = 0; i < lines.length && returnWindowEndsDate == null; i += 1) {
    const m = RETURN_WINDOW_CLOSED.exec(lines[i])
      ?? RETURN_ELIGIBLE_THROUGH.exec(lines[i]);
    if (!m) continue;
    const written = theDayAtTheFront((m[1] ?? '').split(',')[0].trim());
    returnWindowEndsDate = dayFromText(written) ?? dayUnder(lines[i + 1] ?? '');
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

  // ── whether it has been rated at the shop ─────────────────────────────────
  //
  // Read over the whole text for the same reason `returned` is. Both phrases
  // present is a page that contradicts itself and is read as "we do not know",
  // never as rated: the direction that costs a person one more look, not the
  // direction that moves a task on a page nobody understood.
  // THE STATUS, NEVER A DATE. See ParsedOrder.deliveredSaid.
  const deliveredSaid = DELIVERED_SAID.test(whole) ? true : null;

  const saidRated = RATED_SAID.test(whole);
  const invitedToRate = RATE_INVITED.test(whole);
  const rated = saidRated && !invitedToRate
    ? true
    : (invitedToRate && !saidRated ? false : null);

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
  // WHERE EACH ONE WAS FOUND, kept beside them rather than on them: a product
  // is a name and a price everywhere else in this codebase, and a line number is
  // this function's own working note. It is used once, below, to draw the line
  // between the order and the things the shop would like sold.
  const foundAt: number[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // The name and the price on one line.
    const together = nameAndPriceOnOneLine(line);
    if (together) { items.push(together); foundAt.push(i); i += 1; continue; }

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
      // AND THE COUNT ON THOSE LINES IS KEPT while stepping over them. See
      // ParsedOrderItem.unitsStated: it is the difference between an item's line
      // and one unit's price, and it was being walked past.
      let units: number | null = null;
      while (at < lines.length
        && (measureOnly(lines[at]) || aroundAProduct(lines[at]))) {
        const said = countOnAMeasureLine(lines[at]);
        if (said != null && (units == null || said > units)) units = said;
        at += 1;
      }

      // A name, then "1 x ₹149", then often the line's own total underneath. The
      // count and price line is the item's OWN price, which is the figure a
      // campaign states, so that is the one kept. What the line came to is part
      // of the bill, and the bill is read separately.
      const counted = quantityAndPrice(lines[at] ?? '');
      if (counted != null && counted > 0n) {
        // "1 x ₹149" then "₹149" is a count line and the LINE'S OWN TOTAL, not
        // a struck pair, so there is no was-price here either.
        // "1 x ₹149" STATES ITS OWN COUNT, and it is the one to believe: it sits
        // on the price line itself rather than among the container sizes above
        // it. The figure taken is the item's OWN price, so the count beside it
        // is one by construction — but it is recorded as read, not as assumed.
        items.push({
          name: line,
          pricePaise: counted,
          wasPricePaise: null,
          unitsStated: countOnThePriceLine(lines[at] ?? '') ?? units,
        });
        foundAt.push(i);
        i = at + (moneyOnly(lines[at + 1] ?? '') != null ? 2 : 1);
        continue;
      }
      // A name with the price on the line under it — or the paid price out of a
      // struck pair, which is the same question asked once, above.
      const under = amountPaidAt(lines, at);
      if (under != null && under.paise > 0n) {
        items.push({
          name: line, pricePaise: under.paise, wasPricePaise: under.was, unitsStated: units,
        });
        foundAt.push(i);
        i = under.through + 1;
        continue;
      }
    }
    i += 1;
  }

  // ── AND THE THINGS THE SHOP WOULD LIKE SOLD ARE NOT ON THE ORDER ────────
  //
  // Read AFTER the scan rather than as a stop inside it, so that abandoning the
  // cut is one line and cannot leave the scan half done. See
  // SOMEBODY_ELSES_PRODUCTS for why a cut that would empty the order is dropped.
  let suggestionsStart = lines.length;
  for (let k = 0; k < lines.length; k += 1) {
    if (SOMEBODY_ELSES_PRODUCTS.some((h) => h.test(lines[k]))) {
      suggestionsStart = k;
      break;
    }
  }
  const theOrdersOwn = items.filter((one, k) => one != null && foundAt[k] < suggestionsStart);
  const bought = theOrdersOwn.length > 0 ? theOrdersOwn : items;

  // WHERE TO LOOK FOR THE TOTALS. Inside the bill block when there is one. When
  // there is not — which is every ROW IN A LIST of orders, where the whole order
  // is a number, a day, a product and one figure — the whole thing is looked at,
  // because a labelled total is a labelled total wherever it sits.
  const totalsFrom = billStart < lines.length ? billStart : 0;

  return {
    orderNumber,
    orderDate,
    totalPaise: moneyForLabels(lines, totalsFrom, TOTAL_BILL_LABELS),
    // ── AND WHEN THE PAGE LABELS NOTHING, ONE PRODUCT IS ITS OWN ITEM TOTAL ──
    //
    // 20 SEPTEMBER 2026, from the owner's own razor. Zepto's ORDER LIST prints a
    // card per order and labels none of its money:
    //
    //   Order delivered   ₹360   Placed at 20th Sep 2026, 07:45 pm
    //   [Gillette Fusion Manual Shaving Razor For Men]
    //
    // There is no "Total", no "Item total" and no "Subtotal" anywhere on it, so
    // both labelled lookups answer null and the stored row carried no bill at
    // all. With an empty bill theRefundBase cannot work an amount out, the
    // evidence went up with itemAmountAmbiguous, and a refund the shop had
    // already priced sat waiting for a person to type 360 into a panel.
    //
    // EXACTLY ONE PRODUCT, AND NOTHING IS MULTIPLIED OR ADDED UP. Not a sum
    // over several lines — two products at ₹180 each and one at ₹360 are the
    // same total and mean completely different refunds, which is the whole
    // reason a basket's total is never paid from. One product's own stated
    // price is not an inference about a basket; it is that product's price,
    // read off the page, and it is the only shape where the two cannot differ.
    //
    // AND A STATED COUNT ABOVE ONE STILL REFUSES. "2 x" beside the price means
    // the figure may be the line rather than the unit, and the two are not the
    // same money. unitsStated null is a page that said nothing about count,
    // which is every Zepto list card.
    //
    // A LABELLED TOTAL ALWAYS WINS. This only fills a hole; it never overrides
    // a figure the page put a name to.
    itemTotalPaise: moneyForLabels(lines, totalsFrom, ITEM_TOTAL_LABELS)
      ?? theOnlyProductsOwnPrice(bought),
    // FROM THE SAME PLACE AS THE TWO TOTALS, for the same reason written above
    // totalsFrom: inside the bill block when the page has one, and over the
    // whole page when it does not.
    feesPaise: feesTotal(lines, totalsFrom),
    billDiscountPaise: billDiscountTotal(lines, totalsFrom),
    deliveryDate,
    deliveryAt,
    returnWindowEndsDate,
    returned,
    deliveredSaid,
    rated,
    shipments,
    items: bought,
  };
}
