import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import type { AccessTokenPayload, RequestWithUser } from '../auth.types';

/**
 * Guards routes with a Bearer JWT access token. On success it attaches the
 * principal to `request.user` (read via the @CurrentUser decorator). Any
 * problem — missing header, bad signature, expiry — is a single generic 401;
 * we never leak *why* verification failed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const raw = req.headers['authorization'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      req.user = { id: payload.sub, mobile: payload.mobile };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
