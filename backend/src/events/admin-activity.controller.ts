import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { ActivityService, type UserActivity } from './activity.service';
import { ActivityQueryDto } from './dto/activity.query';

/**
 * ONE PERSON'S TRAIL: WHAT THEY DID, AND WHEN.
 *
 * SUPPORT, which is the role that answers shoppers and therefore the role that
 * needs this. ADMIN reaches it through the super-role short-circuit in
 * RolesGuard, as everywhere else.
 *
 * ── WHY IT LIVES BESIDE THE DASHBOARD AND NOT IN AdminModule ──────────────
 *
 * It shares the address of the unified user view, on purpose — a trail is a
 * thing you open ABOUT a person you already searched for, and a second address
 * would mean the panel had to know two. But it is a measurement read: it reaches
 * for user_events, task_events, chats and refresh_tokens, and it borrows the
 * insights service's definition of a session that ran out. Those are this
 * module's concerns, and AdminModule is already large.
 *
 * Nest resolves the two controllers apart without help: AdminUsersController's
 * GET :id cannot match a two-segment path, so :id/activity is unambiguous.
 *
 * READ-ONLY, with the single exception the service documents: every read writes
 * one AdminAuditLog row, because reading somebody's whole behaviour is an act.
 */
@Controller('admin/users')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class AdminActivityController {
  constructor(private readonly activity: ActivityService) {}

  /**
   * The merged, newest-first trail for one person.
   *
   * The id is the opaque uuid from the search result, and ParseUUIDPipe refuses
   * anything else — the same rule the unified view follows, so a Fayr display id
   * is never accepted on an address either.
   */
  @Get(':id/activity')
  read(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ): Promise<UserActivity> {
    return this.activity.forUser(staff.id, id, query.days, query.limit);
  }
}
