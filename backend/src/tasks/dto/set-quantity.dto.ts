import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * How many units a staff member read off the order page, and how they know.
 *
 * The reason is REQUIRED, exactly as it is on the duplicate-order override. This
 * decision is what makes a refund payable, so the audit row has to answer "why
 * did we pay this amount" a year later without anyone guessing — "the order page
 * shows one unit" is a record; a bare number is not.
 *
 * Bounds mirror the evidence DTO's, so a figure that could never have been paid
 * automatically cannot be typed in by hand either.
 */
export class SetQuantityDto {
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
