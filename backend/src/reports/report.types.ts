/**
 * Response shapes for the four staff reports. Money is always integer paise as a
 * decimal STRING (JSON has no BigInt); counts are plain numbers; percentages are
 * whole-number 0–100. Every report echoes the resolved range it was computed for.
 */

export interface ReportRange {
  /** Inclusive start, ISO (UTC start-of-day). */
  from: string;
  /** Inclusive end, ISO (UTC end-of-day). */
  to: string;
  granularity: 'day' | 'week';
}

/** Report 1 — Campaign / offers performance (OPERATIONS + ADMIN). */
export interface CampaignPerfRow {
  campaignId: string;
  title: string;
  platform: string;
  status: string;
  totalSlots: number | null;
  claims: number;
  purchases: number;
  reviews: number;
  refunds: number;
  expired: number;
  /** purchases / claims, as a whole-number percentage. */
  purchaseConversionPct: number;
  /** refunds / claims, as a whole-number percentage. */
  refundConversionPct: number;
  /** claims / totalSlots, as a whole-number percentage (null if no slot cap). */
  fillRatePct: number | null;
}

export interface CampaignPerfReport {
  range: ReportRange;
  totals: {
    campaigns: number;
    claims: number;
    purchases: number;
    reviews: number;
    refunds: number;
  };
  rows: CampaignPerfRow[];
}

/** Report 2 — Payouts / financial (FINANCE + ADMIN). */
export interface WithdrawalStatusBucket {
  status: string;
  count: number;
  totalPaise: string;
}

export interface PayoutsReport {
  range: ReportRange;
  refundsCreditedPaise: string;
  refundsCreditedCount: number;
  withdrawalsByStatus: WithdrawalStatusBucket[];
  paidOutPaise: string;
  paidOutCount: number;
  completionGrants: number;
  completionTicketsTotal: number;
  series: { bucket: string; refundsPaise: string; paidOutPaise: string }[];
}

/** Report 3 — Activity funnel over time (ADMIN). */
export interface ActivityReport {
  range: ReportRange;
  /** For tasks CREATED in range: how far each got (cohort funnel). */
  funnel: {
    claimed: number;
    purchased: number;
    delivered: number;
    reviewed: number;
    holding: number;
    refunded: number;
    expired: number;
  };
  /** Period activity: claims created + refunds completed per bucket. */
  series: { bucket: string; claims: number; refunds: number }[];
}

/** Report 4 — User growth (ADMIN). */
export interface UserGrowthReport {
  range: ReportRange;
  newSignups: number;
  activeClaimers: number;
  cumulativeUsers: number;
  series: {
    bucket: string;
    signups: number;
    activeClaimers: number;
    cumulative: number;
  }[];
}
