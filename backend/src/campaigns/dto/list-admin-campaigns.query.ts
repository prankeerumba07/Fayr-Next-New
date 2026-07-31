import { CampaignStatus, Platform } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/**
 * Query for GET /admin/campaigns (staff console). Unlike the public list, this
 * returns campaigns in EVERY status by default; `status` and `platform` narrow
 * it. An unknown value for either is a 400, not a silent no-op.
 */
export class ListAdminCampaignsQuery {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;
}
