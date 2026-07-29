/**
 * Withdrawal / payout policy + validation, in one place so the service and tests
 * read against the same spec. These are product policy (code constants), not
 * per-environment config.
 */

/** Smallest cash-out allowed, in integer paise (₹100.00). */
export const MIN_WITHDRAWAL_PAISE = 10_000n;

/** Idempotency keys for the ledger legs a withdrawal produces (one each, ever). */
export const withdrawalKey = {
  reserve: (id: string): string => `withdrawal:reserve:${id}`,
  reversal: (id: string): string => `withdrawal:reversal:${id}`,
};

/** Indian PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** IFSC: 4 letters, a literal 0, then 6 alphanumerics (e.g. HDFC0001234). */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** UPI VPA: handle@psp — deliberately permissive. */
export const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,64}$/;
/** Bank account number: 6–20 digits. */
export const ACCOUNT_REGEX = /^\d{6,20}$/;

export const normalizePan = (s: string): string => s.trim().toUpperCase();
export const normalizeUpi = (s: string): string => s.trim().toLowerCase();
export const normalizeIfsc = (s: string): string => s.trim().toUpperCase();
export const normalizeAccount = (s: string): string => s.replace(/\s/g, '');

/**
 * Mask a payout destination for display/echo — staff and the user should be able
 * to recognize it, never read it back in full.
 */
export function maskUpi(upi: string): string {
  const [handle, psp] = upi.split('@');
  const head = handle.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, handle.length - 2))}@${psp}`;
}
export function maskAccount(account: string): string {
  const last4 = account.slice(-4);
  return `${'*'.repeat(Math.max(2, account.length - 4))}${last4}`;
}
