import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ActivityService } from './activity.service';
import { AdminActivityController } from './admin-activity.controller';
import { AdminInsightsController } from './admin-insights.controller';
import { EventController } from './event.controller';
import { InsightsService } from './insights.service';

/**
 * The growth dashboard, one person's trail, and the one route the app reports
 * screens on.
 *
 * Imports AdminModule for the staff guards, the same one-directional pattern
 * SupportModule and WithdrawalModule use. It is NOT global and must not become
 * so: reading numbers is a thing two controllers do, not something the rest of
 * Fayr should be able to reach for.
 *
 * Recording a step is the opposite, and lives in UserEventModule, which IS
 * global — see the comment there.
 */
@Module({
  imports: [AdminModule],
  controllers: [AdminActivityController, AdminInsightsController, EventController],
  providers: [ActivityService, InsightsService],
  exports: [ActivityService, InsightsService],
})
export class InsightsModule {}
