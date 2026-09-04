/**
 * THE RULES BEHIND THE PAGE THAT MEASURES FAYR ITSELF. NO DATABASE UNDER THEM.
 *
 * Pure functions over facts already gathered, for the same reason
 * campaign-health.rules.ts is: a rule with a database under it can only be
 * checked against whatever happens to be in that database today.
 *
 * ── THE THREE ANSWERS, AND WHY THEY MUST NEVER BE SWAPPED ────────────────────
 *
 * A number on this page is one of exactly three things, and the whole point of
 * the page falls over if two of them are ever printed the same way:
 *
 *   counted        A real figure out of the record. A NOUGHT HERE IS A REAL
 *                  NOUGHT: we looked, and there were none.
 *   nothing yet    The recording works and there is nothing in it. Nobody has
 *                  ever run the thing that fills it.
 *   not watching   NOTHING RECORDS THIS AT ALL. A nought here would be a lie,
 *                  because it would read as "none happened" when it means "we
 *                  never look".
 *
 * The last one is the reason this file exists rather than the page simply
 * returning numbers. A page showing a nought that really means "we do not look"
 * is the exact kind of wrongness a room full of directors finds.
 */

import type { TaskState } from '@prisma/client';
import { IST_OFFSET_MINUTES } from '../assistant/journey';
import { resolveChargedPaise } from '../tasks/engine/charged-amount';
import type { EvidenceOrder } from '../tasks/engine/evidence.types';
import { explainHoldForStaff } from '../tasks/engine/hold-reasons';
import { DO_NOT_KNOW, ORDER_SOURCE_GROUPS } from './running.words';

// ── The three answers ────────────────────────────────────────────────────────

export type Reading =
  | { kind: 'counted'; count: number }
  | { kind: 'nothing-yet' }
  | { kind: 'not-watching'; whatItWouldTake: string };

export const counted = (count: number): Reading => ({ kind: 'counted', count });
export const nothingYet = (): Reading => ({ kind: 'nothing-yet' });
export const notWatching = (whatItWouldTake: string): Reading => ({
  kind: 'not-watching',
  whatItWouldTake,
});

export type MoneyReading =
  /** Integer paise as a decimal string, because money is never a Number here. */
  | { kind: 'counted'; paise: string }
  | { kind: 'nothing-yet' }
  /** There is a real figure behind this and we genuinely cannot work it out. */
  | { kind: 'cannot-be-known'; why: string };

export const countedMoney = (paise: bigint): MoneyReading => ({
  kind: 'counted',
  paise: paise.toString(),
});
/**
 * Its own constructor rather than sharing nothingYet().
 *
 * A count of nothing and an amount of nothing are two different shapes, and one
 * function serving both is how a count reaches a place expecting money. The
 * compiler caught exactly that while this was being written.
 */
export const noMoneyYet = (): MoneyReading => ({ kind: 'nothing-yet' });

// ── The drop between two steps ───────────────────────────────────────────────

export type Drop =
  | { kind: 'dropped'; count: number }
  /** A step above is not recorded, so there is nothing to take away from. */
  | { kind: 'cannot-tell'; why: string }
  /**
   * The lower step counts MORE than the step above it.
   *
   * Never printed as a negative drop, and never quietly clamped to nought. Two
   * columns of the same journey disagreeing is a fault worth a director seeing,
   * and hiding it behind a nought is how a page starts lying.
   */
  | { kind: 'does-not-line-up'; by: number; why: string }
  /**
   * This step is not on the way, so a drop into it means nothing.
   *
   * Only one step is like this today and it is named in running.words.ts. It is
   * NOT a way of hiding an awkward number: the step still shows its own count,
   * and the step BELOW it measures itself from the last step that IS on the way.
   */
  | { kind: 'not-a-step'; why: string };

export const CANNOT_TELL_DROP =
  'The step above this one is not recorded, so there is nothing to take away from.';

/**
 * The sentence for a step that counts MORE than the step above it.
 *
 * It carries its own words for the same reason the other two shapes do: the
 * screen prints what it is given rather than writing a sentence of its own, so
 * every word a director reads has been through the plain-language check.
 */
export function doesNotLineUpWords(by: number): string {
  const places = by === 1 ? 'place' : 'places';
  return `This counts ${by} more ${places} than the step above it.`;
}

export function notAStep(why: string): Drop {
  return { kind: 'not-a-step', why };
}

export function dropBetween(above: Reading, here: Reading): Drop {
  if (above.kind !== 'counted' || here.kind !== 'counted') {
    return { kind: 'cannot-tell', why: CANNOT_TELL_DROP };
  }
  if (here.count > above.count) {
    const by = here.count - above.count;
    return { kind: 'does-not-line-up', by, why: doesNotLineUpWords(by) };
  }
  return { kind: 'dropped', count: above.count - here.count };
}

// ── The journey facts the state machine does not carry ───────────────────────

/**
 * The columns that record a step ACTUALLY HAPPENING, as opposed to which step a
 * place is sitting on now.
 *
 * Both are true and they are not the same thing, which is why report.service.ts
 * keeps counting states and this counts columns. Where the two disagree the page
 * says so rather than choosing the flattering one.
 */
export interface JourneyRow {
  state: TaskState;
  closeReason: string | null;
  /**
   * Whether this place's person is recorded as signed in at THIS place's shop.
   *
   * A place, not a person: this row sits between "took a place" and "order
   * established", and both of those count places, so counting people here would
   * put a number beside two it cannot be compared with.
   *
   * The shop is the one frozen on the place at the moment it was taken, never the
   * offer's shop as it is today, for the same reason every other figure on this
   * page reads the frozen column.
   */
  signedInAtThisShop: boolean;
  orderId: string | null;
  deliveredAt: Date | null;
  reviewPublished: boolean | null;
  windowEndsAt: Date | null;
  orderConfirmed: boolean;
  markReviewedEvents: number;
}

export interface JourneyFacts {
  tookAPlace: number;
  /** Places whose person is recorded as signed in at that place's own shop. */
  signedInAtTheShop: number;
  gaveUsTheirOrder: number;
  orderEstablished: number;
  productArrived: number;
  reviewFoundLive: number;
  /** How many of those carry a MARK_REVIEWED event. The cross-check, not the number. */
  reviewStepReached: number;
  returnTimeFinished: number;
}

export function factsOf(rows: readonly JourneyRow[], now: Date): JourneyFacts {
  return {
    tookAPlace: rows.length,
    signedInAtTheShop: rows.filter((r) => r.signedInAtThisShop).length,
    gaveUsTheirOrder: rows.filter((r) => r.orderConfirmed).length,
    orderEstablished: rows.filter((r) => r.orderId != null).length,
    productArrived: rows.filter((r) => r.deliveredAt != null).length,
    reviewFoundLive: rows.filter((r) => r.reviewPublished === true).length,
    reviewStepReached: rows.filter((r) => r.markReviewedEvents > 0).length,
    returnTimeFinished: rows.filter(
      (r) => r.windowEndsAt != null && r.windowEndsAt.getTime() < now.getTime(),
    ).length,
  };
}

/**
 * One short line when two columns of the same fact disagree, and nothing at all
 * when they agree.
 *
 * The owner's rule, and it is the right one: pick a number, name where it came
 * from, and say by how much the other one differs. Never average them and never
 * take the bigger.
 */
export function disagreementWords(
  chosen: number,
  other: number,
  otherIsCalled: string,
): string | null {
  if (chosen === other) return null;
  const by = chosen > other ? chosen - other : other - chosen;
  const direction = chosen > other ? 'fewer' : 'more';
  const places = by === 1 ? 'place' : 'places';
  return (
    `${otherIsCalled} counts ${by} ${direction} ${places} than this. `
    + 'The two do not agree, and this row shows the first of them.'
  );
}

/**
 * DOES THIS PAGE'S JOURNEY MATCH THE REPORT'S?
 *
 * Both sides count with funnelOf, but they do NOT gather the rows the same way:
 * the report asks the database for the places taken in the window, and this page
 * takes every place and filters them here. Two different paths to one number, so
 * they really can disagree, and a mutation that made this page work the window
 * out its own way was caught by exactly this.
 *
 * A pure function so both answers can be proved. It used to be seven comparisons
 * written inline in the response, and hard-wiring the whole thing to `true`
 * passed every check: nothing anywhere exercised the FALSE answer.
 */
export function sameFunnel(
  mine: Record<string, number>,
  theirs: Record<string, number>,
): boolean {
  const keys = [
    'claimed',
    'purchased',
    'delivered',
    'reviewed',
    'holding',
    'refunded',
    'expired',
  ];
  return keys.every((key) => mine[key] === theirs[key]);
}

// ── How each order was established ───────────────────────────────────────────

export interface SourceTally {
  key: string;
  count: number;
}

export interface OrderSourceCount {
  groups: SourceTally[];
  doNotKnow: number;
  /**
   * Names that appear in the record and are in no group, listed BY NAME.
   *
   * This is the whole safety net. A source added next month with nobody
   * remembering this file lands here and is visible, instead of being counted as
   * automatic because "automatic" happened to be first in the list.
   */
  unmappedNames: string[];
  /** Places with an established order, counted by SECTION A, not by this tally. */
  established: number;
  /**
   * Whether the parts really come to the whole.
   *
   * ── WHY THIS TAKES SECTION A's NUMBER RATHER THAN ITS OWN ──────────────────
   *
   * It used to compare this tally's total against its own input length, which is
   * always equal: every source either lands in a group or falls into "we do not
   * know". So the flag could not be false, and a mutation that hard-wired it to
   * true passed every check. It was decoration.
   *
   * Section A counts places with an order number on them. This counts how each
   * of those orders was established. They are built by different code down
   * different paths, so they CAN disagree, and a disagreement means one of the
   * two is reading the wrong rows. That is worth a director seeing.
   */
  addsUp: boolean;
}

const GROUPED_NAMES = new Map<string, string>();
for (const group of ORDER_SOURCE_GROUPS) {
  for (const name of group.names) GROUPED_NAMES.set(name, group.key);
}

/** Which group a stored source name belongs to, or null when nobody grouped it. */
export function groupOfSource(source: string | null | undefined): string | null {
  if (source == null) return null;
  const name = source.trim();
  if (name === '') return null;
  return GROUPED_NAMES.get(name) ?? null;
}

/**
 * Count established orders by how they were established.
 *
 * `sources` must be one entry per place WITH AN ORDER, and nothing else. A place
 * with no order is not an established order, and counting it here would break the
 * adding-up rule below in the one direction nobody would notice.
 *
 * `establishedInTheJourney` is Section A's own count of the same thing, reached
 * separately. The two are compared rather than assumed equal.
 */
export function countOrderSources(
  sources: readonly (string | null)[],
  establishedInTheJourney: number,
): OrderSourceCount {
  const counts = new Map<string, number>(
    ORDER_SOURCE_GROUPS.map((g) => [g.key, 0]),
  );
  const unmapped = new Set<string>();
  let doNotKnow = 0;

  for (const source of sources) {
    const key = groupOfSource(source);
    if (key == null) {
      doNotKnow += 1;
      const name = (source ?? '').trim();
      if (name !== '') unmapped.add(name);
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groups = ORDER_SOURCE_GROUPS.map((g) => ({
    key: g.key,
    count: counts.get(g.key) ?? 0,
  }));
  const total =
    groups.reduce((n, g) => n + g.count, 0) + doNotKnow;

  return {
    groups,
    doNotKnow,
    unmappedNames: [...unmapped].sort(),
    established: establishedInTheJourney,
    addsUp: total === establishedInTheJourney,
  };
}

export const DO_NOT_ADD_UP =
  'These do not add up to the number of orders established above, and that is a fault.';

export function addsUpWords(count: OrderSourceCount): string | null {
  return count.addsUp ? null : DO_NOT_ADD_UP;
}

/** The group headings, in the order they are shown, including the last one. */
export const ALL_SOURCE_GROUP_KEYS: readonly string[] = [
  ...ORDER_SOURCE_GROUPS.map((g) => g.key),
  DO_NOT_KNOW.key,
];

/**
 * THE STATES IN WHICH A REFUND IS STILL IN QUESTION.
 *
 * The same four the staff list uses. REFUNDED is deliberately not here: that
 * money has already been paid, so it is not a held refund, and letting it in
 * would count settled places as things a person still has to decide.
 *
 * CLAIMED is not here either. Nobody has bought anything yet, so there is no
 * amount to be unsure about.
 *
 * Pinned by a check, because no fixture can catch this going wrong: a refunded
 * place always has a readable amount (it could not have been paid otherwise), so
 * adding REFUNDED to this list changes no number anywhere.
 */
export const OPEN_STATES: readonly string[] = [
  'PURCHASED',
  'DELIVERED',
  'REVIEWED',
  'HOLDING',
];

// ── Money held, and why ──────────────────────────────────────────────────────

/**
 * THE SIX REASONS A REFUND IS HELD, in one place and in a fixed order.
 *
 * Taken from resolveChargedPaise, which is the only thing that decides a hold.
 * All six are always shown, including the ones with nothing against them: the
 * list IS the point, because it is the list of things Fayr refuses to guess
 * about. A nought beside a reason is a real nought, because every open place was
 * walked to produce it.
 */
export const HELD_REASONS: readonly string[] = [
  'amount-unknown',
  'quantity-unknown',
  'quantity-not-divisible',
  'quantity-implausible',
  'item-price-above-total-and-ambiguous',
  'amount-gap-implausible',
];

export interface HeldRow {
  reason: string;
  /** The words the person clearing it reads. From hold-reasons.ts, never new. */
  explanation: string;
  count: number;
  /** True when nobody has a control that can clear this one today. */
  nobodyCanClearIt: boolean;
}

/**
 * The two reasons no staff control can clear.
 *
 * awaiting-amount.response.ts leaves both out of the staff list on purpose, and
 * that is right for a list of things to do: neither the count control nor the
 * amount control can fix them. It is wrong for this page, which is why they are
 * marked here rather than dropped.
 */
export const NOBODY_CAN_CLEAR: readonly string[] = [
  'item-price-above-total-and-ambiguous',
  'amount-gap-implausible',
];

export interface HeldTally {
  rows: HeldRow[];
  total: number;
}

/** Tally held refunds by reason. `reasons` is one entry per HELD place. */
export function tallyHeld(reasons: readonly string[]): HeldTally {
  const counts = new Map<string, number>(HELD_REASONS.map((r) => [r, 0]));
  for (const reason of reasons) {
    // An unrecognised reason still has to appear. explainHoldForStaff already
    // falls back to words that say the reason was not recognised, which is
    // itself worth looking at, so it is never silently dropped.
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const known = HELD_REASONS.map((reason) => ({
    reason,
    explanation: explainHoldForStaff(reason),
    count: counts.get(reason) ?? 0,
    nobodyCanClearIt: NOBODY_CAN_CLEAR.includes(reason),
  }));
  const extra = [...counts.keys()]
    .filter((r) => !HELD_REASONS.includes(r))
    .sort()
    .map((reason) => ({
      reason,
      explanation: explainHoldForStaff(reason),
      count: counts.get(reason) ?? 0,
      nobodyCanClearIt: false,
    }));
  const rows = [...known, ...extra];
  return { rows, total: rows.reduce((n, r) => n + r.count, 0) };
}

/** Is this place's refund held, and if so why? The one decision, one place. */
export function holdOf(order: EvidenceOrder | null | undefined): string | null {
  if (order == null) return null;
  const charged = resolveChargedPaise(order);
  return charged.needsStaff ? (charged.reason ?? 'amount-unknown') : null;
}

// ── When the page was read ───────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "9:14 in the morning on 3 September".
 *
 * India, always, for the same reason the chat greeting is: a page read in Mumbai
 * that stamps itself with the hour somewhere else is a page nobody can line up
 * against what they were doing at the time.
 */
export function readAtWords(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const hour24 = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const partOfDay =
    hour24 < 12 ? 'in the morning' : hour24 < 17 ? 'in the afternoon' : 'in the evening';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const clock = `${hour12}:${String(minute).padStart(2, '0')}`;
  const day = ist.getUTCDate();
  const month = MONTHS[ist.getUTCMonth()];
  return `Read at ${clock} ${partOfDay} on ${day} ${month}.`;
}

/** "26 August" in India, for a date that was recorded some time ago. */
export function dayWords(when: Date): string {
  const ist = new Date(when.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`;
}

const DAY_MS = 86_400_000;

/**
 * Whole days between two moments, counted by the calendar day in India rather
 * than by dividing. Two moments nineteen hours apart can be two days ago to the
 * person reading, and "which was 0 days ago" is not something to print.
 */
export function daysAgo(when: Date, now: Date): number {
  const dayOf = (d: Date): number =>
    Math.floor((d.getTime() + IST_OFFSET_MINUTES * 60_000) / DAY_MS);
  return Math.max(0, dayOf(now) - dayOf(when));
}
