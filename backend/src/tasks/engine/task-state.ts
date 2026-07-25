import type {
  EvidenceDelivery,
  EvidenceOrder,
  EvidenceReview,
} from './evidence.types';
import { STATES, type BlockerName, type TaskStateName } from './states';

/**
 * The pure in-memory task the engine operates on — ported from src/taskflow.js
 * `createTask()`. The NestJS TaskService hydrates this from the DB row, runs a
 * transition, then persists the diff; the engine itself has no I/O.
 */
export interface VisibilityCheckEntry {
  at: number;
  published: boolean;
}

export interface HistoryEntry {
  from: TaskStateName;
  to: TaskStateName;
  at: number;
  type: string;
  reason: string | null;
}

export interface EngineTask {
  id: string;
  platform: string;
  category: string | null;
  target: {
    asin: string | null;
    reviewId: string | null;
    product: string | null;
  };
  state: TaskStateName;
  order: EvidenceOrder | null;
  delivery: EvidenceDelivery | null;
  review: EvidenceReview | null;
  returned: boolean | null;
  orderConfirmed: boolean;
  blocker: BlockerName | null;
  blockerReason: string | null;
  probe: unknown;
  /** Visibility re-checks during HOLDING — auditable after the fact. */
  visibilityChecks: VisibilityCheckEntry[];
  /** Idempotency keys already applied → replays are no-ops. */
  applied: Record<string, number>;
  history: HistoryEntry[];
}

export interface CreateTaskInit {
  id: string;
  platform?: string;
  category?: string | null;
  asin?: string | null;
  reviewId?: string | null;
  product?: string | null;
}

export function createTask(init: CreateTaskInit): EngineTask {
  return {
    id: init.id,
    platform: init.platform ?? 'amazon',
    category: init.category ?? null,
    target: {
      asin: init.asin ?? null,
      reviewId: init.reviewId ?? null,
      product: init.product ?? null,
    },
    state: STATES.CLAIMED,
    order: null,
    delivery: null,
    review: null,
    returned: null,
    orderConfirmed: false,
    blocker: null,
    blockerReason: null,
    probe: null,
    visibilityChecks: [],
    applied: {},
    history: [],
  };
}
