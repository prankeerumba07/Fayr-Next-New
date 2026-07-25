import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

/**
 * The task loop — the authoritative task state machine + its money/ticket
 * effects. Imports AuthModule (for JwtAuthGuard), and the ticket + wallet
 * ledgers, whose services it composes into its own transactions (claim → tickets,
 * release → wallet). Exports TaskService for the 1.6 scheduler.
 */
@Module({
  imports: [AuthModule, TicketModule, WalletModule],
  controllers: [TaskController],
  providers: [TaskService],
  exports: [TaskService],
})
export class TaskModule {}
