import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';

/**
 * The wallet ledger module. Provides WalletService (the double-entry posting
 * primitive + balances) and exports it for the domain modules that post money —
 * tasks (refunds) in 1.5, withdrawals later. PrismaService is injected from the
 * global PrismaModule, so it isn't imported here.
 *
 * No controller yet: 1.2 is the money core, exercised by services and tests. The
 * user-facing wallet endpoints arrive with the task loop.
 */
@Module({
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
