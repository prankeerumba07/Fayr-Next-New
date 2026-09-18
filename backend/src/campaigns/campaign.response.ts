import type { Campaign, CampaignStatus, Platform } from '@prisma/client';
import { seatsLeft } from './seats';
import {
  offerAvailability,
  type OfferAvailability,
} from '../live-check/live-page.rules';

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
   * How many MINUTES the buyer has to purchase after claiming, before the claim
   * expires and their tickets come back. The operator's CLAIM_TTL_MINUTES setting,
   * passed in — see toCampaignResponse for why it is not read here.
   *
   * Minutes, not days, since 1 September 2026: the owner asked for a thirty minute
   * slot and the old setting's smallest value was one whole day. The field was
   * renamed rather than kept alongside a new one, so a screen cannot read a stale
   * `claimWindowDays` and quote seven days over a thirty minute window.
   */
  claimWindowMinutes: number;
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
  /**
   * THE EXACT PHRASE TO TYPE INTO THE SHOP'S OWN SEARCH BOX, or null.
   *
   * Sent to the app, which shows it on the bar above the in-app shop and asks
   * the person to TYPE it — there is deliberately no copy control. Null means
   * ops has not written one, and the app says that plainly rather than falling
   * back to productName.
   */
  searchKeyword: string | null;
  imageUrl: string | null;
  /**
   * Whether the app should show this offer greyed out, and what to say on it.
   *
   * Worked out HERE rather than in the app, from two things the app cannot see
   * together: how many places are left, and what the shop's own page looked like
   * the last time a person opened it. One definition, so a card and the claim gate
   * can never disagree about whether an offer is usable.
   */
  availability: OfferAvailability;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything this mapper cannot read off the Campaign row.
 *
 * AN OBJECT, NOT POSITIONAL ARGUMENTS, and that is the whole point.
 *
 * `claimWindowMinutes` used to be a second positional parameter, and making it
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
 * operator's CLAIM_TTL_MINUTES, which the claim itself uses to compute
 * claimExpiresAt, and a live count of tasks. A fallback for either would be a
 * second number claiming to be the same thing.
 */
export interface CampaignResponseContext {
  claimWindowMinutes: number;
  claimedCount: number;
  /**
   * Now, passed in rather than read here, so a test can put the clock where it
   * needs it — the greyed-out state depends on how OLD the last look at the shop
   * page was, and a function that reads its own clock cannot be tested at the edge.
   */
  now?: Date;
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
    claimWindowMinutes: ctx.claimWindowMinutes,
    claimedCount: ctx.claimedCount,
    // Through seats.ts, not `c.totalSlots - ctx.claimedCount` — one definition of
    // a remaining seat, shared with the gate that refuses the claim.
    seatsLeft: seatsLeft(c.totalSlots, ctx.claimedCount),
    asin: c.asin,
    productUrl: c.productUrl,
    searchKeyword: c.searchKeyword,
    imageUrl: c.imageUrl,
    availability: offerAvailability({
      seatsLeft: seatsLeft(c.totalSlots, ctx.claimedCount),
      liveState: c.liveState,
      liveCheckedAt: c.liveCheckedAt,
      now: ctx.now ?? new Date(),
    }),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
