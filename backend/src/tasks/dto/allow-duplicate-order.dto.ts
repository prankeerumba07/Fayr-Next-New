import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Why a second task on one order number may be paid. Required, not optional:
 * this override is the one place a single purchase can legitimately produce two
 * refunds, so the audit row is worthless without the reasoning ("merged cart —
 * order 408-… contains both the shoes and the laptop case").
 */
export class AllowDuplicateOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
