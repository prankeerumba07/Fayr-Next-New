import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedStaff, RequestWithStaff } from '../staff.types';

/**
 * Injects the authenticated staff principal that StaffAuthGuard placed on the
 * request. Fails closed if used on a route the guard didn't run on, so a handler
 * can never silently receive an undefined staff member.
 */
export const CurrentStaff = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStaff => {
    const req = ctx.switchToHttp().getRequest<RequestWithStaff>();
    if (!req.staff) {
      throw new UnauthorizedException();
    }
    return req.staff;
  },
);
