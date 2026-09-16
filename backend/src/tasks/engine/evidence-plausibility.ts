import type { Evidence, EvidenceOrder } from './evidence.types';
import { DAY } from './states';

/**
 * SERVER-SIDE PLAUSIBILITY GATE for submitted evidence.
 *
 * `POST /tasks/:id/evidence` is authenticated but otherwise trusts its body: the
 * device asserts the order, the delivery date, the review's published flag AND
 * its own `source` tier. There is no signature, and a bundled-key HMAC would not
 * be one either — the key ships inside the app. So instead of pretending the
 * client is trustworthy, the server refuses submissions that are impossible on
 * their face. That is real defence which does not depend on a secret the client
 * can leak.
 *
 * Scope, stated plainly: this raises the cost of forging evidence, it does not
 * make the device trustworthy. Only real device attestation (App Attest /
 * Play Integrity) or independent server-side verification does that — logged as
 * a separate decision, deliberately not built here.
 *
 * Design rule throughout: bands are GENEROUS. A false reject destroys real
 * evidence a user cannot resubmit (the idempotency key would dedupe the retry),
 * so every bound below targets the physically impossible, not the merely odd.
 */

/** Clock skew allowance for a device-supplied timestamp. */
const SKEW_MS = 6 * 60 * 60 * 1000; // 6h — covers timezone confusion, not fraud

/**
 * Oldest delivery a claim may assert. The attack this closes: post a delivery
 * date far in the past so the holding period is already elapsed and the refund
 * releases immediately, skipping the VISIBILITY_CHECK that catches a review
 * deleted mid-hold. Two years is well beyond any marketplace return window while
 * still allowing a genuinely stale-but-real order.
 */
const MAX_DELIVERY_AGE_MS = 730 * DAY;

/**
 * How far a claimed amount may diverge from the campaign price before it is
 * treated as impossible rather than discounted. Deliberately wide: real prices
 * move, campaigns are edited, and the refund itself is separately floored to the
 * amount actually charged (see charged-amount.ts). This only catches nonsense.
 */
const AMOUNT_MAX_MULTIPLE = 10n;

export interface PlausibilityResult {
  ok: boolean;
  /** Machine-readable reasons, safe to log and to show staff. */
  rejections: string[];
}

export interface PlausibilityCampaign {
  productPricePaise: bigint | null;
}

function amountImplausible(
  claimedPaise: bigint | null | undefined,
  campaignPaise: bigint | null,
): boolean {
  if (claimedPaise == null || campaignPaise == null) return false;
  if (claimedPaise < 0n || campaignPaise <= 0n) return claimedPaise < 0n;
  // Impossible in either direction: 10x over, or a tenth of, the campaign price.
  if (claimedPaise > campaignPaise * AMOUNT_MAX_MULTIPLE) return true;
  if (claimedPaise * AMOUNT_MAX_MULTIPLE < campaignPaise) return true;
  return false;
}

/**
 * Reject evidence that cannot be true. `existingOrder` is the order already on
 * the task, when any — used to refuse an order SWAP, which is how a task's refund
 * figure could otherwise be re-priced upward after it was confirmed.
 */
export function checkPlausibility(
  evidence: Evidence,
  campaign: PlausibilityCampaign,
  now: number,
  existingOrder?: EvidenceOrder | null,
): PlausibilityResult {
  const rejections: string[] = [];
  const future = now + SKEW_MS;

  const orderDate = evidence.order?.date ?? null;
  const deliveryAt = evidence.delivery?.at ?? null;
  const reviewDate = evidence.review?.reviewDate ?? null;

  if (orderDate != null && orderDate > future) {
    rejections.push('order-date-in-future');
  }
  if (deliveryAt != null && deliveryAt > future) {
    rejections.push('delivery-date-in-future');
  }
  if (deliveryAt != null && deliveryAt < now - MAX_DELIVERY_AGE_MS) {
    // The holding-window bypass.
    rejections.push('delivery-date-implausibly-old');
  }
  if (orderDate != null && deliveryAt != null && deliveryAt < orderDate - SKEW_MS) {
    rejections.push('delivered-before-ordered');
  }
  if (reviewDate != null && reviewDate > future) {
    rejections.push('review-date-in-future');
  }
  // A STATED RETURN WINDOW THAT IS NOT A RETURN WINDOW.
  //
  // This is NOT a money guard, and saying so matters: windowEnd takes the LATER
  // of this and the policy table, so no value of it can pay anybody sooner. What
  // it guards against is a task nobody can ever release and a queue nobody can
  // ever clear — a hold anchored to a date years out because a page was read
  // wrong. A year past the delivery is longer than any marketplace's window,
  // generously, and a real one is measured in days.
  const statedWindowEnd = evidence.delivery?.returnWindowEndsAt ?? null;
  if (
    statedWindowEnd != null && deliveryAt != null
    && statedWindowEnd > deliveryAt + 365 * DAY
  ) {
    rejections.push('return-window-implausibly-long');
  }
  if (orderDate != null && reviewDate != null && reviewDate < orderDate - SKEW_MS) {
    // ANTI-REPLAY: a review that predates the order is a review of something
    // else, or a review recycled from an older purchase.
    rejections.push('review-predates-order');
  }

  if (amountImplausible(evidence.order?.itemPaise, campaign.productPricePaise)) {
    rejections.push('item-amount-implausible');
  }
  if (
    amountImplausible(evidence.order?.orderTotalPaise, campaign.productPricePaise)
  ) {
    rejections.push('order-total-implausible');
  }

  // ORDER SWAP. Once a task is anchored to a real order id, a submission naming a
  // DIFFERENT one is not new evidence about the same purchase — it is a different
  // purchase, and accepting it silently rewrites the refund figure.
  const incomingId = evidence.order?.id ?? null;
  const anchoredId = existingOrder?.id ?? null;
  if (anchoredId != null && incomingId != null && anchoredId !== incomingId) {
    rejections.push('order-id-changed');
  }

  return { ok: rejections.length === 0, rejections };
}
