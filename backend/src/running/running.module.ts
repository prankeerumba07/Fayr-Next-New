import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ReportModule } from '../reports/report.module';
import { AdminRunningController } from './admin-running.controller';
import { RunningService } from './running.service';

/**
 * The page that measures Fayr itself.
 *
 * Imports AdminModule for the staff guards, and ReportModule for the report
 * service it counts the funnel with. Bringing the report in rather than counting
 * the journey a second time is the whole design: two functions counting one thing
 * disagree within a month.
 */
@Module({
  imports: [AdminModule, ReportModule],
  controllers: [AdminRunningController],
  providers: [RunningService],
})
export class RunningModule {}
