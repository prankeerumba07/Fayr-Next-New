import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type AuthResult } from './auth.service';
import type {
  AuthenticatedUser,
  IssuedTokens,
  RequestWithUser,
  TokenMeta,
} from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { RefreshDto } from './dto/refresh.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  /** Request an OTP. Tighter per-IP throttle: codes are cheap to spam + cost SMS. */
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestOtp(
    @Body() dto: RequestOtpDto,
  ): Promise<{ expiresInSeconds: number; resendInSeconds: number }> {
    return this.auth.requestOtp(dto.mobile);
  }

  /** Verify an OTP and mint a session. */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: RequestWithUser,
  ): Promise<AuthResult> {
    return this.auth.verifyOtp(dto.mobile, dto.code, this.meta(req));
  }

  /**
   * Rotate a refresh token for a fresh access + refresh pair.
   *
   * Limited in its own right, not just by the app-wide ceiling. A refresh token is
   * long and random so guessing one is not the worry; what a limit stops is
   * somebody with one stolen token spinning it to keep a session alive for ever
   * without ever touching a rate-limited door.
   */
  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshDto,
    @Req() req: RequestWithUser,
  ): Promise<IssuedTokens> {
    return this.tokens.rotateRefreshToken(dto.refreshToken, this.meta(req));
  }

  /** Revoke a refresh token (logout). Idempotent, and limited like the rest. */
  @Post('logout')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshDto): Promise<{ ok: true }> {
    await this.tokens.revokeRefreshToken(dto.refreshToken);
    return { ok: true };
  }

  /** The authenticated principal — proves the guard + token round-trip. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthenticatedUser> {
    return this.auth.getMe(user.id);
  }

  private meta(req: RequestWithUser): TokenMeta {
    const ua = req.headers['user-agent'];
    return {
      userAgent: Array.isArray(ua) ? ua[0] : ua,
      ip: req.ip,
    };
  }
}
