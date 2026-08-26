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
  REPORT_DOWNLOAD: 'REPORT_DOWNLOAD',
  CAMPAIGN_CHECK_RUN: 'CAMPAIGN_CHECK_RUN', // someone ran the offer check by hand
  ASSISTANT_QUESTION_VIEW: 'ASSISTANT_QUESTION_VIEW', // staff opened one person's own words + what they were doing
  SCREENSHOT_VIEW: 'SCREENSHOT_VIEW', // staff streamed a private verification screenshot
  EVIDENCE_REVIEW: 'EVIDENCE_REVIEW', // staff approved / rejected / requested-more on a case
  DUPLICATE_ORDER_ALLOW: 'DUPLICATE_ORDER_ALLOW', // staff let a second task on one order be paid
  TASK_QUANTITY_SET: 'TASK_QUANTITY_SET', // staff read the unit count off the order page
  TASK_AMOUNT_SET: 'TASK_AMOUNT_SET', // staff read what one unit cost off a real document
  TASK_REVIEW_VISIBLE: 'TASK_REVIEW_VISIBLE', // staff opened the product page and said whether the review is there
  // The four payout decisions. Kept as four tags rather than one WITHDRAWAL_DECISION
  // so the trail can be filtered down to the money that actually LEFT — the audit
  // list filters by action, and "show me every payout marked paid" is the question
  // an auditor asks first.
  WITHDRAWAL_APPROVE: 'WITHDRAWAL_APPROVE', // finance cleared a payout for disbursement
  WITHDRAWAL_REJECT: 'WITHDRAWAL_REJECT', // finance refused it and returned the money
  WITHDRAWAL_MARK_PAID: 'WITHDRAWAL_MARK_PAID', // finance recorded money leaving, with a UTR
  WITHDRAWAL_MARK_FAILED: 'WITHDRAWAL_MARK_FAILED', // the transfer failed; money returned
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
