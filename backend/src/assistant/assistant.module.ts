import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { AssistantStore } from './assistant.store';
import { UserJourneyService } from './user-journey.service';
import { AdminAssistantController } from './admin-assistant.controller';

/**
 * The assistant's knowledge and its record of real activity.
 *
 * Phase 1 is the store, the journey, and the staff read endpoints. No engine, no
 * device screen, no scheduled job — everything later in this build reads and writes
 * through here.
 *
 * AdminModule is imported for the staff guards and the audit trail, the same way
 * the support and offer-check modules do it. The dependency is one-directional:
 * AdminModule does not import this, so there is no cycle.
 */
@Module({
  imports: [PrismaModule, TicketModule, WalletModule, AdminModule],
  controllers: [AdminAssistantController],
  providers: [AssistantStore, UserJourneyService],
  exports: [AssistantStore, UserJourneyService],
})
export class AssistantModule {}
