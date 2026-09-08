// WHAT THE WAITING BOX ON THE HOME PAGE SAYS, decided here and nowhere else.
//
// The owner asked for this on 1 September 2026, in these words: he must not have
// to tap My Products to find out where a claim stands. The design has had the card
// since the beginning — fayr-design.browser.jsx:3720, RotatingStatusCard, put on
// Home at :1702 — and it had never been built. This is the decision half of it;
// src/ui/WaitingBox.js draws it.
//
// THE RULE THIS FILE EXISTS FOR: no state falls through to a blank box. Every one
// of the engine's states, every one of its blockers, and every reason a claim can
// be closed has words here. The test walks the engine's own lists rather than a
// list somebody typed, so a state added to the machine with no words here is a
// failing test instead of an empty card in front of somebody waiting on money.
//
// IT READS THE RECORD AND NOTHING ELSE. Not a note on the phone, not a flag set
// when a button was tapped. That is what makes the box survive a force quit:
// there is nothing local to lose, because the task list comes from the backend.
// It also means the box never claims to know something the server does not.
//
// TWO THINGS ARE DELIBERATELY NOT HERE:
//
//   * WHERE TAPPING GOES. The box opens that claim's journey, and the journey
//     works out its own step from the same record. A second opinion about which
//     step somebody is on is exactly the defect this project keeps finding, so
//     this file does not have one.
//   * THE DISMISSAL ITSELF. This file only says what key a dismissal is filed
//     under. Whether one has happened is the screen's business.
//
// PURE. It imports one thing, with an extension, so a plain node test can read
// every decision in it without a phone.

import { countdown } from './confirmJoin.js';

/**
 * Every situation the box can be in, in the order a claim passes through them.
 *
 * A "situation" is not a state. It is WHAT IS BEING SAID, which is a finer thing:
 * one state can be several situations (a claim that is still running and a claim
 * whose slot has just lapsed are both CLAIMED in the record), and that distinction
 * is what makes a dismissal wear off correctly. See dismissKeyFor.
 */
export const SITUATIONS = [
  'to-buy',
  'slot-ran-out',
  'send-order-picture',
  'no-delivery-date',
  'sign-in-again',
  'confirm-order',
  'to-deliver',
  'to-review',
  'send-review-picture',
  'review-not-public',
  'in-window',
  'refund-ready',
  'paid',
  'returned',
  'out-of-window',
  'needs-a-look',
  'cancelled',
  'claim-closed',
];

/**
 * The words for one situation.
 *
 *   status   the product's status, in one short line. The design puts this in the
 *            tone colour, so it is the line a person reads first.
 *   cta      the button. null where there is genuinely nothing to do — a button
 *            offered for its own sake is a button that lies.
 *   tone     amber, blue, purple, green or red. The design's own palette.
 *   waiting  is there something for this person to do or know NOW? Only the
 *            finished-and-paid situation says no, and the box is not drawn for it.
 *   line     one extra sentence, where the status alone would leave a question.
 */
const WORDS = {
  'to-buy': {
    status: 'Slot reserved',
    cta: 'Go and buy it',
    tone: 'amber',
    waiting: true,
    line: 'Buy the product before the time runs out.',
  },
  'slot-ran-out': {
    // The owner objected to a box that sits at zero still saying "go and buy it".
    // This is the same answer the claimed sheet gives, in the same words.
    status: 'Your slot ran out',
    cta: 'See the offer',
    tone: 'red',
    waiting: true,
    line: 'Your tickets are on their way back. You can take the offer again.',
  },
  'send-order-picture': {
    status: 'We could not read your order',
    cta: 'Send a picture',
    tone: 'amber',
    waiting: true,
    line: 'Send a picture of the order and a person at Fayr will check it.',
  },
  'no-delivery-date': {
    status: 'No delivery date yet',
    cta: 'Send a picture',
    tone: 'blue',
    waiting: true,
    line: 'If it has arrived, send a picture showing the delivery.',
  },
  'sign-in-again': {
    status: 'Sign in to the shop again',
    cta: 'Sign in',
    tone: 'amber',
    waiting: true,
    line: 'The shop signed you out, so we cannot read your order.',
  },
  'confirm-order': {
    status: 'Check your order details',
    cta: 'Check them',
    tone: 'amber',
    waiting: true,
    line: 'Tell us this is your order and we will carry on.',
  },
  'to-deliver': {
    status: 'Waiting for delivery',
    cta: 'See where it is',
    tone: 'blue',
    waiting: true,
    line: 'Nothing for you to do. We are watching for it to arrive.',
  },
  'to-review': {
    status: 'Time to write your review',
    cta: 'Write it',
    tone: 'purple',
    waiting: true,
    line: 'Say what you really think. A low rating is paid the same.',
  },
  'send-review-picture': {
    status: 'Show us your review',
    cta: 'Send a picture',
    tone: 'purple',
    waiting: true,
    line: 'Send a picture of your review once it is live on the shop.',
  },
  'review-not-public': {
    status: 'Your review is not public yet',
    cta: 'See what to do',
    tone: 'purple',
    waiting: true,
    line: 'Shops can take a day or two to publish. Nothing is lost.',
  },
  'in-window': {
    status: 'Waiting for the return window',
    cta: 'See when it closes',
    tone: 'green',
    waiting: true,
    line: 'Your refund is on its way once the shop’s return window closes.',
  },
  'refund-ready': {
    status: 'Your refund is ready',
    cta: 'Get your refund',
    tone: 'green',
    waiting: true,
    line: 'The return window has closed. Move it to your wallet.',
  },
  paid: {
    // WORDS, BUT NOT DRAWN. The design's own Home leaves finished claims out of
    // this card, and it is right to: the money is in the wallet and the wallet
    // screen says so, so a box about it is noise on every launch forever. The
    // words exist because "no state is blank" has to hold for every state.
    status: 'Refund paid',
    cta: 'See your wallet',
    tone: 'green',
    waiting: false,
    line: 'This one is finished. The money is in your Fayr wallet.',
  },
  returned: {
    status: 'This order was returned',
    cta: 'Ask Fayr',
    tone: 'red',
    waiting: true,
    line: 'A refund only applies to a product you keep.',
  },
  'out-of-window': {
    status: 'This purchase came before the offer',
    cta: 'Ask Fayr',
    tone: 'red',
    waiting: true,
    line: 'Only orders placed after you claim can be refunded.',
  },
  'needs-a-look': {
    // The catch-all for a blocker this app has never heard of. It must still read
    // as a sentence: the Task screen used to print raw values like
    // "order_unreadable" at people, on the screen where they check their money.
    status: 'This claim needs a check',
    cta: 'Ask Fayr',
    tone: 'amber',
    waiting: true,
    line: 'Something needs a person to look at it. Ask us and we will sort it out.',
  },
  cancelled: {
    status: 'This claim was cancelled',
    cta: 'Ask Fayr',
    tone: 'red',
    waiting: true,
    line: 'Nothing more to do here. Ask us if that looks wrong.',
  },
  'claim-closed': {
    status: 'This claim is closed',
    cta: 'Ask Fayr',
    tone: 'red',
    waiting: true,
    line: 'Ask us about it if that looks wrong.',
  },
};

/** The words for a situation, or null for one we do not know. Never a guess. */
export function wordsFor(situation) {
  if (typeof situation !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(WORDS, situation)
    ? WORDS[situation]
    : null;
}

/** Which blocker maps to which situation. Anything unlisted needs a look. */
const BY_BLOCKER = {
  reconnect_account: 'sign-in-again',
  order_unreadable: 'send-order-picture',
  no_delivery_date: 'no-delivery-date',
  review_not_public: 'review-not-public',
  order_out_of_window: 'out-of-window',
  returned: 'returned',
};

/** Epoch milliseconds from an ISO string, or null for anything unusable. */
function at(value) {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * WHAT IS BEING SAID about this claim, as one word.
 *
 * The order of the tests below is the order of authority, and it matters:
 *
 *  1. A LAPSED SLOT beats everything, including the record's own state. The sweep
 *     that closes a lapsed claim runs hourly, so a claim can be well past its
 *     deadline and still sitting at CLAIMED. Waiting for the sweep would mean
 *     spending up to an hour telling somebody to go and buy something they can no
 *     longer be paid for.
 *  2. CLOSED beats the state too, for the same reason in reverse: the closing
 *     writes closedAt and leaves state alone.
 *  3. A BLOCKER beats the state, because a blocked task's state is where it got
 *     to, not what it needs.
 *  4. Then the state itself.
 *
 * Returns null only when there is no task at all.
 */
export function situationFor(task, now) {
  if (!task || typeof task !== 'object') return null;
  const when = typeof now === 'number' ? now : Date.now();

  // 1 and 2. A claim that is over, however it got there.
  const clock = countdown(task, new Date(when));
  const closed = at(task.closedAt) != null;
  const reason = task.closeReason || null;
  const paid = task.state === 'REFUNDED' || reason === 'refunded';

  if (closed || (clock && clock.over)) {
    if (paid) return 'paid';
    if (reason === 'expired' || (clock && clock.over)) return 'slot-ran-out';
    if (reason === 'cancelled') return 'cancelled';
    if (closed) return 'claim-closed';
  }
  if (paid) return 'paid';

  // 3. Blocked: what it needs, not where it got to.
  if (task.blocker) {
    return BY_BLOCKER[task.blocker] || 'needs-a-look';
  }

  // 4. The state. Written in the order the journey runs, so it reads as a path.
  const state = task.state || 'CLAIMED';
  if (state === 'HOLDING') {
    const ends = at(task.windowEndsAt);
    return ends != null && when >= ends ? 'refund-ready' : 'in-window';
  }
  if (state === 'REVIEWED') return 'send-review-picture';
  if (state === 'DELIVERED') return 'to-review';
  if (state === 'PURCHASED' || task.order) {
    // The same gate the journey uses, read on both shapes for the same reason:
    // the server's record carries the flag inside the order, the engine's task
    // carries it at the top, and this is handed whichever the caller has.
    const confirmed =
      task.orderConfirmed === true
      || (task.order && task.order.orderConfirmed === true);
    return confirmed ? 'to-deliver' : 'confirm-order';
  }
  return 'to-buy';
}

/**
 * The campaign's own status, said in a way that is true for somebody who has
 * ALREADY claimed it. Null when there is nothing worth saying.
 *
 * The owner asked for the product's status and the campaign's status. The two are
 * different things and only one of the campaign's problems matters here:
 *
 *   * A DEAD SHOP PAGE matters. They are about to go and buy something, and if the
 *     shop's page has gone the box should say so before they try.
 *   * A FULL OFFER DOES NOT. "All the places are taken" is about joining. Somebody
 *     holding a claim has their place, and telling them the offer is full would
 *     read as their claim being gone, which would be frightening and false.
 */
export function campaignLineFor(campaign) {
  const a = campaign && campaign.availability;
  if (!a || a.greyedOut !== true) return null;
  if (a.reason !== 'page') return null;
  return typeof a.label === 'string' && a.label.length > 0 ? a.label : null;
}

/**
 * One claim as the box would draw it, or null when nothing is waiting.
 *
 * `campaign` is optional: the task's own campaign summary comes down with it from
 * the backend, so a box can be drawn from the task alone. The campaign is only
 * needed for its availability and a better picture.
 */
export function waitingBox(task, campaign, now) {
  const situation = situationFor(task, now);
  const words = wordsFor(situation);
  if (!words) return null;
  if (words.waiting !== true) return null;

  // IT HAS TO BE ABOUT SOMETHING. A row with no claim id and no campaign behind it
  // is not a claim, and drawing it would put a card reading "Slot reserved" over no
  // product at all — which is worse than drawing nothing. A missing state is
  // treated as CLAIMED throughout this app, so without this guard any stray object
  // in the list becomes a box.
  const named =
    (task && task.id) || (task && task.campaign && task.campaign.id)
    || (campaign && campaign.id);
  if (!named) return null;

  const when = typeof now === 'number' ? now : Date.now();
  const summary = (task && task.campaign) || {};
  const c = campaign || {};

  // THE CLOCK IS ONLY EVER ON THE BUYING STEP. The thirty minutes are the time to
  // buy; nothing after that has a deadline of its own that a person can act on, so
  // a countdown anywhere else would be inventing one.
  const clock = situation === 'to-buy' ? countdown(task, new Date(when)) : null;

  // ── ONE MESSAGE, AND WHERE IT WINS ────────────────────────────────────────
  //
  // THE OWNER'S RULE, in his words: "There should not be any different messages
  // for the same campaign on different pages." So when the server has sent a
  // message for this task, THAT is what the bar says, and the wording in this
  // file is not consulted at all. The bar takes the SHORT form, the My Products
  // list takes the SHORT form, and the opened screen takes the LONG form, all
  // from the one record built in backend engine/journey-message.ts.
  //
  // WHAT THIS DOES NOT YET COVER, said plainly rather than implied. The server
  // sends a message only for the went-to-the-shop journey: four states, listed
  // in that file. Every OTHER situation still uses wordsFor() above, which holds
  // its own sentences in this file. That is fifteen sentences that have not moved
  // to the server yet, and moving them is a job of its own rather than something
  // to do halfway. Until then this file is the single source for those and the
  // server is the single source for its four, and no situation has two sources.
  const sent = task && task.message && typeof task.message === 'object'
    ? task.message
    : null;
  const fromServer = sent && typeof sent.short === 'string' && sent.short !== ''
    ? sent.short
    : null;

  return {
    taskId: (task && task.id) || null,
    campaignId: summary.id || c.id || null,
    productName: summary.productName || c.productName || null,
    imageUrl: summary.imageUrl || c.imageUrl || null,
    situation,
    status: fromServer || words.status,
    // THE SECOND LINE IS DROPPED when the server spoke, and that is deliberate:
    // it belongs to this file's own wording, and pairing it with a sentence from
    // somewhere else is how two half-messages read as one confused one.
    line: fromServer ? null : words.line,
    cta: words.cta,
    tone: words.tone,
    campaignLine: campaignLineFor(c),
    timer: clock && !clock.over ? clock.clock : null,
    ticking: !!(clock && !clock.over && clock.ticking),
    over: situation === 'slot-ran-out',
  };
}

/**
 * Every claim with something waiting, most urgent first.
 *
 * "Most urgent" is not a judgement: a claim with a running clock is the only kind
 * that can be lost by doing nothing, so it goes first. Everything else keeps the
 * order the backend sent, which is newest first.
 */
export function waitingBoxes(input) {
  const o = input || {};
  const tasks = Array.isArray(o.tasks) ? o.tasks : [];
  const campaigns = Array.isArray(o.campaigns) ? o.campaigns : [];
  const now = typeof o.now === 'number' ? o.now : Date.now();

  const byId = new Map();
  for (const c of campaigns) if (c && c.id) byId.set(c.id, c);

  const boxes = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const cid = (task.campaign && task.campaign.id) || null;
    const box = waitingBox(task, cid ? byId.get(cid) : null, now);
    if (box) boxes.push(box);
  }

  // Stable: only the ticking ones move, and they keep their order among
  // themselves. Array.prototype.sort is stable in every engine the app runs on.
  return boxes.slice().sort((a, b) => (b.ticking ? 1 : 0) - (a.ticking ? 1 : 0));
}

/**
 * WHERE A DISMISSAL IS FILED, and the answer to the owner's own question about it.
 *
 * He asked how a dismissed box wears off when the state moves on. It wears off
 * because the key is not the claim — it is the claim AND WHAT WAS BEING SAID. Close
 * "go and buy it" and `task-1::to-buy` is silenced. Nothing else is. When the same
 * claim reaches "show us your review" the key is `task-1::send-review-picture`,
 * which has never been dismissed, so the box comes back.
 *
 * Keyed on the claim alone, one dismissal would have switched off every future
 * reminder for that claim, including the one saying their money is ready. Keyed on
 * the claim and its STATE it would still have failed in one important case: a
 * lapsed slot, where the record still says CLAIMED because the sweep has not run
 * yet, so "go and buy it" and "your slot ran out" would have shared a key. The
 * situation is finer than the state, on purpose, and that case is a test.
 */
export function dismissKeyFor(box) {
  if (!box || typeof box !== 'object') return '';
  return `${box.taskId || box.campaignId || 'unknown'}::${box.situation}`;
}
