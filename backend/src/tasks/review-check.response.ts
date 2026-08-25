import type { Campaign, Task } from '@prisma/client';
import type { EvidenceReview } from './engine/evidence.types';
import { SOURCES, sourceRank } from './engine/states';
import { toEngineTask } from './task.mapper';

/**
 * REVIEWS ONLY A PERSON CAN CHECK.
 *
 * Fayr pays for a review a shopper can read. Most marketplaces let a machine
 * settle that: Amazon publishes a review permalink that can be fetched, and
 * Flipkart states its own moderation verdict. Meesho does neither — the star
 * appears on the order, the words only inside its app — so on Meesho the question
 * "is this review live?" has no machine answer at all, ever.
 *
 * The Task screen has been telling those users "a Fayr reviewer confirms yours is
 * live" for as long as that copy has existed, with no reviewer able to. This is
 * the queue that makes the promise true.
 *
 * Everything on the card exists so the reviewer does not have to hunt: the page
 * to open, the star the marketplace already vouched for, and — in words — why no
 * machine can settle it.
 */
export interface ReviewCheckItem {
  taskId: string;
  state: string;
  platform: string;
  campaignTitle: string;
  productName: string | null;
  /** The offer's own product page, so the reviewer knows where to look first. */
  productUrl: string | null;
  claimedAt: string;
  user: { id: string; mobile: string };
  orderId: string | null;
  orderDate: string | null;
  /** The star the marketplace itself recorded. Never invented here. */
  rating: number | null;
  /**
   * WHAT TO LOOK FOR on the page. Without these the job is "find one review among
   * hundreds"; with them it is a lookup. On Meesho — the reason this queue exists
   * — they are the only clue a reviewer gets, because nothing here can read the
   * public page to help.
   */
  reviewTitle: string | null;
  reviewText: string | null;
  /** Photos on the review. A review with pictures is far easier to spot. */
  mediaCount: number | null;
  /** In plain words: why nothing but a person can answer this. */
  whyNoMachineCheck: string;
  /** True once a Fayr reviewer has said they saw it. */
  confirmedVisible: boolean;
  /** The page that reviewer opened, and when — null until somebody has. */
  confirmedUrl: string | null;
  confirmedAt: string | null;
}

export interface ReviewCheckResponse {
  items: ReviewCheckItem[];
  total: number;
}

/**
 * The tier a person may fill. Anything ranking ABOVE this has actually looked at
 * a public page, and a person's recollection does not overrule that.
 */
const STAFF_TIER = sourceRank(SOURCES.STAFF_VISIBLE);

/** True when a machine has already settled visibility, either way. */
export function machineSettledVisibility(
  review: EvidenceReview | null | undefined,
): boolean {
  return sourceRank(review?.publishedSource) > STAFF_TIER;
}

/**
 * Does this task need a pair of human eyes on a product page?
 *
 * Deliberately derived from the EVIDENCE rather than from a list of platforms. A
 * platform list would be a second definition of the same decision, and it would
 * be wrong the first time a marketplace changed what it exposes — Meesho web
 * login is behind an experiment right now, and Amazon's own permalink fetch does
 * not always land. What actually matters is one question: has anything that
 * outranks a person already answered this?
 *
 * A review must already be ON FILE. Confirming the VISIBILITY of a review the
 * marketplace never told us exists would be a far larger claim — it would let a
 * staff member invent the review itself — so the star is the entry condition.
 */
export function needsEyesOnPage(
  review: EvidenceReview | null | undefined,
): boolean {
  if (!review) return false;
  // The marketplace has to have vouched that the user rated the product. A
  // review row with no star at all is not something to confirm the visibility of.
  if (review.rating == null) return false;
  // Something that outranks a person has answered. Nothing for a person to do,
  // and nothing they are permitted to overturn.
  if (machineSettledVisibility(review)) return false;
  // Already treated as public by some other route — including every review
  // written before visibility carried a provenance at all, and the
  // quick-commerce platforms, where the marketplace states the rating on the
  // order itself. Not this queue's business, and not a verdict to reopen by hand.
  if (review.published === true && review.publishedSource !== SOURCES.STAFF_VISIBLE) {
    return false;
  }
  return true;
}

/**
 * Why no machine can settle it — stated as what is missing, not as an enum.
 *
 * Separate from hold-reasons.ts on purpose: that file explains why a REFUND is
 * held on an amount, which is a different axis entirely. Keeping the two apart
 * stops one map growing reasons that belong to the other.
 */
export function explainNoMachineCheck(
  platform: string,
  review: EvidenceReview | null | undefined,
): string {
  if (review?.permalink) {
    return (
      'There is a link to this review, but the automatic check has not been able '
      + 'to reach it. Open the page yourself and say what you see.'
    );
  }
  if (String(platform).toUpperCase() === 'MEESHO') {
    return (
      'Meesho shows the star on the order but keeps the written review inside its '
      + 'own app, so there is no page Fayr can check on its own. Open the product '
      + 'page, find this buyer’s review, and say whether it is there.'
    );
  }
  return (
    'Nothing has been able to check whether this review is on the product page '
    + 'yet, and there is no link to it. Open the product page and say what you see.'
  );
}

type Row = Task & { campaign: Campaign; user: { id: string; mobile: string } };

export function toReviewCheckItem(row: Row): ReviewCheckItem | null {
  const task = toEngineTask(row, []);
  const review = task.review;
  if (!needsEyesOnPage(review)) return null;

  const confirmedVisible =
    review?.published === true &&
    review?.publishedSource === SOURCES.STAFF_VISIBLE;

  return {
    taskId: row.id,
    state: task.state,
    platform: row.platform,
    campaignTitle: row.campaign.title,
    productName:
      review?.product ?? row.campaign.productName ?? null,
    productUrl: row.campaign.productUrl ?? null,
    claimedAt: row.createdAt.toISOString(),
    user: { id: row.user.id, mobile: row.user.mobile },
    orderId: task.order?.id ?? null,
    orderDate:
      task.order?.date != null
        ? new Date(task.order.date).toISOString()
        : null,
    rating: review?.rating ?? null,
    reviewTitle: review?.title ?? null,
    reviewText: review?.text ?? null,
    mediaCount: review?.mediaCount ?? null,
    whyNoMachineCheck: explainNoMachineCheck(row.platform, review),
    confirmedVisible,
    confirmedUrl: confirmedVisible ? (review?.visibleUrl ?? null) : null,
    confirmedAt:
      confirmedVisible && review?.visibleCheckedAt != null
        ? new Date(review.visibleCheckedAt).toISOString()
        : null,
  };
}
