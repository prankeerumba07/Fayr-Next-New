/**
 * The refund amount, in integer paise.
 *
 * The refundable figure is the amount ACTUALLY CHARGED for the product. Callers
 * must resolve it with `resolveChargedPaise` (see charged-amount.ts) rather than
 * reaching for `order.itemPaise`, because on some platforms that field is the
 * listed/selling price and sits ABOVE what was paid. A campaign then bounds it
 * with a percentage and an optional cap: min(chargedPaise × payoutPercent / 100,
 * cap). Integer bigint maths throughout — the division floors, so we never
 * over-pay a fraction.
 */
export function computeRefundPaise(
  itemPaise: bigint,
  payoutPercent: number,
  capPaise: bigint | null,
): bigint {
  if (itemPaise < 0n) {
    throw new Error('itemPaise must be >= 0');
  }
  if (!Number.isInteger(payoutPercent) || payoutPercent < 0) {
    throw new Error('payoutPercent must be a non-negative integer');
  }
  const base = (itemPaise * BigInt(payoutPercent)) / 100n; // floors
  if (capPaise != null && base > capPaise) {
    return capPaise;
  }
  return base;
}
