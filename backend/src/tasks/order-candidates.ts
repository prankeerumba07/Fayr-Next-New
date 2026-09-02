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
  order: ParsedOrder,
  item: OrderItemForComparison | null,
): boolean {
  if (item == null) return false;
  if (order.items.length !== 1) return false;
  if (order.shipments > 1) return false;
  if (order.totalPaise == null) return false;
  const price = typeof item.pricePaise === 'bigint'
    ? item.pricePaise
    : BigInt(Math.trunc(item.pricePaise));
  return order.totalPaise === price;
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
