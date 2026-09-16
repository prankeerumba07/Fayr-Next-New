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

// WHICH CLAIM A NOTE IS ABOUT. Asked of the task store rather than taken as an
// argument, so every caller is correct without any of them having to remember —
// see noteName for the run that made this necessary. No cycle: the task store
// does not know this file exists.
import { getTaskId } from '../taskStore';

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

/**
 * ONE NOTE'S OWN NAME: THE CLAIM IT IS ABOUT, AND WHAT WAS DONE.
 *
 * ── IT USED TO BE THE OFFER, AND THAT IS A BUG THAT HIDES THE WHOLE APP ───
 *
 * MEASURED ON THE OWNER'S PHONE, 16 September 2026, 22:18. He had tested this
 * same offer an hour earlier and tapped "yes, I bought it", which wrote
 * `<campaign>::bought`. That claim was then deleted and he claimed the offer
 * again. The new task was CLAIMED, with no order and no shop visit — and the
 * note was still there, because it was filed under the OFFER and the offer had
 * not changed.
 *
 * journeyStepFor reads these three notes for exactly the steps that happen
 * before the server has anything to say, and the first thing it asks is
 * `saidTheyBought`. So a brand new claim went straight to "show us a
 * screenshot": no "before you go", no shop, no "did you buy it", and THE ORDER
 * READ NEVER RAN AT ALL. His backend log for that claim is one POST /tasks and
 * then silence.
 *
 * It reads as "the fetch is broken". Nothing fetched anything. The screen that
 * fetches was never reached.
 *
 * ── AND IT IS NOT ONLY A TESTING PROBLEM ──────────────────────────────────
 *
 * Any second claim of the same offer hits it: a claim that ran out and was
 * swept, an offer somebody left and came back to. The notes are about a
 * PURCHASE, and when the claim they were written under is gone, the purchase
 * they describe is gone with it.
 *
 * ── SO THEY ARE FILED UNDER THE CLAIM ─────────────────────────────────────
 *
 * A new task is a new claim, so its notes start empty, which is the truth. The
 * old claim's notes are still in the file under its own id and answer nothing.
 *
 * WITH NO TASK, THE OFFER'S OWN NAME IS USED, unchanged from before. The first
 * of these — signing in to the shop — really can be written before a claim
 * exists, and losing it costs one page: this file's own note above says so.
 */
function noteName(campaignId, why) {
  const taskId = getTaskId(campaignId);
  return taskId ? `${campaignId}::${taskId}::${why}` : `${campaignId}::${why}`;
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
