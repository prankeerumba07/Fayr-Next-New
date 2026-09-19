// WHICH READ: THE ONE ORDER FAYR WATCHED, OR THE LIST. THE DECISION ONLY.
//
// ── THE RUN THIS COMES FROM ─────────────────────────────────────────────────
//
// The owner's own Zepto purchase, 18 September 2026. The web view saw the order
// one second after payment, and the read that followed opened the LIST:
//
//   [fayr-look] list rows=8/0  numbers linked=7 opening=7 how=link
//   orders-found judged=6 matched=0 reasons=[product_name_not_found x6]
//
// Six OLD orders — noodles, eggs, pasta, a razor, oil — and not the one he had
// just placed, whose page was a live tracking page the reader does not yet
// know. Seventeen minutes later the same read found it at once:
//
//   19:55:22  orders-found judged=1 matched=1 reasons=[matched]
//
// So the readers in src/order/ are RIGHT. They were pointed at the wrong thing.
// And the delivery read that followed opened NOTHING:
//
//   19:55:31  [fayr-look] numbers linked=8 opening=0 named=true
//
// because it was handed the order NUMBER the page prints (JKLIKGSNS48449) as
// the thing to open, and a Zepto page is addressed by the UUID in its link. It
// refused to build an address out of the wrong identifier, which was right, and
// so it read nothing, which was the bug.
//
// ── SO THE READ IS POINTED AT THE WATCHED ORDER'S OWN PAGE ──────────────────
//
// With a watched key on the record there is exactly one page to read, and it is
// built the way the review step already builds it: the measured shape from
// detailLook.js with the key in the middle, by theOrderPage. No search, no
// list, no "Load More". The text goes to the server exactly as before and the
// server decides exactly as before.
//
// ── AND A PAGE THAT CANNOT BE READ YET IS NOT A FAILURE ─────────────────────
//
// The order exists and has not settled. The right answer is to look again on
// the cadence, and NEVER to fall back to the list because of it — that
// fallback is what read six strangers. The screen hands back to the journey,
// which shows the wait and looks again.
//
// PURE. No React, no fetch, no clock. The screen asks and does.

import { theOrderPage } from '../shop/theOrderPage.js';

/** The three answers to "where does this look go?" */
export const ONE_PAGE = 'one-page';
export const THE_LIST = 'the-list';
export const NOWHERE = 'nowhere';

/**
 * THE WATCHED ORDER'S KEY, OFF THE RECORD, or null.
 *
 * Read off the server's task response and nothing on the phone: a reinstall or
 * a second phone must land on the same page. Trimmed, and an empty string is
 * no key. Nothing here checks the key's shape — theOrderPage refuses anything
 * that cannot be part of an address, and that is the one place that rule lives.
 */
export function theWatchedOrderKey(task) {
  const t = task && typeof task === 'object' ? task : null;
  if (!t) return null;
  const key = typeof t.watchedOrderKey === 'string' ? t.watchedOrderKey.trim() : '';
  return key === '' ? null : key;
}

/**
 * HOW THIS LOOK IS TO BE DONE.
 *
 * `watchedOrderKey`  the key off the record, or null.
 * `shape`            how this shop names an order's page, from detailLook.js's
 *                    howThisShopNamesAnOrder, or null for a shop whose pages
 *                    are not read one at a time.
 *
 * Answers one of:
 *
 *   { path: ONE_PAGE, url }   a watched key and a measured shape: read that one
 *                             page and nothing else
 *   { path: THE_LIST }        no watched key: the search-then-list read exactly
 *                             as it has always run
 *   { path: NOWHERE }         a watched key but no page can be built from it —
 *                             a shop with no measured shape, or a key that is
 *                             not an address part. Read nothing and hand back,
 *                             because the LIST is never the answer to "we know
 *                             which order it is"
 */
export function howToLook({ watchedOrderKey, shape } = {}) {
  const key = typeof watchedOrderKey === 'string' ? watchedOrderKey.trim() : '';
  if (key === '') return { path: THE_LIST, url: null };
  const url = theOrderPage(shape, key);
  if (url == null) return { path: NOWHERE, url: null };
  return { path: ONE_PAGE, url };
}
