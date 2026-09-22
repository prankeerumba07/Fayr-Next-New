// What "My Products" shows, decided in one testable place.
//
// Two separate jobs live here because both are about picking the RIGHT task, and
// both were previously got wrong in ways a user could see:
//
//  1. `preferTask` — which of two tasks for the same campaign wins. The store
//     keys its map by campaignId, so re-claiming a campaign left the OLD closed
//     task on screen (see the taskstore-oldest-task-wins note). A list arriving
//     newest-first meant last-write-wins handed victory to the oldest row.
//
//  2. `myProductsView` — splitting tasks into the design's two tabs and giving
//     each row its stage. The design's own list is driven by a mock `enrolled`
//     map with a hardcoded `step`; real state has to be derived instead.
//
// Pure, so it runs under node like timeline.js / wallet.js / stages.js.

import { taskStage, closedInfo } from './stages.js';
import { STATES } from '../taskflow.js';

/** Parse an ISO date to epoch ms, tolerating null/garbage. */
function epoch(v) {
  if (!v) return null;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Which of two tasks for the SAME campaign should be displayed.
 *
 * Order of authority, most important first:
 *   1. nothing to compare against → take the incoming one;
 *   2. same task id → the incoming one is a fresher copy of the same row;
 *   3. an OPEN task beats a CLOSED one, whatever the dates say. This is the
 *      actual bug: re-claiming produced a new open task while the old closed one
 *      kept winning, so the user saw "This claim expired" on a live claim;
 *   4. otherwise the one created later wins.
 *
 * Returns the winner (one of the two arguments), never a copy.
 */
export function preferTask(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  if (existing.id && incoming.id && existing.id === incoming.id) return incoming;

  const exClosed = !!existing.closedAt;
  const inClosed = !!incoming.closedAt;
  if (exClosed !== inClosed) return exClosed ? incoming : existing;

  const exAt = epoch(existing.createdAt);
  const inAt = epoch(incoming.createdAt);
  if (exAt != null && inAt != null && exAt !== inAt) return inAt > exAt ? incoming : existing;

  // No usable dates and both equally open/closed: keep what is already shown
  // rather than flickering between two indistinguishable rows.
  return existing;
}

/**
 * True when a task is finished and paid — the "Refund Claimed" tab.
 *
 * ── AND SINCE 22 SEPTEMBER 2026, ALSO WHAT LOCKS THE OFFER'S CARD ─────────
 *
 * The owner completed the Cadbury journey end to end and his home card still
 * read "Continue", which reopened the journey on "You have been paid ₹96". In
 * his words: "Once the campaign is completed, the user should not be able to
 * continue the same campaign again. The campaign card should remain visible in
 * the feed for information, but it should be locked."
 *
 * ONE DEFINITION, TWO READERS. The My Products tab has always asked this
 * question to decide which tab a row belongs in; the home card now asks the same
 * function rather than growing a second idea of "finished". A second idea is how
 * one tab and one card end up disagreeing about the same task.
 */
export function isSettled(task) {
  return !!task && task.state === STATES.REFUNDED;
}

/**
 * THE WORDS A FINISHED OFFER'S CARD CARRIES.
 *
 * Beside isSettled, because they are the same fact said two ways and a reader
 * looking at one should see the other. The card's other two banners live in
 * ui/seats.js with the seat rule they belong to; this one is not a seat fact —
 * the offer may have seats free and still be over FOR THIS PERSON.
 *
 * "Completed" and not "Locked", which is the seats word. Two different reasons a
 * card cannot be opened must not read as one, or somebody whose journey is
 * finished is told to come back when a slot opens.
 */
export const DONE_BANNER = 'Completed — you have finished this one';

/** In place of "Continue ›". It is a statement, not an invitation. */
export const DONE_CTA = 'Completed';

/** The footer line, in place of the ticket cost or the seat count. */
export const DONE_LINE = 'Your refund is in Earnings';

/**
 * The two tabs, each row carrying what a row needs to render.
 *
 * A CLOSED-but-unpaid task (expired, cancelled) is NOT dropped: hiding it is how
 * the app used to pretend a dead claim never happened. It stays in "In Progress"
 * carrying its closedInfo, so the row can say what went wrong.
 */
export function myProductsView(tasks) {
  const list = Array.isArray(tasks) ? tasks.filter(Boolean) : [];

  const rows = list.map((t) => {
    const closed = closedInfo(t);
    const stage = taskStage(t);
    // ONE MESSAGE, READ HERE AS THE SHORT FORM. The owner's rule: "There should
    // not be any different messages for the same campaign on different pages."
    // The bar above the navigation shows this same string, and the opened screen
    // shows the long form of it. All three come from one record on the server,
    // built in backend engine/journey-message.ts. Nothing here writes wording.
    //
    // Null when the server sent none, which is every state outside the
    // went-to-the-shop journey. Those still use `stage.label` from stages.js, and
    // that is a single source too, so no state has two sources.
    const sent = t.message && typeof t.message === 'object' ? t.message : null;
    return {
      task: t,
      id: t.id || null,
      campaign: t.campaign || null,
      stage,
      closed,
      settled: isSettled(t),
      /** The SHORT form, for the row. The same string the bar shows. */
      messageShort:
        sent && typeof sent.short === 'string' && sent.short !== '' ? sent.short : null,
      /** The LONG form, for the opened screen. Carried so it is read, not rebuilt. */
      messageLong:
        sent && typeof sent.long === 'string' && sent.long !== '' ? sent.long : null,
      // A closed, unpaid claim has no next action — offering one would be a lie.
      cta: closed.closed ? null : stage.cta,
    };
  });

  return {
    inProgress: rows.filter((r) => !r.settled),
    refunded: rows.filter((r) => r.settled),
    counts: {
      inProgress: rows.filter((r) => !r.settled).length,
      refunded: rows.filter((r) => r.settled).length,
    },
  };
}

/** Copy for an empty tab — the design has one only for "In Progress". */
export function emptyState(tab) {
  return tab === 'refunded'
    ? {
      icon: '💸',
      title: 'No refunds yet',
      body: 'Finish a claim and the refund shows up here.',
    }
    : {
      icon: '🛍️',
      title: 'Nothing in progress',
      body: 'Claim a product from Home to get started.',
    };
}
