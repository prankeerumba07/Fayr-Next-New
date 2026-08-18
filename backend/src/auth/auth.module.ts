import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TicketModule } from '../tickets/ticket.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { smsSenderProvider } from './sms/sms.provider';
import { TokenService } from './token.service';

/**
 * Mobile-OTP authentication.
 *
 * JwtModule is registered with empty options on purpose — the signing secret and
 * TTL are passed per-call from validated config, so there is no place for a
 * hardcoded fallback secret to hide.
 *
 * The SMS sender is chosen by SMS_PROVIDER at boot (see sms/sms.provider.ts), not
 * hardcoded here. Unset means the console sender, so a fresh clone runs the whole
 * auth flow offline; a named provider with incomplete credentials refuses to boot
 * rather than degrading silently to the console.
 */
@Module({
  imports: [JwtModule.register({}), TicketModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    smsSenderProvider,
  ],
  // Exported so later feature modules can guard their routes and (rarely) mint
  // or revoke tokens. JwtModule is re-exported too, so JwtAuthGuard's own
  // dependency (JwtService) resolves wherever a downstream module imports
  // AuthModule to use the guard.
  exports: [JwtAuthGuard, TokenService, JwtModule],
})
export class AuthModule {}
