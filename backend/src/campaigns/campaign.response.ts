import type { Campaign, CampaignStatus, Platform } from '@prisma/client';

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
  asin: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Map a Campaign row to its public response (BigInt→string, Date→ISO).
 *
 * `claimWindowDays` is a REQUIRED parameter with no default on purpose. It is one
 * operator setting (CLAIM_TTL_DAYS) and the claim itself computes claimExpiresAt
 * from that same setting; a fallback here would be a second number claiming to be
 * the same policy, and the two would drift the first time the setting changed.
 * Required means the type system refuses any call site that forgets it.
 */
export function toCampaignResponse(
  c: Campaign,
  claimWindowDays: number,
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
    claimWindowDays,
    asin: c.asin,
    productUrl: c.productUrl,
    imageUrl: c.imageUrl,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
