import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { AssistantStore } from './assistant.store';
import { UserJourneyService } from './user-journey.service';

/**
 * The assistant's knowledge and its record of real activity.
 *
 * Phase 1 is the store and nothing else: no engine, no screens, no scheduled job.
 * Everything later in this build reads and writes through here, which is why it is
 * registered on its own first rather than arriving alongside the thing that uses
 * it.
 */
@Module({
  imports: [PrismaModule, TicketModule, WalletModule],
  providers: [AssistantStore, UserJourneyService],
  exports: [AssistantStore, UserJourneyService],
})
export class AssistantModule {}
