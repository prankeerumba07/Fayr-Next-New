// ONE MESSAGE FOR ONE PERSON ABOUT ONE CAMPAIGN AT ONE MOMENT.
//
// ── THE OWNER'S OWN RULE, AND IT IS THE WHOLE REASON THIS FILE EXISTS ───────
//
// "There should not be any different messages for the same campaign on
// different pages." Said on 8 September 2026, after seeing the same claim
// described three different ways on three screens.
//
// So there is ONE record, written ONCE, here. It carries a SHORT form and a LONG
// form of the SAME thing, and three places read it:
//
//   the small bar above the bottom navigation -> the SHORT form, cut off
//   the My Products list                      -> the SHORT form
//   the My Products screen, opened            -> the LONG form
//
// NOTHING ON A SCREEN WRITES ITS OWN WORDING FOR A CAMPAIGN'S STATE. If a screen
// needs different words, this file changes and the screen does not.
//
// ── THE SHORT FORM IS THE LONG FORM'S OWN OPENING ───────────────────────────
//
// Not a second sentence somebody wrote separately, which is exactly how three
// screens drifted apart in the first place. `long` is built by JOINING sentences
// and `short` is the FIRST of them, so the two cannot say different things: one
// is literally a prefix of the other, and journey-message.spec.ts asserts that
// for every message rather than trusting it.
//
// ── AND THE TIME IN THEM IS REAL ────────────────────────────────────────────
//
// The held-until sentence carries the clock time worked out from this task's own
// hold, in India's time, by the same function the pop-up uses. A message with a
// placeholder in it is not a message.
//
// WHAT IS DELIBERATELY NOT HERE: the live countdown. A number that changes every
// second cannot come from a record built on the server, so the app draws that
// from shopHoldEndsAt and its unit words live in src/ui/journeyWords.js, which
// this project's plain language rule reads off disk exactly the way it reads
// src/connect/gateWords.js.

import { cameBackInTime, theHold } from './shop-visit';
import { clockInIndia, dayInIndia } from './shop-visit-words';

/** Which message this is. A name, never shown to anybody. */
export type JourneyMessageKey =
  | 'wentToShop'
  | 'twoHoursRanOut'
  | 'couldNotFindOrder'
  | 'foundYourOrder';

export interface JourneyMessage {
  /** The machine name, for the app to branch its controls on. Never displayed. */
  key: JourneyMessageKey;
  /** The opening sentence. What the bar and the list show. */
  short: string;
  /** Every sentence, opening included. What the opened screen shows. */
  long: string;
}

/**
 * THE HELD-UNTIL SENTENCE, and it is the only one with a number in it.
 *
 * Shared with the pop-up's own wording by using the same two clock functions, so
 * the promise on the pop-up and the promise in the message cannot disagree about
 * what time it is.
 */
function heldUntil(endsAt: number, from: number): string {
  const day = dayInIndia(endsAt, from);
  const when = clockInIndia(endsAt);
  return day == null
    ? `Your place is held until ${when}.`
    : `Your place is held until ${when} ${day}.`;
}

/**
 * EVERY MESSAGE, AS A LIST OF SENTENCES. One entry per state, and no others.
 *
 * A list rather than a joined string because `short` has to be the first
 * sentence and `long` has to be all of them. Joining once, below, is what makes
 * the prefix rule true by construction instead of by somebody remembering it.
 */
function sentencesFor(input: {
  key: JourneyMessageKey;
  shopName: string;
  holdEndsAt: number | null;
  now: number;
}): string[] {
  const { key, shopName, holdEndsAt, now } = input;

  if (key === 'wentToShop') {
    const held = holdEndsAt == null ? [] : [heldUntil(holdEndsAt, now)];
    return [
      `You went to ${shopName}. Tell us when you have bought it.`,
      ...held,
      'We cannot pay you after that, even if you bought the product.',
    ];
  }

  if (key === 'twoHoursRanOut') {
    // WITHOUT BLAME, and the owner asked for that in those words. Somebody who
    // ran out of time has lost money they were expecting, and a sentence that
    // reads as an accusation on top of that is a second injury.
    return [
      'Your two hours have run out.',
      'This offer has gone to somebody else.',
      'You did nothing wrong, and you can claim another offer whenever you like.',
    ];
  }

  if (key === 'couldNotFindOrder') {
    return [
      'We could not find your order.',
      `Open ${shopName} and check that your order is there, then tell us again.`,
      'You can also send us a photograph of the order.',
    ];
  }

  return [
    'We found your order. Is it yours?',
    'Open this to check the order number, the amount and the date.',
  ];
}

/** Build one record. `short` is the first sentence, `long` is all of them. */
export function buildMessage(input: {
  key: JourneyMessageKey;
  shopName: string;
  holdEndsAt: number | null;
  now: number;
}): JourneyMessage {
  const sentences = sentencesFor(input);
  return {
    key: input.key,
    short: sentences[0],
    // JOINED WITH A SPACE, so the long form BEGINS with the short form exactly.
    // That is the prefix rule, made true by construction.
    long: sentences.join(' '),
  };
}

/**
 * WHICH MESSAGE THIS TASK HAS RIGHT NOW, or null when it has none.
 *
 * ── NULL IS A REAL ANSWER AND NOT A GAP ─────────────────────────────────────
 *
 * A task nobody has taken to the shop yet has no message. It is not "waiting" or
 * "pending", it is simply somebody who claimed an offer and has not gone
 * shopping, and the screen for that already has its own button. Inventing a
 * message for it would put a sentence on the bar with nothing behind it.
 *
 * ── THE ORDER IS THE PRIORITY ORDER, AND IT MATTERS ─────────────────────────
 *
 * A found order beats a running clock: somebody whose order we have already
 * matched should be asked about it, not told to hurry. And the clock running out
 * beats "tell us when you have bought it", because that instruction is no longer
 * true once nothing can be paid.
 */
export function messageFor(input: {
  wentToShopAt: number | null;
  shopHoldEndsAt: number | null;
  shopName: string;
  /** True once an order has been matched and is waiting to be confirmed. */
  orderWaitingToBeConfirmed?: boolean;
  /** True once a look for the order has finished and found nothing. */
  lookedAndFoundNothing?: boolean;
  now: number;
}): JourneyMessage | null {
  if (input.wentToShopAt == null) return null;

  const common = {
    shopName: input.shopName,
    holdEndsAt: input.shopHoldEndsAt,
    now: input.now,
  };

  if (input.orderWaitingToBeConfirmed === true) {
    return buildMessage({ ...common, key: 'foundYourOrder' });
  }

  const hold =
    input.shopHoldEndsAt == null
      ? null
      : { tappedAt: input.wentToShopAt, endsAt: input.shopHoldEndsAt };
  if (cameBackInTime({ hold, now: input.now }) === 'the-two-hours-ran-out') {
    return buildMessage({ ...common, key: 'twoHoursRanOut' });
  }

  if (input.lookedAndFoundNothing === true) {
    return buildMessage({ ...common, key: 'couldNotFindOrder' });
  }

  return buildMessage({ ...common, key: 'wentToShop' });
}

/** Every key, so a walk can prove it covered all of them and no more. */
export const EVERY_MESSAGE_KEY: readonly JourneyMessageKey[] = [
  'wentToShop',
  'twoHoursRanOut',
  'couldNotFindOrder',
  'foundYourOrder',
];

/**
 * Every sentence any message can say, for the plain language walk.
 *
 * Built by calling the real builder for every key rather than typed out again,
 * so a sentence changed above is walked without anybody remembering to add it.
 * The shop name and the instant are examples; the rule cares about shape.
 */
export function everyMessageSentence(shopName = 'Amazon'): readonly string[] {
  const now = Date.UTC(2026, 8, 8, 6, 0);
  const out: string[] = [];
  for (const key of EVERY_MESSAGE_KEY) {
    const built = buildMessage({
      key,
      shopName,
      holdEndsAt: theHold(now).endsAt,
      now,
    });
    out.push(built.short, built.long);
  }
  return out;
}
