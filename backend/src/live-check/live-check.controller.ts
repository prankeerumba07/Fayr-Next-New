import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import {
  LiveCheckService,
  type LiveCheckReport,
  type OfferToCheck,
} from './live-check.service';
import { SubmitLiveResultsDto } from './dto/submit-results.dto';

interface RunSummary {
  ranAt: string;
  startedByStaffId: string;
  checked: number;
  opened: number;
  expired: number;
  soldOut: number;
  unavailable: number;
  couldNotOpen: number;
  noLink: number;
}

interface LiveCheckView {
  /** The most recent run, or null before anybody has done one. */
  lastRun: (RunSummary & { findings: unknown }) | null;
  /** The last two weeks of runs, so it is obvious whether this happens daily. */
  recent: RunSummary[];
  /** How many live offers there are to look at, and how many have a page at all. */
  toCheck: { total: number; withAPage: number; withNoPage: number };
}

/**
 * THE LIVE PAGE CHECK, FROM THE STAFF SIDE.
 *
 * OPERATIONS owns it, which is the role behind the Front-end operations tab —
 * the team that owns what is live and visible in the app.
 *
 * WHY THE PHONE POSTS HERE RATHER THAN A USER ENDPOINT. Marking an offer as
 * expired hides it from every user's feed. If an ordinary app login could do that,
 * one hostile person with a phone could empty the whole feed. So the screen that
 * runs this asks for a staff sign-in, and the phone posts with a staff token even
 * though it is running inside the app — the app is simply where the signed-in shop
 * session lives.
 */
@Controller('admin/live-check')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('OPERATIONS')
export class LiveCheckController {
  constructor(
    private readonly live: LiveCheckService,
    private readonly audit: AdminAuditService,
  ) {}

  /** What the person running it this morning has to open. */
  @Get('todo')
  offersToCheck(): Promise<OfferToCheck[]> {
    return this.live.offersToCheck();
  }

  /** What has been found, and whether this is actually happening every day. */
  @Get()
  async current(): Promise<LiveCheckView> {
    const [lastRun, recent, todo] = await Promise.all([
      this.live.latestRun(),
      this.live.recentRuns(),
      this.live.offersToCheck(),
    ]);
    return {
      lastRun: lastRun
        ? { ...this.summarise(lastRun), findings: lastRun.findings }
        : null,
      recent: recent.map((r) => this.summarise(r)),
      toCheck: {
        total: todo.length,
        withAPage: todo.filter((o) => !!o.productUrl).length,
        withNoPage: todo.filter((o) => !o.productUrl).length,
      },
    };
  }

  /** One morning's findings, from the phone that did the looking. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: SubmitLiveResultsDto,
  ): Promise<LiveCheckReport> {
    const report = await this.live.record(staff.id, dto.results);
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.LIVE_PAGE_CHECK_RUN,
      metadata: {
        checked: report.checked,
        expired: report.counts.expired,
        soldOut: report.counts['sold-out'],
        unavailable: report.counts.unavailable,
        couldNotOpen: report.counts['could-not-open'],
      },
    });
    return report;
  }

  private summarise(run: {
    ranAt: Date;
    startedByStaffId: string;
    checked: number;
    opened: number;
    expired: number;
    soldOut: number;
    unavailable: number;
    couldNotOpen: number;
    noLink: number;
  }): RunSummary {
    return {
      ranAt: run.ranAt.toISOString(),
      startedByStaffId: run.startedByStaffId,
      checked: run.checked,
      opened: run.opened,
      expired: run.expired,
      soldOut: run.soldOut,
      unavailable: run.unavailable,
      couldNotOpen: run.couldNotOpen,
      noLink: run.noLink,
    };
  }
}
