/**
 * THE ORDERS THE PHONE FOUND, READ AND JUDGED HERE.
 *
 * THE PHONE LOOKS. THE SERVER JUDGES AND REMEMBERS.
 *
 * The person is signed in to the shop inside Fayr's own web view, and that sign
 * in lives on the device — the design says so itself at
 * fayr-design.browser.jsx:2284. So only the phone can open somebody's list of
 * recent orders, and it does: src/orderhistory.js fetches the list and cuts it
 * into one piece of TEXT per order. That is the whole of the phone's part.
 *
 * EVERYTHING ELSE HAPPENS HERE, and that is the point. The phone sends text. This
 * file reads the text into an order (order-text.ts) and decides whether that
 * order is the campaign's product at the campaign's price (order-comparison.ts).
 * The phone is never asked whether something matched, and the endpoint does not
 * accept an answer if one is offered.
 *
 * WHY IT IS DONE THIS WAY ROUND. Reading the fields on the phone as well would be
 * two copies of one rule, in two languages, both deciding things about somebody's
 * money. They would eventually disagree, and the disagreement would be found by a
 * person whose refund had gone wrong.
 *
 * PURE. No Prisma, no Nest, no clock — the service next door does the talking.
 */

import {
  matchOrderToCampaign,
  type OrderItemForComparison,
  type OrderMatchReason,
} from '../ocr/order-comparison';
import { parseOrderText, type ParsedOrder } from '../ocr/order-text';
import type { EvidenceOrder } from './engine/evidence.types';

/**
 * How many orders back we will look at. The owner's number.
 *
 * THE SERVER HAS ITS OWN COPY OF THE CAP ON PURPOSE. The phone has one too
 * (MOST_RECENT_ORDERS in src/orderhistory.js), and a cap that only the phone
 * enforced would be no cap at all: a phone is something a person controls.
 */
export const MOST_RECENT_ORDERS_ACCEPTED = 20;

/** The longest piece of text one order may be. A page, not a book. */
export const LONGEST_ORDER_TEXT = 20000;

/** What the campaign says the product is and what it costs. */
export interface CampaignFacts {
  productName: string;
  productPricePaise: bigint;
}

/** One order, read and judged, ready to be written down. */
export interface JudgedOrder {
  /** 0 is the newest order on the shop's own list. */
  position: number;
  orderNumber: string | null;
  orderDate: Date | null;
  totalPaise: bigint | null;
  /**
   * The day it ARRIVED, kept apart from the day it was placed.
   *
   * It was being dropped: the order page states it, the reader read it, and
   * there was nowhere on this shape to put it, so it went no further than the
   * parser. It is carried now — read, written down, shown to staff, AND fed into
   * the evidence funnel, which is what moves a task to DELIVERED. That last part
   * was deliberately left undone when this field was added, because it is a
   * state change; it has been asked for since, and the whole point of the
   * product is that a delivery is read rather than tapped.
   */
  deliveryDate: Date | null;
  /**
   * THE LAST INSTANT OF THE DAY THE SHOP SAID ITS OWN RETURN WINDOW CLOSES, or
   * null when the page did not say, or said it without a year.
   *
   * THE END OF THE DAY AND NOT NOON, which is the one thing here that is not
   * obvious and is the difference between holding money and paying it out.
   * dayToDate puts an order date at noon so no time zone can move it, and that
   * is right for a date being COMPARED. This one is a DEADLINE: a window that
   * "closed on 19 June" closed at the END of 19 June, and reading it as midday
   * would release a refund twelve hours early. The end of the day in UTC is
   * later than the end of the same day in India, so what error remains is in the
   * direction that holds.
   */
  returnWindowEndsAt: Date | null;
  /** TRI-STATE, exactly as the page said it. See ParsedOrder.returned. */
  returned: boolean | null;
  shipments: number;
  items: { name: string; pricePaise: bigint }[];
  matches: boolean;
  reason: OrderMatchReason;
  /**
   * The one product this answer is about, when there is one. Not written down as
   * a column: it is the product whose price the evidence will carry, and it is
   * found again from the stored items when the person says the order is theirs.
   */
  matchedItem: OrderItemForComparison | null;
}

/** An order's day as a real date at noon, so no time zone can move it. */
function dayToDate(day: string | null): Date | null {
  if (day == null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 12);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * A DAY'S LAST INSTANT, FOR A DEADLINE. See JudgedOrder.returnWindowEndsAt.
 *
 * Deliberately NOT dayToDate above. The two look interchangeable and are not: a
 * date being compared wants the middle of its day, a date something expires at
 * wants the end of it.
 */
function dayToEndOfDay(day: string | null): Date | null {
  if (day == null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  const ms = Date.UTC(
    Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), 23, 59, 59, 999,
  );
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * IS THIS PRODUCT'S PRICE CERTAIN ENOUGH TO PAY A REFUND ON?
 *
 * Only when the order holds ONE product and the whole bill is exactly that
 * product's price. Then the quantity must be one, so the figure on the screen is
 * what one unit cost and there is nothing to work out.
 *
 * ANY OTHER SHAPE IS LEFT FOR A PERSON. An order with two products, or with a
 * bill larger than the product, might be two of the thing at half the price each,
 * or the thing plus a delivery charge, or the thing bought twice. Guessing is how
 * a refund gets paid on a purchase that never happened at that price, so the
 * amount stays unknown and the existing gate holds it for a staff member. That is
 * the same answer this project already gives for quick commerce orders, and it is
 * the safe direction: a held refund is fixed by a person in a minute, an
 * overpaid one is not fixed at all.
 */
export function itemPriceIsCertain(
  // ONLY THE THREE FIELDS THIS ACTUALLY READS, and the narrowing is deliberate.
  // It took a whole ParsedOrder, so every field added to that shape had to be
  // handed in here as a null — and one caller rebuilding an order from a stored
  // row already had four of them. A price decision has nothing to do with when
  // something was delivered, and the type now says so.
  order: Pick<ParsedOrder, 'totalPaise' | 'shipments' | 'items'>,
  item: OrderItemForComparison | null,
  /**
   * WHAT THE OFFER SAYS THIS PRODUCT COSTS, when the caller knows it.
   *
   * Optional, and absent means "ask the old question only". Every caller that
   * does not have a campaign in hand behaves exactly as it did before.
   */
  expectedPricePaise?: bigint | null,
): boolean {
  if (item == null) return false;
  const price = typeof item.pricePaise === 'bigint'
    ? item.pricePaise
    : BigInt(Math.trunc(item.pricePaise));

  // ── THE SECOND WAY A PRICE CAN BE CERTAIN, AND IT IS NOT A LOOSENING ─────
  //
  // MEASURED ON THE OWNER'S OWN ORDER, 16 SEPTEMBER 2026. One order number, two
  // products, and the shop's page states EACH product's own price beside it:
  //
  //     Lukzer | Heavy-Duty Metal Garment Rack ...     ₹938.00
  //     SR 2 PES ... Bathroom Corner Shelf ...         ₹388.00
  //     Grand Total:                                 ₹1,331.00
  //
  // The rule below this one asks whether the WHOLE BILL is the product's price,
  // which is a way of proving the quantity was one when a page states no price
  // per product. On a page that states one per product it proves nothing and
  // refuses everything: the owner's refund was held for a staff member with
  // ₹938.00 printed twice on the page it was read from.
  //
  // SO THE SECOND QUESTION IS ASKED OF THE PRODUCT INSTEAD OF THE BILL: is the
  // price this page states for THIS product exactly what the offer says the
  // product costs? Exact, to the paise, with no tolerance anywhere — the same
  // equality matchOrderToCampaign already made to decide the order matched at
  // all.
  //
  // ── WHY THIS IS NOT A WEAKER TEST THAN THE ONE BELOW IT ─────────────────
  //
  // Take the three shapes the original comment named, and ask what the page
  // would have to state for each to slip through here:
  //
  //   TWO OF THE THING AT HALF THE PRICE EACH. Then the line states either the
  //     unit price (in which case a refund of one unit's price is right) or the
  //     line total, which is twice the offer's price and fails this equality.
  //   THE THING PLUS A DELIVERY CHARGE. A delivery charge is not on the
  //     product's line; it is its own line on the bill, which is exactly why the
  //     bill is bigger than the product here. This asks the product.
  //   THE THING BOUGHT TWICE. Same as the first, and it fails the same way.
  //
  // In every one of them the product's own line is not the offer's price, so
  // this refuses. What it accepts is the one case the old rule also wanted and
  // could not see: a page that states, in words, that this product cost exactly
  // what the offer said it would.
  //
  // AND IT CANNOT BE REACHED BY GUESSING. The figure is not derived, averaged,
  // apportioned or inferred from a total. It is read off the page and compared
  // for equality with a number the operator set before anybody bought anything.
  //
  // ── AND WHEN AN OFFER PRICE IS KNOWN, THIS IS THE WHOLE ANSWER ──────────
  //
  // It does not fall through to the bill question below on a mismatch, and that
  // is a REFUSAL the old rule did not make. A caller only reaches here after
  // matchOrderToCampaign said the order matched, and matching IS this equality —
  // so a price that is not the offer's price at this point means the two
  // readings disagree, and "the readings about somebody's money disagree" is not
  // a state to resolve by asking an easier question. It fails closed.
  //
  // Caught by its own check: one product, one shipment, a bill exactly equal to
  // the line — every condition the bill question wants — and a line that is
  // twice the offer's price. The old rule called that certain. It is not.
  if (expectedPricePaise != null && expectedPricePaise > 0n) {
    if (price !== expectedPricePaise) return false;

    // ── AND THE BILL STILL HAS A VETO. IT COSTS ₹80 TO LEAVE THIS OUT ──────
    //
    // The equality above says the page's figure for this product is the figure
    // the offer states. It does NOT say that figure was paid. An order-level
    // discount — a promotion, a coupon, a bank offer — is not on the product's
    // line; it comes off the BILL. The owner's own page has exactly that shape,
    // and order-text.ts quotes it:
    //
    //     Total:              ₹1,411.00
    //     Promotion Applied:    -₹80.00
    //     Grand Total:        ₹1,331.00
    //
    // With a campaign listing ₹1,411.00, the line equals the offer, the equality
    // above passes, and the figure would be written as unitPricePaise — which
    // resolveChargedPaise takes OUTRIGHT, never consulting the total. The refund
    // would then be a percentage of ₹1,411.00 when ₹1,331.00 left the account.
    // Measured, by running the real functions: certain=true, basis 141100,
    // needsStaff false, actually charged 133100.
    //
    // THE OLD RULE CAUGHT THIS BY ACCIDENT — `order.totalPaise === price` is
    // false when the total is lower — and dropping it dropped the catch. This is
    // the same shape that was already proven live on the Flipkart heels order,
    // recorded at charged-amount.ts:18: an item figure of ₹367.00 against a total
    // of ₹328.00, where "a ₹39 overpay had it released".
    //
    // AND THE HUMAN PATH ALREADY REFUSES IT. staff-amount.ts turns down a staff
    // member who types a figure above the order total, in its own words: "One
    // item on an order cannot have cost more than the whole order did." A
    // machine path looser than the one a person is held to is not a rule.
    //
    // ONLY THE LOWER DIRECTION REFUSES. A total ABOVE the line is the ordinary
    // multi-product order — the owner's ₹938.00 rack inside a ₹1,331.00 bill —
    // and is exactly what this whole change exists to settle. A total that is
    // ABSENT refuses nothing, because a page that states no bill contradicts
    // nothing; the line is still the offer's own price.
    if (order.totalPaise != null && order.totalPaise < price) return false;
    return true;
  }

  // ── AND THE ORIGINAL QUESTION, UNCHANGED, WHEN NO OFFER PRICE IS KNOWN ──
  //
  // A shop that states no price per product — quick commerce states a basket
  // total and nothing else — can still prove a quantity of one the only way
  // such a page can: one product, one shipment, and a bill that is exactly that
  // product's price.
  if (order.items.length !== 1) return false;
  if (order.shipments > 1) return false;
  if (order.totalPaise == null) return false;
  return order.totalPaise === price;
}

/**
 * WHAT A TASK'S ORDER ALREADY SAYS, CARRIED SO A PARTIAL WRITE CANNOT ERASE IT.
 *
 * ── THE TRAP, AND IT IS NOT OBVIOUS FROM ANY ONE FILE ─────────────────────
 *
 * transition() applies order evidence with
 * `patch.order = preferByAuthority(task.order, e.order)`, and preferByAuthority
 * RETURNS THE INCOMING OBJECT WHOLE. It does not merge field by field. So an
 * evidence fragment that names five fields does not update five fields — it
 * REPLACES the order, and every field it leaves out becomes null.
 *
 * That is correct for a fresh read of a whole page, which is what the shape was
 * designed for. It is a trap for anything that submits a CORRECTION: a writer
 * that only wants to add a price silently deletes the order date, the matched
 * product price, the line id, the match warnings, the product photo and the
 * shop's status line. Measured on this very changeset — settling a price blanked
 * the order date the same changeset had just been written to show.
 *
 * So a corrective writer spreads this first and overrides only what it means to
 * change. Everything here is carried unchanged from what is already on the task.
 *
 * MONEY IS NOT CARRIED, DELIBERATELY. Not itemPaise, not unitPricePaise, not
 * lineTotalPaise, not the quantity and not their sources. A correction to an
 * amount must state the whole amount itself, so that reading the fragment tells
 * you what the task will be worth. Quietly inheriting half of a previous figure
 * is how two readings end up blended into a third that nobody wrote.
 */
export function whatTheOrderAlreadySays(
  order: EvidenceOrder | null | undefined,
): Record<string, unknown> {
  if (order == null) return {};
  const keep: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    if (value != null) keep[key] = value;
  };
  put('id', order.id);
  put('itemId', order.itemId);
  put('itemIdSource', order.itemIdSource);
  put('itemIdReason', order.itemIdReason);
  put('date', order.date);
  put('dateRaw', order.dateRaw);
  put('matchedPricePaise',
    order.matchedPricePaise == null ? null : String(order.matchedPricePaise));
  put('mrpPaise', order.mrpPaise == null ? null : String(order.mrpPaise));
  put('quantityObserved', order.quantityObserved);
  put('match', order.match);
  put('product', order.product);
  put('image', order.image);
  put('statusText', order.statusText);
  if (order.itemAmountAmbiguous === true) keep.itemAmountAmbiguous = true;
  return keep;
}

/**
 * Read and judge every order the phone found, newest first.
 *
 * The shop's own page lists its orders newest first and the phone keeps that
 * order, so position 0 is the newest. Nothing is sorted here: sorting would need
 * a date, and an order whose date could not be read would then move for no
 * reason a person could see.
 */
export function judgeFoundOrders(
  pages: readonly string[] | null | undefined,
  campaign: CampaignFacts,
): JudgedOrder[] {
  const list = Array.isArray(pages) ? pages : [];
  const out: JudgedOrder[] = [];

  for (const raw of list.slice(0, MOST_RECENT_ORDERS_ACCEPTED)) {
    const text = typeof raw === 'string' ? raw.slice(0, LONGEST_ORDER_TEXT) : '';
    const parsed = parseOrderText(text);
    const answer = matchOrderToCampaign(
      { items: parsed.items },
      {
        productName: campaign.productName,
        expectedPricePaise: campaign.productPricePaise,
      },
    );
    out.push({
      position: out.length,
      orderNumber: parsed.orderNumber,
      orderDate: dayToDate(parsed.orderDate),
      totalPaise: parsed.totalPaise,
      // Through the SAME day-to-date converter as the order date, so the two
      // cannot end up on different sides of a time zone.
      deliveryDate: dayToDate(parsed.deliveryDate),
      // AND THROUGH A DIFFERENT ONE, on purpose. See dayToEndOfDay: this is a
      // deadline, not a date being compared.
      returnWindowEndsAt: dayToEndOfDay(parsed.returnWindowEndsDate),
      returned: parsed.returned,
      shipments: parsed.shipments,
      items: parsed.items,
      matches: answer.matches,
      reason: answer.reason,
      matchedItem: answer.item,
    });
  }
  return out;
}

/**
 * WHAT DATE TO PUT ON THE EVIDENCE, WHEN ALL WE READ WAS A DAY.
 *
 * A shop's list of orders prints a DAY. The time somebody has to buy after
 * claiming is measured in MINUTES. So a day is simply not a precise enough
 * reading to test against that window: "21 August" cannot say whether the order
 * was placed at 11:52, which is inside the window, or at 14:30, which is not.
 *
 * The order window rule is not weakened by one word to get round this. It already
 * says, in its own comment, that an unknown date is NOT a failure, because plenty
 * of readers legitimately cannot resolve one. This is one of those readers, so:
 *
 *   THE DAY IS SENT WHEN IT SETTLES THE QUESTION ON ITS OWN. A day that ends
 *   before the window opens, or begins after it closes, cannot be inside the
 *   window whatever the hour was, so the instant is sent and the rule refuses the
 *   order. That is the case the rule exists for: a purchase from last January
 *   dressed up as one caused by the offer.
 *
 *   OTHERWISE IT IS LEFT UNKNOWN. A day that overlaps the window might be inside
 *   it. Asserting an hour we did not read would either refuse every honest
 *   same-day purchase or claim a precision we do not have, and both are worse
 *   than saying we do not know.
 *
 * The day itself is never lost: it goes on the record as written, in `dateRaw`,
 * so a person looking at the task later can see what was read.
 */
export function dateToSubmit(
  orderDate: Date | null,
  window: { floor: number; ceiling: number | null },
): number | null {
  if (orderDate == null) return null;
  const at = orderDate.getTime();
  if (!Number.isFinite(at)) return null;
  const day = new Date(at);
  const start = Date.UTC(
    day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0,
  );
  const end = start + 86_400_000 - 1;

  // The whole day is over before the window opens.
  if (end < window.floor) return end;
  // The whole day begins after the window has closed.
  if (window.ceiling != null && start > window.ceiling) return start;
  // The day overlaps the window, and a day cannot say more than that.
  return null;
}

/** The day as written, for the record. "2026-08-21", or null. */
export function dayAsWritten(orderDate: Date | null): string | null {
  if (orderDate == null || !Number.isFinite(orderDate.getTime())) return null;
  const m = String(orderDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(orderDate.getUTCDate()).padStart(2, '0');
  return `${orderDate.getUTCFullYear()}-${m}-${d}`;
}

/** The items of one judged order, as JSON can hold them. Paise as strings. */
export function itemsToJson(
  items: readonly { name: string; pricePaise: bigint }[],
): { name: string; pricePaise: string }[] {
  return items.map((i) => ({ name: i.name, pricePaise: String(i.pricePaise) }));
}

/**
 * And back again, when a stored order is read. Anything unreadable is dropped.
 *
 * The price comes back as a whole number of paise and never as anything else,
 * which is why the answer is typed more narrowly than the comparison's own item
 * shape: a stored order feeds the parser's shape as well, and that one has no
 * room for a fractional price.
 */
export function itemsFromJson(
  value: unknown,
): { name: string; pricePaise: bigint }[] {
  if (!Array.isArray(value)) return [];
  const out: { name: string; pricePaise: bigint }[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as { name?: unknown; pricePaise?: unknown };
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name === '') continue;
    const price = typeof row.pricePaise === 'string' && /^\d+$/.test(row.pricePaise)
      ? BigInt(row.pricePaise)
      : null;
    if (price == null || price <= 0n) continue;
    out.push({ name, pricePaise: price });
  }
  return out;
}
