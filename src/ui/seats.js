// What the app says about how full a campaign is — and when it says nothing.
//
// The server now sends `claimedCount` and `seatsLeft` on every campaign, both
// counted from real tasks through the same definition the claim gate uses. This
// file is only the WORDS. It does no arithmetic on them: subtracting here would
// be a second definition of a remaining seat, and the screen would end up
// offering a seat the server refuses.
//
// Pure module, no RN imports, so it is testable under node (same reason as
// stages.js and confirmJoin.js).

import { groupIndian } from './theme.js'; // explicit extension: also run under node

/**
 * "3 slots left", "All seats taken", or NULL when there is nothing true to say.
 *
 * The design's own words — `👥 {n} slots left` on a card and "All seats taken"
 * when it is full. Not "X of Y seats left": the design never shows the total
 * beside the remainder, and a number nobody asked for is a number to get wrong.
 *
 * Null in two cases, and they are different:
 *   - the campaign has NO limit, so there is no remainder to state;
 *   - the server did not send one, so we do not know.
 * Both mean silence. A screen that says "0 slots left" because a field was
 * missing has told the user the offer is closed when it is wide open.
 */
export function seatsLine(campaign) {
  const left = campaign == null ? null : campaign.seatsLeft;
  if (!Number.isInteger(left)) return null;
  if (left <= 0) return 'All seats taken';
  return `${groupIndian(left)} slots left`;
}

/** True only when the server actually said the campaign is full. */
export function isFullCampaign(campaign) {
  const left = campaign == null ? null : campaign.seatsLeft;
  return Number.isInteger(left) && left <= 0;
}

/**
 * A FULL OFFER IS LOCKED, NOT GONE — THE WORDS. Added 18 September 2026.
 *
 * ── WHAT THE OWNER ASKED FOR, IN HIS OWN WORDS ─────────────────────────────
 *
 * "The total slots will be 1, so I want to see what happens if the slot gets
 * fulfilled completely. I don't want the campaign to go away or vanish from the
 * app once the slot is full. I need something that should show the user that the
 * campaign has been locked. It was active, now the slots are full, so it has
 * been locked, and it will come back soon."
 *
 * ── NOTHING VANISHED, AND NOTHING NEEDED BUILDING TO STOP IT ───────────────
 *
 * The backend's listActive filters on `status: 'ACTIVE'` and on nothing else —
 * never on seats — so a full offer has always stayed in the feed. This is
 * PRESENTATION, and it is written here rather than as machinery because there
 * was no plumbing problem to solve.
 *
 * ── WHY "FULL" WAS THE WRONG WORD ──────────────────────────────────────────
 *
 * The card used to say "Full", which reads as a dead end: a thing that happened
 * and is over. What is true is three things, and the wording below carries all
 * three because any one of them alone misleads —
 *
 *   IT WAS OPEN      so somebody who saw it yesterday is not imagining it;
 *   IT IS FULL NOW   which is why they cannot take it;
 *   IT COMES BACK    which is the part "Full" threw away.
 *
 * AND IT PROMISES NO TIME. "Soon" is the owner's word for it and it is not in
 * these sentences, because nobody knows when a slot frees: it happens when a
 * claim closes or an operator raises the cap, and neither is on a clock. Saying
 * "nobody can say when" is the honest version of the same reassurance and it
 * cannot come back as a broken promise.
 *
 * ── AND "LOCKED" IS NOT "PAUSED" AND NOT "NOT RIGHT NOW" ──────────────────
 *
 * Three different facts, and the app must not let them collide:
 *
 *   PAUSED          an operator stopped it. It is not ACTIVE, so listActive
 *                   never sends it and it is not in the feed AT ALL. There is no
 *                   wording for it here because there is nothing to draw.
 *   NOT RIGHT NOW   the SHOP'S own page is dead — expired, sold out, gone. That
 *                   is src/livecheck.js's `cardState`, its label comes from the
 *                   server, and it OUTRANKS this one: a locked offer whose shop
 *                   page has also died reads as the shop's problem, because that
 *                   is the one a slot opening up would not fix.
 *   LOCKED          this. The offer is alive and its seats are spoken for.
 */

/** The tile's banner, across the top of the card. It carries "full now". */
export const LOCKED_BANNER = 'Locked — every slot is taken';

/** The tile's call to action, in place of "Claim →". It is not an invitation. */
export const LOCKED_CTA = 'Locked';

/**
 * The tile's footer line, in place of "All seats taken". It carries "comes back".
 *
 * Null for an offer that is not full, so a caller cannot draw it by accident —
 * the same shape as every other answer in this file.
 */
export function lockedLine(campaign) {
  if (!isFullCampaign(campaign)) return null;
  return 'Comes back when a slot opens';
}

/**
 * The detail screen's two sentences, which carry all three things in the owner's
 * own order. An array, because they are two paragraphs and not one long line.
 *
 * Null for an offer that is not full.
 */
export function lockedReason(campaign) {
  if (!isFullCampaign(campaign)) return null;
  return [
    'This offer was open and every slot is now taken, so it is locked.',
    'It has not ended. It comes back when a slot opens up, and nobody can say '
    + 'when that will be.',
  ];
}

/**
 * "1,240 joined", or NULL.
 *
 * Zero is deliberately NOT shown. The design shows "1,240 joined"; it never shows
 * "0 joined", which reads as an empty room rather than a new offer — and a new
 * offer is exactly when it would appear. Absent for the same reason every other
 * missing figure is absent.
 *
 * Grouped with groupIndian, not toLocaleString: Hermes ships only part of Intl,
 * so the locale call is unreliable on device. theme.js already solved this.
 */
export function joinedLine(campaign) {
  const n = campaign == null ? null : campaign.claimedCount;
  if (!Number.isInteger(n) || n <= 0) return null;
  return `${groupIndian(n)} joined`;
}
