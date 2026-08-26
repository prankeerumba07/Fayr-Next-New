import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import type { AuthenticatedStaff } from '../admin/staff.types';
import {
  CampaignHealthService,
  type FindingKey,
  type HealthReport,
} from './campaign-health.service';

/** What the panel's Front-end operations tab reads. */
interface HealthView {
  report: HealthReport;
  /** When the nightly job last ran, and what it saw. Null before the first one. */
  lastRun: {
    ranAt: string;
    trigger: string;
    checked: number;
    blocking: number;
    attention: number;
    unchecked: number;
  } | null;
  /** Findings in this report that were not in the last recorded run. */
  newSinceLastRun: FindingKey[];
}

/**
 * THE OFFER CHECK, FOR THE TEAM THAT OWNS THE OFFERS.
 *
 * Front-end operations owns what is live and visible in the app — the offers,
 * their pictures, their words — so this is their queue, and it sits in their tab
 * in the panel.
 *
 * The permission behind it is OPERATIONS (ADMIN via the super-role), which is the
 * role that already owns campaigns. Front-end operations is a TEAM, and the tab
 * names the team; it is not yet a role of its own. Splitting the role is a real
 * change — RBAC, staff management, every test that asserts who can see what — and
 * inventing a half of it here would leave the panel claiming a separation the
 * server does not enforce.
 *
 * GET is a plain read and is not audited: it is the tab loading. POST re-runs the
 * check on demand and IS audited, because "who asked, and when" is the only way to
 * tell a deliberate re-check from the nightly job.
 */
@Controller('admin/campaign-health')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('OPERATIONS')
export class CampaignHealthController {
  constructor(
    private readonly health: CampaignHealthService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  async current(): Promise<HealthView> {
    const lastRun = await this.health.latestRun();
    const report = await this.health.run();
    return {
      report,
      lastRun: lastRun
        ? {
            ranAt: lastRun.ranAt.toISOString(),
            trigger: lastRun.trigger,
            checked: lastRun.checked,
            blocking: lastRun.blocking,
            attention: lastRun.attention,
            unchecked: lastRun.unchecked,
          }
        : null,
      newSinceLastRun: this.health.newSince(report, lastRun),
    };
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runNow(@CurrentStaff() staff: AuthenticatedStaff): Promise<HealthView> {
    const { report, fresh } = await this.health.runAndRecord('MANUAL');
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.CAMPAIGN_CHECK_RUN,
      metadata: {
        checked: report.checked,
        blocking: report.counts.blocking,
        attention: report.counts.attention,
        newFindings: fresh.length,
      },
    });
    const lastRun = await this.health.latestRun();
    return {
      report,
      lastRun: lastRun && {
        ranAt: lastRun.ranAt.toISOString(),
        trigger: lastRun.trigger,
        checked: lastRun.checked,
        blocking: lastRun.blocking,
        attention: lastRun.attention,
        unchecked: lastRun.unchecked,
      },
      newSinceLastRun: fresh,
    };
  }
}
