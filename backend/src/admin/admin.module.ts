import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TaskModule } from '../tasks/task.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuditService } from './admin-audit.service';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStaffService } from './admin-staff.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { RolesGuard } from './guards/roles.guard';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import { StaffBootstrapService } from './staff-bootstrap.service';
import { StaffTokenService } from './staff-token.service';

/**
 * The staff / admin back office (Phase 2).
 *
 * Its own auth stack, walled off from the user app: email+password login, a
 * token signed with STAFF_JWT_SECRET, and role-based guards. JwtModule is
 * registered empty (like AuthModule) — the staff secret + TTL are passed
 * per-call from validated config, so there's no place for a hardcoded fallback.
 *
 * StaffAuthGuard, RolesGuard, and AdminAuditService are exported so the later
 * admin feature modules (unified user view, support questions) can guard their
 * routes and write the audit trail without re-wiring the auth stack.
 */
@Module({
  imports: [JwtModule.register({}), TicketModule, WalletModule, TaskModule],
  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminAuditController,
    AdminStaffController,
  ],
  providers: [
    StaffTokenService,
    StaffAuthService,
    AdminAuditService,
    AdminUsersService,
    AdminStaffService,
    StaffBootstrapService,
    StaffAuthGuard,
    RolesGuard,
  ],
  exports: [StaffAuthGuard, RolesGuard, StaffTokenService, AdminAuditService],
})
export class AdminModule {}
