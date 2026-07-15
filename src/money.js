// Money. The wallet is an append-only double-entry ledger in INTEGER PAISE, so
// nothing here may go through a float.
//
// Why this exists rather than `parseAmount(x) * 100`: float64 cannot hold most
// two-decimal rupee values exactly, so multiplying by 100 and truncating pays a
// paise short. Measured over ₹0.00-5000.99, 65,660 of those 500,100 values are
// inexact after *100. Real cases that LOSE a paise when truncated:
//     4.35 * 100 === 434.99999999999994  -> trunc 434, should be 435
//    16.08 * 100 === 1607.9999999999998  -> trunc 1607, should be 1608
//     0.29 * 100 ===   28.999999999999996 -> trunc 28,  should be 29
// The error is value-dependent, which is the trap: it passes every test written
// with round numbers like 249.00 and fails on real prices. Parse the digits as
// strings instead; never multiply a float.
//
// ONE canonical shape for scraped amounts: a plain decimal string, no currency
// symbol, no thousands separators - "388.00", "1326.00", "3000". Scrapers must
// normalise to that (see normAmount in src/platforms.js) and this module is the
// only thing that turns it into paise.

const AMOUNT_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

// "1326.00" -> 132600 | "388.5" -> 38850 | "3000" -> 300000 | bad input -> null.
// Tolerates a stray symbol/comma/space so a caller that forgot to normalise
// gets the right number rather than a wrong one.
export function toPaise(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    // Only accept integers here - a float amount is exactly the thing this
    // module exists to keep out of the ledger.
    return Number.isInteger(v) ? v * 100 : null;
  }
  const s = String(v).replace(/[₹,\s]/g, '');
  const m = s.match(AMOUNT_RE);
  if (!m) return null;
  const rupees = parseInt(m[1], 10);
  // Pad so ".5" is 50 paise, not 5.
  const frac = m[2] ? (m[2].length === 1 ? m[2] + '0' : m[2]) : '00';
  return rupees * 100 + parseInt(frac, 10);
}

// 132600 -> "1326.00". Display only; never round-trip money through this.
export function formatPaise(paise) {
  if (paise == null || !Number.isInteger(paise)) return null;
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

// A campaign pays a percentage of the ITEM price (e.g. 90% of a ₹1,000 item).
// Integer-only: floor to whole paise so we can never credit a fraction, and so
// the same inputs always produce the same number.
export function percentOfPaise(paise, percent) {
  if (paise == null || !Number.isInteger(paise)) return null;
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null;
  return Math.floor((paise * percent) / 100);
}
