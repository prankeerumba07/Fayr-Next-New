import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * HOW MANY REVIEW PAGES THE PHONE MAY HAND OVER IN ONE GO.
 *
 * A person's own list of reviews, not a shop's catalogue. Twenty is far past any
 * realistic number somebody has written and still small enough that the cost of
 * reading them all is nothing.
 */
export const MOST_REVIEWS_ACCEPTED = 20;

/** The longest one review page may be. A page, not a book. */
export const LONGEST_REVIEW_TEXT = 20000;

/**
 * WHAT THE PHONE IS ALLOWED TO SEND ABOUT A REVIEW, AND NOTHING ELSE.
 *
 * One piece of TEXT per review page it opened.
 *
 * THERE IS NO `matches` FIELD, AND NO `published` FIELD, AND THAT IS THE POINT.
 * Whether a review is the campaign's product is decided on this side, from the
 * text, by matchReviewToCampaign. Whether it is publicly visible is decided on
 * this side too, from the fact that the page was readable at all.
 *
 * `published` ABOVE ALL MUST NEVER COME OFF A PHONE. It is the payout signal —
 * the single fact that separates a task that gets paid from one that does not —
 * and a phone is something a person controls. A field for it here would be a
 * field for "please pay me".
 *
 * NOR ARE THE READ FIELDS ACCEPTED: not the product, not the star, not the date.
 * A phone that could send those could send a review that was never written.
 */
export class FoundReviewsDto {
  @IsArray()
  @ArrayMaxSize(MOST_REVIEWS_ACCEPTED)
  @IsString({ each: true })
  @MaxLength(LONGEST_REVIEW_TEXT, { each: true })
  pages!: string[];
}
