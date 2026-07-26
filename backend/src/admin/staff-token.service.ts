import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { StaffRole } from '@prisma/client';
import type { Env } from '../config/env.validation';
import type { StaffAccessTokenPayload, StaffSession } from './staff.types';

/**
 * Mints staff access tokens.
 *
 * Deliberately simpler than the user-side TokenService: staff get a single
 * medium-lived access token and NO refresh rotation (they re-login when it
 * expires). The security separation lives in the SECRET — STAFF_JWT_SECRET is
 * distinct from JWT_ACCESS_SECRET, so a staff token and a user token are signed
 * in different trust domains and neither verifies as the other.
 */
@Injectable()
export class StaffTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Sign a fresh staff access token for a login. */
  async issueSession(staff: {
    id: string;
    email: string;
    role: StaffRole;
  }): Promise<StaffSession> {
    const accessToken = await this.signAccess({
      sub: staff.id,
      email: staff.email,
      role: staff.role,
      typ: 'staff',
    });
    return {
      staff: { id: staff.id, email: staff.email, role: staff.role },
      accessToken,
      tokenType: 'Bearer',
      accessTokenExpiresIn: this.config.get('STAFF_JWT_TTL', { infer: true }),
    };
  }

  private signAccess(payload: StaffAccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.get('STAFF_JWT_SECRET', { infer: true }),
      expiresIn: this.config.get('STAFF_JWT_TTL', { infer: true }),
    });
  }

  /**
   * Verify a presented staff token. Throws if the signature/expiry is bad OR the
   * `typ` tag is missing — so a token from any other trust domain is rejected
   * even before the guard reads its claims.
   */
  async verify(token: string): Promise<StaffAccessTokenPayload> {
    const payload = await this.jwt.verifyAsync<StaffAccessTokenPayload>(token, {
      secret: this.config.get('STAFF_JWT_SECRET', { infer: true }),
    });
    if (payload.typ !== 'staff') {
      throw new Error('not a staff token');
    }
    return payload;
  }
}
