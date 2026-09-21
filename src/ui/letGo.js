// A CLAIM THAT WAS LET GO IS NOT A LIVE CLAIM. THE DECISION ONLY.
//
// ── THE BUG, IN THE OWNER'S WORDS ───────────────────────────────────────────
//
// "'Continue' for ever: listForUser returns closed tasks; hasTask is true for
// any task id. A claim that was released and never bought keeps its card on
// 'Continue'."
//
// The store keeps every task our side has ever sent, closed or not, and that is
// right — a REFUNDED task is closed and must still show as done, and a claim
// that expired must still be able to say so. What was wrong is the question
// hasTask answered: "is there a task id" rather than "is there a live claim".
//
// ── THE SAME SHAPE seats.ts EXCLUDES, AND NOT A SECOND IDEA OF IT ───────────
//
// backend/src/campaigns/seats.ts frees a seat for exactly one shape of task,
// in the owner's words: "A claim that has been RELEASED — closed with its
// tickets returned, and never purchased — holds no seat." Written there as
//
//   SEAT_TAKEN_BY = { NOT: { closedAt: { not: null }, state: 'CLAIMED', orderId: null } }
//
// Three facts that must ALL hold: closed, still CLAIMED, no order. This file is
// that condition on the phone, and letGo.test.mjs reads seats.ts off disk to
// hold the two to the same three facts, so they cannot drift apart: the day a
// seat frees is the day the card says Claim again, and never a day earlier or
// later.
//
// A REFUNDED task fails the second fact and is not let go. Closed does not mean
// gone. Nothing is filtered out of listForUser on our side, because REFUNDED
// history would vanish with it.
//
// ── AND THE SECOND SHAPE, 21 SEPTEMBER 2026: THE ORDER WENT BACK ────────────
//
// The owner bought the Cadbury product on a one-slot offer and the shop
// cancelled the order. In his words: "the user has completed every step from
// their side... the user should be allowed to complete the campaign again. They
// should have to claim the campaign again and accept the terms and conditions
// again... when I go back on the Fayr homepage, I need to see that the campaign
// is active again... it should show 'Claim' not 'Continue'."
//
// That task has an order and it moved past CLAIMED, so the first shape keeps it
// for ever. seats.ts grew a SECOND row under its NOT for it —
//
//   { closedAt: { not: null }, closeReason: 'returned' }
//
// — and this is that row on the phone. The two shapes free for different
// reasons and either one on its own is enough, so they are written as two
// questions and an OR, exactly as the server writes two rows and not four facts.
//
// THE CLOSE REASON IS THE WHOLE TEST, not `returned` itself. `returned` is
// written the moment the shop's page says the word; the close comes afterwards,
// in the one server method that also returns the five tickets. A card that went
// back to "Claim" on the word alone would offer a second claim while the first
// was still live.
//
// AND IT IS STILL THERE IN MY PRODUCTS. That screen lists tasks directly and
// never asks this question, so the person can still open a cancelled order and
// read why it stopped — the Home card going back to "Claim" is about the OFFER
// being open again, not about the task being gone.
//
// PURE. No React, no store, no clock.

import { STATES } from '../taskflow.js'; // explicit extension: also run under node

/**
 * WAS THIS CLAIM LET GO — closed, never moved past CLAIMED, and with no order?
 *
 * Handed the server's task response, or the engine task the store mirrors from
 * it; both carry `closedAt`, `state` and `order`. Anything that is not a task
 * answers false, which is the shy direction: a card that says Continue on a
 * shape this file does not understand is a card a person can still act on.
 */
export function isLetGo(task) {
  const t = task && typeof task === 'object' ? task : null;
  if (!t) return false;
  const closed = t.closedAt != null && t.closedAt !== '';
  const stillClaimed = t.state === STATES.CLAIMED;
  const orderId = t.order && typeof t.order === 'object' ? t.order.id : null;
  const noOrder = orderId == null || orderId === '';
  const releasedWithoutBuying = closed && stillClaimed && noOrder;
  const theOrderWentBack = closed && t.closeReason === 'returned';
  return releasedWithoutBuying || theOrderWentBack;
}
