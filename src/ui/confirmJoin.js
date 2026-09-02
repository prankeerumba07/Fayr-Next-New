// The claim confirmation screen's numbers, as pure functions.
//
// This is the screen where 5 tickets are actually committed, so it is held to the
// same rule as the money screens: every figure on it is one the backend stated,
// and anything the backend did not state is simply not shown.
//
// THE DEADLINE IS THE ONE THAT WAS MISSING. The design's confirmation screen says
// "buy the product within 48 hours of joining"; its own claimed sheet says 2 hours
// and counts down from 25 minutes; the backend's real window is the only one that
// actually expires a claim. The server sends that number with the campaign
// (claimWindowMinutes), and claimDeadline refuses to state a window it was not
// given rather than inheriting one of the design's.
//
// IT IS MINUTES NOW. The owner asked on 1 September 2026 for a thirty minute slot,
// and the old setting was whole days: its smallest possible value was one day, so
// it could not express thirty minutes at all. The setting, the campaign field and
// this function all moved to minutes together, in one commit, so there is never a
// moment where two numbers claim to be the same window.
import { estMaxRefundRupees } from './theme.js';

/**
 * The length of a window in minutes, said the way a person would say it.
 *
 * The largest plain unit, and the second one only when the first does not divide
 * exactly: 30 minutes, 1 hour, 2 days, "1 hour 30 minutes", "2 days 15 minutes".
 * Never rounded — saying "1 hour" for ninety minutes hands somebody half an hour
 * they do not have, and this is a purchase deadline.
 */
function lengthInWords(totalMinutes) {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(plural(days, 'day'));
  if (hours > 0) parts.push(plural(hours, 'hour'));
  if (minutes > 0) parts.push(plural(minutes, 'minute'));
  // Two units at most. A window of "1 day 2 hours 3 minutes" is precision nobody
  // reads; the two largest units are always enough to plan a purchase around, and
  // dropping the smallest can only ever understate the time left, never overstate
  // it, which is the safe direction for a deadline.
  return parts.slice(0, 2).join(' ');
}

/**
 * The design's deadline sentence, with the operator's real window in it — as a
 * LENGTH only. See the body for why it states no clock time.
 *
 * Returns null — meaning "do not draw the deadline card" — when the window is
 * absent or not a positive whole number of minutes. A claim screen that guesses a
 * deadline is worse than one that stays quiet: the user plans a purchase around it.
 */
export function claimDeadline(opts) {
  const o = opts || {};
  const minutes = o.windowMinutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1) {
    return null;
  }
  const within = lengthInWords(minutes);
  return {
    minutes,
    within,
    // A LENGTH, and deliberately no clock time. The design's card reads "within
    // 48 hours of joining — by 6 Jul, 6:00 PM", but the exact deadline does not
    // exist yet: the server stamps claimExpiresAt when it creates the task, a
    // few seconds after this screen is drawn. Forecasting the instant here put
    // "by 1 Sep, 4:00 PM" on this screen and "until 1 Sep, 3:59 PM" on the very
    // next one — one number, two routes, a minute apart, in front of a room.
    // The claimed sheet has the real instant and is the only screen that names
    // one. No `when` or `by` is returned at all, so no screen can print a
    // forecast by accident.
    line: `Buy the product within ${within} of joining.`,
  };
}

/**
 * HOW LONG THE SLOT RESERVED MOMENT STAYS ON SCREEN, in milliseconds.
 *
 * The owner asked for about three seconds, with no button: it says the slot is
 * reserved, shows how long there is to buy, plays the design's own celebration,
 * and then leaves by itself.
 *
 * Here rather than in the screen so the number lives in one place and the test can
 * read it instead of repeating it.
 */
export const SLOT_RESERVED_MS = 3000;

/**
 * HOW LONG IS LEFT TO BUY, as ONE SHORT LINE.
 *
 * The confirmation page carried the claim deadline in a card of its own. The owner
 * took that page off the path on 2 September 2026, so the deadline moved to the
 * three screens that come after a claim: the slot reserved moment, the connect
 * page and the before you go page. All three say it in these exact words, from
 * here, so they cannot drift apart.
 *
 * Returns null when there is no usable deadline, so a screen says nothing rather
 * than something it cannot back up.
 */
export function deadlineLine(task, now) {
  const c = countdown(task, now);
  if (!c) return null;
  if (c.over) return 'Your time to buy has run out.';

  // BUILT FROM THE NUMBERS, not from the clock's own text. My first version took
  // the "20m : 00s" clock apart with string replacements and produced "20 minute
  // seconds and 00s", which is the kind of thing that reaches a screen.
  //
  // The seconds are dropped rather than rounded up, so the line can only ever
  // understate the time left, never overstate it. That is the safe direction for a
  // deadline. Under a minute it says so in words instead of "0 minutes".
  const minutes = c.minutes;
  if (typeof minutes !== 'number' || minutes < 1) {
    return 'Buy it in the next minute.';
  }
  return `Buy it within ${lengthInWords(minutes)}.`;
}

/** "1 Sep, 4:00 PM" — the design's format, in the device's locale rules for IN. */
function formatDeadline(d) {
  const day = d.getDate();
  const month = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][d.getMonth()];
  let h = d.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 === 0 ? 12 : h % 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${h}:${m} ${suffix}`;
}

/**
 * What this claim costs in tickets and what is left afterwards.
 *
 * An unknown balance stays unknown (`enough: null`): the wallet call can fail, and
 * reading a missing balance as sufficient would put a live CONFIRM & JOIN in front
 * of a user whose claim the server is about to refuse.
 */
export function ticketPlan(opts) {
  const o = opts || {};
  const cost = Number.isInteger(o.cost) && o.cost > 0 ? o.cost : 5;
  const balance = Number.isInteger(o.balance) ? o.balance : null;
  if (balance === null) {
    return { cost, balance: null, after: null, enough: null, shortBy: null };
  }
  const enough = balance >= cost;
  return {
    cost,
    balance,
    after: enough ? balance - cost : null,
    enough,
    shortBy: enough ? 0 : cost - balance,
  };
}

/** The two refund rows: the percentage, and the ceiling — omitted if unknown. */
export function refundLines(opts) {
  const c = opts || {};
  const pct = Number.isInteger(c.percent) ? c.percent : 100;
  const max = estMaxRefundRupees(c);
  return {
    percentLine: `${pct}% of what you pay`,
    maxLine: max == null ? null : `₹${max}`,
  };
}

/**
 * Tickets sitting in claims that could still be returned.
 *
 * The design's insufficient-tickets sheet shows a "Held in active claims" row.
 * There is no held bucket in the ledger — claiming DEDUCTS and an expiry RETURNS —
 * so this is derived from the user's own open claims, which are exactly the ones
 * whose tickets would come back. A PURCHASED claim has spent them permanently, per
 * the ticket economy, so counting it here would promise a return that never comes.
 */
export function heldTicketCount(tasks) {
  if (!Array.isArray(tasks)) return 0;
  let held = 0;
  for (const t of tasks) {
    if (!t || t.state !== 'CLAIMED') continue;
    if (Number.isInteger(t.ticketCost) && t.ticketCost > 0) held += t.ticketCost;
  }
  return held;
}

/**
 * THE LIVE COUNTDOWN ON THE CLAIMED SHEET, from the task's OWN deadline.
 *
 * The design's claimed sheet counts down from 25m 35s and tells the user the
 * product is theirs "for the next 2 hours". Neither number exists anywhere in the
 * system. `claimExpiresAt` does, it comes from the operator's claim window, and it
 * is the only one that actually expires a claim and returns the tickets.
 *
 * THREE ANSWERS, NOT TWO, and that is the whole reason this replaced the old
 * function. It used to return null both for "this task has no deadline" and for
 * "the deadline has passed", so the sheet could not tell those apart and drew
 * nothing either way: somebody whose thirty minutes ran out saw a sheet with no
 * timer and no explanation. Now:
 *
 *   null                  — no usable deadline. Say nothing.
 *   { over: true, when }  — the time is up. Say so, and offer the way back.
 *   { over: false, ... }  — live, with a clock to draw.
 *
 * `ticking` tells the screen whether to redraw every second. It does under an
 * hour, which is the case the owner asked for; above that the clock reads in hours
 * or days and a per-second redraw would be battery spent on the same picture.
 */
export function countdown(task, now) {
  const iso = task && task.claimExpiresAt;
  if (!iso) return null;
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return null;
  const from = (now instanceof Date ? now : new Date()).getTime();

  // The deadline ITSELF, formatted exactly as the confirmation screen formatted
  // it. This is what the sheet states, and it is why the two screens can no
  // longer contradict each other: the confirmation screen promises a LENGTH and
  // names no instant, and this is the only screen that names one. Present on an
  // expired claim too, so the sheet can say when it ran out and not merely that
  // it did.
  const when = formatDeadline(new Date(end));

  const ms = end - from;
  if (ms <= 0) return { over: true, clock: null, ticking: false, when };

  // ROUNDED UP, deliberately. Rounding down would print "0m : 00s" for the last
  // second of a live claim, which reads as a stuck clock; this prints one second
  // and then ends.
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalSeconds < 3600) {
    return {
      over: false,
      // The design's own shape, at the scale the real window now has.
      clock: `${minutes}m : ${String(seconds).padStart(2, '0')}s`,
      ticking: true,
      minutes,
      seconds,
      when,
    };
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return {
    over: false,
    clock: days >= 1
      ? `${days}d ${hours}h`
      : `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m`,
    ticking: false,
    minutes: totalMinutes,
    seconds: 0,
    when,
  };
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
