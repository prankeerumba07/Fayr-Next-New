import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { HowItIsRunningResponse } from './running.response';
import { RunningService } from './running.service';

/**
 * HOW FAYR IS RUNNING. ONE ROUTE, READ ONLY, NO FORM.
 *
 * ── WHY IT TAKES NO QUERY AT ALL ─────────────────────────────────────────────
 *
 * That is the whole difference from the reports beside it. A report is a thing
 * you ask a question of, so it takes a date range and a granularity. This is the
 * answer to "how do you know it is working", and a director does not fill in a
 * form to find out whether the product works. It reads on open.
 *
 * ── WHO CAN OPEN IT ──────────────────────────────────────────────────────────
 *
 * Every role, decided by the owner on 3 September 2026. ADMIN is not listed
 * below because it is a super-role and passes every role check already, which is
 * how every other route here is written. The three functional roles are named
 * rather than the check being left off: a role added later then has to be let in
 * deliberately, instead of arriving with the run of the place.
 *
 * Nothing on the page belongs to one team: there is no name on it, no mobile number, no order, no
 * personal detail of any kind, only counts and totals. And the question it
 * answers belongs to everybody who runs Fayr. Splitting it by team was
 * considered and refused for one concrete reason: the finance roles would then
 * not have seen that two refunds are held past their return time, which is the
 * thing they most need to know.
 *
 * NOT public. It is still behind the staff sign-in and the role guard, because
 * "no personal detail" is not the same as "safe to publish".
 *
 * ── WHY IT IS NOT AUDITED ────────────────────────────────────────────────────
 *
 * The report downloads are audited because aggregate money data is leaving the
 * system as a file. This returns no file, no name and no figure about any one
 * person, so a row per page view would be noise in the trail that matters.
 */
@Controller('admin/how-it-is-running')
@UseGuards(StaffAuthGuard, RolesGuard)
export class AdminRunningController {
  constructor(private readonly running: RunningService) {}

  @Get()
  @Roles('SUPPORT', 'FINANCE', 'OPERATIONS')
  read(): Promise<HowItIsRunningResponse> {
    return this.running.read();
  }
}
