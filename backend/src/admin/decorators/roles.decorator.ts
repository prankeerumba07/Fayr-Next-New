import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@prisma/client';

/** Metadata key under which required roles are stored for RolesGuard to read. */
export const ROLES_KEY = 'staff_roles';

/**
 * Restrict a route (or controller) to the given staff roles. Applied ALONGSIDE
 * StaffAuthGuard — authentication first (who are you), then this for
 * authorization (are you allowed). A route with no @Roles is open to any
 * authenticated staff member.
 *
 *   @Roles('ADMIN')
 *   @Get('staff') listStaff() { ... }
 */
export const Roles = (
  ...roles: StaffRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
