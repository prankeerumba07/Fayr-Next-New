import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { MeController } from './me.controller';

/**
 * The signed-in user's own account surface. Imports AuthModule for JwtAuthGuard
 * and the ticket/wallet services it reads. Pure read layer — no providers of its
 * own beyond the controller.
 */
@Module({
  imports: [AuthModule, TicketModule, WalletModule],
  controllers: [MeController],
})
export class MeModule {}
