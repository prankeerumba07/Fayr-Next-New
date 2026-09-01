// HOW LONG UNTIL THE SHOP'S RETURN WINDOW CLOSES, AND HOW TO SAY IT.
//
// The design writes both numbers into the screen: a ring reading "5 DAYS" and a
// sentence saying "closes on 11 Jul". Both would be wrong every single time they
// were shown. They belong to the task, and the task's own windowEndsAt is the same
// field the backend uses to decide whether a refund may be released — so a screen
// built on this cannot promise a date that differs from the one gating the money.
//
// PURE. No React, no fetch, and the clock is always handed in, so every sentence
// and every count can be checked under node. Same reason as ui/journey.js.
//
// NO Intl. Hermes only partially ships it, so the month names are a plain table.

/** Short month names, in the order a date's month number indexes them. */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** An ISO date string to milliseconds, or null when it is not a date at all. */
export function toMillis(iso) {
  if (typeof iso !== 'string' || iso === '') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "11 Jul", or null when there is no date.
 *
 * Deliberately no year: the return window is days away, never months, so a year
 * is noise. If a date ever arrives that is not in the current year the sentence
 * around it still reads correctly, because it names the day and the month.
 */
export function shortDate(iso) {
  const ms = toMillis(iso);
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Which calendar day a moment falls on, counted in local days since the epoch. */
function dayIndex(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/**
 * Whole days from today until the day the window closes. 0 means it closes today
 * or has already closed. null means we were not told, and null must never be
 * drawn as a number.
 *
 * COUNTED IN CALENDAR DAYS, not in hours divided by twenty four. A window that
 * closes at six this evening closes TODAY, and a person reading "1 day" would
 * plan for tomorrow. The deadline is a date, so the count has to be a count of
 * dates. This is also why it can never disagree with the date in the sentence
 * beside it: both come from the same day.
 */
export function daysUntil(iso, nowMs) {
  const ms = toMillis(iso);
  if (ms == null) return null;
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : null;
  if (now == null) return null;
  return Math.max(0, dayIndex(ms) - dayIndex(now));
}

/**
 * The sentence under the heading.
 *
 * The design's version names the shop and the date. This says the same thing when
 * both are known, drops whichever is missing, and says plainly that we do not have
 * the date rather than inventing one.
 *
 * The design's second sentence — "Festival return extensions adjust this date" —
 * is NOT copied. Fayr does not adjust anything for festivals, so it would be a
 * promise about behaviour that does not exist. What is true is where the date
 * comes from, and that is what is said instead.
 */
export function windowLine(state) {
  const s = state && typeof state === 'object' ? state : {};
  const when = shortDate(s.endsAt);
  const shop = typeof s.shopName === 'string' && s.shopName ? s.shopName : null;
  const source = shop
    ? `This date is ${shop}'s own return window for this kind of product.`
    : 'This date is the shop’s own return window for this kind of product.';

  if (when == null) {
    return shop
      ? `Your money is released once ${shop}’s return window has closed and `
        + 'your review is still there. We do not have the closing date yet.'
      : 'Your money is released once the shop’s return window has closed and '
        + 'your review is still there. We do not have the closing date yet.';
  }

  const days = daysUntil(s.endsAt, s.now);
  const opening = days === 0
    ? shop
      ? `${shop}’s return window closes today, on ${when}.`
      : `The return window closes today, on ${when}.`
    : shop
      ? `After ${shop}’s return window closes on ${when}.`
      : `After the return window closes on ${when}.`;
  return `${opening} ${source}`;
}
