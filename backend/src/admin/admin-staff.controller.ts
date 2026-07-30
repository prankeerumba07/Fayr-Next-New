import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminStaffService } from './admin-staff.service';
import { CurrentStaff } from './decorators/current-staff.decorator';
import { Roles } from './decorators/roles.decorator';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { RolesGuard } from './guards/roles.guard';
import { StaffAuthGuard } from './guards/staff-auth.guard';
import type { StaffResponse } from './staff.response';
import type { AuthenticatedStaff } from './staff.types';

/**
 * Staff-account management — ADMIN only. This is where the FINANCE / OPERATIONS /
 * SUPPORT roles get assigned. Create returns 201 with the new account (no
 * password echoed); PATCH changes role/status. Both are audited by the service.
 */
@Controller('admin/staff')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminStaffController {
  constructor(private readonly staff: AdminStaffService) {}

  @Get()
  list(): Promise<StaffResponse[]> {
    return this.staff.list();
  }

  @Post()
  create(
    @CurrentStaff() actor: AuthenticatedStaff,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffResponse> {
    return this.staff.create(actor.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentStaff() actor: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffResponse> {
    return this.staff.update(actor.id, id, dto);
  }
}
