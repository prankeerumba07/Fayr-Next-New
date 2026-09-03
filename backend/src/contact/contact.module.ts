import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';

/**
 * How a person reaches Fayr. No database, no controller of its own: the Help
 * screen reads it through /me, and the assistant reads it when it seeds the
 * answer book. One service, so there is one answer.
 */
@Module({
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule {}
