import type { Campaign, CampaignStatus, Platform } from '@prisma/client';
import { seatsLeft } from './seats';

/**
 * The public shape of a campaign. Money is integer paise, but JSON cannot carry
 * a BigInt — so paise fields cross the wire as decimal STRINGS (never a float,
 * never a lossy JS number). The client parses them back to integer paise.
 */
export interface CampaignResponse {
  id: string;
  platform: Platform;
  status: CampaignStatus;
  title: string;
  productName: string;
  category: string | null;
  /** Per-campaign Terms & Conditions (free text, one rule per line), or null. */
  terms: string | null;
  /** Expected product price, integer paise as a string (e.g. "129900"). */
  productPricePaise: string;
  payoutPercent: number;
  /** Optional payout ceiling, integer paise as a string, or null. */
  payoutCapPaise: string | null;
  ticketCost: number;
  returnWindowDays: number | null;
  minRating: number | null;
  totalSlots: number | null;
  /**
   * How many days the buyer has to purchase after claiming, before the claim
   * expires and their tickets come back. The operator's CLAIM_TTL_DAYS setting,
   * passed in — see toCampaignResponse for why it is not read here.
   */
  claimWindowDays: number;
  /**
   * How many people have taken a seat on this campaign, counted from real tasks
   * every time this is built — never a stored counter, which drifts the moment a
   * claim is created or expired by any path that forgets to update it.
   *
   * ZERO IS A REAL ANSWER AND MEANS "SAY NOTHING". The design shows "1,240
   * joined"; it does not show "0 joined", which reads as an empty room rather than
   * a new offer. The app suppresses it, the same way it suppresses every other
   * figure it does not have.
   */
  claimedCount: number;
  /**
   * Seats remaining, or null when the campaign has no limit — computed here by
   * the same function the claim gate uses, so the screen cannot offer a seat the
   * server would refuse. Never negative: an operator can lower the slot count
   * after claims exist.
   *
   * 0 IS the full state. Proven equivalent to isFull() at every boundary in
   * seats.spec.ts, so the app can read "All seats taken" off this one number
   * instead of doing its own arithmetic.
   */
  seatsLeft: number | null;
  asin: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything this mapper cannot read off the Campaign row.
 *
 * AN OBJECT, NOT POSITIONAL ARGUMENTS, and that is the whole point.
 *
 * `claimWindowDays` used to be a second positional parameter, and making it
 * required did not protect it: `rows.map(toCampaignResponse)` still COMPILED,
 * because Array.map calls back with (item, index, array) — so the first campaign
 * silently reported a 0-day deadline, the second 1 day, and nothing failed. That
 * was the eighth instance of one-number-two-routes found in this codebase, and it
 * was caught by a source-grep test rather than by the compiler.
 *
 * Adding a third positional parameter would have doubled the surface of the same
 * trap. An options object closes it instead: an array index is not assignable to
 * this type, so the bare form is now a TYPE ERROR rather than a wrong number on a
 * screen. campaign.response.spec.ts pins that with @ts-expect-error, which fails
 * the build if the bare form ever type-checks again.
 *
 * Neither field has a default. Both are policy or fact owned elsewhere — the
 * operator's CLAIM_TTL_DAYS, which the claim itself uses to compute
 * claimExpiresAt, and a live count of tasks. A fallback for either would be a
 * second number claiming to be the same thing.
 */
export interface CampaignResponseContext {
  claimWindowDays: number;
  claimedCount: number;
}

/** Map a Campaign row to its public response (BigInt→string, Date→ISO). */
export function toCampaignResponse(
  c: Campaign,
  ctx: CampaignResponseContext,
): CampaignResponse {
  return {
    id: c.id,
    platform: c.platform,
    status: c.status,
    title: c.title,
    productName: c.productName,
    category: c.category,
    terms: c.terms,
    productPricePaise: c.productPricePaise.toString(),
    payoutPercent: c.payoutPercent,
    payoutCapPaise:
      c.payoutCapPaise === null ? null : c.payoutCapPaise.toString(),
    ticketCost: c.ticketCost,
    returnWindowDays: c.returnWindowDays,
    minRating: c.minRating,
    totalSlots: c.totalSlots,
    claimWindowDays: ctx.claimWindowDays,
    claimedCount: ctx.claimedCount,
    // Through seats.ts, not `c.totalSlots - ctx.claimedCount` — one definition of
    // a remaining seat, shared with the gate that refuses the claim.
    seatsLeft: seatsLeft(c.totalSlots, ctx.claimedCount),
    asin: c.asin,
    productUrl: c.productUrl,
    imageUrl: c.imageUrl,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
