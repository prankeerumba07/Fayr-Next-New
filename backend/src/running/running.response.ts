import type { Drop, MoneyReading, Reading } from './running.rules';

/**
 * THE SHAPE OF THE PAGE THAT MEASURES FAYR ITSELF.
 *
 * Every line of writing the screen shows comes down this shape, out of
 * running.words.ts. The panel renders it and writes nothing of its own, so a
 * sentence cannot reach a director without the plain-language check having read
 * it first.
 */

export interface Titled {
  title: string;
  lead: string;
}

// ── Section A ────────────────────────────────────────────────────────────────

export interface JourneyStepResponse {
  step: string;
  meaning: string;
  /** Only on a step nothing records. */
  whatItWouldTake: string | null;
  everythingSoFar: Reading;
  lastThirtyDays: Reading;
  /**
   * False for a step that is not on the way, so no drop is measured into it and
   * the step below it measures from the last step that IS on the way.
   */
  onThePath: boolean;
  /** Null on the first step, which has nothing above it. */
  dropSoFar: Drop | null;
  dropLastThirtyDays: Drop | null;
  /** One short line when two columns of the same fact disagree. */
  disagreement: string | null;
}

export interface JourneyResponse {
  title: string;
  lead: string;
  everythingSoFarLabel: string;
  everythingSoFarMeaning: string;
  lastThirtyDaysLabel: string;
  lastThirtyDaysMeaning: string;
  /** Said only when the two columns really are the same today. */
  bothMatchToday: string | null;
  whereTheyAreNow: string;
  canGoBackwards: string;
  stepHeading: string;
  dropHeading: string;
  steps: JourneyStepResponse[];
  expired: {
    step: string;
    meaning: string;
    everythingSoFar: Reading;
    lastThirtyDays: Reading;
  };
  /**
   * Whether this page's own thirty-day numbers match the existing report.
   *
   * Both come from funnelOf now, so they cannot drift. This carries the proof
   * rather than the promise: if it ever comes back false, the page says so.
   */
  agreesWithActivityReport: boolean;
  /** Said only when the numbers really do not match. */
  disagreesWithTheReports: string | null;
}

// ── Section B ────────────────────────────────────────────────────────────────

export interface SourceGroupResponse {
  heading: string;
  meaning: string;
  /** The stored names this group matches. Data, not writing. */
  names: string[];
  count: Reading;
}

export interface HowOrdersResponse extends Titled {
  groups: SourceGroupResponse[];
  doNotKnow: SourceGroupResponse;
  established: Reading;
  addsUp: boolean;
  /** Said when the parts DO come to the whole, so the reader can see it checked. */
  addsUpConfirmed: string;
  /** Only when they do not add up. */
  addsUpProblem: string | null;
  establishedLabel: string;
  countHeading: string;
  namesHeading: string;
  unmappedHeading: string;
  unmappedNames: string[];
  candidatesNote: string;
}

// ── Section C ────────────────────────────────────────────────────────────────

export interface MoneyLine {
  label: string;
  meaning: string;
  amount: MoneyReading;
}

export interface HeldReasonResponse {
  /** Plain words from hold-reasons.ts. The stored name is carried beside it. */
  explanation: string;
  reason: string;
  count: Reading;
  nobodyCanClearIt: boolean;
  /** Said only against a reason nobody can clear that has something in it. */
  nobodyCanClearThisOne: string | null;
}

export interface MoneyResponse {
  title: string;
  lead: string;
  lines: MoneyLine[];
  hasLeftFayr: {
    label: string;
    amount: MoneyReading;
    words: string;
  };
  waiting: {
    title: string;
    lead: string;
    countLabel: string;
    count: Reading;
    wouldPayLabel: string;
    wouldPayMeaning: string;
    /** Named so a figure can be traced. A function name is not English. */
    workedOutBy: string;
    wouldPay: MoneyReading;
    cannotWorkOutLabel: string;
    cannotWorkOutMeaning: string;
    cannotWorkOut: Reading;
  };
  held: {
    title: string;
    leadOne: string;
    leadTwo: string;
    theRule: string;
    allSix: string;
    reasonHeading: string;
    countHeading: string;
    reasons: HeldReasonResponse[];
    total: Reading;
    alsoWaiting: string;
    /** Only when at least one held reason nobody can clear has something in it. */
    nobodyCanClearWarning: string | null;
  };
}

// ── Section D ────────────────────────────────────────────────────────────────

export interface MachineRow {
  label: string;
  meaning: string;
  reading: Reading;
}

export interface MachineResponse extends Titled {
  rows: MachineRow[];
}

// ── Section E ────────────────────────────────────────────────────────────────

export interface CheckRunResponse {
  label: string;
  meaning: string;
  /** "Last looked on 26 August, which was 8 days ago." Null when never run. */
  lastLooked: string | null;
  /** Only when it has never run. */
  neverRun: string | null;
  /** Which of the two set it off, in words. Null when never run. */
  howItStarted: string | null;
  counts: { label: string; reading: Reading }[];
}

export interface OffersResponse extends Titled {
  runs: CheckRunResponse[];
}

// ── The whole page ───────────────────────────────────────────────────────────

export interface HowItIsRunningResponse {
  title: string;
  lead: string;
  leadTwo: string;
  leadThree: string;
  readAt: string;
  /** The same moment as a machine-readable stamp, for a check to pin. */
  readAtIso: string;
  /**
   * The two phrases the screen prints where a number would go.
   *
   * Sent rather than written into the panel, because the panel writes nothing of
   * its own: a phrase living in the screen would reach a director without the
   * plain-language check ever having read it.
   */
  says: { nothingYet: string; notWatching: string };
  journey: JourneyResponse;
  howOrders: HowOrdersResponse;
  money: MoneyResponse;
  machine: MachineResponse;
  offers: OffersResponse;
  notRealYet: { title: string; lead: string; items: string[] };
}
