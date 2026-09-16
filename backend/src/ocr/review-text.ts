/**
 * ONE REVIEW'S OWN PAGE, READ AS WORDS.
 *
 * ── WHY THIS IS A SECOND READER AND NOT A BRANCH OF THE FIRST ─────────────
 *
 * order-text.ts reads an ORDER: a bill, products, prices, a delivery. This reads
 * a REVIEW: who wrote it, about what, when, and whether the shop calls it a
 * verified purchase. The two pages share a website and nothing else, and folding
 * them together would mean one function whose every rule had to ask which kind of
 * page it was looking at.
 *
 * ── WHAT IT IS FOR, SAID PLAINLY ──────────────────────────────────────────
 *
 * A refund is paid for a review that is really there. So the question this
 * answers is "is the campaign's product the thing this review is about", and the
 * answer has to come off the shop's own page rather than from anybody's word for
 * it. THE PHONE FETCHES, THIS READS, AND THE SERVER DECIDES — the same division
 * the order read already keeps, for the same reason: a phone is something a
 * person controls.
 *
 * ── MEASURED, NOT IMAGINED ────────────────────────────────────────────────
 *
 * Every rule below was written against the owner's own review page, read on
 * 16 September 2026. The shape it is written to is this:
 *
 *     Customer Review
 *     prakash tamang
 *     5 out of 5 stars
 *     Sturdy, Space Saving and Worth the Price.
 *     Reviewed in India on 13 June 2026
 *     Colour: WhiteSet name: Single Rod (MGS-001)
 *     Verified Purchase
 *
 *     Good quality garment rack for the price. ...
 *
 *     2 people found this helpful
 *     Helpful
 *     Report
 *     Product Details
 *     Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf ...
 *     byLukzer
 *     3.8 out of 5 stars
 *
 * TWO "out of 5 stars" LINES ARE ON THAT PAGE and they mean opposite things: the
 * first is this person's star, the second is the product's average across four
 * thousand strangers. Reading the wrong one would put a shop's average on a
 * person's record. That is why everything here is anchored to "Customer Review"
 * and the star is the FIRST one after it.
 *
 * PURE. No Prisma, no Nest, no clock, no network.
 */

/** Everything one review page states, and nothing inferred. */
export interface ParsedReview {
  /** Who the page says wrote it. Null when the page did not say. */
  reviewer: string | null;
  /** The review's own headline. */
  title: string | null;
  /** The product it is about, as the shop writes it. */
  product: string | null;
  /** 1 to 5, or null. THE REVIEWER'S star, never the product's average. */
  rating: number | null;
  /** The day it was written, as "2026-06-13", or null. */
  reviewDay: string | null;
  /**
   * WHETHER THE SHOP ITSELF CALLS IT A VERIFIED PURCHASE.
   *
   * Not decorative. It is the marketplace saying the reviewer really bought the
   * thing through it, which is a fact about the purchase that nobody at Fayr and
   * nobody on the phone can assert.
   */
  verifiedPurchase: boolean;
  /** What they actually wrote. Null when nothing readable followed. */
  body: string | null;
}

/**
 * WHERE THE REVIEW STARTS ON THE PAGE.
 *
 * Everything above it is the shop's furniture — the menus, the basket, the
 * category list — and it runs to some thousands of characters. Anchoring here is
 * what stops a star, a name or a date being read out of a carousel.
 */
const WHERE_THE_REVIEW_STARTS = 'customer review';

/** Where the product's own details begin, which is where the review has ended. */
const WHERE_THE_PRODUCT_STARTS = 'product details';

/**
 * LINES THAT END THE REVIEW'S WORDS.
 *
 * The body runs until the page stops being the review and starts being the
 * buttons under it. Each of these was on the owner's own page.
 */
const AFTER_THE_WORDS: readonly string[] = [
  'helpful',
  'report',
  'people found this helpful',
  'person found this helpful',
  'one person found this helpful',
  'permalink',
  'comment',
  'translate review to english',
];

/** Lines that are the shop describing the item bought, not the review's words. */
const ABOUT_THE_THING_BOUGHT = /^(colour|color|size|style|set name|pattern|capacity|configuration|item package quantity)\b/i;

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
}

function low(line: string): string {
  return line.toLowerCase().trim();
}

/** Nothing was read. Every field absent, never a zero or an empty string. */
function nothing(): ParsedReview {
  return {
    reviewer: null,
    title: null,
    product: null,
    rating: null,
    reviewDay: null,
    verifiedPurchase: false,
    body: null,
  };
}

/**
 * THE REVIEWER'S STAR, off a line that states one.
 *
 * "5 out of 5 stars" and "5.0 out of 5 stars" are both written by the same shop
 * on two of its own pages, so both are read. A star outside one to five is
 * refused rather than clamped: a number that cannot be a rating is a line that
 * was not a rating, and rounding it into range would invent one.
 */
function starOn(line: string): number | null {
  const m = low(line).match(/^([0-5](?:\.\d)?)\s+out of\s+5\s+stars?\b/);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

/**
 * THE DAY A REVIEW LINE STATES, as the shop writes it.
 *
 * "Reviewed in India on 13 June 2026". The country is not read and is not
 * checked: what it says is where the reviewer is, which is not a fact this is
 * about, and a shop that writes a different country tomorrow must not stop the
 * date being read.
 */
function dayOnAReviewLine(line: string): string | null {
  const m = line.match(/reviewed in .+? on\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Read one review page.
 *
 * `dayFrom` is handed in rather than imported so this file stays free of the
 * comparison module, which imports nothing from here either. The caller passes
 * order-comparison's dayFromText, which already reads every shape of date the
 * shops write and is checked on its own.
 */
export function parseReviewText(
  text: string | null | undefined,
  dayFrom: (t: string | null | undefined) => string | null,
): ParsedReview {
  if (typeof text !== 'string' || text.trim() === '') return nothing();
  const all = lines(text);

  // ── ONE: WHERE THE REVIEW IS ─────────────────────────────────────────────
  const startedAt = all.findIndex((l) => low(l) === WHERE_THE_REVIEW_STARTS);
  if (startedAt < 0) return nothing();

  // ── TWO: WHERE THE PRODUCT'S OWN SECTION BEGINS ──────────────────────────
  //
  // The review's words end here whatever else is true, which is what keeps the
  // product's four-thousand-rating average out of the reviewer's star.
  const productAt = all.findIndex(
    (l, i) => i > startedAt && low(l) === WHERE_THE_PRODUCT_STARTS,
  );
  const endOfReview = productAt < 0 ? all.length : productAt;

  const out = nothing();

  // ── THREE: THE NAME, THE STAR AND THE TITLE, IN THE ORDER THEY APPEAR ────
  //
  // The name is the first line after the anchor, the star is the first star
  // after that, and the title is the line after the star. Read positionally
  // because none of the three is labelled on the page — and the positions are
  // only trustworthy BECAUSE of the anchor above.
  let i = startedAt + 1;
  if (i < endOfReview && starOn(all[i]) == null) {
    out.reviewer = all[i];
    i += 1;
  }
  while (i < endOfReview) {
    const star = starOn(all[i]);
    if (star != null) {
      out.rating = star;
      i += 1;
      if (i < endOfReview) { out.title = all[i]; i += 1; }
      break;
    }
    i += 1;
  }

  // ── FOUR: THE DAY, AND WHETHER THE SHOP VERIFIED THE PURCHASE ───────────
  let wordsFrom = i;
  for (let k = i; k < endOfReview; k += 1) {
    const stated = dayOnAReviewLine(all[k]);
    if (stated != null && out.reviewDay == null) {
      out.reviewDay = dayFrom(stated);
      wordsFrom = k + 1;
      continue;
    }
    if (low(all[k]) === 'verified purchase') {
      out.verifiedPurchase = true;
      wordsFrom = k + 1;
      continue;
    }
    if (ABOUT_THE_THING_BOUGHT.test(all[k])) { wordsFrom = k + 1; continue; }
    break;
  }

  // ── FIVE: THE WORDS, UP TO THE BUTTONS UNDER THEM ───────────────────────
  const words: string[] = [];
  for (let k = wordsFrom; k < endOfReview; k += 1) {
    const l = low(all[k]);
    if (AFTER_THE_WORDS.some((w) => l === w || l.endsWith(w))) break;
    words.push(all[k]);
  }
  if (words.length > 0) out.body = words.join(' ');

  // ── SIX: WHAT THE REVIEW IS ABOUT ───────────────────────────────────────
  //
  // The line under "Product Details", which is the shop's own full title for the
  // thing. It is long and it carries punctuation the campaign's own name does
  // not; matching handles that and this does not tidy it, because a name that has
  // been tidied is no longer what the page said.
  if (productAt >= 0 && productAt + 1 < all.length) {
    out.product = all[productAt + 1];
  }

  return out;
}
