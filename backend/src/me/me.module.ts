import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactModule } from '../contact/contact.module';
import { TicketModule } from '../tickets/ticket.module';
import { WalletModule } from '../wallet/wallet.module';
import { ShopModule } from '../shops/shop.module';
import { MeController } from './me.controller';

/**
 * The signed-in user's own account surface. Imports AuthModule for JwtAuthGuard
 * and the ticket/wallet services it reads. Pure read layer — no providers of its
 * own beyond the controller.
 *
 * ShopModule is here so the profile can say WHICH SHOPS THEY ARE ALREADY SIGNED
 * IN AT. The app used to keep its own note of that in a file on the phone, keyed
 * by campaign, so a second campaign at the same shop looked like a shop nobody
 * had signed in to — and asking Amazon for its sign in page a second time is
 * what got Fayr taken for a robot. Our side has had the durable answer since 4
 * September; this is the import that lets the app read it.
 */
@Module({
  imports: [AuthModule, TicketModule, WalletModule, ContactModule, ShopModule],
  controllers: [MeController],
})
export class MeModule {}
