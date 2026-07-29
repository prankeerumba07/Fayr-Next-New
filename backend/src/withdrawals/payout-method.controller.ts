import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddPayoutMethodDto } from './dto/add-payout-method.dto';
import {
  toPayoutMethodResponse,
  type PayoutMethodResponse,
} from './withdrawal.response';
import { WithdrawalService } from './withdrawal.service';

/** The signed-in user's payout destinations. Destinations are echoed MASKED. */
@Controller('me/payout-methods')
@UseGuards(JwtAuthGuard)
export class PayoutMethodController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Post()
  async add(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddPayoutMethodDto,
  ): Promise<PayoutMethodResponse> {
    const method = await this.withdrawals.addPayoutMethod(user.id, dto);
    return toPayoutMethodResponse(method);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PayoutMethodResponse[]> {
    const methods = await this.withdrawals.listPayoutMethods(user.id);
    return methods.map(toPayoutMethodResponse);
  }
}
