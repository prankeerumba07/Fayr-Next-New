/**
 * Integer paise → what a person reads.
 *
 * The ledger is append-only bigint paise and never anything else. Every message,
 * label and error a USER sees has to be rupees, and the conversion belongs at
 * that boundary rather than in each message — this exists because one message
 * read "Minimum withdrawal is 10000 paise", which a first-time user cannot tell
 * from ₹10,000.
 *
 * Exact bigint arithmetic, no float anywhere: a formatter that routes money
 * through a Number starts lying above 2^53 paise, and "the display was only
 * slightly wrong" is not a thing that can be said about money.
 *
 * Indian grouping — last three digits, then twos (₹1,00,00,000), which is what a
 * number is expected to look like here.
 */
export function rupeesOf(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / 100n;
  const fraction = abs % 100n;
  const grouped = groupIndian(whole.toString());
  const body =
    fraction === 0n
      ? `₹${grouped}`
      : `₹${grouped}.${fraction.toString().padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const parts: string[] = [];
  let i = rest.length;
  while (i > 2) {
    parts.unshift(rest.slice(i - 2, i));
    i -= 2;
  }
  if (i > 0) parts.unshift(rest.slice(0, i));
  return `${parts.join(',')},${last3}`;
}
