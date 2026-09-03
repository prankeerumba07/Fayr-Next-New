/**
 * WHY A REFUND WAS REFUSED, IN WORDS THE PERSON WAITING FOR IT CAN READ.
 *
 * These four sentences used to be written inline in task.service.ts, in the
 * middle of the release path. Two of them had a long dash in them, which is the
 * one shape Fayr's own plain-language rule names and says what to do about. They
 * sat there from the day they were written, because that rule was only ever run
 * over the assistant's answers and had never read a single word said to somebody
 * about their own money.
 *
 * SO THEY LIVE HERE, beside the held-money wordings, for one reason: a words file
 * can be walked. hold-and-refusal-words.spec.ts puts every sentence in this file
 * and in hold-reasons.ts through the real check, in a check of its own, the same
 * way chat/how-it-talks.spec.ts walks the assistant's words. A sentence added
 * below cannot reach a person without that walk having read it first.
 *
 * THEY ARE FRAGMENTS ON PURPOSE, and that is not an accident of the past. Several
 * can be true at once, and the release path joins them, so each one has to read
 * correctly beside another. Each says what is wrong and what settles it.
 */

/** The same product has already been paid for on another offer. */
export const SAME_ITEM_ALREADY_REFUNDED =
  'this exact item has already been refunded on another offer, so a Fayr '
  + 'reviewer needs to check it';

/**
 * Something on this order has been paid for, and we cannot tell whether it was
 * this product. A different investigation from the one above, so a different
 * sentence: this is a possibly honest basket we cannot read.
 */
export const SAME_ORDER_ALREADY_REFUNDED =
  'this order has already been refunded on another offer, so a Fayr reviewer '
  + 'needs to check it';

/** More than one of their orders matches, and only they know which. */
export const MORE_THAN_ONE_ORDER_MATCHED =
  'more than one order matched this product, so please confirm which one is yours';

/** The price does not agree with the offer, so we ask rather than assume. */
export const AMOUNT_DOES_NOT_MATCH =
  'the amount you paid does not match this offer, so please confirm this is '
  + 'your order';

/** The last resort, when the engine refused for a reason it did not name. */
export const NOT_ALLOWED_YET =
  'this refund is not ready to be paid yet, and a person at Fayr will look at it';

/**
 * Every refusal in this file, for the walk.
 *
 * A list and not a lookup: nothing chooses between these by name, the release
 * path picks the one that fits. It exists so the check cannot miss one, and so
 * adding a sentence without adding it here fails the count below.
 */
export const EVERY_REFUSAL: readonly string[] = [
  SAME_ITEM_ALREADY_REFUNDED,
  SAME_ORDER_ALREADY_REFUNDED,
  MORE_THAN_ONE_ORDER_MATCHED,
  AMOUNT_DOES_NOT_MATCH,
  NOT_ALLOWED_YET,
];
