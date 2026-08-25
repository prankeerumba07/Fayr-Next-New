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
  /** The page stated what ONE unit cost. Quantity is then irrelevant. */
  | 'unit-price'
  /** One unit's cost, divided out of the line total by a KNOWN quantity. */
  | 'unit-from-line-total'
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

/**
 * Above this, a "quantity" is far more likely to be a misread field than a real
 * basket — and dividing by it would produce an absurdly small refund that looked
 * legitimate. Refuse instead.
 */
const MAX_PLAUSIBLE_QUANTITY = 100;

/**
 * Tolerance for "is this the product the campaign is paying for?": a ₹2 floor OR
 * 5%, whichever is larger. Deliberately the same shape as the device matcher's
 * (src/verify.js:82-83) so the two do not disagree about what "close" means.
 */
const TOLERANCE_FLOOR_PAISE = 200n;
const TOLERANCE_PERCENT = 5n;

/**
 * Does the amount ACTUALLY CHARGED disagree with the campaign's price?
 *
 * This replaces `match.amountOk` as the refund gate's price signal, and the
 * difference is the whole point. `amountOk` is computed on the device by
 * comparing the campaign's LISTED price against the marketplace's LISTED price
 * (Flipkart's `itemSellingPrice`), while the refund is paid on the CHARGED
 * figure. Those are different numbers on the same order: the live heels order
 * carried a ₹367 sticker against ₹328 charged, so a campaign priced honestly at
 * ₹328 read `amountOk: false` — 2.4x the tolerance — and every honest order
 * tripped a gate meant to catch fraud. A signal that fires on the good path is
 * not a fraud signal; it is noise that trains people to tap through.
 *
 * Comparing charged-against-campaign fires when what the user really paid does
 * not match the offer, which is the thing actually worth a human's attention.
 *
 * @param chargedPaise  from resolveChargedPaise — never a raw itemPaise.
 * @param campaignPaise the campaign's expected price. A missing or non-positive
 *   price means there is nothing to compare, so no disagreement is asserted
 *   rather than blocking every release (cf. the zero-cap trap, where a `0` that
 *   meant "no limit" was read as a real limit and computed a ₹0 refund).
 */
export function chargedDisagreesWithCampaign(
  chargedPaise: bigint,
  campaignPaise: bigint | null | undefined,
): boolean {
  if (campaignPaise == null || campaignPaise <= 0n) return false;
  const diff =
    chargedPaise > campaignPaise
      ? chargedPaise - campaignPaise
      : campaignPaise - chargedPaise;
  const pct = (campaignPaise * TOLERANCE_PERCENT) / 100n;
  return diff > (pct > TOLERANCE_FLOOR_PAISE ? pct : TOLERANCE_FLOOR_PAISE);
}

export function resolveChargedPaise(
  order: EvidenceOrder | null | undefined,
): ChargedAmount {
  const staff = (reason: string): ChargedAmount => ({
    paise: null,
    basis: null,
    needsStaff: true,
    reason,
  });

  // A STATED per-unit price is evidence, not inference, so it wins outright — and
  // it makes the quantity irrelevant, because a refund is always for one unit.
  const unit = order?.unitPricePaise ?? null;
  if (unit != null) {
    if (unit <= 0n) return staff('amount-unknown');
    return { paise: unit, basis: 'unit-price', needsStaff: false, reason: null };
  }

  // Otherwise we are working from a LINE figure. `itemPaise` is the historic,
  // ambiguous name for the same thing and is read as a line total, which is the
  // safe reading — see evidence.types.ts.
  const line = order?.lineTotalPaise ?? order?.itemPaise ?? null;
  const total = order?.orderTotalPaise ?? null;
  const ambiguous = order?.itemAmountAmbiguous === true;

  // Never fall back to a bare order total: on quick-commerce it can cover a whole
  // basket, so paying it would refund several products for one review.
  if (line == null) return staff('amount-unknown');

  // The order-total cross-check, unchanged, applied to the LINE figure.
  let lineCharged: bigint;
  let basis: ChargedBasis;
  if (total == null) {
    lineCharged = line;
    basis = 'item-price-only';
  } else if (total >= line) {
    lineCharged = line;
    basis = 'item-price';
  } else if (ambiguous) {
    return staff('item-price-above-total-and-ambiguous');
  } else if (gapIsImplausible(line, total)) {
    return staff('amount-gap-implausible');
  } else {
    lineCharged = total;
    basis = 'order-total-lower';
  }

  // ── QUANTITY. NEVER ASSUME 1. ─────────────────────────────────────────────
  // A line total carries as many units as were bought. Refunding a percentage of
  // it without knowing how many pays a multiple of what the campaign intended.
  // Only a page that STATES the number fills this in (see src/quantity.js), and
  // Amazon prints no label on a single-unit order, so this still refuses far more
  // often than it pays — deliberately. Refusing costs a staff review; guessing
  // costs money.
  const quantity = order?.quantity ?? null;
  if (quantity == null) return staff('quantity-unknown');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PLAUSIBLE_QUANTITY) {
    return staff('quantity-implausible');
  }
  if (quantity === 1) {
    return { paise: lineCharged, basis, needsStaff: false, reason: null };
  }

  // More than one unit: the refund is for ONE of them. Only exact division is
  // accepted — rounding real money in either direction is not a silent decision.
  const q = BigInt(quantity);
  if (lineCharged % q !== 0n) return staff('quantity-not-divisible');
  return {
    paise: lineCharged / q,
    basis: 'unit-from-line-total',
    needsStaff: false,
    reason: null,
  };
}
