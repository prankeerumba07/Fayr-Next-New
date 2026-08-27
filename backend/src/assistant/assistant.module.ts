import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { AssistantStore } from './assistant.store';
import { UserJourneyService } from './user-journey.service';
import { AdminAssistantController } from './admin-assistant.controller';
import { AssistantController } from './assistant.controller';
import { AnswerEngine } from './answer-engine.service';
import { AnswerBookSource, ModelAnswerSource } from './answer-source';
import { AssistantSeedService } from './assistant-seed.service';

/**
 * The assistant's knowledge and its record of real activity.
 *
 * The store, the journey, the answer engine, and both sides of the wire: the app
 * asks through /assistant and staff read through /admin/assistant.
 *
 * AuthModule is imported for the user sign-in guard, AdminModule for the staff
 * guards and the audit trail — the same arrangement as the support module, which
 * also has a user side and a staff side in one place.
 *
 * AdminModule is imported for the staff guards and the audit trail, the same way
 * the support and offer-check modules do it. The dependency is one-directional:
 * AdminModule does not import this, so there is no cycle.
 */
@Module({
  imports: [PrismaModule, TicketModule, WalletModule, AdminModule, AuthModule],
  controllers: [AdminAssistantController, AssistantController],
  providers: [
    AssistantStore,
    UserJourneyService,
    AnswerBookSource,
    ModelAnswerSource,
    AnswerEngine,
    AssistantSeedService,
  ],
  exports: [
    AssistantStore,
    UserJourneyService,
    AnswerEngine,
    AssistantSeedService,
  ],
})
export class AssistantModule {}
