import type { EvidenceOrder } from './evidence.types';

/**
 * WHICH FIGURE DID THE USER ACTUALLY PAY?
 *
 * Policy, decided 2026-08-11: **a refund is always based on the amount actually
 * charged, never a listed/sticker price.** Any marketplace can show a per-item
 * price above what was really paid once a discount, bank offer, or coupon lands.
 *
 * Evidence can carry two money figures, and they do NOT mean the same thing on
 * every platform — this is the whole reason a single "use itemPaise" rule was
 * wrong:
 *
 *   - Amazon  `itemPaise` = the item's own row on the order-DETAILS page;
 *             `orderTotalPaise` = the order total, which folds in shipping/fees
 *             AND merges carts, so it can bundle unrelated products. Here the
 *             total is routinely HIGHER and is not a per-item figure at all.
 *   - Flipkart `itemPaise` = moneyDataBag.itemSellingPrice, which is the
 *             SELLING/listed price. Proven live on 2026-08-11: heels order
 *             OD337767552058345100 carried itemPaise 36700 against an order
 *             total of 32800 — a ₹39 overpay had it released.
 *   - Myntra   emits neither (mrp only, deliberately) — dormant, unaffected.
 *   - Blinkit/Zepto/Instamart emit ONLY a total, which may cover several
 *             products; they stay staff-gated rather than guessing.
 *   - OCR      emits an item figure and no total; tier 3, staff-approved anyway.
 *
 * `min(item, total)` is what satisfies both shapes at once, and it is not a
 * coincidence:
 *   - merged cart / shipping → total > item → min = item  (never pay for
 *     someone else's items in the same order)
 *   - discount on the item   → total < item → min = total (never pay above the
 *     amount actually charged)
 *
 * It is deliberately NOT applied blind. Two cases route to a human instead of
 * paying a number we can't justify — consistent with "never guess money".
 */

/** Why a figure was chosen, recorded so a payout can be explained later. */
export type ChargedBasis =
  /** The item's own charged line. The total was >= it (fees, or a merged cart). */
  | 'item-price'
  /** No total to cross-check against, so the item figure stands alone. */
  | 'item-price-only'
  /** The item figure sat ABOVE the amount charged, so the total won. */
  | 'order-total-lower';

export interface ChargedAmount {
  /** Integer paise to base the refund on, or null when a human must decide. */
  paise: bigint | null;
  basis: ChargedBasis | null;
  /** True = do not pay automatically; a staff member confirms the amount. */
  needsStaff: boolean;
  /** Machine-readable reason, surfaced to the caller. Null when payable. */
  reason: string | null;
}

/**
 * A gap this large is not a coupon. Below half the item price the difference is
 * far more likely to be several products sharing one total, or marketplace gift
 * card / wallet / promotional credit — which the terms now make ineligible
 * outright. Under-paying would be "safe" for Fayr and unfair to the user, and
 * over-paying is worse, so neither is guessed: it goes to staff.
 *
 * Expressed as `total * 2 < item` to stay in exact integer bigint maths.
 */
function gapIsImplausible(itemPaise: bigint, totalPaise: bigint): boolean {
  return totalPaise * 2n < itemPaise;
}

export function resolveChargedPaise(
  order: EvidenceOrder | null | undefined,
): ChargedAmount {
  const item = order?.itemPaise ?? null;
  const total = order?.orderTotalPaise ?? null;
  const ambiguous = order?.itemAmountAmbiguous === true;

  const staff = (reason: string): ChargedAmount => ({
    paise: null,
    basis: null,
    needsStaff: true,
    reason,
  });

  // No per-item figure at all. Note we do NOT fall back to the order total:
  // on quick-commerce that total can cover several products, so paying it would
  // refund the whole basket for one reviewed item. This is the pre-existing
  // quick-commerce/Myntra behaviour, unchanged.
  if (item == null) {
    return staff('amount-unknown');
  }

  // Nothing to cross-check against — the item figure is all we have.
  if (total == null) {
    return { paise: item, basis: 'item-price-only', needsStaff: false, reason: null };
  }

  // The total is at or above the item price: fees, shipping, or other items in
  // the same order. The item's own line IS the charged amount for this product.
  if (total >= item) {
    return { paise: item, basis: 'item-price', needsStaff: false, reason: null };
  }

  // From here the item figure EXCEEDS what the order was charged, so it cannot
  // be the paid price. The total is the better figure — but only when we can
  // justify it.
  if (ambiguous) {
    // The item figure is already flagged untrustworthy AND sits above the
    // charge. Two unknowns stacked; don't pick a winner.
    return staff('item-price-above-total-and-ambiguous');
  }
  if (gapIsImplausible(item, total)) {
    return staff('amount-gap-implausible');
  }
  return { paise: total, basis: 'order-total-lower', needsStaff: false, reason: null };
}
