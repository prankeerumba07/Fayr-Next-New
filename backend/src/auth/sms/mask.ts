/**
 * Redaction for anything that goes near a log.
 *
 * A login code and a phone number are both credentials. The easy way to leak one
 * is to log a provider's error body verbatim — providers echo the request back,
 * so the body can contain the code we just sent and the number we sent it to.
 */

/** Digit runs this long or longer are treated as phone-number shaped. */
const PHONE_LIKE = 10;
/** Digit runs this long or longer are treated as possibly secret (OTP is 6). */
const SECRET_LIKE = 4;

/**
 * A phone number with everything but the last two digits masked. Length is
 * preserved so the shape is still recognisable in a log; the number is not.
 * A number too short to mask safely is masked completely.
 */
export function maskMobile(mobile: string): string {
  if (typeof mobile !== 'string' || mobile.length === 0) return '(no number)';
  const digits = mobile.replace(/\D/g, '');
  if (digits.length <= 2) return '*'.repeat(mobile.length);
  let seen = 0;
  const keepFrom = digits.length - 2;
  return mobile.replace(/\d/g, (d) => (seen++ >= keepFrom ? d : '*'));
}

/**
 * Scrub arbitrary provider text before logging it. Every digit run of 4+ is
 * masked; runs long enough to be a phone number keep their last two digits so a
 * support conversation can still match a report to a user.
 *
 * Deliberately aggressive: it is better to mask a harmless order number than to
 * let one six-digit login code through.
 */
export function scrubForLog(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/\d{4,}/g, (run) =>
    run.length >= PHONE_LIKE
      ? '•'.repeat(run.length - 2) + run.slice(-2)
      : '•'.repeat(run.length),
  );
}

/** True when a digit run of this length could be a secret. Exported for tests. */
export const isSecretLength = (n: number): boolean => n >= SECRET_LIKE;
