import type { BlockerName, SourceName } from './states';

/**
 * The normalized EVIDENCE object — the contract between the on-device layer and
 * the backend. It is exactly what src/taskflow.js `readEvidence()` produces
 * on-device (from the scraper the backend does NOT reimplement); the backend
 * consumes it and applies it through the ported transition().
 *
 * Money is integer paise as `bigint` (the HTTP DTO parses the incoming decimal
 * strings into these before the engine ever sees them). Dates are epoch ms.
 */
export interface EvidenceReview {
  reviewId?: string | null;
  asin?: string | null;
  product?: string | null;
  rating?: number | null;
  /** The payout signal: is the review publicly visible on the product page? */
  published: boolean;
  verified?: boolean;
  reviewDate?: number | null;
  reviewDateSource?: string | null;
  /**
   * The PUBLIC review permalink. The on-device layer captured it; the backend
   * re-fetches it server-side during HOLDING (1.6) to independently confirm the
   * review is still live — the payout signal it can verify without the user's
   * marketplace session.
   */
  permalink?: string | null;
}

/**
 * HOW this order was matched to the campaign — campaigns carry no product id, so
 * the match is a name score plus an amount cross-check (see matchOrderByNameAmount
 * in src/verify.js). It is carried all the way to the refund gate because a
 * DOUBTFUL match must not pay out on a user's tap alone: `ambiguous` (several
 * orders scored within 0.15 of the winner) and `amountOk === false` (the price
 * disagrees with the campaign) are the two signals that demand a human.
 *
 * Previously computed on-device and then thrown away at the wire boundary, which
 * silently disarmed the "is this your order?" warnings the moment the
 * authoritative response landed.
 */
export interface EvidenceOrderMatch {
  /** 0..1 name-token overlap. null when the matcher did not run. */
  score?: number | null;
  /** true/false/null — null means the campaign or the order had no amount. */
  amountOk?: boolean | null;
  /** 2+ candidates within 0.15 of the best score and not amount-rejected. */
  ambiguous?: boolean;
  candidateCount?: number | null;
}

export interface EvidenceOrder {
  id: string | null;
  date?: number | null;
  dateRaw?: string | null;
  /** The REFUNDABLE figure — the item's own paid price, never the order total. */
  itemPaise?: bigint | null;
  orderTotalPaise?: bigint | null;
  mrpPaise?: bigint | null;
  amountSource?: string | null;
  itemAmountAmbiguous?: boolean;
  match?: EvidenceOrderMatch | null;
  product?: string | null;
  image?: string | null;
  statusText?: string | null;
  source: SourceName;
}

export interface EvidenceDelivery {
  at: number; // epoch ms
  raw?: string | null;
  source: SourceName;
}

export interface Evidence {
  /** A blocker means the flow can't advance and must SAY why (never blank). */
  blocker?: BlockerName | null;
  reason?: string | null;
  review?: EvidenceReview | null;
  order?: EvidenceOrder | null;
  delivery?: EvidenceDelivery | null;
  /** Tri-state: null = unknown (no readable order data), distinct from false. */
  returned?: boolean | null;
  probe?: unknown;
}
