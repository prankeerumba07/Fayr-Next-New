/** E.164: a leading '+', first digit 1-9, then 7-14 more. Same rule as the DTOs. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Validate a mobile against the country we are configured to send to, and return
 * both forms a provider might ask for: the full E.164 string and the national part
 * without the country code.
 *
 * Returns null rather than guessing. A number outside the configured country must
 * be REFUSED, not reshaped: we cannot know where to cut the digits of a foreign
 * number, and the remainder could be a real number belonging to someone else.
 *
 * Shared so no provider can drift into its own idea of a valid number.
 */
export function splitMobile(
  mobile: string,
  countryCode: string,
): { e164: string; national: string } | null {
  if (typeof mobile !== 'string' || !E164.test(mobile)) return null;
  const digits = mobile.slice(1);
  if (!digits.startsWith(countryCode)) return null;
  const national = digits.slice(countryCode.length);
  if (national.length === 0) return null;
  return { e164: mobile, national };
}
