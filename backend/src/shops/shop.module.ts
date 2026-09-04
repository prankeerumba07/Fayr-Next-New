import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ShopSignInController } from './shop-sign-in.controller';
import { ShopSignInService } from './shop-sign-in.service';

/**
 * The record of who got signed in at which shop, and when.
 *
 * AuthModule for the sign-in guard. Exported because the page that measures Fayr
 * counts these rows, and one function should count them.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ShopSignInController],
  providers: [ShopSignInService],
  exports: [ShopSignInService],
})
export class ShopModule {}
