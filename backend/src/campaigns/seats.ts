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
 * A taken seat is any task on the campaign EXCEPT a claim that was released
 * without ever buying anything.
 *
 * ── THE DAY THIS STOPPED BEING UNCONDITIONAL: 18 SEPTEMBER 2026 ────────────
 *
 * Until then this was deliberately empty — "a taken seat is ANY task on the
 * campaign, whatever state it reached" — and its own note said why and said
 * what would change it: "the day a seat stops being unconditional — expired
 * claims released back, say — there is exactly ONE place to say so." This is
 * that day, and this is the one place.
 *
 * MEASURED ON THE OWNER'S OWN ACCOUNT. He made a one-slot campaign, claimed it,
 * and released the claim. ./free-claims said the five tickets came back and
 * "Every seat on this one is taken, so it is free and still shut." The tickets
 * came back; the seat did not. A one-slot offer was therefore dead for good the
 * first time anybody claimed it and let it lapse — nobody could ever claim it
 * again, and it sat in the feed locked for ever.
 *
 * ── THE RULE, IN HIS WORDS ─────────────────────────────────────────────────
 *
 * "A claim that has been RELEASED — closed with its tickets returned, and never
 * purchased — holds no seat. A claim that was PURCHASED still holds one, for
 * ever, because that seat really was used. Those two must not be confused."
 *
 * "DO NOT WIDEN IT FURTHER THAN THAT. A claim still running holds a seat. A
 * claim that reached a purchase holds a seat. Only the released-without-buying
 * case frees."
 *
 * ── SO THE CONDITION IS WRITTEN AS THE ONE EXCEPTION, NOT AS A LIST ────────
 *
 * Taken means NOT (released without a purchase), and "released without a
 * purchase" is three facts that must ALL hold:
 *
 *   closedAt is set    the claim is over — expiry, or ./free-claims, which runs
 *                      the same expireClaim and writes the same row
 *   state is CLAIMED   it never moved on. PURCHASED, DELIVERED, REVIEWED,
 *                      HOLDING and REFUNDED all mean the seat was really used
 *   orderId is null    no order was ever matched to it. A CLAIMED claim that has
 *                      an order on it but was never confirmed is the ambiguous
 *                      case, and the rule says do not widen — so it keeps its
 *                      seat
 *
 * A claim that is still OPEN fails the first fact and keeps its seat. A claim
 * that reached a purchase fails the second and keeps it for ever, closed or not.
 * Written as one NOT over one conjunction so that the exception cannot grow a
 * clause without the whole condition changing, and so the gate and the feed —
 * both of which import this — cannot read it differently.
 *
 * ── AND THE SECOND SHAPE THAT FREES: 21 SEPTEMBER 2026 ─────────────────────
 *
 * MEASURED, AGAIN ON THE OWNER'S OWN ACCOUNT. He claimed the one slot on the
 * Cadbury offer, signed in to the shop, bought the product — and the order was
 * cancelled before it arrived. The seat stayed taken for ever, because the task
 * had an order on it and had moved past CLAIMED: both of the facts above that
 * keep a seat.
 *
 * ── THE RULE, IN HIS WORDS ────────────────────────────────────────────────
 *
 * "The user has completed every step from their side... the user should be
 * allowed to complete the campaign again. They should have to claim the
 * campaign again and accept the terms and conditions again, but only if there
 * is still a slot available. If there are no slots left, the user should see a
 * message saying that the slot is closed and the campaign is no longer active."
 *
 * So the seat a cancelled order was holding goes back into the pool. It is a
 * seat that was paid for with a purchase, but it is a seat nothing can ever be
 * finished from: `returned === true` fails refundEligibility for ever, and the
 * task is closed.
 *
 * ── AND IT IS A SECOND SHAPE, NOT A FOURTH CLAUSE ─────────────────────────
 *
 * Widening the conjunction above would have changed what the FIRST rule means.
 * These are two different things a closed task can be, so they are written as
 * two rows under one NOT — Prisma reads an array there as "none of these" —
 * and either one on its own frees the seat.
 *
 * THE CLOSE REASON IS THE WHOLE TEST, and it is written by exactly one place:
 * letGoBecauseTheOrderWentBack in task.service.ts, which fires only on
 * `task.returned === true`. Reading `returned` here instead would have freed
 * the seat the moment the shop said the word, before anything had closed the
 * task — a live claim with a seat already given away to somebody else.
 */
/**
 * A TASK THE SHOP SENT BACK, IN ONE PLACE.
 *
 * Two rules read this and they must read the same thing: the seat rule below —
 * the seat goes back into the pool — and the claim gate in task.service.ts,
 * which otherwise answers "You've already completed this campaign" for ever to
 * the one person who ought to be allowed to try again. A cancelled order that
 * freed its seat but still barred its own buyer would be the worst of both.
 *
 * BOTH FACTS, NEVER ONE. `closeReason` alone would be enough today, because only
 * letGoBecauseTheOrderWentBack writes it and it always writes `closedAt` in the
 * same update. Asking for both keeps that true by construction rather than by
 * remembering, and says what this is: a task that is OVER, and over for this
 * reason.
 */
export const THE_ORDER_WENT_BACK: Prisma.TaskWhereInput = {
  closedAt: { not: null },
  closeReason: 'returned',
};

export const SEAT_TAKEN_BY: Prisma.TaskWhereInput = {
  NOT: [
    {
      closedAt: { not: null },
      state: 'CLAIMED',
      orderId: null,
    },
    THE_ORDER_WENT_BACK,
  ],
};

/**
 * THE SAME RULE, ASKED OF ONE ROW IN MEMORY, for checks and for the sentence
 * ./free-claims prints. It has to give the same answer as the where-clause
 * above for every shape of row, and seats.spec.ts walks both against the same
 * rows to make sure it does. Neither is derived from the other: the where-clause
 * is what the database runs and this is what a test can read, and a drift
 * between them would be caught rather than hidden.
 */
export function seatIsTakenBy(row: {
  closedAt: Date | null;
  state: string;
  orderId: string | null;
  // REQUIRED, not optional. An optional field is one a caller can forget to
  // select, and a forgotten closeReason reads as undefined — which would answer
  // "still taken" on every returned order and free nothing, silently. Naming it
  // here makes the query that feeds this fail to compile instead.
  closeReason: string | null;
}): boolean {
  const releasedWithoutBuying =
    row.closedAt != null && row.state === 'CLAIMED' && row.orderId == null;
  const theOrderWentBack =
    row.closedAt != null && row.closeReason === 'returned';
  return !releasedWithoutBuying && !theOrderWentBack;
}

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
