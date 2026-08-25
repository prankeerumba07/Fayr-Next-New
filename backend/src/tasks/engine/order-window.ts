// THE CAMPAIGN MUST HAVE CAUSED THE PURCHASE.
//
// A campaign may only ever consider orders placed inside the window that opens
// when the user claims it. An order from before that is a purchase they were
// going to make anyway, and paying a refund on it is not an incentivised review —
// it is a giveaway. It also narrows the window a forged screenshot has to fit
// inside, and it bounds the order-history search (page backwards until you pass
// the floor, then stop) instead of an arbitrary "last N orders".
//
// Before this existed there was NO comparison of an order date to the campaign
// anywhere: checkPlausibility compared the order date only to `now`, to the
// delivery date and to the review date, and the campaign it received carried
// nothing but a price. The hole was live and demonstrably exercised — see
// ORDER_WINDOW_RULE_FROM below.
//
// Enforced on the BACKEND. The device also filters, but only so a user is not
// shown an order that cannot qualify; the decision here is the authoritative one
// and applies identically to scraped, screenshot/OCR and manually-typed dates.

import type { Evidence } from './evidence.types';
import { BLOCKERS, DAY } from './states';

/**
 * A user who finds an offer, opens the marketplace, buys, and only THEN comes
 * back and taps Claim has done the right thing in the wrong order. Two hours
 * absorbs that; it cannot launder a purchase from last January.
 */
export const ORDER_WINDOW_GRACE_MS = 2 * 60 * 60 * 1000;

/**
 * The rule ships with a cutoff because EVERY task that existed when it landed
 * would fail it — all seven, including two already REFUNDED. They are dev-account
 * test purchases, so there is no fraud to unwind, and voiding them would claw
 * back real ledger entries and leave nothing working to demonstrate.
 *
 * So: tasks CLAIMED before this instant are exempt, and are exempt permanently —
 * keyed on the task, not on the submission, so re-fetching an old task does not
 * suddenly fail it. Tasks claimed after it are bound by the rule.
 *
 * This constant is the entire grandfather clause. Delete it and the rule applies
 * to everything.
 */
export const ORDER_WINDOW_RULE_FROM = Date.UTC(2026, 7, 17); // 2026-08-17

/** Why an order date does not qualify. Distinct causes, distinct wording. */
export type OrderWindowVerdict =
  | 'ok'
  | 'before-claim' // bought before the campaign was claimed — never qualifies
  | 'after-deadline'; // bought after the purchase deadline had passed

export interface OrderWindow {
  /** Earliest qualifying order instant, inclusive. */
  floor: number;
  /** Latest qualifying order instant, inclusive; null when no deadline is set. */
  ceiling: number | null;
  /** False for a task claimed before the rule shipped. */
  enforced: boolean;
}

export interface OrderWindowInput {
  /** When THIS user claimed the campaign (tasks.createdAt). */
  claimedAt: number;
  /** When the campaign itself was created — the secondary backstop. */
  campaignCreatedAt: number | null;
  /** The purchase deadline, giving a CLOSED window rather than an open floor. */
  claimExpiresAt: number | null;
  graceMs?: number;
}

/**
 * The qualifying window for one task.
 *
 * Floor is claim time less the grace, but never earlier than the campaign itself:
 * a campaign re-published later must not be able to reopen an older window, and a
 * generous grace must not reach back past the campaign's own existence.
 */
export function orderWindow(input: OrderWindowInput): OrderWindow {
  const grace = input.graceMs ?? ORDER_WINDOW_GRACE_MS;
  const softFloor = input.claimedAt - grace;
  const floor =
    input.campaignCreatedAt != null
      ? Math.max(softFloor, input.campaignCreatedAt)
      : softFloor;
  return {
    floor,
    ceiling: input.claimExpiresAt,
    enforced: input.claimedAt >= ORDER_WINDOW_RULE_FROM,
  };
}

/**
 * Does this order date qualify? An unknown date is NOT a failure — plenty of
 * readers legitimately cannot resolve one, and refusing on absence would reject
 * real evidence. Absence is handled by the normal missing-data path.
 */
export function checkOrderWindow(
  orderDate: number | null | undefined,
  window: OrderWindow,
): OrderWindowVerdict {
  if (orderDate == null) return 'ok';
  if (!window.enforced) return 'ok';
  if (orderDate < window.floor) return 'before-claim';
  if (window.ceiling != null && orderDate > window.ceiling) return 'after-deadline';
  return 'ok';
}

/**
 * How far back a reader needs to search, in days — what replaces "the last 10
 * orders". Bounded by the floor, so the search is COMPLETE for the window that
 * matters instead of arbitrary.
 *
 * `maxDays` is the configurable ceiling on the search itself (a longer window for
 * testing must not weaken the rule above — it only lets the scraper look further,
 * and checkOrderWindow still refuses anything before the floor).
 */
export function lookbackDays(
  window: OrderWindow,
  now: number,
  maxDays: number,
): number {
  const spanMs = Math.max(0, now - window.floor);
  const days = Math.ceil(spanMs / DAY) + 1; // +1 so the floor's own day is included
  return Math.max(1, Math.min(days, maxDays));
}

/**
 * What the user is told. Two rules that must hold for every line here:
 *
 *  1. It must read as a RULE, not a glitch. "We couldn't read your order" made a
 *     deliberate refusal look like a broken scraper.
 *  2. It must say what to do next — or say plainly that there is nothing to do.
 *     Never leave someone guessing about their money.
 *
 * No upload can change a date, so neither message offers one.
 */
export const OUT_OF_WINDOW_MESSAGE: Record<
  Exclude<OrderWindowVerdict, 'ok'>,
  string
> = {
  'before-claim':
    'You bought this before you claimed the offer, so it doesn’t qualify. '
    + 'Only orders placed after you claim can be refunded. To earn a refund, '
    + 'claim the offer first, then buy the product.',
  'after-deadline':
    'You bought this after the time to buy had run out, so it doesn’t qualify. '
    + 'Claim the offer again if it is still open, then buy within the deadline.',
};

export interface WindowScreenResult {
  evidence: Evidence;
  verdict: OrderWindowVerdict;
  /** True when the order was refused and stripped from the evidence. */
  refused: boolean;
}

/**
 * THE ENFORCEMENT POINT. Applied to every evidence submission regardless of
 * source, so scraped, screenshot/OCR and typed dates are all bound identically —
 * deliberately NOT behind the opt-in plausibility flag, which the staff OCR path
 * turns off.
 *
 * An out-of-window order is STRIPPED rather than 400'd: the submission still
 * lands as an audit record, the task carries an honest blocker the screen can
 * explain, and — the part that matters for money — the order never becomes the
 * task's anchor, so no itemPaise or orderId is written and nothing can compute a
 * refund from it.
 *
 * The delivery goes with it: a delivery date for an order that does not qualify
 * is not evidence of anything. The review is kept, because it is harmless
 * information and cannot advance the task on its own.
 */
export function screenEvidenceByWindow(
  evidence: Evidence,
  window: OrderWindow,
): WindowScreenResult {
  const verdict = checkOrderWindow(evidence.order?.date ?? null, window);
  if (verdict === 'ok') return { evidence, verdict, refused: false };
  return {
    verdict,
    refused: true,
    evidence: {
      ...evidence,
      order: null,
      delivery: null,
      blocker: BLOCKERS.ORDER_OUT_OF_WINDOW,
      reason: OUT_OF_WINDOW_MESSAGE[verdict],
    },
  };
}
