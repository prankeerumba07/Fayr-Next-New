import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { CurrentStaff } from './decorators/current-staff.decorator';
import { Roles } from './decorators/roles.decorator';
import { SearchUsersDto } from './dto/search-users.dto';
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

  /**
   * Look somebody up by mobile number.
   *
   * A POST, with the number in the body, and NOT a GET with it in the address.
   * That is not a REST preference: a mobile number in a web address is written
   * into the application log, into any proxy's log, and into the browser history
   * of whichever staff laptop typed it, and none of those are places a person's
   * phone number should live. The log copy is separately stripped (see the pino
   * config); this removes the rest.
   *
   * Nothing is created, so it answers 200 rather than 201.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: SearchUsersDto,
  ): Promise<UserSummaryResponse> {
    return this.users.searchByMobile(staff.id, dto.mobile);
  }

  @Get(':id')
  view(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserViewResponse> {
    return this.users.getUserView(staff.id, id);
  }
}
