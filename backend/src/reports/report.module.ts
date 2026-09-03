import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminReportController } from './admin-report.controller';
import { ReportService } from './report.service';

/**
 * Staff analytics (Stage 4). Read-only aggregation over the domain tables with
 * JSON + Excel output. Imports AdminModule for the staff guards + audit service
 * (the same wiring the campaign console uses) — no cycle, since AdminModule does
 * not depend on this module.
 */
@Module({
  imports: [AdminModule],
  controllers: [AdminReportController],
  providers: [ReportService],
  // Exported for the page that measures Fayr itself, which counts the journey by
  // calling this rather than counting it again.
  exports: [ReportService],
})
export class ReportModule {}
