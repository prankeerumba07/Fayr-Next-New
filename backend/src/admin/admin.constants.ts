/**
 * Staff-auth policy constants, in one place so they read as a spec and tests can
 * assert the same values. Product policy, not per-environment config.
 */

/**
 * Minimum staff password length. Enforced when a staff account is created
 * (bootstrap + future staff-management endpoints), NOT at login — login only
 * ever checks the presented password against the stored hash, and must not leak
 * the policy to an attacker probing the form.
 */
export const STAFF_PASSWORD_MIN_LENGTH = 12;

/** Audit-log action tags. Kept as constants so reads/writes agree on the string. */
export const AUDIT_ACTIONS = {
  STAFF_LOGIN: 'STAFF_LOGIN',
  USER_SEARCH: 'USER_SEARCH',
  USER_VIEW: 'USER_VIEW',
  QUESTION_REPLY: 'QUESTION_REPLY',
  QUESTION_CLOSE: 'QUESTION_CLOSE',
  STAFF_CREATE: 'STAFF_CREATE',
  STAFF_UPDATE: 'STAFF_UPDATE',
  CAMPAIGN_CREATE: 'CAMPAIGN_CREATE',
  CAMPAIGN_UPDATE: 'CAMPAIGN_UPDATE',
  CAMPAIGN_STATUS: 'CAMPAIGN_STATUS',
} as const;

/** The staff roles an admin can assign. Kept here so the DTO + tests share one list. */
export const STAFF_ROLES = [
  'SUPPORT',
  'FINANCE',
  'OPERATIONS',
  'ADMIN',
] as const;

/** Staff account states an admin can set. */
export const STAFF_STATUSES = ['ACTIVE', 'DISABLED'] as const;

/**
 * Normalize an email for storage and lookup: trim + lowercase. Applied on every
 * create and every login so "Admin@Fayr.local" and "admin@fayr.local " are the
 * same account and the @unique index does what a human expects.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
