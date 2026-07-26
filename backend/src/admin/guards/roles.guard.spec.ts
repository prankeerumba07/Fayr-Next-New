import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { StaffRole } from '@prisma/client';
import type { AuthenticatedStaff } from '../staff.types';
import { RolesGuard } from './roles.guard';

/**
 * Pure unit tests for the RBAC guard. The Reflector is stubbed to return the
 * @Roles metadata directly, so these pin the authorization decision without any
 * Nest wiring: no roles = open to any staff, otherwise role must be in the set.
 */

function makeCtx(staff?: AuthenticatedStaff): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ staff }) }),
  } as unknown as ExecutionContext;
}

function makeGuard(required: StaffRole[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

const support: AuthenticatedStaff = {
  id: 's1',
  email: 'a@fayr.local',
  role: 'SUPPORT',
};
const admin: AuthenticatedStaff = {
  id: 's2',
  email: 'b@fayr.local',
  role: 'ADMIN',
};

describe('RolesGuard', () => {
  it('allows any authenticated staff when no roles are required', () => {
    expect(makeGuard(undefined).canActivate(makeCtx(support))).toBe(true);
    expect(makeGuard([]).canActivate(makeCtx(support))).toBe(true);
  });

  it('allows a staff member whose role is in the required set', () => {
    expect(makeGuard(['ADMIN']).canActivate(makeCtx(admin))).toBe(true);
    expect(makeGuard(['SUPPORT', 'ADMIN']).canActivate(makeCtx(support))).toBe(
      true,
    );
  });

  it('forbids a staff member whose role is not in the required set', () => {
    expect(() => makeGuard(['ADMIN']).canActivate(makeCtx(support))).toThrow(
      ForbiddenException,
    );
  });

  it('fails closed (401) when no staff principal is present', () => {
    expect(() => makeGuard(['ADMIN']).canActivate(makeCtx(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
