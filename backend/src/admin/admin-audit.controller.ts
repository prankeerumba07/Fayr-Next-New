import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';
import type { AuditListResponse } from './audit.response';
import { Roles } from './decorators/roles.decorator';
import { ListAuditQueryDto } from './dto/list-audit.query';
import { RolesGuard } from './guards/roles.guard';
import { StaffAuthGuard } from './guards/staff-auth.guard';

/**
 * Read access to the staff audit trail — ADMIN only. Support agents do their job
 * without seeing who looked at whom; reviewing that trail is an oversight
 * function, so @Roles('ADMIN') gates it (enforced by RolesGuard after
 * StaffAuthGuard authenticates). The read itself is not audited (it would just
 * add noise to the very log it reads).
 */
@Controller('admin/audit')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  list(@Query() query: ListAuditQueryDto): Promise<AuditListResponse> {
    return this.audit.list(query);
  }
}
