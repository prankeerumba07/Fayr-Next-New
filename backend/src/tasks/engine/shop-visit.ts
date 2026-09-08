// THE JOURNEY'S TWO CLOCKS, AND THE THREE NUMBERS THAT DRIVE THEM.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// Until today the journey had ONE clock and no record of the moment that matters
// most. A person claimed an offer, and thirty minutes later the claim expired if
// no purchase had been proved. Nothing anywhere recorded THAT THEY WENT TO THE
// SHOP AT ALL, so there was no instant to measure a purchase against except the
// claim itself, and no way to hold their place while they were away buying.
//
// The owner named the shape on 8 September 2026, and these are his numbers:
//
//   CLAIM   -> TAP BUY     30 minutes. Not tapped in time, the place goes back.
//   TAP BUY -> COME BACK    2 hours.   Then the place goes back and it is over.
//   THE ORDER ITSELF        must be placed inside those same 2 hours.
//
// ── THE THIRD ONE IS NOT A THIRD NUMBER, AND THAT IS THE POINT ──────────────
//
// "Inside those same 2 hours" is the SAME window as the second, used a second
// way: once as a deadline for the person, and once as a referee for the shop's
// own timestamp on the order. Writing it as its own setting would let the two
// drift, and a person could then be inside the deadline while their order was
// outside the window, or the reverse, with nothing to say which was right. So
// there are two numbers here and three jobs, and the second number does two of
// them. See theHold below: one function answers both questions.
//
// ── AND THE THIRTY MINUTES IS NOT REDEFINED HERE ────────────────────────────
//
// CLAIM_TTL_MINUTES already exists, already means exactly this, and stays the
// authority. It is named here so all three live in one place to read, and its
// value is passed IN rather than copied: a second copy of thirty is how two
// screens end up quoting different numbers, which the setting's own comment in
// config/env.validation.ts was written to prevent.
//
// ── THE SHOP'S TIMESTAMP IS THE REFEREE, NEVER OUR GUESS ────────────────────
//
// Whether an order qualifies is decided by the date THE SHOP PRINTED ON IT, not
// by when we read it, not by when the person told us, and not by when the app
// happened to sync. Our own clock decides only whether the person came back in
// time. Those are two different questions and this file keeps them apart.

import type { OrderWindowVerdict } from './order-window';

/**
 * THE FIRST NUMBER, and it lives in config/env.validation.ts as
 * CLAIM_TTL_MINUTES. This is a name for it, not a second copy.
 *
 * Every function here takes the minutes as an argument. Nothing in this file
 * reads a setting for itself, so the whole thing can be checked without a server
 * and cannot disagree with the operator's own value.
 */
export const CLAIM_TO_TAP_SETTING = 'CLAIM_TTL_MINUTES';

/**
 * THE SECOND NUMBER. Two hours, from the tap, to come back and tell us.
 *
 * Not an operator setting today and deliberately so: it is a promise printed on
 * a pop-up in front of somebody before they leave for the shop, and a promise
 * that can be changed under them between the reading and the buying is not a
 * promise. Making it configurable is a decision about what Fayr owes people, not
 * a tuning knob, so it takes a code change and a person's name on it.
 */
export const HOURS_TO_COME_BACK = 2;

/** The second number in milliseconds, worked out once rather than at each use. */
export const THE_HOLD_MS = HOURS_TO_COME_BACK * 60 * 60 * 1000;

/** Both clocks, named together, for anything that wants to show all three. */
export const THE_THREE_NUMBERS = {
  claimToTapSetting: CLAIM_TO_TAP_SETTING,
  hoursToComeBack: HOURS_TO_COME_BACK,
  /** The order's own window IS the hold. Same number, second job. See the head. */
  theOrderMustBeInsideTheHold: true,
} as const;

/** The hold a recorded tap starts. Nothing else can start one. */
export interface TheHold {
  /** The instant the tap was recorded. The shop's order may not precede it. */
  tappedAt: number;
  /** The instant the hold ends, inclusive of the millisecond itself. */
  endsAt: number;
}

/**
 * THE HOLD, FROM THE TAP. The one place the second number turns into two instants.
 *
 * `hours` is an argument so a check can walk a short hold without waiting two
 * real hours, and so nothing here has to read a setting. It defaults to the
 * promise above, which is what every caller in the app uses.
 */
export function theHold(tappedAt: number, hours: number = HOURS_TO_COME_BACK): TheHold {
  const span = Number.isFinite(hours) && hours > 0 ? hours : HOURS_TO_COME_BACK;
  return { tappedAt, endsAt: tappedAt + span * 60 * 60 * 1000 };
}

/** Whether the person may still tap Buy, and if not, why. */
export type MayTapVerdict = 'ok' | 'the-thirty-minutes-ran-out';

/**
 * MAY THEY TAP BUY? The first clock, and only the first clock.
 *
 * THE BOUNDARY IS INCLUSIVE AT THIRTY AND OUT AT THIRTY ONE, which is the edge
 * the owner asked to see checked by name. A deadline nobody can land exactly on
 * is a deadline that reads as broken to whoever lands on it.
 *
 * An absent deadline is NOT a refusal. Tasks that predate the deadline being
 * recorded have none, and refusing those would break somebody's live claim to
 * enforce a rule that did not exist when they made it.
 */
export function mayTapBuy(input: {
  claimExpiresAt: number | null | undefined;
  now: number;
}): MayTapVerdict {
  const deadline = input.claimExpiresAt;
  if (deadline == null) return 'ok';
  return input.now <= deadline ? 'ok' : 'the-thirty-minutes-ran-out';
}

/** Whether the person came back inside the hold, and if not, why. */
export type CameBackVerdict = 'ok' | 'never-went' | 'the-two-hours-ran-out';

/**
 * DID THEY COME BACK IN TIME? The second clock, and only the second clock.
 *
 * `never-went` is its own answer and not a refusal. Somebody who never tapped
 * Buy has no hold to be outside of, and telling them their two hours are up when
 * they never started them is a lie about their own history.
 *
 * INCLUSIVE AT TWO HOURS EXACTLY, out one millisecond later. One hour fifty nine
 * is in, two hours one minute is out, and both are checked by name.
 */
export function cameBackInTime(input: {
  hold: TheHold | null | undefined;
  now: number;
}): CameBackVerdict {
  const hold = input.hold;
  if (hold == null) return 'never-went';
  return input.now <= hold.endsAt ? 'ok' : 'the-two-hours-ran-out';
}

/**
 * WAS THE ORDER PLACED INSIDE THE HOLD? The shop's timestamp against the tap.
 *
 * ── WHY AN UNKNOWN DATE IS NOT A REFUSAL ────────────────────────────────────
 *
 * Plenty of readers legitimately cannot resolve an order date, and Blinkit and
 * Instamart routinely do not print one we can read. Refusing on absence would
 * throw away real evidence from real purchases, so absence answers `unknown` and
 * goes down the existing hold path where a person decides. That is the same
 * choice checkOrderWindow already made, for the same reason, and this deliberately
 * matches it rather than inventing a second convention.
 *
 * ── AND BEFORE THE TAP IS ITS OWN ANSWER ────────────────────────────────────
 *
 * An order placed five minutes before the tap is the owner's own edge case, and
 * it is refused. It is not a near miss: the campaign cannot have caused a purchase
 * that already existed, which is the whole reason order-window.ts exists. The two
 * rules agree on direction and this one is stricter, because it measures from the
 * tap rather than from the claim.
 */
export type OrderAgainstVisitVerdict =
  | 'ok'
  | 'unknown'
  | 'before-the-tap'
  | 'after-the-hold';

export function checkOrderAgainstTheVisit(
  orderPlacedAt: number | null | undefined,
  hold: TheHold | null | undefined,
): OrderAgainstVisitVerdict {
  if (hold == null) return 'unknown';
  if (orderPlacedAt == null) return 'unknown';
  if (!Number.isFinite(orderPlacedAt)) return 'unknown';
  if (orderPlacedAt < hold.tappedAt) return 'before-the-tap';
  if (orderPlacedAt > hold.endsAt) return 'after-the-hold';
  return 'ok';
}

/**
 * THE SAME REFUSAL, IN THE OLDER RULE'S OWN WORDS, so nothing downstream has to
 * learn a second vocabulary.
 *
 * order-window.ts already refuses out-of-window orders and already has wording
 * for both directions that has been through the plain language walk. This maps
 * onto it rather than duplicating it: `before-the-tap` is that rule's
 * `before-claim` and `after-the-hold` is its `after-deadline`. Null means this
 * rule has nothing to say and the caller should not refuse on its behalf.
 */
export function asOrderWindowVerdict(
  verdict: OrderAgainstVisitVerdict,
): OrderWindowVerdict | null {
  if (verdict === 'before-the-tap') return 'before-claim';
  if (verdict === 'after-the-hold') return 'after-deadline';
  return null;
}
