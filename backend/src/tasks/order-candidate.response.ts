import { dayInIndiaOf } from '../common/india-clock';
import type { OrderCandidate, OrderCandidateSource } from '@prisma/client';
import { itemsFromJson } from './order-candidates';

/** How a person would say where this order came from. */
const SAID: Record<OrderCandidateSource, string> = {
  ORDER_LIST: 'order-list',
  SCREENSHOT: 'screenshot',
  HAND_TYPED: 'hand-typed',
};

/**
 * ONE ORDER WE ARE ASKING SOMEBODY ABOUT.
 *
 * Money is a string of paise, the way every other figure crosses the wire in this
 * project: a whole number of paise is bigger than a JSON number can be trusted
 * with, and a float is never allowed near money here.
 *
 * `matches` and `reason` are the SERVER'S answer. The phone sent text; this is
 * what Fayr made of it.
 */
export interface OrderCandidateResponse {
  id: string;
  /** 0 is the newest order the shop showed. */
  position: number;
  source: string;
  orderNumber: string | null;
  /** The day it was placed, as "2026-08-21", or null. */
  orderDate: string | null;
  /**
   * The day it ARRIVED, as "2026-06-05", or null. A different date from the one
   * above, and null when the page did not say — including when it said it
   * without a year, which Amazon's own page does.
   */
  deliveryDate: string | null;
  /**
   * THE INSTANT THE SHOP SAID ITS OWN RETURN WINDOW CLOSES, or null.
   *
   * AN INSTANT AND NOT A DAY, unlike the two dates above it, and deliberately
   * so: it is a deadline and the end of the day is part of it. Writing it
   * through the same day() converter would print "2026-06-19" and lose the fact
   * that the window runs to the END of the 19th.
   */
  returnWindowEndsAt: string | null;
  /** TRI-STATE as the page said it: true, false, or null for "it did not say". */
  returned: boolean | null;
  totalPaise: string | null;
  /**
   * WHAT THE CAMPAIGN'S OWN PRODUCT COST ON THIS ORDER, when one of the products
   * on it is the campaign's.
   *
   * ── WHY THE ORDER'S TOTAL IS THE WRONG NUMBER TO SHOW ─────────────────────
   *
   * Measured on the owner's own Amazon order, 15 September 2026. One order
   * number, two products, two delivery dates:
   *
   *   Grand Total  1331 rupees
   *     938        the garment rack the offer is for
   *     388        a bathroom shelf that has nothing to do with it
   *
   * The card showed 1331. The offer pays a share of what the PRODUCT cost, the
   * server already matched on that product's own price, and showing the order's
   * total puts a number on screen that nobody is going to be paid a share of.
   *
   * Null when no product on the order is the campaign's, and null on an order of
   * one product is impossible — it is the same figure either way.
   */
  matchedPricePaise: string | null;
  /** The name of that product, as the SHOP wrote it, not as the offer did. */
  matchedName: string | null;
  items: { name: string; pricePaise: string }[];
  shipments: number;
  matches: boolean;
  /**
   * What happened, always named: matched, product_name_not_found, price_differs,
   * no_products_read, no_campaign_product, no_expected_price. Never simply
   * "no match" — that tells nobody anything.
   */
  reason: string;
  chosenAt: string | null;
}

/** A day as "2026-08-21", from a stored date. */
function day(value: Date | null): string | null {
  if (!value) return null;
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${value.getUTCFullYear()}-${m}-${d}`;
}

export function toOrderCandidateResponse(
  row: OrderCandidate,
): OrderCandidateResponse {
  return {
    id: row.id,
    position: row.position,
    source: SAID[row.source] ?? 'order-list',
    orderNumber: row.orderNumber,
    orderDate: day(row.orderDate),
    // AND IN INDIA'S OWN DAY — Phase 8B-c, 20 September 2026. The column now
    // holds an INSTANT when the shop's page stated the minute, and a parcel that
    // arrived at half past midnight on the 25th falls on the 24th in universal
    // time. What is shown has to be the day the page printed, which is the day
    // the person saw. A day-only reading is untouched, because noon universal is
    // half past five in the evening in India and so the same day either way.
    deliveryDate: dayInIndiaOf(row.deliveryDate),
    // AND NOT THROUGH day(). See the field's own comment: the time of day is the
    // point of this one.
    returnWindowEndsAt:
      row.returnWindowEndsAt ? row.returnWindowEndsAt.toISOString() : null,
    returned: row.returned,
    totalPaise: row.totalPaise == null ? null : String(row.totalPaise),
    // FILLED IN BY THE CALLER THAT KNOWS THE CAMPAIGN. This function is handed a
    // row and nothing else, and which product an offer is for is not on the row.
    matchedPricePaise: null,
    matchedName: null,
    items: itemsFromJson(row.items).map((i) => ({
      name: i.name,
      pricePaise: String(i.pricePaise),
    })),
    shipments: row.shipments,
    matches: row.matches,
    reason: row.reason,
    chosenAt: row.chosenAt ? row.chosenAt.toISOString() : null,
  };
}
