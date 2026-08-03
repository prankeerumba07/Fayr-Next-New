import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
}
