import type { Campaign, Task } from '@prisma/client';
import { computeRefundPaise } from './engine/money';
import {
  chargedDisagreesWithCampaign,
  resolveChargedPaise,
} from './engine/charged-amount';
import { staffAmountBounds } from './engine/staff-amount';
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
  /**
   * WHICH decision clears this. The panel renders one control or the other from
   * this rather than re-deriving it from the reason string — two readings of one
   * decision is how the money defects started.
   */
  action: 'count' | 'amount';
  /** What the campaign says the product costs, for the reviewer to compare against. */
  campaignPricePaise: string | null;
  /** The most a person may type here, and which real figure produced that ceiling. */
  maxAmountPaise: string | null;
  maxAmountAnchor: 'campaign-price' | 'order-total' | null;
}

export interface AwaitingAmountResponse {
  items: AwaitingAmountItem[];
  total: number;
}

/** What confirming a given figure would actually pay. Writes nothing. */
export interface RefundPreviewResponse {
  /** The hypothetical count, when that is what is being previewed. */
  quantity: number | null;
  /** The hypothetical per-unit price, when that is what is being previewed. */
  unitPricePaise: string | null;
  /** The amount the refund would be based on, or null when still undecidable. */
  chargedPaise: string | null;
  /** What would land in the wallet: percentage of charged, floored, then capped. */
  refundPaise: string | null;
  payable: boolean;
  heldReason: string | null;
  heldExplanation: string | null;
  /** The campaign's own price, so a disagreement can be shown, not just flagged. */
  campaignPricePaise: string | null;
  /**
   * True when the figure the refund would use differs from the campaign's price
   * by more than the tolerance. NOT a block — a real discount is legitimate — but
   * it must not pass unremarked.
   */
  disagreesWithCampaign: boolean;
  maxAmountPaise: string | null;
  maxAmountAnchor: 'campaign-price' | 'order-total' | null;
}

/** True when this task's refund is waiting on somebody stating a unit count. */
export function heldOnQuantity(reason: string | null): boolean {
  return reason != null && reason.startsWith('quantity-');
}

/**
 * True when no price could be read at all, so a person has to supply one.
 *
 * Deliberately NOT the other amount holds. 'item-price-above-total-and-ambiguous'
 * and 'amount-gap-implausible' both already HAVE an amount, established by a
 * source that outranks a human typing — and staff confirmation may not overwrite
 * that. Those need a different decision (which of two figures to believe), and
 * putting them in this queue would mean a card with a control that cannot fix it.
 */
export function heldOnAmount(reason: string | null): boolean {
  return reason === 'amount-unknown';
}

/** Which staff decision clears this hold, or null when neither can. */
export function actionFor(reason: string | null): 'count' | 'amount' | null {
  if (heldOnQuantity(reason)) return 'count';
  if (heldOnAmount(reason)) return 'amount';
  return null;
}

type Row = Task & { campaign: Campaign; user: { id: string; mobile: string } };

export function toAwaitingAmountItem(row: Row): AwaitingAmountItem | null {
  const task = toEngineTask(row, []);
  const order = task.order;
  if (!order) return null;
  const charged = resolveChargedPaise(order);
  const action = charged.needsStaff ? actionFor(charged.reason) : null;
  if (action === null) return null;
  const bounds = staffAmountBounds({
    campaignPricePaise: row.campaign.productPricePaise,
    orderTotalPaise: order.orderTotalPaise ?? null,
  });

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
    action,
    campaignPricePaise:
      row.campaign.productPricePaise != null
        ? row.campaign.productPricePaise.toString()
        : null,
    maxAmountPaise: bounds.maxPaise != null ? bounds.maxPaise.toString() : null,
    maxAmountAnchor: bounds.anchor,
  };
}

/**
 * What a chosen figure would pay — through the SAME resolver and the SAME payout
 * function the release uses.
 *
 * Deliberately not "percentage of the line figure" computed here. Four separate
 * defects have now come from a number being reached by a second route: a listed
 * price shown against a charged one, a percentage shown without its cap, a count
 * read without knowing what it counted, and a paid-out total summed from a table
 * the ledger does not agree with. A preview doing its own arithmetic would be the
 * fifth.
 *
 * `overrides` is the hypothetical the reviewer is considering — a count, or a
 * per-unit price. Nothing is written.
 */
export function toRefundPreview(
  row: Task & { campaign: Campaign },
  overrides: { quantity?: number; unitPricePaise?: bigint },
): RefundPreviewResponse {
  const task = toEngineTask(row, []);
  const order = task.order;
  const hypothetical = order ? { ...order, ...overrides } : order;
  const charged = resolveChargedPaise(hypothetical);
  const bounds = staffAmountBounds({
    campaignPricePaise: row.campaign.productPricePaise,
    orderTotalPaise: order?.orderTotalPaise ?? null,
  });
  const context = {
    quantity: overrides.quantity ?? null,
    unitPricePaise:
      overrides.unitPricePaise != null ? overrides.unitPricePaise.toString() : null,
    campaignPricePaise:
      row.campaign.productPricePaise != null
        ? row.campaign.productPricePaise.toString()
        : null,
    maxAmountPaise: bounds.maxPaise != null ? bounds.maxPaise.toString() : null,
    maxAmountAnchor: bounds.anchor,
    // Compared against what was CHARGED, not what the reviewer typed, so the
    // warning fires on the figure the refund would actually be based on.
    disagreesWithCampaign:
      charged.paise != null &&
      chargedDisagreesWithCampaign(charged.paise, row.campaign.productPricePaise),
  };

  if (charged.paise == null) {
    return {
      ...context,
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
    ...context,
    chargedPaise: charged.paise.toString(),
    refundPaise: refund.toString(),
    payable: true,
    heldReason: null,
    heldExplanation: null,
  };
}
