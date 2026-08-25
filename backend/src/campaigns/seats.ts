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
export const SEAT_TAKEN_BY: Prisma.TaskWhereInput = {
  // Intentionally empty: no condition beyond "a task exists on this campaign".
  // It is a named constant rather than nothing so that the day a seat stops being
  // unconditional — expired claims released back, say — there is exactly ONE
  // place to say so, and every count picks it up together. Spelling the condition
  // out twice is how the screen and the gate come to disagree.
};

export function CLAIMED_SEATS_WHERE(campaignId: string): Prisma.TaskWhereInput {
  return { campaignId, ...SEAT_TAKEN_BY };
}

/** The same predicate, for many campaigns at once. */
export function CLAIMED_SEATS_WHERE_MANY(
  campaignIds: string[],
): Prisma.TaskWhereInput {
  return { campaignId: { in: campaignIds }, ...SEAT_TAKEN_BY };
}

/** Just enough of a Prisma client to count tasks — so this is unit-testable. */
export interface SeatCountingDb {
  task: {
    // Method syntax, not an arrow property: TypeScript checks method parameters
    // bivariantly, which is what lets Prisma's heavily overloaded groupBy satisfy
    // this narrow shape. As an arrow property the real client is not assignable
    // and every production call site would need a cast — which would defeat the
    // point of naming the shape at all.
    groupBy(args: {
      by: ['campaignId'];
      where: Prisma.TaskWhereInput;
      _count: { _all: true };
    }): Promise<{ campaignId: string; _count: { _all: number } }[]>;
  };
}

/**
 * Seats taken, per campaign, in ONE query.
 *
 * Deliberately not Prisma's `_count: { select: { tasks: true } }` on the campaign
 * include, which would have been shorter. That helper counts every related task
 * by definition and cannot be told about SEAT_TAKEN_BY — so the feed and the claim
 * gate would have been two expressions of one rule, agreeing today and diverging
 * the first time the rule changed. This goes through the same predicate the gate
 * uses.
 *
 * A campaign with no claims is ABSENT from the result, not zero: groupBy returns
 * only groups that exist. Callers read through `claimedFor` below rather than
 * indexing the map, so absence and zero cannot be confused.
 */
export async function claimedSeatsByCampaign(
  db: SeatCountingDb,
  campaignIds: string[],
): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await db.task.groupBy({
    by: ['campaignId'],
    where: CLAIMED_SEATS_WHERE_MANY(campaignIds),
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.campaignId, r._count._all]));
}

/** Seats taken for one campaign, reading 0 for a campaign nobody has claimed. */
export function claimedFor(
  counts: Map<string, number>,
  campaignId: string,
): number {
  return counts.get(campaignId) ?? 0;
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
