import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TicketService } from '../tickets/ticket.service';
import { WalletService } from '../wallet/wallet.service';

/** The signed-in user's own balances. Money is integer paise as a STRING. */
export interface MyWalletResponse {
  ticketBalance: number;
  walletBalancePaise: string;
}

/**
 * The authenticated user's own account reads. `/me/wallet` gives the app what it
 * needs for the wallet/earnings screen: the current ticket count and the
 * refundable balance (SUM over the ledger, in paise). Read-only — it never posts.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly tickets: TicketService,
    private readonly wallet: WalletService,
  ) {}

  @Get('wallet')
  async wallet_(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyWalletResponse> {
    const [ticketBalance, paise] = await Promise.all([
      this.tickets.getBalance(user.id),
      this.wallet.getUserBalance(user.id),
    ]);
    return { ticketBalance, walletBalancePaise: paise.toString() };
  }
}
