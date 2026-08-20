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
  /**
   * ── THE MONEY FIELDS, NAMED SO THEY CANNOT BE CONFUSED ────────────────────
   *
   * `itemPaise` is the historic name and it is AMBIGUOUS: on some platforms it is
   * what one unit cost, on others what the whole line cost. That difference is
   * real money — a line total for three units refunded as a unit price pays about
   * three times what the campaign intended — so the two are now separate fields
   * and `itemPaise` is read as a LINE TOTAL, which is the safe reading.
   *
   * @deprecated Prefer lineTotalPaise or unitPricePaise. Kept because it is the
   * wire field every existing reader, row and task already uses.
   */
  itemPaise?: bigint | null;
  /**
   * What ONE unit was charged. Set only where the page genuinely states a
   * per-unit figure. When present, quantity does not matter: a refund is for one
   * unit of the product, so this is the basis and nothing has to be inferred.
   */
  unitPricePaise?: bigint | null;
  /**
   * What the whole LINE was charged — unit price times quantity. On its own this
   * is not enough to pay from, because without the quantity we cannot tell one
   * unit at this price from three at a third of it.
   */
  lineTotalPaise?: bigint | null;
  /**
   * How many units of the product this line covers.
   *
   * NULL means UNKNOWN, and unknown is NEVER treated as 1. No marketplace reader
   * captures this today — the word "quantity" appears nowhere in platforms.js,
   * extract.js, verify.js or taskflow.js — so unknown is the honest value, and a
   * line total with an unknown quantity goes to a human instead of paying out.
   */
  quantity?: number | null;
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
