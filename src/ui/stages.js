// What a task looks like in a LIST, and what a stuck task says to the person
// waiting on their money. Pure, so it can be tested under node (the same reason
// src/ui/timeline.js and src/ui/wallet.js are).
//
// Two jobs, both previously done badly or not at all:
//
//  1. Stage vocabulary for the My Products list, mapped from real backend state
//     onto the 7-segment tracker and the tone/label vocabulary in the design
//     (fayr-design.browser.jsx stageMeta / STAGE_TONE).
//
//  2. Plain English for a blocked task. The Task screen used to print raw enums
//     at the user — "Next: dkim", "· ORDER_UNREADABLE" — which is developer
//     output on the screen where someone checks whether they are getting paid.
//     Every blocker now says what happened, in their words, AND what to do next.

import { STATES } from '../taskflow.js'; // explicit extension: this module is also run under node

/** The design's tone palette (STAGE_TONE). Kept as names; the screen maps to colour. */
export const TONES = ['amber', 'blue', 'purple', 'green', 'red'];

/**
 * Which of the 7 tracker segments a task is on, with the design's label
 * vocabulary.
 *
 * DROPPED from the design deliberately: its separate "order proof pending" and
 * "delivery proof pending" steps. Those assume the user uploads both by hand,
 * while the scraper reads order AND delivery from one fetch — so a screen asking
 * for two uploads would be asking for work nobody has to do. The 7 segments are
 * preserved; two of them now describe waiting rather than uploading.
 */
export function taskStage(task) {
  const t = task || {};
  const state = t.state || STATES.CLAIMED;
  const hasOrder = !!t.order;
  const windowClosed =
    t.windowEndsAt != null && t.now != null && t.now >= t.windowEndsAt;

  if (state === STATES.REFUNDED) {
    return { step: 7, label: 'Refunded', tone: 'green', cta: null };
  }
  if (state === STATES.HOLDING) {
    return windowClosed
      ? { step: 6, label: 'Refund ready', tone: 'green', cta: 'Release refund' }
      : { step: 5, label: 'In return window', tone: 'green', cta: null };
  }
  if (state === STATES.REVIEWED) {
    return { step: 4, label: 'Under verification', tone: 'blue', cta: null };
  }
  if (state === STATES.DELIVERED) {
    return { step: 3, label: 'Review pending', tone: 'purple', cta: 'Write review' };
  }
  if (state === STATES.PURCHASED || hasOrder) {
    return { step: 2, label: 'Delivery pending', tone: 'blue', cta: null };
  }
  return { step: 1, label: 'Purchase pending', tone: 'amber', cta: 'Buy now' };
}

/**
 * A closed task, told honestly.
 *
 * `expireStaleClaims` writes closedAt + closeReason and leaves `state` at
 * CLAIMED, and no screen read either field — so a user whose claim the server had
 * already closed still saw "Order not found yet · Buy on Amazon, then check
 * again", with a live button. That is the screen stating something false about
 * their money, which is worse than showing nothing.
 */
export function closedInfo(task) {
  const t = task || {};
  if (!t.closedAt) return { closed: false, label: null, title: null, body: null };
  const reason = t.closeReason || null;
  if (t.state === STATES.REFUNDED || reason === 'refunded') {
    return {
      closed: true,
      label: 'Refunded',
      tone: 'green',
      title: 'Refund paid',
      body: 'This one is finished. The money is in your Fayr wallet.',
    };
  }
  if (reason === 'expired') {
    return {
      closed: true,
      label: 'Window closed',
      tone: 'red',
      title: 'This claim expired',
      // Say the ticket outcome out loud — it is the user's actual question.
      body:
        'The time to buy the product ran out, so the claim was closed and your '
        + 'tickets were returned. You can claim it again if it is still open.',
    };
  }
  if (reason === 'cancelled') {
    return {
      closed: true,
      label: 'Cancelled',
      tone: 'red',
      title: 'This claim was cancelled',
      body: 'Nothing more to do here. Ask us about it if that looks wrong.',
    };
  }
  return {
    closed: true,
    label: 'Closed',
    tone: 'red',
    title: 'This claim is closed',
    body: reason ? `Closed: ${reason}.` : 'Ask us about it if that looks wrong.',
  };
}

/**
 * Plain English for a blocker, plus the ONE thing to do next.
 *
 * `action` is a machine hint for the screen ('reconnect' | 'upload' | 'review' |
 * 'support' | null) — never shown as text. That is the whole point: the old
 * screen rendered these values raw.
 */
export function explainBlocker(blocker, platformName) {
  const where = platformName || 'the marketplace';
  switch (blocker) {
    case 'reconnect_account':
      return {
        title: `Sign in to ${where} again`,
        body: `${where} signed you out, so we could not read your order. Signing back in fixes it — we only read your own order and review pages.`,
        cta: `Reconnect ${where}`,
        action: 'reconnect',
      };
    case 'order_unreadable':
      return {
        title: 'We could not read this order',
        body: `Your ${where} order page did not load for us. It happens on some older orders. Send us a screenshot of the order instead and a Fayr reviewer will confirm it by hand.`,
        cta: 'Upload a screenshot',
        action: 'upload',
      };
    case 'no_delivery_date':
      return {
        title: 'No delivery date yet',
        body: `${where} has not published a delivery date for this order. If it has already arrived, send a screenshot showing the delivery and we will use that.`,
        cta: 'Upload a screenshot',
        action: 'upload',
      };
    case 'review_not_public':
      return {
        title: 'Your review is not public yet',
        body: `We could not find your review on the product page. Marketplaces can take a day or two to publish. If it is already visible to you, it may just need more time — nothing is lost.`,
        cta: null,
        action: null,
      };
    case 'order_out_of_window':
      // A RULE, not a glitch — and the one blocker with deliberately no way out.
      // The old copy for this case was "We could not read this order", which made
      // a decision we made on purpose look like our scraper breaking, and sent
      // the user off to upload a screenshot that could never help. The body is
      // normally replaced by the backend's own sentence (blockerReason), which
      // distinguishes "before you claimed" from "after the deadline"; this is the
      // safe fallback if it ever arrives without one.
      return {
        title: 'This purchase came before the offer',
        body:
          'You bought this before you claimed the offer, so it doesn’t qualify. '
          + 'Only orders placed after you claim can be refunded. To earn a refund, '
          + 'claim the offer first, then buy the product.',
        cta: null,
        action: null,
      };
    case 'returned':
      return {
        title: 'This order was returned',
        body: 'A refund only applies to a product you keep, so this claim cannot be paid. Ask us about it if the order was not actually returned.',
        cta: 'Ask Fayr',
        action: 'support',
      };
    default:
      if (!blocker) return null;
      // An unknown blocker must still read as a sentence, never as an enum.
      return {
        title: 'This claim needs a check',
        body: 'Something about this order needs a person to look at it. Ask us and we will sort it out.',
        cta: 'Ask Fayr',
        action: 'support',
      };
  }
}

/**
 * The one-line "what happens next" for a task that is NOT blocked. Replaces the
 * raw `Next: <source>` line, which printed 'dkim' / 'order-details' at the user.
 */
export function nextStepLine(task) {
  const t = task || {};
  const stage = taskStage(t);
  switch (stage.step) {
    case 1: return 'Buy the product, then come back and check.';
    case 2: return 'We are watching for the delivery — nothing for you to do.';
    case 3: return 'Write your review on the marketplace, then tap the button.';
    case 4: return 'We are checking your review is publicly visible.';
    case 5: return 'Waiting out the return window. We re-check your review during it.';
    case 6: return 'Ready — release the refund to your wallet.';
    default: return 'Paid. It is in your wallet.';
  }
}
