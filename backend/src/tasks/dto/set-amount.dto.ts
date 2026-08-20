import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AMOUNT_EVIDENCE_SOURCES,
  type AmountEvidenceSource,
} from '../engine/evidence.types';

/** Integer paise as a decimal string — money never crosses the wire as a float. */
const PAISE = /^\d+$/;

/**
 * A staff member states what ONE UNIT cost.
 *
 * One unit, deliberately, not a line total. It is the only figure that is
 * unambiguous — it needs no quantity, cannot be divided by the wrong number, and
 * is exactly the judgement a person looking at an order page is able to make. A
 * line total would reintroduce the ambiguity the count rule exists to refuse.
 */
export class SetAmountDto {
  @Matches(PAISE, { message: 'unitPricePaise must be integer paise as a string' })
  unitPricePaise!: string;

  /**
   * WHERE the figure was read. A closed list, because free text alone is not a
   * defence if the payout is disputed — every value names a place somebody else
   * can go and check.
   */
  @IsIn(AMOUNT_EVIDENCE_SOURCES)
  evidenceSource!: AmountEvidenceSource;

  /** What they actually saw. Required: an audit row that says nothing looks like diligence. */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  /**
   * Set when the figure disagrees with the campaign's price by more than the
   * tolerance. The server refuses without it, so the acknowledgement is a real
   * gate rather than a dialog the panel could forget to show. A genuine discount
   * is legitimate — it just may not pass unremarked.
   */
  @IsOptional()
  @IsBoolean()
  acknowledgedDisagreement?: boolean;
}
