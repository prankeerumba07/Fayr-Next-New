import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CurrentStaff } from './decorators/current-staff.decorator';
import { Roles } from './decorators/roles.decorator';
import { SearchUsersQueryDto } from './dto/search-users.query';
import { RolesGuard } from './guards/roles.guard';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import type {
  UserSummaryResponse,
  UserViewResponse,
} from './user-view.response';
import type { AuthenticatedStaff } from './staff.types';

/**
 * The staff unified user view. Read-only by nature (no user-mutation routes),
 * so SUPPORT and FINANCE may both read it (ADMIN via the super-role): support
 * work needs it, and FINANCE reviews a user's activity to judge whether a payout
 * request looks legitimate before approving. Both handlers audit the access.
 *
 * Lookup is by MOBILE (the search DTO enforces E.164); drilling in uses the
 * opaque UUID from the search result (ParseUUIDPipe rejects anything else, so a
 * Fayr display id is never accepted even on the detail route).
 */
@Controller('admin/users')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT', 'FINANCE')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('search')
  search(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() query: SearchUsersQueryDto,
  ): Promise<UserSummaryResponse> {
    return this.users.searchByMobile(staff.id, query.mobile);
  }

  @Get(':id')
  view(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserViewResponse> {
    return this.users.getUserView(staff.id, id);
  }
}
