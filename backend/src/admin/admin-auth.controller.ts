import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentStaff } from './decorators/current-staff.decorator';
import { StaffLoginDto } from './dto/staff-login.dto';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import type { AuthenticatedStaff, StaffSession } from './staff.types';

/**
 * Staff authentication endpoints, under the `/admin` namespace that the whole
 * back office lives beneath. Everything here is a SEPARATE trust domain from the
 * user `/auth` routes — different credentials, different token secret, different
 * guard. No user token can reach a staff route, and no staff token authorizes a
 * user route.
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: StaffAuthService) {}

  /** Exchange email + password for a staff access token. Tightly throttled: a
   *  login endpoint is the prime brute-force target. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: StaffLoginDto): Promise<StaffSession> {
    return this.auth.login(dto.email, dto.password);
  }

  /** The authenticated staff principal — proves the guard + token round-trip. */
  @Get('me')
  @UseGuards(StaffAuthGuard)
  me(@CurrentStaff() staff: AuthenticatedStaff): Promise<AuthenticatedStaff> {
    return this.auth.getMe(staff.id);
  }
}
