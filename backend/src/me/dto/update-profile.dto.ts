import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * The answers the first-run setup sequence collects. Every field is optional so
 * the sequence can save PROGRESSIVELY — a user who abandons after step 1 keeps
 * step 1, and resuming does not have to resend everything.
 */

/** Bands, never a date of birth: we have no use for one, so we do not ask. */
export const AGE_BANDS = [
  '18 - 24',
  '25 - 34',
  '35 - 44',
  '45 and above',
] as const;

export const GENDERS = [
  'Female',
  'Male',
  'Other',
  'Prefer not to say',
] as const;

/** The shopping interests offered by the setup screen, verbatim. */
export const CATEGORIES = [
  'Fashion & Apparel',
  'Beauty & Personal Care',
  'Electronics & Mobile',
  'Footwear',
  'Home & Kitchen',
  'Grocery & Daily Needs',
  'Sports & Fitness',
  'Toys, Babies & Kids',
] as const;

/** Marketplaces a user can say they already shop on. Mirrors the Platform enum. */
export const SHOP_PLATFORMS = [
  'amazon',
  'flipkart',
  'meesho',
  'myntra',
  'blinkit',
  'zepto',
  'instamart',
  'others',
] as const;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsIn(AGE_BANDS as unknown as string[])
  ageBand?: string;

  @IsOptional()
  @IsIn(GENDERS as unknown as string[])
  gender?: string;

  // Validated against a fixed list rather than accepting free text: these drive
  // the feed, and an open string column would quietly fill with typos.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CATEGORIES.length)
  @IsIn(CATEGORIES as unknown as string[], { each: true })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SHOP_PLATFORMS.length)
  @IsIn(SHOP_PLATFORMS as unknown as string[], { each: true })
  platforms?: string[];

  /**
   * Sent as `true` when the user reaches the end of the sequence. Kept separate
   * from the answers so that finishing setup WITHOUT giving a name still counts
   * as done — otherwise "Prefer not to say" users get asked forever.
   *
   * One-way: it stamps setupDoneAt if unset and can never clear it, so a later
   * profile edit cannot accidentally reopen onboarding.
   */
  @IsOptional()
  @IsBoolean()
  setupDone?: boolean;
}
