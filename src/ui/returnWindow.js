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

// ── AND A WAIT THAT IS NOT MEASURED IN DAYS AT ALL — Phase 8B-b ────────────
//
// THE OWNER, 19 September 2026: "[Zepto, Blinkit, Instamart] ... once the product
// is delivered to the user, it cannot be sent back ... give them 2 or 3 hours of
// time, and then we refund the money to the user."
//
// So on those three shops the wait is three hours, and every sentence above is
// the wrong instrument for it: "closes today, on 20 Sep" is true and tells
// somebody nothing, and a ring reading 0 DAYS reads as a bug. A wait under a day
// is said in hours, in minutes, and with the actual time on the clock.
//
// NOTHING ABOUT A WAIT OF A DAY OR MORE CHANGES. daysUntil, shortDate and the
// day-shaped half of windowLine answer exactly what they always answered.

/** India is five and a half hours ahead of universal time, and has no summer time. */
const INDIA_OFFSET_MS = 330 * 60 * 1000;
const A_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * THE CLOCK FACE IN INDIA, AS SOMEBODY WOULD SAY IT OUT LOUD.
 *
 * A MIRROR OF clockInIndia IN backend/src/tasks/engine/shop-visit-words.ts, and
 * deliberately the same arithmetic down to the noon and midnight case: the phone
 * already shows "your place is held until 1:30 pm" built on that side, and two
 * clocks in one app that disagree about what 12 o'clock is called would be found
 * by somebody whose refund was late. returnWindow.test.mjs reads that file off
 * disk and holds the two to the same rule.
 *
 * IN INDIA'S TIME, ALWAYS, AND NOT THE PHONE'S. A phone set to another zone must
 * not change what the sentence says, for the same reason the server applies the
 * offset rather than leaving it to whatever Date does where it runs.
 */
export function clockInIndia(at) {
  const ms = typeof at === 'number' && Number.isFinite(at) ? at : null;
  if (ms == null) return null;
  const shifted = new Date(ms + INDIA_OFFSET_MS);
  const hour24 = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minutes} ${hour24 < 12 ? 'am' : 'pm'}`;
}

/**
 * Today or tomorrow, in India, and it is not decoration: a three hour hold that
 * starts at eleven at night ends the NEXT day, and "due at 2:00 am today" read at
 * half past eleven is simply false. Null when it is further away than tomorrow,
 * and then the day word is dropped rather than guessed at.
 */
export function dayInIndia(at, from) {
  const a = typeof at === 'number' && Number.isFinite(at) ? at : null;
  const b = typeof from === 'number' && Number.isFinite(from) ? from : null;
  if (a == null || b == null) return null;
  const dayOf = (t) => Math.floor((t + INDIA_OFFSET_MS) / A_DAY_MS);
  const gap = dayOf(a) - dayOf(b);
  if (gap === 0) return 'today';
  if (gap === 1) return 'tomorrow';
  return null;
}

/**
 * WHAT KIND OF WAIT THIS IS, AND HOW MUCH OF IT IS LEFT.
 *
 * One answer for the whole screen, so the ring, the heading and the sentence
 * cannot end up saying three different things about one instant.
 *
 *   kind 'unknown'  we were not told when it ends. Nothing may be drawn as a
 *                   number, which is what the screen already does for null.
 *   kind 'due'      the wait is over. The refund is released by our side on its
 *                   own; this screen never moves money and never says it did.
 *   kind 'minutes'  under an hour.
 *   kind 'hours'    under a day.
 *   kind 'days'     a day or more — counted in CALENDAR days, exactly as
 *                   daysUntil has always counted them, because a deadline that
 *                   far out is a date rather than a duration.
 *
 * ── ROUNDED UP, AND NEVER DOWN ──────────────────────────────────────────────
 *
 * With two hours and one minute left the heading says three hours. Rounding the
 * other way would tell somebody their money is due sooner than it is, and being
 * early with somebody else's money is the one direction that costs trust. It is
 * the same rounding, for the same reason, as timeLeftInWords in journeyWords.js.
 *
 * THE EXACT TIME IS IN THE SENTENCE, so the rounding costs nobody anything: the
 * heading is a glance and `at` is the answer.
 */
export function theWait(state) {
  const s = state && typeof state === 'object' ? state : {};
  const endsAt = toMillis(s.endsAt);
  const now = typeof s.now === 'number' && Number.isFinite(s.now) ? s.now : null;
  if (endsAt == null || now == null) {
    return { kind: 'unknown', count: null, unit: null, at: null, day: null };
  }
  const at = clockInIndia(endsAt);
  const day = dayInIndia(endsAt, now);
  const left = endsAt - now;
  if (left <= 0) return { kind: 'due', count: 0, unit: null, at, day };
  if (left < 60 * 60 * 1000) {
    const count = Math.ceil(left / 60000);
    return { kind: 'minutes', count, unit: count === 1 ? 'MINUTE' : 'MINUTES', at, day };
  }
  if (left < A_DAY_MS) {
    const count = Math.ceil(left / (60 * 60 * 1000));
    return { kind: 'hours', count, unit: count === 1 ? 'HOUR' : 'HOURS', at, day };
  }
  const count = daysUntil(s.endsAt, now);
  return { kind: 'days', count, unit: count === 1 ? 'DAY' : 'DAYS', at, day };
}

/**
 * The heading, for every kind of wait.
 *
 * The day-shaped headings are word for word the ones the screen already wrote,
 * moved here so that all of them are in one file and every one of them is walked
 * by the plain language rule.
 */
export function waitHeading(wait) {
  const w = wait && typeof wait === 'object' ? wait : { kind: 'unknown' };
  if (w.kind === 'minutes') {
    return w.count === 1
      ? 'Your refund unlocks in a minute'
      : `Your refund unlocks in ${w.count} minutes`;
  }
  if (w.kind === 'hours') {
    return w.count === 1
      ? 'Your refund unlocks in an hour'
      : `Your refund unlocks in ${w.count} hours`;
  }
  if (w.kind === 'due') return 'Your refund is due now';
  if (w.kind === 'days') {
    return w.count === 0
      ? 'Your refund unlocks today'
      : `Refund unlocks in ${w.count} ${w.count === 1 ? 'day' : 'days'}`;
  }
  return 'Waiting for the return window';
}

/**
 * HOW LONG IS LEFT ON THE WINDOW, for the claim's own status rows.
 *
 * MOVED HERE FROM TaskScreen.js ON 20 SEPTEMBER 2026, with one thing fixed and
 * nothing else changed. It said "0h remaining" for the last hour of any wait,
 * which was survivable while every wait was days long and is not now: the whole
 * of a three hour hold's last hour would have read as nought.
 *
 * It lives in this file so that it is walked by the plain language rule with the
 * rest of the wait's words. `endsAt` and `now` are milliseconds here, because
 * that is what the screen holds.
 */
export function timeLeftOnTheWindow(endsAt, now) {
  const ends = typeof endsAt === 'number' && Number.isFinite(endsAt) ? endsAt : null;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : null;
  if (ends == null || at == null) return null;
  const left = ends - at;
  if (left <= 0) return 'Return window has closed';
  const say = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} remaining`;
  if (left < 60 * 60 * 1000) return say(Math.ceil(left / 60000), 'minute');
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  const hours = Math.floor((left % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h remaining`;
  return say(Math.ceil(left / (60 * 60 * 1000)), 'hour');
}

/**
 * WHEN THE WINDOW ENDS, as a date or as a time.
 *
 * A DEADLINE A WEEK AWAY IS A DATE and a deadline this afternoon is a time. The
 * row used to print a bare date for both, so a three hour hold read "Sun Sep 20
 * 2026" and told nobody the one thing they wanted to know.
 *
 * Milliseconds in, because this is the claim's own status row and that is what
 * it holds. Null when there is nothing to say, which the row already draws as
 * "Needs a delivery date".
 */
export function whenTheWindowEnds(endsAt, now) {
  const ends = typeof endsAt === 'number' && Number.isFinite(endsAt) ? endsAt : null;
  if (ends == null) return null;
  const d = new Date(ends);
  if (Number.isNaN(d.getTime())) return null;
  const at = typeof now === 'number' && Number.isFinite(now) ? now : null;
  if (at == null || ends - at >= A_DAY_MS) return d.toDateString();
  const day = dayInIndia(ends, at);
  const when = clockInIndia(ends);
  return day == null ? `${d.toDateString()}, ${when}` : `${when} ${day}`;
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

  // ── A WAIT UNDER A DAY IS SAID ON THE CLOCK, NOT ON THE CALENDAR ─────────
  //
  // And the second sentence changes with it, because the day-shaped one below
  // would be a LIE here: it says the date is the shop's own return window, and
  // on the three shops this branch exists for the shop states no return window
  // at all. Fayr holds the money for a few hours after delivery and then
  // releases it. Saying that is both true and the thing somebody wants to know.
  const wait = theWait(s);
  if (wait.kind === 'minutes' || wait.kind === 'hours' || wait.kind === 'due') {
    const soon = wait.kind === 'due'
      ? 'Your refund is due now.'
      : wait.day == null
        ? `Your refund is due at ${wait.at}.`
        : `Your refund is due at ${wait.at} ${wait.day}.`;
    return `${soon} We hold it for a short while after your parcel arrives, `
      + 'and then it is sent to your wallet.';
  }

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
