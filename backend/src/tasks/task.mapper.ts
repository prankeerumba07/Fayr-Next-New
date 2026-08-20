import { Prisma, type Task } from '@prisma/client';
import type {
  EvidenceDelivery,
  EvidenceOrder,
  EvidenceReview,
} from './engine/evidence.types';
import { windowEnd } from './engine/transition';
import { type ReturnPolicy } from './engine/return-policy';
import type { BlockerName, TaskStateName } from './engine/states';
import type { EngineTask } from './engine/task-state';

/**
 * The bridge between the persisted Task row and the pure EngineTask.
 *
 * Split of responsibilities on the row:
 *   - queryable/constrainable facts live in promoted COLUMNS (state, itemPaise,
 *     deliveredAt, reviewPublished, windowEndsAt, returned, blocker…);
 *   - the nested evidence the engine emits lives in the `evidence` JSONB.
 *
 * JSON has no BigInt, so money inside `evidence` is stored as decimal STRINGS
 * and parsed back to bigint on hydrate. The promoted `itemPaise` column is the
 * real BigInt; the JSON copy is only there to rebuild the full order object.
 */

/** The order as stored in JSON — money fields are strings (or null). */
type StoredOrder = Omit<
  EvidenceOrder,
  'itemPaise' | 'unitPricePaise' | 'lineTotalPaise' | 'orderTotalPaise' | 'mrpPaise'
> & {
  itemPaise: string | null;
  unitPricePaise: string | null;
  lineTotalPaise: string | null;
  orderTotalPaise: string | null;
  mrpPaise: string | null;
};

interface StoredEvidence {
  order: StoredOrder | null;
  delivery: EvidenceDelivery | null;
  review: EvidenceReview | null;
  orderConfirmed: boolean;
  probe: Prisma.JsonValue | null;
}

function bigintOrNull(v: bigint | null | undefined): string | null {
  return v != null ? v.toString() : null;
}

function parseBigint(v: string | null | undefined): bigint | null {
  return v != null ? BigInt(v) : null;
}

function orderToStored(order: EvidenceOrder | null): StoredOrder | null {
  if (!order) return null;
  return {
    ...order,
    itemPaise: bigintOrNull(order.itemPaise),
    // EVERY money field must be listed here. A bigint spread through untouched
    // reaches JSON.stringify and throws "Do not know how to serialize a BigInt" —
    // a 500 on evidence submission, which is how these two were caught.
    unitPricePaise: bigintOrNull(order.unitPricePaise),
    lineTotalPaise: bigintOrNull(order.lineTotalPaise),
    orderTotalPaise: bigintOrNull(order.orderTotalPaise),
    mrpPaise: bigintOrNull(order.mrpPaise),
  };
}

function orderFromStored(order: StoredOrder | null): EvidenceOrder | null {
  if (!order) return null;
  return {
    ...order,
    itemPaise: parseBigint(order.itemPaise),
    unitPricePaise: parseBigint(order.unitPricePaise),
    lineTotalPaise: parseBigint(order.lineTotalPaise),
    orderTotalPaise: parseBigint(order.orderTotalPaise),
    mrpPaise: parseBigint(order.mrpPaise),
  };
}

/** Hydrate a DB row (+ its already-applied event keys) into a pure EngineTask. */
export function toEngineTask(row: Task, appliedKeys: string[]): EngineTask {
  const stored = (row.evidence as unknown as StoredEvidence | null) ?? null;
  const applied: Record<string, number> = {};
  for (const key of appliedKeys) applied[key] = 1;

  return {
    id: row.id,
    platform: row.platform,
    category: row.category,
    target: {
      asin: row.targetAsin,
      reviewId: row.targetReviewId,
      product: row.targetProduct,
    },
    state: row.state as TaskStateName,
    order: orderFromStored(stored?.order ?? null),
    delivery: stored?.delivery ?? null,
    review: stored?.review ?? null,
    returned: row.returned,
    orderConfirmed: stored?.orderConfirmed ?? false,
    blocker: row.blocker as BlockerName | null,
    blockerReason: row.blockerReason,
    probe: stored?.probe ?? null,
    // The audit list + full history live in the visibility_checks / task_events
    // tables; the engine only appends, so hydrating them empty is faithful.
    visibilityChecks: [],
    applied,
    history: [],
  };
}

/** The promoted columns to write for a task, derived from the engine state. */
export function toPromotedColumns(
  task: EngineTask,
  policy: ReturnPolicy,
): Prisma.TaskUncheckedUpdateInput {
  const w = windowEnd(task, policy);
  return {
    state: task.state,
    // Promoted so the refund gate can ask "has this order already been paid
    // out?" with an index instead of digging through JSONB.
    orderId: task.order?.id ?? null,
    returned: task.returned,
    itemPaise: task.order?.itemPaise ?? null,
    deliveredAt: task.delivery ? new Date(task.delivery.at) : null,
    reviewPublished: task.review?.published ?? null,
    windowEndsAt: w != null ? new Date(w) : null,
    blocker: task.blocker,
    blockerReason: task.blockerReason,
  };
}

/** The nested evidence to store as JSONB (money → strings). */
export function toEvidenceJson(task: EngineTask): Prisma.InputJsonValue {
  const stored: StoredEvidence = {
    order: orderToStored(task.order),
    delivery: task.delivery,
    review: task.review,
    orderConfirmed: task.orderConfirmed,
    probe: (task.probe ?? null) as Prisma.JsonValue,
  };
  return stored as unknown as Prisma.InputJsonValue;
}
