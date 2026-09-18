import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * The body of PUT /tasks/:taskId/review.
 *
 * ── ONE FIELD, AND THE SCORE IS DELIBERATELY NOT IN IT ─────────────────────
 *
 * The app works a score out as somebody types, because a live indicator cannot
 * be a network call per keystroke. It never sends that number. The server scores
 * the text it is about to store, from src/reviews/fayr-score.ts, because a
 * number the server cannot vouch for is not worth keeping — and because a score
 * arriving from a phone is a score somebody can set to whatever they like.
 *
 * ── AND THE TEXT IS NOT TRANSFORMED HERE ───────────────────────────────────
 *
 * No @Transform, no trim, no normalisation. class-transformer is perfectly happy
 * to tidy a string on the way in and that is exactly what must not happen: what
 * is stored is what they typed. MinLength(1) rather than a trimmed check, so a
 * review that is deliberately spaced out is still theirs.
 *
 * The 5000 is a storage bound and not an opinion about length. Nothing in the
 * score rewards length — it counts DISTINCT words — so a long review is not a
 * better one, and this number is only here so a single row cannot be unbounded.
 */
export class WriteReviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text!: string;

  /**
   * THE STARS THEY GAVE THE PRODUCT AT THE SHOP, 1 to 5, or absent.
   *
   * OPTIONAL, AND IT MUST STAY OPTIONAL. Somebody may write the review before
   * they have decided the number, and nothing in Fayr may ever force one out of
   * them. A required field here would be Fayr asking for a rating, which is the
   * one thing this product must never do.
   *
   * IT IS A RECORD AND NEVER A REASON TO PAY. Nothing downstream reads it to
   * decide money, a state or a hold — see the note on the column, and the check
   * that walks the whole of backend/src to keep it true.
   *
   * `score` and `band` are still NOT here, and still cannot be sent: the app's
   * global validation pipe refuses a body carrying a field this class does not
   * declare, so the server remains the only thing that scores the text.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;
}
