import { IsString, MaxLength, MinLength } from 'class-validator';

/** Records the external disbursement reference (UTR) when a payout is confirmed. */
export class MarkPaidDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  utr!: string;
}
