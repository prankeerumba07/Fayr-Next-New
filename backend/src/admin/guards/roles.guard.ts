import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestWithStaff } from '../staff.types';

/**
 * Role-based authorization for `/admin/*` routes. Runs AFTER StaffAuthGuard, so
 * `request.staff` is already populated. Reads the @Roles metadata (method wins
 * over class); if none is set the route is open to any authenticated staff.
 * Otherwise the staff member's role must be in the allowed set, or it's a 403.
 *
 * Fails closed: if it somehow runs without an authenticated staff principal
 * (guard misordering), it's a 401 rather than a silent allow.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithStaff>();
    if (!req.staff) {
      throw new UnauthorizedException();
    }
    // ADMIN is a super-role: it can do everything the functional roles
    // (SUPPORT / FINANCE / OPERATIONS) can, so it passes every @Roles check.
    // Routes then declare only the specific functional role they need.
    if (req.staff.role === 'ADMIN') return true;
    if (!required.includes(req.staff.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
