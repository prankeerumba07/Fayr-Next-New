/**
 * INDIA'S OWN CLOCK, FOR PAGES THAT PRINT A TIME OF DAY.
 *
 * ── WHY THIS EXISTS — PHASE 8B-c, 20 SEPTEMBER 2026 ────────────────────────
 *
 * A quick commerce order page states the MINUTE a parcel arrived:
 *
 *   Order Arrived at / 25 Aug 2026, 9:02 PM
 *   Shipment 1 Arrived at / 21 Jul 2026, 5:32 PM
 *
 * That time was read off the page and thrown away. The day was kept and turned
 * into an instant at noon UTC — 17:30 in India — which is a sensible thing to do
 * with a date being COMPARED and a wrong thing to do with the moment a hold is
 * counted from. Two things went wrong because of it, and both are measured:
 *
 *   A THREE HOUR HOLD ANCHORED TO THE WRONG INSTANT. The hold for the three
 *     shops that cannot be sent back to runs from the delivery. Anchored to
 *     17:30 whatever the page said, a parcel that arrived at nine in the evening
 *     released its refund at half past eight — before it turned up.
 *   A DELIVERY READ IN THE MORNING WAS IN THE FUTURE. evidence-plausibility
 *     allows six hours of clock skew. A page read at ten in the morning carried
 *     a delivery instant of 17:30 that same day, seven and a half hours ahead,
 *     and the whole read was REFUSED as delivery-date-in-future. It only ever
 *     passed because the one live run happened after eight in the evening.
 *
 * ── WHY THE OFFSET IS FIXED AND NOT ASKED OF THE MACHINE ───────────────────
 *
 * India is five and a half hours ahead of universal time and has no summer time,
 * so the offset is a constant and not a lookup. This runs on a server whose own
 * zone is nobody's business — the page was printed in India, by an Indian shop,
 * for somebody standing in India, and it says so. shop-visit-words.ts has said
 * the same thing since it was written; ONE copy of the number now, here, and it
 * reads it from this file.
 *
 * PURE. No clock of its own, no Date.now, nothing to configure.
 */

/** India is five and a half hours ahead of universal time, and has no summer time. */
export const INDIA_OFFSET_MS = 330 * 60 * 1000;

/** A time of day as the page printed it, already turned into 24 hour terms. */
export interface ClockReading {
  hours: number;
  minutes: number;
}

/**
 * "9:02 PM", "6:09 AM", "5:32 pm", "12:00 a.m." — AND NOTHING ELSE.
 *
 * ANCHORED AT THE VERY START, with an optional comma in front of it, because
 * that is exactly how the measured pages write it: the day, a comma, the time.
 * A number further along a sentence is not a time and must never become one — a
 * delivery instant invented out of a price or an order number would move the
 * moment somebody's money is released.
 *
 * TWENTY-FOUR HOUR TIMES ARE REFUSED, deliberately and not by oversight. No page
 * anybody has measured prints one, and "17:32" and "5:32" are the same four
 * characters apart; accepting both means guessing which was meant on the day a
 * shop changes its layout. Null is the answer this whole file gives to anything
 * it has not been shown, and null costs nothing: the day is still read, and the
 * delivery is still an instant at noon exactly as it was before this existed.
 */
const A_TIME_OF_DAY = /^\s*,?\s*(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?(?![a-z])/i;

export function clockFromText(text: string | null | undefined): ClockReading | null {
  if (typeof text !== 'string') return null;
  const m = A_TIME_OF_DAY.exec(text);
  if (!m) return null;

  const stated = Number(m[1]);
  const minutes = Number(m[2]);
  // A CLOCK FACE, NOT A NUMBER. Twelve hour times run 1 to 12; "0:15 pm" and
  // "13:40 pm" are not times a page prints, they are a layout we have not seen,
  // and reading them anyway is how a made up instant gets onto a hold.
  if (!Number.isInteger(stated) || stated < 1 || stated > 12) return null;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;

  // MIDNIGHT IS 12 AM AND NOON IS 12 PM, which is the one place a naive twelve
  // hour conversion gets it wrong in both directions at once.
  const pm = m[3].toLowerCase() === 'p';
  const hours = stated === 12 ? (pm ? 12 : 0) : stated + (pm ? 12 : 0);
  return { hours, minutes };
}

/**
 * A DAY AND A CLOCK FACE, BOTH READ OFF ONE INDIAN PAGE, AS ONE INSTANT.
 *
 * The day is "YYYY-MM-DD" — what dayFromText hands back, and the only shape
 * accepted, so a half-read date cannot arrive here as something to interpret.
 * The clock is India's, so the instant is the time on the page minus five and a
 * half hours.
 */
export function instantInIndia(
  day: string | null | undefined,
  clock: ClockReading | null | undefined,
): number | null {
  if (typeof day !== 'string' || clock == null) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!parts) return null;
  const ms = Date.UTC(
    Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]),
    clock.hours, clock.minutes,
  ) - INDIA_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * THE DAY AN INSTANT FALLS ON IN INDIA, as "2026-08-25".
 *
 * THE DAY THE PAGE PRINTED, IN OTHER WORDS, and that is the whole reason this is
 * not the UTC day. A parcel that arrived at half past midnight on 25 August fell
 * on 24 August in universal time, and a record that says so is a record that
 * contradicts the page it was read from. Everything a person is shown about
 * their own order is shown in the day their shop used.
 *
 * A day-only reading is unaffected: noon UTC is half past five in the evening in
 * India, which is the same day either way.
 */
export function dayInIndiaOf(at: Date | number | null | undefined): string | null {
  if (at == null) return null;
  const ms = typeof at === 'number' ? at : at.getTime();
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + INDIA_OFFSET_MS);
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${m}-${d}`;
}
