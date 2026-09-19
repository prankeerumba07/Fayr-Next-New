// THE ORDER FAYR WATCHED BEING PLACED — WHAT TO TELL OUR SIDE, AND WHERE TO GO.
//
// ── THE MOMENT THIS IS ABOUT ────────────────────────────────────────────────
//
// MEASURED ON THE OWNER'S OWN ZEPTO PURCHASE, 18 SEPTEMBER 2026: one second
// after he paid, the shop's page inside Fayr moved to /order/status/<uuid>.
// theOrderPlaced.js now reads that uuid out of the address. This file decides
// the two things that happen next, and it decides them without a phone:
//
//   WHAT TO TELL OUR SIDE   the key, once, through the existing untrusted
//                           device-evidence route — the same POST every other
//                           fact the phone reports travels by. Nothing else in
//                           the body, so the engine has nothing to act on.
//   WHERE TO HAND OVER      to Fayr's own task page, which runs the read on
//                           THAT ONE ORDER'S page. Without a key — a shop whose
//                           confirmation carries none — to the read that walks
//                           the list, exactly as Phase 7 left it.
//
// ── WHY THE KEY GOES TO OUR SIDE AT ALL ─────────────────────────────────────
//
// Because three later reads need it — the order, the delivery, the review — and
// a second phone or a reinstall must not lose the one handle Fayr has on the
// purchase it watched. It is a place to look, not a fact about money: no gate
// on our side reads it, and it is never written into the order number's column.
// See tasks/engine/watched-order.ts for the server's half of the same rule.
//
// ── AND IT IS TOLD ONCE ─────────────────────────────────────────────────────
//
// The shop navigates on after a confirmation page — to tracking, to the order's
// own page, back to the confirmation — and a single-page shop can report the
// same address several times. One key is one fact. The screen keeps the keys it
// has already sent and this refuses a repeat; our side keeps the first key it
// hears and ignores a different one, so a repeat that slips past costs nothing.
//
// PURE. No React, no fetch, no clock.

import { AN_ORDER_KEY, PLACED } from './theOrderPlaced.js';

/**
 * THE IDEMPOTENCY KEY'S PREFIX. Our side records the watched key outside the
 * engine, so this key is never applied by transition(); it is here so the body
 * is a well-formed evidence submission and a repeat reads as a repeat in a log.
 */
export const WATCHED_ORDER_KEY_PREFIX = 'watched-order:';

/**
 * WHAT TO TELL OUR SIDE, OR NOTHING.
 *
 * `said`         theOrderPlaced.js's answer for the page. Only PLACED tells.
 * `orderKey`     the key it read out of the address, or null.
 * `alreadyTold`  the keys this screen has already sent, in this sitting.
 *
 * Answers null when there is nothing to tell — not PLACED, no key, a key that
 * is not a key, or a key already sent — and otherwise the one body to POST:
 * the idempotency key and the watched key, and NOTHING the engine reads.
 */
export function whatToTellOurSide({ said, orderKey, alreadyTold } = {}) {
  if (said !== PLACED) return null;
  if (typeof orderKey !== 'string' || !AN_ORDER_KEY.test(orderKey)) return null;
  const told = alreadyTold instanceof Set
    ? alreadyTold
    : new Set(Array.isArray(alreadyTold) ? alreadyTold : []);
  if (told.has(orderKey)) return null;
  return {
    body: {
      key: `${WATCHED_ORDER_KEY_PREFIX}${orderKey}`,
      watchedOrderKey: orderKey,
    },
  };
}

/**
 * WHERE THE SHOP SCREEN HANDS OVER, ONCE AN ORDER HAS BEEN SEEN.
 *
 * WITH A KEY: Fayr's own task page. The owner, in his own words: "Once the
 * payment is done and they come back to the Zepto app [inside Fayr], I want
 * the app to redirect me to the Fayr campaign page." The journey then works
 * its step out from the record, and its step for a claim with a watched key is
 * the read of that one order's page. No note is written: the key on the record
 * is what says an order was seen.
 *
 * WITHOUT A KEY: the read that walks the list, exactly as Phase 7 left it, with
 * the LOOKED_FOR_THE_ORDER note written before the move so a journey that
 * comes straight back knows a read has run. A shop whose confirmation page
 * carries no key has nothing better to offer yet.
 */
export function whereToHandOver({ orderKey } = {}) {
  if (typeof orderKey === 'string' && AN_ORDER_KEY.test(orderKey)) {
    return { to: 'Journey', writesTheLookedNote: false };
  }
  return { to: 'LookingForIt', writesTheLookedNote: true };
}
