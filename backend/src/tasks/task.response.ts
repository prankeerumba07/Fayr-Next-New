import type { Campaign, Task } from '@prisma/client';
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
    orderTotalPaise: string | null;
    product: string | null;
    date: string | null;
    source: string | null;
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

  const itemPaise = task.order?.itemPaise ?? null;
  const amountPaise =
    itemPaise != null
      ? computeRefundPaise(
          itemPaise,
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
          itemPaise: itemPaise != null ? itemPaise.toString() : null,
          orderTotalPaise:
            task.order.orderTotalPaise != null
              ? task.order.orderTotalPaise.toString()
              : null,
          product: task.order.product ?? null,
          date: isoEpoch(task.order.date),
          source: task.order.source ?? null,
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
    },
    claimExpiresAt: iso(row.claimExpiresAt),
    closedAt: iso(row.closedAt),
    closeReason: row.closeReason,
    createdAt: row.createdAt.toISOString(),
  };
}
