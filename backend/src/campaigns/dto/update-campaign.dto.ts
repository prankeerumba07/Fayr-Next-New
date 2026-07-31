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

/** Integer paise as a decimal string, OR "" to clear an optional money field. */
const PAISE_OR_EMPTY = /^(\d{1,15})?$/;

/**
 * Body for PATCH /admin/campaigns/:id. Every field optional — only those present
 * are changed. For the clearable text/money fields (category, payoutCapPaise,
 * returnWindowDays override, terms, image, asin, productUrl) an empty string ""
 * means "clear it" (the service maps that to null); omitting leaves it as-is.
 * Editing is allowed only while a campaign is DRAFT or PAUSED (enforced in the
 * service), so a live campaign's terms can't shift under an already-claimed task.
 */
export class UpdateCampaignDto {
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @Matches(/^\d{1,15}$/, {
    message:
      'productPricePaise must be an integer number of paise (as a string)',
  })
  productPricePaise?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  payoutPercent?: number;

  @IsOptional()
  @Matches(PAISE_OR_EMPTY, {
    message:
      'payoutCapPaise must be an integer number of paise, or "" to clear',
  })
  payoutCapPaise?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  ticketCost?: number;

  // The nullable overrides accept `null` to clear them back to "use the default"
  // (@IsOptional skips the range checks when the value is null).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  returnWindowDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  minRating?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  totalSlots?: number | null;

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
