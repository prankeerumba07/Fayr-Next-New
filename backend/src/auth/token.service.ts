import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, IssuedTokens, TokenMeta } from './auth.types';

/**
 * Owns the token lifecycle: signing short-lived JWT access tokens and
 * issuing/rotating/revoking long-lived refresh tokens.
 *
 * Refresh-token design:
 *   - The token itself is 256 bits of CSPRNG entropy, returned to the client
 *     ONCE. Only its SHA-256 hash is persisted, so a DB leak yields no usable
 *     token. (SHA-256 is safe here precisely because the input is high-entropy —
 *     unlike low-entropy OTP codes, which need argon2.)
 *   - Every use ROTATES: the presented token is revoked and a fresh one issued.
 *   - Presenting an already-revoked token is treated as theft → every session
 *     for that user is revoked (reuse detection).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  /** SHA-256 hex of a token — used for both storage and lookup. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private newRefreshValue(): string {
    return randomBytes(32).toString('base64url'); // 256 bits, URL-safe
  }

  private refreshExpiry(): Date {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private signAccess(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });
  }

  private issued(accessToken: string, refreshToken: string): IssuedTokens {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    };
  }

  /** Mint a brand-new session (login): fresh access + fresh refresh token. */
  async issueTokens(
    user: { id: string; mobile: string },
    meta: TokenMeta = {},
  ): Promise<IssuedTokens> {
    const refreshValue = this.newRefreshValue();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshValue),
        expiresAt: this.refreshExpiry(),
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    const accessToken = await this.signAccess({
      sub: user.id,
      mobile: user.mobile,
    });
    return this.issued(accessToken, refreshValue);
  }

  /** Validate a presented refresh token and rotate it for a fresh pair. */
  async rotateRefreshToken(
    presented: string,
    meta: TokenMeta = {},
  ): Promise<IssuedTokens> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(presented) },
      include: { user: true },
    });
    if (!existing) throw new UnauthorizedException('Invalid refresh token');

    // Re-presenting a revoked token means it was already rotated out (or stolen
    // and replayed). Fail closed AND revoke every session for the user.
    if (existing.revokedAt) {
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Refresh token already used');
    }
    if (existing.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (existing.user.status === 'BLOCKED') {
      throw new ForbiddenException('Account is blocked');
    }

    const refreshValue = this.newRefreshValue();
    // Rotate atomically. The revoke is CONDITIONAL on the row still being active,
    // so if two refreshes race, exactly one wins; the loser gets count 0 and is
    // handled as reuse below. Create rides in the same transaction, so we never
    // revoke the old without persisting the new.
    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoke = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoke.count === 0) return false;
      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: this.hashToken(refreshValue),
          expiresAt: this.refreshExpiry(),
          userAgent: meta.userAgent,
          ip: meta.ip,
        },
      });
      return true;
    });
    if (!rotated) {
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Refresh token already used');
    }

    const accessToken = await this.signAccess({
      sub: existing.userId,
      mobile: existing.user.mobile,
    });
    return this.issued(accessToken, refreshValue);
  }

  /** Revoke a single refresh token (logout). Idempotent — silent if unknown. */
  async revokeRefreshToken(presented: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
