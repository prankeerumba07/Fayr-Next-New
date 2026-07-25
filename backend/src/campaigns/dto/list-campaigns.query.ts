import { Platform } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * Query for GET /campaigns. `platform` is an optional filter; when present it
 * must be a known marketplace (an unknown value is a 400, not silently ignored).
 * Phase 1 only seeds Amazon, but the filter is enum-validated for the future.
 */
export class ListCampaignsQuery {
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;
}
