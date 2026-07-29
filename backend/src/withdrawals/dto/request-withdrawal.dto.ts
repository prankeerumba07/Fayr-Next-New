import { IsUUID, Matches } from 'class-validator';

/**
 * Request a cash-out. Money crosses the wire as a decimal STRING of integer paise
 * (JSON has no BigInt) — the service parses it to a bigint. `payoutMethodId` must
 * be one of the caller's own active methods (checked in the service).
 */
export class RequestWithdrawalDto {
  @Matches(/^\d{1,15}$/, {
    message: 'amountPaise must be an integer number of paise (as a string)',
  })
  amountPaise!: string;

  @IsUUID()
  payoutMethodId!: string;
}
