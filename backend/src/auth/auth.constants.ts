/**
 * OTP + auth policy constants, in one place so they read as a spec and the tests
 * can assert against the same values. These are deliberately code constants (not
 * env) — they're product policy, not per-environment configuration.
 */

/** Length of the numeric OTP code. */
export const OTP_LENGTH = 6;

/** How long a code is valid after issue. */
export const OTP_TTL_SECONDS = 5 * 60; // 5 minutes

/** Wrong-code attempts allowed on a single challenge before it's locked. */
export const OTP_MAX_ATTEMPTS = 5;

/** Minimum gap between successive OTP requests for the same number. */
export const OTP_RESEND_COOLDOWN_SECONDS = 30;

/**
 * E.164 mobile number: leading '+', first digit 1-9, then 7–14 more digits.
 * Shared by the request/verify DTOs so validation is identical on both.
 */
export const E164_REGEX = /^\+[1-9]\d{7,14}$/;
