import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';

/**
 * The ticket economy module. Provides TicketService (the append-only ticket
 * ledger) and exports it for the modules that move tickets — auth/registration
 * (the signup grant) and tasks (claim / expiry-return / completion) in later
 * steps. PrismaService is injected from the global PrismaModule.
 *
 * No controller yet: 1.3 is the ledger, exercised by services and tests. The
 * lifecycle wiring lands with the task loop.
 */
@Module({
  providers: [TicketService],
  exports: [TicketService],
})
export class TicketModule {}
