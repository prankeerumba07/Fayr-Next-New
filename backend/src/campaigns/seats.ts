import type { Prisma } from '@prisma/client';

/**
 * How many seats a campaign has left, in ONE place.
 *
 * The app shows the design's three campaign states — "1,240 joined", "3 left",
 * "All seats taken" — and the claim endpoint independently refuses with
 * "Campaign is full". Those are one fact read by two audiences: if the screen
 * counted seats differently from the gate, the app would offer a seat the server
 * then refused, which reads to a user as the app lying to them. So the definition
 * of a taken seat lives here and both sides import it.
 */

/**
 * A taken seat is ANY task on the campaign, whatever state it reached.
 *
 * Deliberately not "active" tasks: a seat consumed by someone who bought,
 * reviewed and was refunded is gone for good, and an expired unpurchased claim
 * still has its row. This is the where-clause the claim gate has always used, now
 * named so the response cannot use a different one.
 */
export function CLAIMED_SEATS_WHERE(campaignId: string): Prisma.TaskWhereInput {
  return { campaignId };
}

/**
 * Seats remaining, or null when the campaign is unlimited.
 *
 * Null rather than Infinity or a large number: an unlimited campaign has no
 * seats-left figure to state, and the screen must say nothing rather than
 * something meaningless. Never negative — an operator can lower the slot count
 * after claims exist, and "-2 left" is not a thing to put in front of a user.
 */
export function seatsLeft(
  totalSlots: number | null,
  claimedCount: number,
): number | null {
  if (totalSlots == null) return null;
  return Math.max(0, totalSlots - claimedCount);
}

/**
 * Whether the campaign can take another claim.
 *
 * The boundary is the gate's boundary: it refuses when taken >= totalSlots, so
 * this returns true at exactly the same point. Off by one here would put a live
 * claim button in front of a seat the server has already given away.
 */
export function isFull(
  totalSlots: number | null,
  claimedCount: number,
): boolean {
  if (totalSlots == null) return false;
  return claimedCount >= totalSlots;
}
