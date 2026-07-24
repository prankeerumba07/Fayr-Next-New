import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedUser, RequestWithUser } from '../auth.types';

/**
 * Injects the authenticated principal that JwtAuthGuard placed on the request.
 * Fails closed if used on a route the guard didn't run on, so a handler can
 * never silently receive an undefined user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) {
      throw new UnauthorizedException();
    }
    return req.user;
  },
);
