import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminWithdrawalController } from './admin-withdrawal.controller';
import { PayoutMethodController } from './payout-method.controller';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';

/**
 * The withdrawal / cash-out module (Phase 3). Orchestrates payout methods and the
 * withdrawal lifecycle on top of the WalletService ledger and the TicketService
 * (+10 completion grant).
 *
 * Imports AuthModule for the user JwtAuthGuard (the /me/payout-methods and
 * /withdrawals sides) and AdminModule for the staff guards (the /admin/withdrawals
 * console) — the same one-directional pattern as SupportModule.
 */
@Module({
  imports: [AuthModule, AdminModule, WalletModule, TicketModule],
  controllers: [
    PayoutMethodController,
    WithdrawalController,
    AdminWithdrawalController,
  ],
  providers: [WithdrawalService],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
