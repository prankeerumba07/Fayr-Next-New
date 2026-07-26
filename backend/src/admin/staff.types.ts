import type { StaffRole } from '@prisma/client';

/**
 * Shared staff-auth types. Kept free of Nest/DI imports so both the runtime
 * guards and the unit tests can use them without booting the container.
 *
 * These deliberately MIRROR the user-side auth types but stay a separate set:
 * the staff trust domain never shares a token shape (or a secret) with users.
 */

/** Claims carried inside a signed STAFF access token. */
export interface StaffAccessTokenPayload {
  /** Subject — the staff user's UUID. */
  sub: string;
  email: string;
  role: StaffRole;
  /**
   * Token-type tag. Belt-and-suspenders on top of the separate signing secret:
   * even if a secret were ever misconfigured to match, a token missing
   * `typ: 'staff'` is rejected by the staff guard.
   */
  typ: 'staff';
}

/** The authenticated staff principal attached to a request by StaffAuthGuard. */
export interface AuthenticatedStaff {
  id: string;
  email: string;
  role: StaffRole;
}

/** What the client receives on a successful staff login. */
export interface StaffSession {
  staff: AuthenticatedStaff;
  accessToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime, e.g. "8h" — informational for the client. */
  accessTokenExpiresIn: string;
}

/**
 * The subset of the HTTP request the staff guard/decorator touch. Declared
 * locally (not express types) so they stay narrowly typed, and so `staff` —
 * which the guard sets — is part of the contract and never collides with the
 * user-side `user` property.
 */
export interface RequestWithStaff {
  headers: Record<string, string | string[] | undefined>;
  staff?: AuthenticatedStaff;
}
