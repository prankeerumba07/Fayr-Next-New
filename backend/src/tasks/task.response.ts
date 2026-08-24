import type { Campaign, Task } from '@prisma/client';
import { resolveChargedPaise } from './engine/charged-amount';
import { computeRefundPaise } from './engine/money';
import { policyForWindowDays } from './engine/return-policy';
import type { TaskStateName } from './engine/states';
import { refundEligibility } from './engine/transition';
import { toEngineTask } from './task.mapper';

/**
 * The public shape of a task. Money is integer paise as decimal STRINGS (JSON
 * has no BigInt), dates are ISO strings — the 1.4 convention. Includes a compact
 * campaign summary so the client can render the task without a second fetch, and
 * a refund block that says whether it can release and, if not, exactly why.
 */
export interface TaskResponse {
  id: string;
  state: TaskStateName;
  campaign: {
    id: string;
    title: string;
    productName: string;
    platform: string;
    category: string | null;
    ticketCost: number;
    payoutPercent: number;
    imageUrl: string | null;
  };
  order: {
    id: string | null;
    itemPaise: string | null;
    /**
     * The two NAMED money fields, sent because the device runs its own copy of
     * resolveChargedPaise and these are two of its six inputs.
     *
     * They were stored, they decided the payout, and they were never sent — so a
     * staff-confirmed per-unit price paid a refund the screen could not show a
     * price for, and the device's resolver was answering a money question with
     * half its evidence missing. See src/chargedAmount.test.mjs, which reads the
     * resolver's inputs out of its own source and checks every one arrives.
     */
    unitPricePaise: string | null;
    lineTotalPaise: string | null;
    /** Units on the line. NULL = unknown, which is never read as 1. */
    quantity: number | null;
    orderTotalPaise: string | null;
    /** Also a resolver input: more than one amount was found in the item's row. */
    itemAmountAmbiguous: boolean;
    match?: {
      score?: number | null;
      amountOk?: boolean | null;
      ambiguous?: boolean;
      candidateCount?: number | null;
    } | null;
    /** True once the user has explicitly confirmed this is their order. */
    orderConfirmed?: boolean;
    product: string | null;
    date: string | null;
    source: string | null;
    /**
     * The order's own product photo and marketplace status line. Collected by the
     * readers, sent, validated and STORED — but until now never returned, so the
     * Task screen rendered `task.order.image` / `task.order.statusText` that were
     * always undefined once the authoritative snapshot replaced the optimistic
     * copy. Same class of bug as `match`: dropped at the boundary, not at source.
     */
    image: string | null;
    statusText: string | null;
  } | null;
  delivery: { at: string; source: string | null } | null;
  review: {
    published: boolean;
    rating: number | null;
    product: string | null;
  } | null;
  returned: boolean | null;
  blocker: string | null;
  blockerReason: string | null;
  windowEndsAt: string | null;
  refund: {
    eligible: boolean;
    reasons: string[];
    /** What would be paid if released now, integer paise as a string, or null. */
    amountPaise: string | null;
    /**
     * WHICH price that was worked out from — the resolved charged amount, from the
     * same resolveChargedPaise call the payout uses.
     *
     * Sent so a screen can show the figure the refund is actually based on instead
     * of picking a raw field and hoping it is the same one. On a staff-confirmed
     * amount it is the only price the client has; on a discounted Flipkart order
     * it is the order total rather than the item's listed line. Null whenever no
     * figure could be decided, which is the same condition as amountPaise being
     * null — one resolver, one answer, never two.
     */
    basedOnPaise: string | null;
  };
  claimExpiresAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoEpoch = (ms: number | null | undefined): string | null =>
  ms != null ? new Date(ms).toISOString() : null;

/** Build the public task response from a row and its campaign. */
export function toTaskResponse(
  row: Task,
  campaign: Campaign,
  now: number = Date.now(),
): TaskResponse {
  const task = toEngineTask(row, []);
  const policy = policyForWindowDays(campaign.returnWindowDays);
  const elig = refundEligibility(task, now, policy);

  // THE SCREEN MUST NEVER PROMISE A NUMBER THE PAYOUT WOULD REFUSE.
  //
  // This used to read task.order.itemPaise DIRECTLY — the one thing attemptRelease
  // explicitly warns against — so the amount shown bypassed every money rule. It
  // could show a listed price where the payout would pay the charged one (the live
  // Flipkart case: 367 shown, 328 paid), and with the quantity rule it would show a
  // line total's worth for an order whose units we cannot count.
  //
  // Both now come from the same resolver, so display and payout agree by
  // construction. needsStaff means no number is shown at all, which is honest: a
  // figure a human still has to confirm is not a promise we can make.
  const charged = resolveChargedPaise(task.order);
  const amountPaise =
    charged.paise != null
      ? computeRefundPaise(
          charged.paise,
          campaign.payoutPercent,
          campaign.payoutCapPaise,
        )
      : null;

  return {
    id: row.id,
    state: task.state,
    campaign: {
      id: campaign.id,
      title: campaign.title,
      productName: campaign.productName,
      platform: campaign.platform,
      category: campaign.category,
      ticketCost: campaign.ticketCost,
      payoutPercent: campaign.payoutPercent,
      imageUrl: campaign.imageUrl,
    },
    order: task.order
      ? {
          id: task.order.id,
          // The raw line figure, for display and support. Distinct from the refund
          // basis above on purpose: this is what the order says, that is what we
          // would actually pay.
          itemPaise:
            task.order.itemPaise != null ? task.order.itemPaise.toString() : null,
          unitPricePaise:
            task.order.unitPricePaise != null
              ? task.order.unitPricePaise.toString()
              : null,
          lineTotalPaise:
            task.order.lineTotalPaise != null
              ? task.order.lineTotalPaise.toString()
              : null,
          quantity: task.order.quantity ?? null,
          orderTotalPaise:
            task.order.orderTotalPaise != null
              ? task.order.orderTotalPaise.toString()
              : null,
          itemAmountAmbiguous: task.order.itemAmountAmbiguous === true,
          product: task.order.product ?? null,
          date: isoEpoch(task.order.date),
          source: task.order.source ?? null,
          // Returned so the "is this your order?" screen can still warn AFTER the
          // authoritative response lands. Dropping it here is what silently
          // disarmed those warnings on every round trip.
          match: task.order.match ?? null,
          orderConfirmed: task.orderConfirmed === true,
          image: task.order.image ?? null,
          statusText: task.order.statusText ?? null,
        }
      : null,
    delivery: task.delivery
      ? {
          at: new Date(task.delivery.at).toISOString(),
          source: task.delivery.source,
        }
      : null,
    review: task.review
      ? {
          published: task.review.published,
          rating: task.review.rating ?? null,
          product: task.review.product ?? null,
        }
      : null,
    returned: task.returned,
    blocker: task.blocker,
    blockerReason: task.blockerReason,
    windowEndsAt: isoEpoch(elig.windowEndsAt),
    refund: {
      eligible: elig.eligible,
      reasons: elig.reasons,
      amountPaise: amountPaise != null ? amountPaise.toString() : null,
      basedOnPaise: charged.paise != null ? charged.paise.toString() : null,
    },
    claimExpiresAt: iso(row.claimExpiresAt),
    closedAt: iso(row.closedAt),
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
  };
}
