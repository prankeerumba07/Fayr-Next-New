/**
 * THE PRACTICE WINDOW: A WIDER ORDER WINDOW, FOR TESTING, THAT CANNOT REACH A
 * REAL DATABASE.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * The owner has test campaigns pointing at products he ALREADY BOUGHT on Amazon,
 * months ago, and they are real purchases. He wants one thing proved before
 * anything else: that Fayr can read his Amazon order history and come back with
 * the order number, the amount, the date and the product name, matched to the
 * campaign.
 *
 * The date rule refuses every one of those orders, and it is right to. A campaign
 * must have CAUSED the purchase — an order from before the claim is a purchase
 * they were going to make anyway, and paying a refund on it is a giveaway, not an
 * incentivised review. See order-window.ts, which records the live hole that rule
 * was built to close.
 *
 * So the reading cannot be tested at all without either weakening the rule or
 * widening the window. This widens the window.
 *
 * ── THE RULE ITSELF IS NOT TOUCHED, AND THAT IS THE WHOLE DESIGN ───────────
 *
 * checkOrderWindow and checkOrderAgainstTheVisit are unchanged. Neither of them
 * learns about this file, neither gains a flag, and neither can be told to skip a
 * comparison. What changes is the WINDOW THEY ARE HANDED: its floor reaches
 * further back. A rule that compares a date to a floor is the same rule whatever
 * the floor is, and a rule that has grown a way to be switched off is not.
 *
 * ── AND IT REFUSES ON ANYTHING THAT IS NOT A PRACTICE DATABASE ─────────────
 *
 * Before it widens anything, in the same shape as scripts/free-practice-claims.ts,
 * the demo seed and the answer book: it asks the LIVE DATABASE ITS OWN NAME and
 * refuses unless that name ends in _dev or _test.
 *
 * The live database and not the configured string, because those two can differ —
 * a connection string edited to point somewhere else is exactly the mistake this
 * guard is for, and a guard that reads the same setting the connection came from
 * would agree with the mistake.
 *
 * ── EVERY TASK IT TOUCHES IS MARKED ────────────────────────────────────────
 *
 * A widened match must never be mistakeable for a real one. The task carries how
 * many days were allowed, the staff panel shows it, and the number is written at
 * the moment the widened window is used rather than worked out again later.
 */

/** Off. The only value that changes nothing, and the default everywhere. */
export const PRACTICE_WINDOW_OFF = 0;

/**
 * The longest the window may be widened by, in days. Ten years.
 *
 * A ceiling rather than no ceiling, because a setting with no ceiling is a
 * setting somebody types a wrong number into. Ten years is longer than the
 * oldest order any shop will show, so it cannot stand in the way of a real test.
 */
export const PRACTICE_WINDOW_MAX_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * IS THIS A PRACTICE DATABASE?
 *
 * The same test as scripts/free-practice-claims.ts, in one place both can read,
 * because two spellings of one rule is how one of them ends up wrong.
 *
 * NOTHING ELSE COUNTS. Not NODE_ENV, which is a setting anybody can pass on a
 * command line; not a hostname, which says nothing about which database was
 * opened; and not the absence of rows, because an empty real database is still a
 * real database and will not be empty tomorrow.
 */
export function isAPracticeDatabase(name: string | null | undefined): boolean {
  if (typeof name !== 'string' || name === '') return false;
  return /_dev$|_test$/.test(name);
}

/**
 * HOW MANY DAYS MAY THE WINDOW BE WIDENED BY, given the setting and the database.
 *
 * Answers PRACTICE_WINDOW_OFF for every case that is not plainly allowed:
 *
 *   the setting is off, or absent, or not a number
 *   the database is not a practice one
 *   the number is negative
 *
 * A number ABOVE the ceiling is clamped rather than refused. Refusing would turn
 * a fat-fingered setting into "the rule is being enforced as normal", which reads
 * on a screen exactly like a working practice window and is the one outcome
 * nobody would notice.
 */
export function practiceWindowDays(
  setting: number | null | undefined,
  databaseName: string | null | undefined,
): number {
  if (!isAPracticeDatabase(databaseName)) return PRACTICE_WINDOW_OFF;
  if (typeof setting !== 'number' || !Number.isFinite(setting)) {
    return PRACTICE_WINDOW_OFF;
  }
  const whole = Math.trunc(setting);
  if (whole <= 0) return PRACTICE_WINDOW_OFF;
  return Math.min(whole, PRACTICE_WINDOW_MAX_DAYS);
}

/**
 * THE EXTRA GRACE, IN MILLISECONDS, to hand to orderWindow.
 *
 * orderWindow already takes a `graceMs`, and its floor is the claim moment less
 * that grace, never earlier than the campaign itself. So this is not a new
 * mechanism: it is a bigger number going into the one that already exists.
 *
 * ── AND THE CAMPAIGN'S OWN AGE STILL BOUNDS IT, WHICH IS DELIBERATE ────────
 *
 * orderWindow clamps its floor to campaignCreatedAt. So a practice window of a
 * year against a campaign made yesterday still only reaches back to yesterday.
 * That is not a bug to work around here — a campaign that did not exist cannot
 * have caused a purchase, on a practice database or anywhere else — and it means
 * a practice campaign has to be BACKDATED as well for an old order to match. The
 * check for that says so out loud, so nobody spends an afternoon wondering.
 */
export function practiceGraceMs(days: number, normalGraceMs: number): number {
  const allowed = typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : 0;
  if (allowed <= 0) return normalGraceMs;
  const wider = allowed * DAY_MS;
  // NEVER NARROWER THAN NORMAL. A practice setting that shortened the window
  // would be a practice setting that made the rule stricter, which nobody would
  // ever want and which would look like the rule misbehaving.
  return Math.max(normalGraceMs, wider);
}

/**
 * AND THE SAME FOR THE TWO HOUR HOLD, when that comes to be consulted.
 *
 * ── SAID PLAINLY: checkOrderAgainstTheVisit HAS NO CALLERS TODAY ───────────
 *
 * shop-visit.ts's hold is exported, specced, and consulted by nothing. The live
 * refusal of an old order comes from order-window.ts's floor, at two real call
 * sites. So this function is here for the day the hold IS wired, and it is
 * written now because the alternative is somebody wiring the hold later and
 * quietly not thinking about the practice window at all.
 *
 * ONLY THE START MOVES. The hold's end is left exactly where it was: the orders
 * being tested are MONTHS OLD, so reaching backwards is the whole requirement,
 * and extending the end would let an order placed days AFTER the tap qualify —
 * a different rule, which nobody asked for.
 */
export function widenTheHold<T extends { tappedAt: number; endsAt: number }>(
  hold: T,
  days: number,
): T {
  const allowed = typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : 0;
  if (allowed <= 0) return hold;
  return { ...hold, tappedAt: hold.tappedAt - allowed * DAY_MS };
}
