import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LiveCheckController } from './live-check.controller';
import { LiveCheckService } from './live-check.service';

/**
 * The live page check: whether an offer's real shop page opens the way a shopper
 * would see it.
 *
 * No scheduled job here on purpose. It cannot run on a server: it needs a real
 * phone with a real signed-in shop session, so a person starts it every morning.
 */
@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [LiveCheckController],
  providers: [LiveCheckService],
  exports: [LiveCheckService],
})
export class LiveCheckModule {}
