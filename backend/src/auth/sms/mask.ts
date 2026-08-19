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

/** Query parameters whose VALUE is a secret. Removed, never masked. */
const SECRET_PARAMS = new Set(['key', 'message', 'password', 'authtoken', 'token']);

/** A UUID, which is the shape of every API key we deal with. */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long, mixed-case-or-digit tokens in a path are credentials far more often than not. */
function looksLikeCredential(segment: string): boolean {
  if (UUID_LIKE.test(segment)) return true;
  if (segment.length < 20) return false;
  return /[A-Za-z]/.test(segment) && /[0-9]/.test(segment);
}

/**
 * A provider URL made safe to print.
 *
 * Two providers, two different hiding places, and BOTH have to be covered:
 *
 *  - Message Central puts the login code in `message` and the base-64 console
 *    password in `key` — both QUERY parameters.
 *  - 2Factor puts the API key AND the login code in the PATH:
 *      /API/V1/<api-key>/SMS/+91XXXXXXXXXX/<code>/<template>
 *    so query-only redaction would print a live credential in full.
 *
 * Secrets are REMOVED, not masked, so nothing can be inferred from their length.
 * Everything else survives, because a failure has to stay diagnosable — the host,
 * the route and a template name are all useful and none of them is sensitive.
 *
 * `secrets` is belt-and-braces on top of the heuristic: pass any literal value you
 * know is a credential and it goes regardless of what shape it happens to be.
 */
export function scrubUrlForLog(
  url: string,
  options: { secrets?: readonly string[] } = {},
): string {
  if (typeof url !== 'string') return '';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return scrubForLog(redactLiterals(url, options.secrets));
  }

  for (const [name] of [...parsed.searchParams]) {
    if (SECRET_PARAMS.has(name.toLowerCase())) {
      parsed.searchParams.set(name, '(hidden)');
    }
  }

  // Path segments: hide anything credential-shaped. A 6-digit code and a phone
  // number are left to the digit scrubber below, which masks both.
  parsed.pathname = parsed.pathname
    .split('/')
    .map((segment) => (looksLikeCredential(segment) ? '(hidden)' : segment))
    .join('/');

  const printable = decodeURIComponent(parsed.toString());
  return scrubForLog(redactLiterals(printable, options.secrets));
}

/** Remove exact known-secret substrings, whatever shape they are. */
function redactLiterals(text: string, secrets?: readonly string[]): string {
  if (!secrets || secrets.length === 0) return text;
  let out = text;
  for (const secret of secrets) {
    if (typeof secret !== 'string') continue;
    const trimmed = secret.trim();
    if (trimmed.length === 0) continue;
    out = out.split(trimmed).join('(hidden)');
  }
  return out;
}
