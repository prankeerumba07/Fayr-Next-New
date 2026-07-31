import {
  Controller,
  Get,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { ReportRangeQuery } from './dto/report-range.query';
import {
  activityWorkbook,
  campaignsWorkbook,
  payoutsWorkbook,
  usersWorkbook,
} from './report-workbook';
import { ReportService } from './report.service';
import type { ReportRange } from './report.types';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Staff analytics. Each report is role-scoped (per the staff-roles table):
 * OPERATIONS gets offers performance, FINANCE gets payouts, ADMIN gets those two
 * plus the activity funnel and user growth (and, via the super-role, everything).
 * Every endpoint returns JSON by default, or an .xlsx download with ?format=xlsx.
 * Downloads are audited — this is aggregate financial/PII data leaving the system.
 */
@Controller('admin/reports')
@UseGuards(StaffAuthGuard, RolesGuard)
export class AdminReportController {
  constructor(
    private readonly reports: ReportService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('campaigns')
  @Roles('OPERATIONS')
  async campaigns(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() q: ReportRangeQuery,
  ) {
    const report = await this.reports.campaignPerformance(q);
    return q.format === 'xlsx'
      ? this.download(staff.id, 'campaigns', report.range, () =>
          campaignsWorkbook(report),
        )
      : report;
  }

  @Get('payouts')
  @Roles('FINANCE')
  async payouts(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() q: ReportRangeQuery,
  ) {
    const report = await this.reports.payouts(q);
    return q.format === 'xlsx'
      ? this.download(staff.id, 'payouts', report.range, () =>
          payoutsWorkbook(report),
        )
      : report;
  }

  @Get('activity')
  @Roles('ADMIN')
  async activity(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() q: ReportRangeQuery,
  ) {
    const report = await this.reports.activity(q);
    return q.format === 'xlsx'
      ? this.download(staff.id, 'activity', report.range, () =>
          activityWorkbook(report),
        )
      : report;
  }

  @Get('users')
  @Roles('ADMIN')
  async users(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() q: ReportRangeQuery,
  ) {
    const report = await this.reports.userGrowth(q);
    return q.format === 'xlsx'
      ? this.download(staff.id, 'users', report.range, () =>
          usersWorkbook(report),
        )
      : report;
  }

  /** Build the workbook, audit the export, and stream it as an .xlsx attachment. */
  private async download(
    staffId: string,
    type: string,
    range: ReportRange,
    build: () => Promise<Buffer>,
  ): Promise<StreamableFile> {
    const buffer = await build();
    await this.audit.record({
      staffUserId: staffId,
      action: AUDIT_ACTIONS.REPORT_DOWNLOAD,
      metadata: { type, from: range.from, to: range.to },
    });
    const filename = `fayr-${type}-${range.from.slice(0, 10)}_to_${range.to.slice(0, 10)}.xlsx`;
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
