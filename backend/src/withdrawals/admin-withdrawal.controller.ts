import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { ListWithdrawalsQueryDto } from './dto/list-withdrawals.query';
import { MarkPaidDto } from './dto/mark-paid.dto';
import { ReasonDto } from './dto/reason.dto';
import {
  toWithdrawalResponse,
  toWithdrawalWithContext,
  type WithdrawalResponse,
  type WithdrawalWithContextResponse,
} from './withdrawal.response';
import { WithdrawalService } from './withdrawal.service';

/**
 * The staff withdrawal console (Phase 3). ADMIN-only this phase (a dedicated
 * FINANCE role is deferred). Disbursement is external: staff approve, then record
 * the UTR via mark-paid (which grants the +10 completion tickets), or reject/fail
 * a request (which reverses the reserved funds back to the user).
 */
@Controller('admin/withdrawals')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminWithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get()
  async list(
    @Query() query: ListWithdrawalsQueryDto,
  ): Promise<WithdrawalWithContextResponse[]> {
    const rows = await this.withdrawals.listAll(query.status);
    return rows.map(toWithdrawalWithContext);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalWithContextResponse> {
    return toWithdrawalWithContext(
      await this.withdrawals.getByIdWithContext(id),
    );
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalResponse> {
    return toWithdrawalResponse(await this.withdrawals.approve(staff.id, id));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<WithdrawalResponse> {
    return toWithdrawalResponse(
      await this.withdrawals.reject(staff.id, id, dto.reason),
    );
  }

  @Post(':id/mark-paid')
  @HttpCode(HttpStatus.OK)
  async markPaid(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
  ): Promise<WithdrawalResponse> {
    return toWithdrawalResponse(
      await this.withdrawals.markPaid(staff.id, id, dto.utr),
    );
  }

  @Post(':id/mark-failed')
  @HttpCode(HttpStatus.OK)
  async markFailed(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ): Promise<WithdrawalResponse> {
    return toWithdrawalResponse(
      await this.withdrawals.markFailed(staff.id, id, dto.reason),
    );
  }
}
