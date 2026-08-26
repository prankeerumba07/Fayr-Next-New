import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantStore } from './assistant.store';

/**
 * The assistant's knowledge and its record of real activity.
 *
 * Phase 1 is the store and nothing else: no engine, no screens, no scheduled job.
 * Everything later in this build reads and writes through here, which is why it is
 * registered on its own first rather than arriving alongside the thing that uses
 * it.
 */
@Module({
  imports: [PrismaModule],
  providers: [AssistantStore],
  exports: [AssistantStore],
})
export class AssistantModule {}
