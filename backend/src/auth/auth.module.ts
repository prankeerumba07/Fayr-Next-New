import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { DevSmsSender } from './sms/dev-sms-sender';
import { SMS_SENDER } from './sms/sms-sender';
import { TokenService } from './token.service';

/**
 * Mobile-OTP authentication.
 *
 * JwtModule is registered with empty options on purpose — the signing secret and
 * TTL are passed per-call from validated config, so there is no place for a
 * hardcoded fallback secret to hide.
 *
 * The SMS sender is bound to the dev (console) implementation. Swapping in a real
 * provider for production is a one-line change here and nowhere else.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    JwtAuthGuard,
    { provide: SMS_SENDER, useClass: DevSmsSender },
  ],
  // Exported so later feature modules can guard their routes and (rarely) mint
  // or revoke tokens. JwtModule is re-exported too, so JwtAuthGuard's own
  // dependency (JwtService) resolves wherever a downstream module imports
  // AuthModule to use the guard.
  exports: [JwtAuthGuard, TokenService, JwtModule],
})
export class AuthModule {}
