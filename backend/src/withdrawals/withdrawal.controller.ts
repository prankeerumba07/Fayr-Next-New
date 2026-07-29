import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequestWithdrawalDto } from './dto/request-withdrawal.dto';
import {
  toWithdrawalResponse,
  type WithdrawalResponse,
} from './withdrawal.response';
import { WithdrawalService } from './withdrawal.service';

/** The signed-in user's cash-outs: request one, list them, read one. */
@Controller('withdrawals')
@UseGuards(JwtAuthGuard)
export class WithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Post()
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<WithdrawalResponse> {
    const w = await this.withdrawals.requestWithdrawal(
      user.id,
      BigInt(dto.amountPaise),
      dto.payoutMethodId,
    );
    return toWithdrawalResponse(w);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WithdrawalResponse[]> {
    const list = await this.withdrawals.listForUser(user.id);
    return list.map(toWithdrawalResponse);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalResponse> {
    return toWithdrawalResponse(await this.withdrawals.getForUser(user.id, id));
  }
}
