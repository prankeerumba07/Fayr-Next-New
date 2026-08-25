// The claim confirmation screen's numbers, as pure functions.
//
// This is the screen where 5 tickets are actually committed, so it is held to the
// same rule as the money screens: every figure on it is one the backend stated,
// and anything the backend did not state is simply not shown.
//
// THE DEADLINE IS THE ONE THAT WAS MISSING. The design's confirmation screen says
// "buy the product within 48 hours of joining"; its own claimed sheet says 2 hours
// and counts down from 25 minutes; the backend's real window is CLAIM_TTL_DAYS
// (7 by default) and is the only one that actually expires a claim. The server now
// sends that number with the campaign (claimWindowDays), and claimDeadline refuses
// to state a window it was not given rather than inheriting one of the design's.
import { estMaxRefundRupees } from './theme.js';

/**
 * The design's deadline sentence, with the operator's real window in it — as a
 * LENGTH only. See the body for why it states no clock time.
 *
 * Returns null — meaning "do not draw the deadline card" — when the window is
 * absent or not a positive whole number of days. A claim screen that guesses a
 * deadline is worse than one that stays quiet: the user plans a purchase around it.
 */
export function claimDeadline(opts) {
  const o = opts || {};
  const days = o.windowDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) return null;
  const within = `${days} ${days === 1 ? 'day' : 'days'}`;
  return {
    days,
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
 * How long is left to buy, from the task's OWN deadline.
 *
 * The design's claimed sheet counts down from 25m 35s and tells the user the
 * product is theirs "for the next 2 hours". Neither number exists anywhere in the
 * system: `claimExpiresAt` does, it comes from the operator's claim window, and it
 * is the only one that actually expires a claim and returns the tickets.
 *
 * Returns null when there is no usable deadline or it has already passed — the
 * sheet then simply does not draw a timer. Counting backwards past zero, or
 * printing "the next undefined", is worse than saying nothing.
 */
export function remainingToBuy(task, now) {
  const iso = task && task.claimExpiresAt;
  if (!iso) return null;
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return null;
  const from = (now instanceof Date ? now : new Date()).getTime();
  const ms = end - from;
  if (ms <= 0) return null;

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  // The deadline ITSELF, formatted exactly as the confirmation screen formatted
  // it. This is what the sheet states, and it is why the two screens can no
  // longer contradict each other: the confirmation screen promised "within 7
  // days", the sheet used to answer "yours for the next 6 days" — true, because
  // the claim had already eaten four seconds of the window, and indefensible in
  // front of a room. Both now name the same instant.
  const when = formatDeadline(new Date(end));

  // One unit of precision in the sentence, two on the clock — the same shape the
  // design uses, at the scale the real window actually has.
  if (days >= 1) {
    return {
      phrase: plural(days, 'day'),
      when,
      clock: `${days}d ${hours}h`,
      days,
      hours,
      minutes,
    };
  }
  if (hours >= 1) {
    return {
      phrase: plural(hours, 'hour'),
      when,
      clock: `${hours}h ${String(minutes).padStart(2, '0')}m`,
      days: 0,
      hours,
      minutes,
    };
  }
  return {
    phrase: plural(minutes, 'minute'),
    when,
    clock: `${minutes}m`,
    days: 0,
    hours: 0,
    minutes,
  };
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
