import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Add a payout destination. Only shape/length are validated here; the semantic
 * rules (PAN/UPI/IFSC format, cross-user dedup, PAN anchoring) live in the
 * service so they're enforced identically however the method is called.
 */
export class AddPayoutMethodDto {
  @IsIn(['UPI', 'BANK'])
  type!: 'UPI' | 'BANK';

  @IsString()
  @MaxLength(20)
  pan!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  upiId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(11)
  ifsc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;
}
