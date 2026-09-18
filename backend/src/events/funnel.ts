/**
 * TURNING COUNTS INTO A FUNNEL.
 *
 * Pure. No database, no clock, no network — hand it numbers and it hands back
 * the shape a dashboard draws. Every rule about how a percentage is worked out
 * lives here so that the panel, the tests and anybody reading a figure out loud
 * in a meeting are all using the same arithmetic.
 *
 * ── THE DECISION THIS FILE EXISTS FOR ─────────────────────────────────────
 *
 * A percentage with nothing underneath it is worse than no percentage.
 *
 * On a Monday morning with four signups, "50% of people finish setup" is two
 * people, and somebody will repeat it in a meeting as though it were a finding.
 * So a rate over a small base is still returned, with the base beside it, and
 * `thin` set — and the panel greys it out. A rate over a base of ZERO is not
 * returned at all: it is null, and it prints as a dash, because there is no
 * honest number for "what share of nobody".
 *
 * Nothing here rounds until the last moment, and nothing here invents a zero.
 */

/** Under this many people, a percentage is not worth saying out loud. */
export const THIN_BASE = 20;

/** One step of a funnel, as it arrives from the database. */
export interface StepCount {
  key: string;
  label: string;
  count: number;
}

/** One step of a funnel, as a dashboard draws it. */
export interface FunnelStep extends StepCount {
  /** Share of the people who reached the step before this one. Null at the top. */
  ofPrevious: number | null;
  /** Share of the people who reached the FIRST step. Null at the top. */
  ofStart: number | null;
  /** How many people did not get from the previous step to this one. */
  dropped: number;
  /** True when the base is too small for the percentage to mean anything. */
  thin: boolean;
}

/**
 * A share of a whole, 0 to 100, to one decimal place.
 *
 * Null when the base is zero — see the note at the top of the file. Null also
 * when either number is not a finite number, because a NaN that reaches a screen
 * is read by a person as a bug in the product rather than in the arithmetic.
 */
export function rate(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole)) return null;
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * The steps, in the order given, with the drop between each one worked out.
 *
 * COUNTS ARE NOT FORCED TO DESCEND. It is tempting to assume each step is
 * smaller than the one above it and treat anything else as a bug. It is not a
 * bug: a funnel counted over a fixed window will show more people finishing
 * setup than starting it, because some of them started it yesterday. Clamping
 * that away would hide a real and ordinary thing, so a step that is bigger than
 * its predecessor is reported as it is, with `dropped` at zero rather than
 * negative.
 */
export function buildFunnel(steps: readonly StepCount[]): FunnelStep[] {
  const start = steps.length > 0 ? steps[0].count : 0;
  return steps.map((step, i) => {
    const previous = i === 0 ? null : steps[i - 1].count;
    return {
      ...step,
      ofPrevious: previous === null ? null : rate(step.count, previous),
      ofStart: i === 0 ? null : rate(step.count, start),
      dropped: previous === null ? 0 : Math.max(0, previous - step.count),
      thin: (previous ?? start) < THIN_BASE,
    };
  });
}

/**
 * The single worst drop in a funnel, or null when nothing dropped.
 *
 * What the dashboard puts at the top, because "where are we losing people" is
 * the only question anybody actually opens a funnel to answer. Ties go to the
 * EARLIER step: fixing a leak high up is worth more, since everything below it
 * is drawn from what survives.
 */
export function worstDrop(steps: readonly FunnelStep[]): FunnelStep | null {
  let worst: FunnelStep | null = null;
  for (const step of steps) {
    if (step.dropped <= 0) continue;
    if (worst === null || step.dropped > worst.dropped) worst = step;
  }
  return worst;
}
