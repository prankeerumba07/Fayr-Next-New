import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Integer paise as a decimal string — money crosses the wire as a string. */
const PAISE = /^\d+$/;

/**
 * The staff reviewer's note on an approve / reject / request-more decision.
 * Optional on approve, but the panel encourages one on reject/request-more so the
 * user (and the audit trail) has a reason. Stored on the submission + audited.
 */
export class ReviewDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Approve carries an optional reviewer-confirmed item price (integer paise as a
 * string). Supply it for a PURCHASE screenshot when OCR couldn't read the amount
 * (or to correct a misread) — the reviewer reads the figure off the image. When
 * omitted and OCR read nothing, the item price stays UNKNOWN and the refund gate
 * blocks on it; we never silently assert the campaign price as a verified fact.
 */
export class ApproveDecisionDto extends ReviewDecisionDto {
  @IsOptional()
  @Matches(PAISE, { message: 'itemPaise must be integer paise as a string' })
  itemPaise?: string;

  /**
   * HOW MANY UNITS the screenshot shows.
   *
   * This is the one path where a human can actually answer the question: no
   * marketplace reader captures quantity, so a line total normally holds the refund
   * for a manual check. A reviewer looking at the image can read the units off it,
   * and supplying it here is what unblocks the payout — without anyone guessing.
   *
   * Omitted still means UNKNOWN, never 1.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;
}
