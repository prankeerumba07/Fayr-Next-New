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
  /**
   * WHO established `published` — and the ONLY authority on that verdict.
   *
   * Separate from everything else on this object on purpose. A review carries two
   * unrelated facts with unrelated provenance: the review RECORD (its id, the
   * star, the date), which the marketplace's own order or reviews payload states,
   * and whether a shopper can actually READ it, which is a different question that
   * a different thing answers. Meesho is the case that forces the split — its
   * orders payload states the star with total authority and says nothing whatever
   * about public visibility, so `published: false` there is an ABSENCE of
   * information rather than a finding.
   *
   * Null means nobody has established it either way, and null is the reason a
   * person is allowed to fill it — filling a gap, not overruling a machine. See
   * review-visibility.spec.ts for the two directions that are enforced.
   */
  publishedSource?: SourceName | null;
  /**
   * The public page a Fayr reviewer opened, when a person settled `published`.
   * Required by the staff action: "I checked" with no address is not evidence,
   * because nobody else can go and look at the same thing a year later.
   */
  visibleUrl?: string | null;
  /** When they opened it (epoch ms). Null unless a person settled it. */
  visibleCheckedAt?: number | null;
  /**
   * THE WORDS OF THE REVIEW, carried for the person who has to find it.
   *
   * Amazon, Flipkart and Meesho all publish the title and body, and all three were
   * read on-device and discarded at this boundary. They matter in exactly one
   * place: the staff review-check queue, where somebody is asked to open a product
   * page and find one buyer's review among hundreds. With the words that is a
   * lookup; without them it is a hunt — and Meesho, the only platform that queue
   * exists for, is also the one whose public page nothing here can read.
   *
   * Capped and ellipsis-marked on the device (see reviewSnippet in taskflow.js),
   * because this lands in the evidence JSONB on every write. Null on the
   * quick-commerce platforms, which publish no review text at all.
   */
  title?: string | null;
  text?: string | null;
  /** How many photos the review carries — the other thing a shopper can see. */
  mediaCount?: number | null;
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

/**
 * The only ways a quantity may legitimately be known. Anything else is a guess.
 *   label-qty / label-quantity   the item's own container LABELLED the number
 *   unit-record-stated / -records-stated   marketplace records stating their own count
 *   staff                        a person read the order page and confirmed it
 */
export const QUANTITY_SOURCES = [
  'label-qty',
  'label-quantity',
  'unit-record-stated',
  'unit-records-stated',
  'staff',
] as const;
export type QuantitySource = (typeof QUANTITY_SOURCES)[number];

/** Why no quantity was read. See EvidenceOrder.quantityReason. */
export const QUANTITY_REASONS = [
  'not-stated',
  'picker',
  'conflicting',
  'implausible',
  'partial',
  'no-item-container',
  /**
   * The page stated a count ABOVE ONE, and that is not enough to pay from: the
   * amount beside it could be a per-unit price or a whole line, and dividing the
   * wrong one under-pays by two thirds. See payableQuantity in src/quantity.js.
   */
  'multi-unit-amount-unclear',
] as const;
export type QuantityReason = (typeof QUANTITY_REASONS)[number];

/**
 * WHERE a staff member read an amount they typed in.
 *
 * Free text alone is not enough here. If a staff-confirmed payout is disputed
 * later, "they typed 499" is not a defence — "they read ₹499 off the marketplace
 * invoice on 20 Aug, and here is the note they left" is. Every value below names
 * a place somebody else can go and look.
 *
 * The free-text note is still required on top of this; the list says WHERE, the
 * note says WHAT they saw.
 */
export const AMOUNT_EVIDENCE_SOURCES = [
  /** The marketplace's own order page, open in front of the reviewer. */
  'order-page',
  /** The marketplace invoice or its PDF. */
  'invoice',
  /** The order-confirmation email from the marketplace. */
  'marketplace-email',
  /** The user's own bank or UPI record of the payment. */
  'bank-or-upi-statement',
  /** A screenshot the user uploaded. Lowest standing of the five. */
  'user-screenshot',
] as const;
export type AmountEvidenceSource = (typeof AMOUNT_EVIDENCE_SOURCES)[number];

/**
 * WHICH LINE of an order a fact is about — the only identifiers a marketplace
 * genuinely states, and where each one comes from.
 *
 *   asin               Amazon. The review's ASIN is also an ASIN found on the
 *                      order DETAIL page (the join only succeeds when they
 *                      agree), so it names a line and not a listing.
 *   flipkart-pid       Flipkart's fsn, already on its order object.
 *   meesho-sub-order   Meesho issues a sub-order per line of the order.
 *   instamart-variant  the productVariantId actually bought.
 *
 * A free-text source is deliberately impossible here, for the same reason as
 * quantitySource: it would let a client invent an authority it does not have.
 */
export const ITEM_ID_SOURCES = [
  'asin',
  'flipkart-pid',
  'meesho-sub-order',
  'instamart-variant',
] as const;
export type ItemIdSource = (typeof ITEM_ID_SOURCES)[number];

/** Why no line identifier was read. See EvidenceOrder.itemIdReason. */
export const ITEM_ID_REASONS = [
  'not-stated',
  /**
   * The page offered ONLY a row number — Zepto and Blinkit emit
   * `orderId + "#" + idx`. That is a position, not an identity: add or remove an
   * item and "#2" silently means a different product. Keying a refund on it would
   * be worse than keying on the order, because it would look precise and be
   * wrong. Refused on purpose.
   */
  'positional-only',
] as const;
export type ItemIdReason = (typeof ITEM_ID_REASONS)[number];

export interface EvidenceOrder {
  id: string | null;
  /**
   * WHICH LINE of the order this is, when the marketplace states one.
   *
   * NULL means unknown, and unknown is never read as "a different line". The
   * one-purchase-one-refund gate fails closed on it: two tasks on one order
   * number are only allowed to both pay when BOTH sides name a line and the lines
   * differ. Anything else goes to a human.
   */
  itemId?: string | null;
  itemIdSource?: ItemIdSource | null;
  itemIdReason?: ItemIdReason | null;
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
   * NULL means UNKNOWN, and unknown is NEVER treated as 1. A line total with an
   * unknown quantity goes to a human instead of paying out.
   *
   * A reader may only fill this from a number the page STATES next to a word
   * saying what it means ("Qty: 3"), or from a marketplace record that states
   * its own unit count. Counting rows, reading a badge, or inferring from the
   * absence of a marker are all forbidden — see src/quantity.js for the list of
   * refusals and why each one exists. Amazon prints no label on a single-unit
   * order, so NULL remains the ordinary answer there rather than a failure.
   */
  quantity?: number | null;
  /**
   * WHERE the quantity came from, so a payout can be explained a year later:
   * which label was read, which record stated it, or that a staff member
   * confirmed it by eye. Null whenever quantity is null.
   */
  quantitySource?: QuantitySource | null;
  /**
   * WHY there is no quantity. The distinction matters operationally: 'not-stated'
   * is the page being silent and needs no investigation, while 'picker' or
   * 'conflicting' means the reader saw something it refused, and that is worth a
   * look. Null when a quantity WAS read.
   */
  quantityReason?: QuantityReason | null;
  /**
   * A unit count a reader genuinely read but which is NOT SAFE TO COMPUTE WITH,
   * because we cannot yet tell whether the amount beside it is per-unit or a
   * whole line. Recorded so the staff member deciding the refund can see what the
   * page said instead of opening the order themselves.
   *
   * Nothing in the refund path may read this field. `quantity` is the only field
   * the money is allowed to depend on.
   */
  quantityObserved?: number | null;
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
  /**
   * THE INSTANT THE SHOP'S OWN PAGE SAID ITS RETURN WINDOW CLOSES, epoch ms, or
   * absent when the page never said. Read off the order page in words — Amazon
   * prints "Return window closed on 19 June 2026" — and it is the last instant
   * of that day, because a window that closed on the 19th closed at the end of
   * the 19th.
   *
   * CONSUMED BY EXACTLY ONE FUNCTION: windowEnd in transition.ts, which takes
   * the LATER of this and the operator's policy table.
   *
   * LATER-ONLY IS THE WHOLE SAFETY PROPERTY, and it is what makes accepting this
   * over the wire acceptable at all. This value arrives from a device nobody can
   * attest. A client that sends a SMALLER number is ignored, because the policy
   * table wins; a client that sends a LARGER one has lengthened its own hold.
   * There is no value of this field that pays anybody sooner.
   */
  returnWindowEndsAt?: number | null;
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
