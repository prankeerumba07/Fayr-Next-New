// "WHAT HAS THIS PERSON ALREADY DONE FOR THIS OFFER?"
//
// Three small notes per offer, and they exist for one reason: the first few steps
// of a claim happen entirely on the phone, before the shop has told Fayr anything,
// so there is no record on the server to read yet.
//
//   signin   they said they signed in to the shop
//   buy      they were sent to the shop to buy the product
//   bought   they came back and said they had bought it
//
// It started as ONE note, meaning only "the shop has been opened", and that was
// not enough: opening the shop to sign in and opening it to buy are two different
// things, and treating them as one meant somebody who tapped through to sign in
// was moved on as though they had gone shopping. The notes are separate now.
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

/** The three things a note can say. Anything else is not written. */
export const SIGNED_IN = 'signin';
export const WENT_TO_BUY = 'buy';
export const SAID_THEY_BOUGHT = 'bought';
const REASONS = [SIGNED_IN, WENT_TO_BUY, SAID_THEY_BOUGHT];

let visited = null; // null = not read yet

function file() {
  return new File(Paths.document, FILE);
}

/** One note's own name in the file: the offer and what was done. */
function noteName(campaignId, why) {
  return `${campaignId}::${why}`;
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
    // A note we cannot read means it did not happen. Showing "connect your shop"
    // once more is the harmless direction to fail in.
  }
  return visited;
}

function save(set) {
  try {
    const f = file();
    f.create({ overwrite: true });
    f.write(JSON.stringify([...set]));
  } catch (e) {
    /* best-effort: a note is a convenience, never a decision about money */
  }
}

/**
 * Has this been done for this offer?
 *
 * `why` is one of the three above. Left out, it means what the single note used to
 * mean — the shop has been opened at all, for any reason — so nothing that already
 * asked this question got a different answer when the notes were split.
 */
export function hasVisitedShop(campaignId, why) {
  if (typeof campaignId !== 'string' || campaignId === '') return false;
  const set = read();
  if (why == null) {
    // Old notes were written as the bare offer id, so they still count here.
    return set.has(campaignId)
      || REASONS.some((r) => set.has(noteName(campaignId, r)));
  }
  if (!REASONS.includes(why)) return false;
  return set.has(noteName(campaignId, why));
}

/** Note that this has been done for this offer. An unknown reason writes nothing. */
export function markVisitedShop(campaignId, why) {
  if (typeof campaignId !== 'string' || campaignId === '') return;
  const reason = why == null ? SIGNED_IN : why;
  if (!REASONS.includes(reason)) return;
  const set = read();
  const name = noteName(campaignId, reason);
  if (set.has(name)) return;
  set.add(name);
  save(set);
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
