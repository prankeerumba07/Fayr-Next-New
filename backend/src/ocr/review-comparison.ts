/**
 * IS THIS REVIEW THE ONE THE OFFER IS FOR?
 *
 * ── THE ONE QUESTION, AND WHY IT IS ONLY ABOUT THE PRODUCT ────────────────
 *
 * A person may have written twenty reviews. The offer is for one product. So the
 * question here is which of their reviews is about THAT product, and nothing
 * else: not whether it is good, not how many stars it has, not how long it is.
 * Fayr pays for an honest review and has no opinion about what it says, and a
 * rule here about the words would be exactly that opinion.
 *
 * ── WHAT IS REPORTED BUT NEVER USED TO REFUSE ─────────────────────────────
 *
 * The star and the shop's "Verified Purchase" mark are read and carried, and
 * neither decides this answer. They are facts about the review that a person
 * looking at a held task needs to see; making either a condition would mean Fayr
 * refusing a one-star review, which is the whole thing this product must not do.
 *
 * ── EXACT, PURE, AND WITHOUT A TOLERANCE ──────────────────────────────────
 *
 * Same discipline as matchOrderToCampaign next door, and it uses that file's own
 * sameProductName rather than a second copy of it: one rule for "is this the
 * right product", asked in two places.
 */
import { sameProductName } from './order-comparison';
import type { ParsedReview } from './review-text';

/** What the campaign says its product is. */
export interface CampaignForReviewMatch {
  productName?: string | null;
}

/**
 * Why the answer is what it is. Each names a thing that really happened.
 *
 *   matched                 this review is about the campaign's product
 *   product_name_not_found  the page named a product and it is not that one
 *   no_product_read         the page did not say what the review is about
 *   no_campaign_product     the campaign does not say what its product is
 */
export type ReviewMatchReason =
  | 'matched'
  | 'product_name_not_found'
  | 'no_product_read'
  | 'no_campaign_product';

export interface ReviewMatchAnswer {
  matches: boolean;
  reason: ReviewMatchReason;
}

export function matchReviewToCampaign(
  review: ParsedReview | null | undefined,
  campaign: CampaignForReviewMatch | null | undefined,
): ReviewMatchAnswer {
  const r = review && typeof review === 'object' ? review : null;
  const c = campaign && typeof campaign === 'object' ? campaign : {};

  const wanted = typeof c.productName === 'string' && c.productName.trim() !== ''
    ? c.productName.trim() : null;
  if (wanted == null) {
    return { matches: false, reason: 'no_campaign_product' };
  }

  const about = r && typeof r.product === 'string' && r.product.trim() !== ''
    ? r.product.trim() : null;
  if (about == null) {
    // A PAGE THAT NAMED NO PRODUCT IS NOT A PAGE THAT NAMED THE WRONG ONE.
    // They are different failures: one is a read that did not work, the other is
    // a review of something else, and only the second is the person's doing.
    return { matches: false, reason: 'no_product_read' };
  }

  if (!sameProductName(wanted, about)) {
    return { matches: false, reason: 'product_name_not_found' };
  }
  return { matches: true, reason: 'matched' };
}
