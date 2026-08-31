// "HAS THIS PERSON BEEN TO THE SHOP FOR THIS OFFER YET?"
//
// One small note per offer, and it exists for one reason: connecting the shop
// account and buying the product are two different pages, and the app has one
// way to open the shop for both.
//
// WHY IT IS NOT READ OFF THE SHOP. Whether somebody is signed in to Amazon is
// not something this app can see. The cookies that say so are hidden from
// anything running in the page, deliberately and on every one of the six shops,
// so any check would be a guess dressed up as a fact.
//
// AND WHY THIS IS NOT THE THING THAT DECIDES THE PAGE. It is not. The page comes
// from the server's record of the task, and everything from "bought" onwards
// ignores this file completely. This only separates the first two pages, before
// there is any record to read — so losing it can put somebody back on "connect
// your shop", which is one page, and never back to the beginning.
//
// The same file-in-the-documents-folder the task store already uses. No new
// dependency, and nothing here is worth the keychain: it is not a secret, it is
// a note about which button somebody has already pressed.

import { File, Paths } from 'expo-file-system';

const FILE = 'fayr-shop-visits.json';

let visited = null; // null = not read yet

function file() {
  return new File(Paths.document, FILE);
}

function read() {
  if (visited !== null) return visited;
  visited = new Set();
  try {
    const f = file();
    if (f.exists) {
      const parsed = JSON.parse(f.textSync());
      if (Array.isArray(parsed)) {
        for (const id of parsed) if (typeof id === 'string') visited.add(id);
      }
    }
  } catch (e) {
    // A note we cannot read means we have not been. Showing "connect your shop"
    // once more is the harmless direction to fail in.
  }
  return visited;
}

/** Has the shop been opened for this offer? */
export function hasVisitedShop(campaignId) {
  if (typeof campaignId !== 'string' || campaignId === '') return false;
  return read().has(campaignId);
}

/** Note that the shop has been opened for this offer. */
export function markVisitedShop(campaignId) {
  if (typeof campaignId !== 'string' || campaignId === '') return;
  const set = read();
  if (set.has(campaignId)) return;
  set.add(campaignId);
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify([...set]));
  } catch (e) {
    /* best-effort: the note is a convenience, never a decision about money */
  }
}

/** Dev and testing: forget every note. */
export function forgetShopVisits() {
  visited = new Set();
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch (e) {
    /* nothing to undo */
  }
}
