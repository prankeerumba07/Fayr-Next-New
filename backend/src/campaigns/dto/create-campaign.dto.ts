import { Platform } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Integer paise as a decimal string (JSON has no BigInt), up to 15 digits. */
const PAISE = /^\d{1,15}$/;

/**
 * Body for POST /admin/campaigns — an OPERATIONS staff member drafting a new
 * campaign. Money crosses the wire as decimal STRINGS of integer paise; the
 * service parses them to BigInt. Status is NOT accepted here: a create always
 * lands in DRAFT and is moved live via the explicit publish endpoint.
 */
export class CreateCampaignDto {
  @IsEnum(Platform)
  platform!: Platform;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  productName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @Matches(PAISE, {
    message:
      'productPricePaise must be an integer number of paise (as a string)',
  })
  productPricePaise!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  payoutPercent?: number;

  @IsOptional()
  @Matches(PAISE, {
    message: 'payoutCapPaise must be an integer number of paise (as a string)',
  })
  payoutCapPaise?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ticketCost?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  returnWindowDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  totalSlots?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  asin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  productUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;
}
