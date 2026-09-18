import type { TaskReview } from '@prisma/client';

/**
 * A review as the app reads it back.
 *
 * THE TEXT IS RETURNED EXACTLY AS IT WAS STORED, which is exactly as it was
 * typed. Nothing here trims it, collapses its whitespace or reflows it. A
 * response shape that tidies somebody's writing on the way out is a response
 * shape that has started editing it.
 */
export interface ReviewResponse {
  text: string;
  /** How DESCRIPTIVE it is, 0-100. Never how positive. */
  score: number;
  /** THIN | FAIR | STRONG — the same answer in a word. */
  band: string;
  /**
   * The stars they gave at the shop, 1-5, or null because they have not said.
   *
   * Null is an ordinary answer and never a zero: "they have not decided" and
   * "they gave it nothing" are not the same fact, and nothing may read one as
   * the other.
   */
  stars: number | null;
  writtenAt: string;
  updatedAt: string;
}

export function toReviewResponse(r: TaskReview): ReviewResponse {
  return {
    text: r.text,
    score: r.score,
    band: r.band,
    stars: r.stars,
    writtenAt: r.writtenAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
