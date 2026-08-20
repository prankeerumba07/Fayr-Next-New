import type { Campaign, Task } from '@prisma/client';
import { computeRefundPaise } from './engine/money';
import { resolveChargedPaise } from './engine/charged-amount';
import { explainHoldForStaff } from './engine/hold-reasons';
import { toEngineTask } from './task.mapper';

/**
 * One refund a person has to decide the unit count on.
 *
 * Everything here exists so the reviewer does NOT have to open the marketplace
 * order themselves to make an obvious call: what the order says, what the reader
 * saw, what it refused to assert, and why it is held — in words, not an enum.
 */
export interface AwaitingAmountItem {
  taskId: string;
  state: string;
  platform: string;
  campaignTitle: string;
  productName: string | null;
  claimedAt: string;
  user: { id: string; mobile: string };
  orderId: string | null;
  orderDate: string | null;
  /** The line figure the order carries, as a string of integer paise. */
  itemPaise: string | null;
  orderTotalPaise: string | null;
  /** The unit count in force. Null is the ordinary case — the page did not say. */
  quantity: number | null;
  /** A count a reader READ but refused to assert. See EvidenceOrder. */
  quantityObserved: number | null;
  /** Whether the page was silent, or something was seen and refused. */
  quantityReason: string | null;
  /** Machine-readable, for filtering and the audit trail. */
  heldReason: string;
  /** The same thing in plain words, for the person doing the work. */
  heldExplanation: string;
  payoutPercent: number;
  payoutCapPaise: string | null;
}

export interface AwaitingAmountResponse {
  items: AwaitingAmountItem[];
  total: number;
}

/** What confirming a given count would actually pay. */
export interface QuantityPreviewResponse {
  quantity: number;
  /** The amount the refund would be based on, or null when still undecidable. */
  chargedPaise: string | null;
  /** What would land in the wallet: percentage of charged, floored, then capped. */
  refundPaise: string | null;
  payable: boolean;
  heldReason: string | null;
  heldExplanation: string | null;
}

/** True when this task's refund is waiting on somebody stating a unit count. */
export function heldOnQuantity(reason: string | null): boolean {
  return reason != null && reason.startsWith('quantity-');
}

type Row = Task & { campaign: Campaign; user: { id: string; mobile: string } };

export function toAwaitingAmountItem(row: Row): AwaitingAmountItem | null {
  const task = toEngineTask(row, []);
  const order = task.order;
  if (!order) return null;
  const charged = resolveChargedPaise(order);
  if (!charged.needsStaff || !heldOnQuantity(charged.reason)) return null;

  return {
    taskId: row.id,
    state: task.state,
    platform: row.platform,
    campaignTitle: row.campaign.title,
    productName: order.product ?? row.campaign.productName ?? null,
    claimedAt: row.createdAt.toISOString(),
    user: { id: row.user.id, mobile: row.user.mobile },
    orderId: order.id ?? null,
    orderDate: order.date != null ? new Date(order.date).toISOString() : null,
    itemPaise:
      (order.lineTotalPaise ?? order.itemPaise ?? null) !== null
        ? String(order.lineTotalPaise ?? order.itemPaise)
        : null,
    orderTotalPaise:
      order.orderTotalPaise != null ? order.orderTotalPaise.toString() : null,
    quantity: order.quantity ?? null,
    quantityObserved: order.quantityObserved ?? null,
    quantityReason: order.quantityReason ?? null,
    // `reason` is non-null whenever needsStaff is true; the fallback keeps the
    // type honest rather than asserting it.
    heldReason: charged.reason ?? 'amount-unknown',
    heldExplanation: explainHoldForStaff(charged.reason),
    payoutPercent: row.campaign.payoutPercent,
    payoutCapPaise:
      row.campaign.payoutCapPaise != null
        ? row.campaign.payoutCapPaise.toString()
        : null,
  };
}

/**
 * What a chosen count would pay — through the SAME resolver and the SAME payout
 * function the release uses.
 *
 * This is deliberately not "percentage of the line figure" computed here. Three
 * separate defects have now come from a number being reached by a second route:
 * a listed price shown against a charged one, a percentage shown without its
 * cap, and a count read without knowing what it counted. A preview that does its
 * own arithmetic would be the fourth.
 */
export function toQuantityPreview(
  row: Task & { campaign: Campaign },
  quantity: number,
): QuantityPreviewResponse {
  const task = toEngineTask(row, []);
  const order = task.order;
  const charged = resolveChargedPaise(
    order ? { ...order, quantity } : order,
  );
  if (charged.paise == null) {
    return {
      quantity,
      chargedPaise: null,
      refundPaise: null,
      payable: false,
      heldReason: charged.reason ?? 'amount-unknown',
      heldExplanation: explainHoldForStaff(charged.reason),
    };
  }
  const refund = computeRefundPaise(
    charged.paise,
    row.campaign.payoutPercent,
    row.campaign.payoutCapPaise,
  );
  return {
    quantity,
    chargedPaise: charged.paise.toString(),
    refundPaise: refund.toString(),
    payable: true,
    heldReason: null,
    heldExplanation: null,
  };
}
