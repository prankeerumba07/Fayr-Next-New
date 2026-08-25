// Pure, dependency-free auth helpers — importable by BOTH the RN app and the
// Node test runner (no react-native / expo imports here on purpose, so
// format.test.mjs can exercise them with plain `node`).

/** The backend's OTP length (auth.constants OTP_LENGTH). */
export const CODE_LENGTH = 6;

// A 10-digit Indian mobile → E.164 (+91…), the exact shape the backend's
// E164_REGEX (/^\+[1-9]\d{7,14}$/) validates. Already-prefixed input is
// respected; spaces, dashes and a domestic trunk 0 are tolerated so the user
// can type naturally.
export function toE164(input) {
  const raw = String(input == null ? '' : input).trim();
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }
  let digits = raw.replace(/\D/g, '');
  // Drop a domestic trunk 0 (0XXXXXXXXXX) before applying the country code.
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return digits ? `+91${digits}` : '';
}

// Is this a plausible 10-digit Indian mobile (first digit 6–9)? Gates the
// "Send code" button so we don't round-trip an obviously-bad number. Accepts
// the same shapes toE164 does.
export function isValidIndianMobile(input) {
  return /^\+91[6-9]\d{9}$/.test(toE164(input));
}

// Map a failed auth response (status + parsed body) to ONE friendly, actionable
// line. The backend deliberately returns generic messages (so an attacker can't
// probe which numbers exist); we keep them generic but human. resendInSeconds
// (from a 429) is surfaced so the UI can show a countdown.
export function describeAuthError(status, body) {
  const b = body || {};
  if (status === 0) {
    return {
      message:
        b.message ||
        "Can't reach the Fayr server. Check your connection and that the backend is running.",
    };
  }
  if (status === 429) {
    const secs =
      Number(b.resendInSeconds) > 0 ? Math.ceil(Number(b.resendInSeconds)) : null;
    return {
      message: secs
        ? `Please wait ${secs}s before requesting another code.`
        : 'Too many requests — please wait a moment and try again.',
      resendInSeconds: secs,
    };
  }
  if (status === 401) {
    return { message: 'That code is wrong or has expired. Check it, or request a new one.' };
  }
  if (status === 403) {
    return { message: 'This account is blocked. Contact support if you think this is a mistake.' };
  }
  if (typeof b.message === 'string' && b.message) return { message: b.message };
  return { message: 'Something went wrong. Please try again.' };
}
