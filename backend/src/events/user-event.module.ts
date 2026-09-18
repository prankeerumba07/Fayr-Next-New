import { Global, Module } from '@nestjs/common';
import { UserEventService } from './user-event.service';

/**
 * Measurement, available everywhere.
 *
 * GLOBAL on purpose, and it is the only global module in Fayr besides config and
 * prisma. Steps get recorded in auth, in setup, in the feed and in tasks, and
 * the alternative is adding an import line to every one of those modules — which
 * is the kind of chore that ends with somebody deciding not to record a step
 * rather than touch another file.
 *
 * It is safe to be global because it is one method that writes to one table and
 * cannot throw. Nothing can be broken by having it in scope.
 */
@Global()
@Module({
  providers: [UserEventService],
  exports: [UserEventService],
})
export class UserEventModule {}
