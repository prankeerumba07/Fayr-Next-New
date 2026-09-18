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

// THE NAMING RULE ITSELF, in a file that can be opened under node. This one
// cannot: expo-file-system and the task store are both above. See
// src/journey/noteNames.js for the run that made a note belong to a claim.
import { noteNameFor } from './noteNames.js';

const FILE = 'fayr-shop-visits.json';

/** The three things a note can say. Anything else is not written. */
export const SIGNED_IN = 'signin';
export const WENT_TO_BUY = 'buy';
export const SAID_THEY_BOUGHT = 'bought';
/**
 * ── AND THREE MORE FOR THE REVIEW HALF, ADDED 17 SEPTEMBER 2026 ───────────
 *
 *   review       they were sent to the shop to write the review
 *   reviewwait   they have been told the shop takes 48 to 72 hours
 *   sawarrived   this phone has shown the "Product delivered." moment
 *
 * ── THE FIRST ONE IS ALSO ON THE RECORD, AND THAT IS NOT A DUPLICATE ──────
 *
 * REVIEW-FLOW-PROMPT.md step fourteen asks for the review visit on the record in
 * those words: "the backend must know they left for the review ... It belongs on
 * the record, not only on the phone." So tasks.wentToReviewAt is the answer and
 * this note is not read by anything that decides a screen. It is kept for the
 * same reason WENT_TO_BUY is kept beside wentToShopAt: our side may be a moment
 * behind, and the note is written before the request goes out.
 *
 * THE OTHER TWO ARE ABOUT WHAT THIS PHONE HAS ALREADY SHOWN, which is not a fact
 * about the claim at all and has no business on the record. Losing either costs
 * one repeated sentence, and nothing about anybody's money.
 */
export const WENT_TO_REVIEW = 'review';
export const TOLD_ABOUT_THE_REVIEW_WAIT = 'reviewwait';
export const SAW_IT_ARRIVED = 'sawarrived';
/**
 * ── AND ONE MORE: THEY ANSWERED "YES, IT ARRIVED" ─────────────────────────
 *
 * NOT THE SAME NOTE AS SAW_IT_ARRIVED, and the difference is the whole point.
 * That one says this phone has PLAYED the celebration; this one says the person
 * ANSWERED the question. One is about what was shown, the other about what was
 * asked, and collapsing them would mean the question is skipped by a phone that
 * had merely drawn something.
 *
 * WHY A NOTE AND NOT A COLUMN. Because it settles nothing. The delivery itself
 * is the shop's word, read off the shop's own page, and this tap neither makes
 * it true nor makes it false — it cannot reach anything that decides money. It
 * only says whether this person has been asked yet. Losing it costs one repeated
 * question and nothing else, which is exactly the bar the two notes above it
 * are held to.
 */
export const SAID_IT_ARRIVED = 'saidarrived';
/**
 * ── AND ONE FOR THE SHOP INSIDE FAYR: THE ORDER READ HAS RUN ──────────────
 *
 * Added 18 September 2026 with Phase 7, which takes "Did you buy it?" off the
 * journey for a shop that is shopped inside Fayr. For those shops nobody says
 * they bought anything: the read runs by itself, when the shop's page looks like
 * an order was placed and when they leave the shop. This note is written the
 * moment the read is handed to, and it answers one question for the router —
 * has a read run for this claim at all?
 *
 * WHY IT IS ITS OWN NOTE AND NOT SAID_THEY_BOUGHT. That one is a person's word.
 * This one is a thing Fayr did. The router treats them alike — both mean "the
 * next honest offer is the screenshot fallback" once the record still shows no
 * order — but writing Fayr's action under a name that says "they said" would
 * put words in somebody's mouth on the record.
 *
 * AND "WE HAVE NOT LOOKED YET" IS NOT A FAILURE, which is exactly why the note
 * exists: without it the router could not tell a claim whose read found nothing
 * from a claim whose read has never run, and would offer a screenshot to somebody
 * who has not even been shopping.
 */
export const LOOKED_FOR_THE_ORDER = 'looked';
const REASONS = [
  SIGNED_IN, WENT_TO_BUY, SAID_THEY_BOUGHT,
  WENT_TO_REVIEW, TOLD_ABOUT_THE_REVIEW_WAIT, SAW_IT_ARRIVED, SAID_IT_ARRIVED,
  LOOKED_FOR_THE_ORDER,
];

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
  return noteNameFor(campaignId, getTaskId(campaignId), why);
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
  const name = noteName(campaignId, why);
  // NO NAME MEANS NO NOTE. noteNameFor refuses to invent one rather than
  // returning a name with a hole in it, and a hole would be one note shared by
  // every offer on the phone.
  return name != null && set.has(name);
}

/** Note that this has been done for this offer. An unknown reason writes nothing. */
export function markVisitedShop(campaignId, why) {
  if (typeof campaignId !== 'string' || campaignId === '') return;
  const reason = why == null ? SIGNED_IN : why;
  if (!REASONS.includes(reason)) return;
  const set = read();
  const name = noteName(campaignId, reason);
  if (name == null) return;
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
