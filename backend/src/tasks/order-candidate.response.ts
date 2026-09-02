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
  totalPaise: string | null;
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
    totalPaise: row.totalPaise == null ? null : String(row.totalPaise),
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
