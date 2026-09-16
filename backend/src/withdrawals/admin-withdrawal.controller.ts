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
 * The staff withdrawal console. FINANCE owns it (ADMIN via the super-role);
 * SUPPORT/OPERATIONS cannot touch payouts. Disbursement is external: staff
 * approve, then record the UTR via mark-paid (which grants the +10 completion
 * tickets), or reject/fail a request (which reverses the reserved funds).
 */
@Controller('admin/withdrawals')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('FINANCE')
export class AdminWithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Get()
  async list(
    @Query() query: ListWithdrawalsQueryDto,
  ): Promise<WithdrawalWithContextResponse[]> {
    const rows = await this.withdrawals.listAll(query.status);
    // ── AND WHAT EACH ONE IS DRAWN FROM ──────────────────────────────────
    //
    // A withdrawal row carries an amount and no link to a task or a campaign,
    // so the queue could show a figure with nothing behind it — which is how
    // ₹100.00 beside a ₹938.00 order got read as that order's refund. It is a
    // cash-out from a wallet, and this is the wallet.
    //
    // ONE LOOK-UP PER ACCOUNT, NOT PER ROW. A person with three requests in the
    // queue has one wallet, and asking for it three times would be three reads
    // of the same ledger.
    const basis = new Map<string, Awaited<ReturnType<typeof this.withdrawals.basisFor>>>();
    for (const userId of new Set(rows.map((r) => r.userId))) {
      basis.set(userId, await this.withdrawals.basisFor(userId));
    }
    return rows.map((r) => toWithdrawalWithContext(r, basis.get(r.userId)));
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalWithContextResponse> {
    const row = await this.withdrawals.getByIdWithContext(id);
    return toWithdrawalWithContext(
      row,
      await this.withdrawals.basisFor(row.userId),
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
