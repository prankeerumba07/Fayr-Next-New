import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { RequestWithStaff } from '../staff.types';
import { StaffTokenService } from '../staff-token.service';

/**
 * Guards `/admin/*` routes with a staff Bearer token. On success it attaches the
 * staff principal to `request.staff` (read via @CurrentStaff). Any problem —
 * missing header, wrong trust domain, expiry — is a single generic 401; we never
 * leak WHY. Because the token is verified with STAFF_JWT_SECRET (not the user
 * secret), a user access token presented here fails signature verification and
 * is rejected — the isolation is cryptographic.
 */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(private readonly tokens: StaffTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithStaff>();
    const raw = req.headers['authorization'];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = await this.tokens.verify(token);
      req.staff = { id: payload.sub, email: payload.email, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
