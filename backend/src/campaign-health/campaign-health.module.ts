import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { CampaignHealthService } from './campaign-health.service';
import { CampaignHealthController } from './campaign-health.controller';
import { CampaignHealthScheduler } from './campaign-health.scheduler';

/**
 * The daily check on every live offer. Read-only over campaigns and tasks; the
 * only thing it writes is its own record of having run.
 */
@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [CampaignHealthController],
  providers: [CampaignHealthService, CampaignHealthScheduler],
  exports: [CampaignHealthService],
})
export class CampaignHealthModule {}
