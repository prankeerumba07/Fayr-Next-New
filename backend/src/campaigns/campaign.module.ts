import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { ShopModule } from '../shops/shop.module';
import { StorageModule } from '../storage/storage.module';
import { AdminCampaignController } from './admin-campaign.controller';
import { AdminCampaignService } from './admin-campaign.service';
import { AdminUploadController } from './admin-upload.controller';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

/**
 * Campaigns module. Two audiences share it:
 *  - Users: the read-only GET /campaigns (JwtAuthGuard) they browse and claim.
 *  - Staff (OPERATIONS): the guarded /admin/campaigns write console + image
 *    uploads. AdminModule is imported for the staff guards + audit service (the
 *    same wiring SupportModule uses); StorageModule backs the upload endpoint.
 *
 * ShopModule is imported so the feed can be ordered for the person asking: which
 * marketplaces they have CONNECTED is the first of the three ordering rules, and
 * one function counts those rows (see feed-order.ts).
 *
 * Imports AuthModule so JwtAuthGuard's dependencies resolve on the public routes.
 * Exports CampaignService for the task loop (1.5), which reads a campaign at claim.
 */
@Module({
  imports: [AuthModule, AdminModule, StorageModule, ShopModule],
  controllers: [
    CampaignController,
    AdminCampaignController,
    AdminUploadController,
  ],
  providers: [CampaignService, AdminCampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
