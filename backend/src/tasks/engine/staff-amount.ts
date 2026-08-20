/**
 * THE CEILING ON AN AMOUNT A PERSON TYPES INTO A PAYOUT.
 *
 * A staff-confirmed amount is the only figure in the system a human invents
 * rather than a machine reads, which makes it the only one where a slip pays real
 * money for no reason. ₹499 becomes ₹4990 with one extra keystroke.
 *
 * The ceiling is therefore derived from something REAL, never a round number
 * somebody picked:
 *
 *   - the CAMPAIGN PRICE, doubled. The campaign states what the product costs;
 *     a figure at more than twice that is far likelier a typo or a fraud than a
 *     purchase. Doubling leaves genuine headroom for a price rise between the
 *     campaign being written and the order being placed.
 *   - the ORDER TOTAL. One item on an order cannot have cost more than the whole
 *     order did. This is exact when the order holds one product and merely loose
 *     when it is a merged cart — which is why it is a bound and not the answer.
 *
 * The tighter of the two wins. If NEITHER exists there is nothing real to bound
 * by, so this reports no ceiling and the caller refuses rather than inventing
 * one: a ceiling nobody can justify is the same problem as no ceiling, dressed up.
 */

/** Doubled: real headroom for a price rise, nowhere near a mistyped digit. */
export const MAX_STAFF_AMOUNT_MULTIPLE = 2;

export interface StaffAmountBounds {
  /** The most a person may enter, or null when nothing real bounds it. */
  maxPaise: bigint | null;
  /** Which real figure produced the ceiling, for the message that explains it. */
  anchor: 'campaign-price' | 'order-total' | null;
  allows(paise: bigint): boolean;
}

export function staffAmountBounds(input: {
  campaignPricePaise: bigint | null | undefined;
  orderTotalPaise: bigint | null | undefined;
}): StaffAmountBounds {
  const campaign = input.campaignPricePaise;
  const total = input.orderTotalPaise;
  // A zero price is not a price. Reading a real 0 as a real limit is exactly the
  // payout-cap trap in a neighbouring field.
  const fromCampaign =
    campaign != null && campaign > 0n
      ? campaign * BigInt(MAX_STAFF_AMOUNT_MULTIPLE)
      : null;
  const fromTotal = total != null && total > 0n ? total : null;

  let maxPaise: bigint | null = null;
  let anchor: StaffAmountBounds['anchor'] = null;
  if (fromCampaign != null && fromTotal != null) {
    if (fromTotal < fromCampaign) {
      maxPaise = fromTotal;
      anchor = 'order-total';
    } else {
      maxPaise = fromCampaign;
      anchor = 'campaign-price';
    }
  } else if (fromCampaign != null) {
    maxPaise = fromCampaign;
    anchor = 'campaign-price';
  } else if (fromTotal != null) {
    maxPaise = fromTotal;
    anchor = 'order-total';
  }

  return {
    maxPaise,
    anchor,
    allows(paise: bigint) {
      if (paise <= 0n) return false;
      if (maxPaise == null) return false;
      return paise <= maxPaise;
    },
  };
}
