/**
 * The return-window policy — ported from src/taskflow.js.
 *
 * Gap 3 from the taskflow notes: no marketplace exposes a return-window end date,
 * so this is the OPERATOR's policy table, maintained deliberately. Days are
 * counted from DELIVERY. A campaign may override the whole thing with its own
 * `returnWindowDays` (see policyForWindowDays below), which then wins regardless
 * of category.
 */
export interface ReturnPolicy {
  defaultDays: number;
  byCategory: Record<string, number>;
  /**
   * A HOLD MEASURED IN MILLISECONDS, for a shop where days are the wrong unit.
   *
   * Set only by policyForWindowDays, only for the three shops that deliver in
   * minutes, and only when the operator has set no window of their own. When it
   * is present windowEnd uses it INSTEAD of the day table; when it is absent —
   * which is every other campaign, and every campaign with an explicit
   * returnWindowDays — nothing about the day table changes.
   *
   * It is on the policy rather than read off the task inside windowEnd so that
   * "which shop, and did the operator say otherwise" is decided in ONE pure
   * function, and windowEnd stays a function of the task and the policy it was
   * handed.
   */
  holdMs?: number | null;
}

/** An hour, in milliseconds. Written once so no call site multiplies it again. */
const HOUR = 60 * 60 * 1000;

/**
 * HOW LONG FAYR HOLDS A QUICK-COMMERCE REFUND AFTER DELIVERY — THREE HOURS.
 *
 * ── THE OWNER'S WORDS, 19 SEPTEMBER 2026 ────────────────────────────────────
 *
 *   "[Zepto, Blinkit, Instamart] ... once the product is delivered to the user,
 *    it cannot be sent back ... give them 2 or 3 hours of time, and then we
 *    refund the money to the user."
 *
 * ── WHY THE DAY TABLE IS THE WRONG INSTRUMENT HERE ──────────────────────────
 *
 * The whole point of the return window is loophole 3: somebody takes the refund
 * and then sends the product back, or deletes the review, and Fayr has paid for
 * nothing. The window is how long that remains possible.
 *
 * On these three shops it is not possible at all. A ten-minute grocery delivery
 * has no returns process to wait out — there is nothing to send back. So the
 * seven days the operator's table gives every uncategorised campaign is not
 * caution, it is a week of somebody's own money held against a risk that does
 * not exist on that shop.
 *
 * THREE HOURS IS NOT NOTHING, AND THAT IS DELIBERATE. It is the owner's number,
 * and what it buys is the window in which a wrong delivery, a missing item or a
 * cancelled order actually surfaces — which on a shop this fast is minutes, not
 * days.
 *
 * ONE CONSTANT, HERE. Changing the hold is changing this number and nothing
 * else.
 */
export const QUICK_COMMERCE_HOLD_HOURS = 3;

/**
 * THE THREE SHOPS THAT CANNOT BE SENT BACK TO.
 *
 * Written as the platform names the database uses. Matched without regard to
 * case because the engine's own createTask defaults to a lower-case name while
 * every row from the database is upper-case, and a rule about somebody's money
 * must not turn on which of the two reached it.
 */
export const SHOPS_THAT_CANNOT_BE_SENT_BACK: readonly string[] = [
  'ZEPTO',
  'BLINKIT',
  'INSTAMART',
];

/** Is this one of the three? Pure, and the only place the list is read. */
export function cannotBeSentBack(platform: string | null | undefined): boolean {
  if (typeof platform !== 'string' || platform === '') return false;
  const name = platform.trim().toUpperCase();
  return SHOPS_THAT_CANNOT_BE_SENT_BACK.includes(name);
}

export const DEFAULT_RETURN_POLICY: ReturnPolicy = {
  defaultDays: 7,
  byCategory: {
    electronics: 10,
    apparel: 15,
    furniture: 10,
    grocery: 0, // non-returnable → refund can release as soon as delivered+reviewed
  },
};

export function createPolicy(overrides?: Partial<ReturnPolicy>): ReturnPolicy {
  const o = overrides ?? {};
  return {
    defaultDays: o.defaultDays ?? DEFAULT_RETURN_POLICY.defaultDays,
    byCategory: {
      ...DEFAULT_RETURN_POLICY.byCategory,
      ...(o.byCategory ?? {}),
    },
  };
}

export function windowDaysFor(
  policy: ReturnPolicy | undefined,
  category: string | null | undefined,
): number {
  const p = policy ?? DEFAULT_RETURN_POLICY;
  const key = String(category ?? '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(p.byCategory, key)
    ? p.byCategory[key]
    : p.defaultDays;
}

/**
 * A campaign-scoped policy: an explicit `returnWindowDays` override applies to
 * ANY category (empty byCategory → windowDaysFor always returns defaultDays);
 * otherwise fall back to the operator's category table.
 *
 * ── AND THE THREE-HOUR HOLD, WHICH IS THE LAST THING ASKED ──────────────────
 *
 * THE OPERATOR'S OWN NUMBER WINS OUTRIGHT, and it wins by being asked FIRST.
 * Somebody who typed a window into the campaign console said something explicit
 * about this offer, and no rule about which shop it is may quietly overrule it —
 * so the early return below carries no holdMs at all, and a campaign with
 * returnWindowDays set behaves exactly as it did before this phase, on every
 * platform.
 *
 * Only when nothing was typed does the shop matter, and then only for the three
 * that cannot be sent back to. Everything else falls through to the operator's
 * category table, unchanged.
 */
export function policyForWindowDays(
  overrideDays: number | null | undefined,
  platform?: string | null,
): ReturnPolicy {
  if (overrideDays != null) {
    return { defaultDays: overrideDays, byCategory: {} };
  }
  if (cannotBeSentBack(platform)) {
    return {
      ...DEFAULT_RETURN_POLICY,
      holdMs: QUICK_COMMERCE_HOLD_HOURS * HOUR,
    };
  }
  return DEFAULT_RETURN_POLICY;
}
