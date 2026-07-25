import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

/**
 * Campaigns module. Exposes the read-only endpoints and exports CampaignService
 * for the task loop (1.5), which reads a campaign when a user claims it.
 *
 * Imports AuthModule so JwtAuthGuard's dependencies (JwtService, ConfigService)
 * resolve when the controller guards its routes.
 */
@Module({
  imports: [AuthModule],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
