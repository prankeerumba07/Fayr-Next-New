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
 */
export function policyForWindowDays(
  overrideDays: number | null | undefined,
): ReturnPolicy {
  if (overrideDays != null) {
    return { defaultDays: overrideDays, byCategory: {} };
  }
  return DEFAULT_RETURN_POLICY;
}
