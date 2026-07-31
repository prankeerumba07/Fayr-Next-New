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
  asin: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Map a Campaign row to its public response (BigInt→string, Date→ISO). */
export function toCampaignResponse(c: Campaign): CampaignResponse {
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
    asin: c.asin,
    productUrl: c.productUrl,
    imageUrl: c.imageUrl,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
