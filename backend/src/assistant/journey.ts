/**
 * WHAT WAS THIS PERSON DOING WHEN THEY WROTE IN?
 *
 * Somebody writes to Fayr when something is stuck. The single most useful thing
 * to know before answering is what they were in the middle of — and the app
 * already knows: every claim, purchase, delivery, review, hold and refund is an
 * append-only row in the task log, every ticket movement is a row in the ticket
 * ledger, every rupee is a row in the wallet, every payout request has a status.
 *
 * NO NEW TRACKING. Not one step here is something the app started recording for
 * this. It reads what is already written down and turns it into sentences.
 *
 * The value is the sentence a person can read in two seconds — "waiting out the
 * return window on the cooktop, and it ends on 30 August" — instead of a state
 * name and a timestamp. So no state name, no code and no underscore may reach the
 * output, ever.
 *
 * Pure: facts in, sentences out. The reading of the database is next door in
 * user-journey.service.ts, which is the same split as the offer check.
 *
 * WHAT IS DELIBERATELY NOT IN THE FACTS: the mobile number, the PAN, the bank or
 * UPI details. The snapshot is stored on a question and read by staff, and the
 * safest way to keep personal detail out of it is for this code never to be given
 * any.
 */

import { rupeesOf } from '../common/rupees';

/** How many steps a snapshot carries. Beyond this it stops being readable. */
export const RECENT_STEP_LIMIT = 25;

/**
 * India is +5:30 and has never had daylight saving, so a fixed offset is exactly
 * right here — and unlike asking the runtime for a locale it gives the same answer
 * on every machine. Every user and every staff member reading this is in India.
 */
export const IST_OFFSET_MINUTES = 330;

// prettier-ignore
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface JourneyTaskEvent {
  at: Date;
  type: string;
  fromState: string;
  toState: string;
  reason: string | null;
}

export interface JourneyTask {
  id: string;
  offer: string;
  platform: string;
  state: string;
  closedAt: Date | null;
  closeReason: string | null;
  blocker: string | null;
  blockerReason: string | null;
  claimExpiresAt: Date | null;
  windowEndsAt: Date | null;
  events: JourneyTaskEvent[];
}

/** Everything read out of the records the app already keeps. Plain data only. */
export interface JourneyFacts {
  takenAt: Date;
  account: { joinedAt: Date; setupDoneAt: Date | null };
  tickets: {
    balance: number;
    entries: { at: Date; delta: number; reason: string }[];
  };
  wallet: {
    balancePaise: bigint;
    entries: {
      at: Date;
      amountPaise: bigint;
      kind: string;
      memo: string | null;
    }[];
  };
  tasks: JourneyTask[];
  withdrawals: { at: Date; amountPaise: bigint; status: string }[];
  proofs: { at: Date; kind: string; offer: string | null }[];
  questionsWrittenBefore: number;
}

export type JourneySource =
  'task' | 'tickets' | 'wallet' | 'withdrawal' | 'proof' | 'account';

export interface JourneyStep {
  /** When it happened, as text — this is stored as JSON, so never a Date. */
  at: string;
  /** What happened, in plain words. */
  what: string;
  /** Which record it came from, so nobody has to wonder whether it is real. */
  from: JourneySource;
}

export interface JourneySnapshot {
  takenAt: string;
  /** What this person is in the middle of, right now. */
  nowDoing: string[];
  /** The last few things that happened, newest first. */
  recent: JourneyStep[];
  /** The numbers somebody answering would otherwise have to go and look up. */
  standing: {
    ticketBalance: number;
    walletBalance: string;
    offersInProgress: number;
    offersRefunded: number;
    payoutsWaiting: number;
    hasWrittenInBefore: boolean;
  };
  /** What this snapshot could NOT see. Said out loud, never left implied. */
  notIncluded: string[];
}

/** A code turned into words. The one place underscores and capitals are removed. */
function plainCode(code: string): string {
  return String(code ?? '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

const STATE_NAMES: Record<string, string> = {
  CLAIMED: 'joined',
  PURCHASED: 'bought',
  DELIVERED: 'arrived',
  REVIEWED: 'review found',
  HOLDING: 'waiting out the return window',
  REFUNDED: 'refunded',
};

/** What a task's stage is called in words. Never the stored name. */
export function plainStateName(state: string): string {
  return STATE_NAMES[state] ?? plainCode(state);
}

/** A date the way it is written in India. */
function plainDate(when: Date): string {
  const ist = new Date(when.getTime() + IST_OFFSET_MINUTES * 60_000);
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

/** An offer's name, or something readable when it has none. */
function offerName(offer: string | null | undefined): string {
  const trimmed = String(offer ?? '').trim();
  return trimmed === '' ? 'an offer' : trimmed;
}

function quoted(offer: string | null | undefined): string {
  return `“${offerName(offer)}”`;
}

/** Money the way a person reads it. Never paise, never a bare number. */
function money(paise: bigint): string {
  const abs = paise < 0n ? -paise : paise;
  return rupeesOf(abs);
}

// ── what they are in the middle of ────────────────────────────────────────

function describeOpenTask(task: JourneyTask): string {
  const name = quoted(task.offer);
  switch (task.state) {
    case 'CLAIMED':
      return task.claimExpiresAt
        ? `Joined ${name} and has not bought it yet — the time to buy runs out on ${plainDate(task.claimExpiresAt)}.`
        : `Joined ${name} and has not bought it yet.`;
    case 'PURCHASED':
      return `Bought ${name} and is waiting for it to arrive.`;
    case 'DELIVERED':
      return `${name} has arrived, and Fayr is waiting for the review to appear on the product page.`;
    case 'REVIEWED':
      return `The review for ${name} has been found, and the return-window wait is about to start.`;
    case 'HOLDING':
      return task.windowEndsAt
        ? `Waiting out the return window on ${name} — it ends on ${plainDate(task.windowEndsAt)}, and the money goes back after that.`
        : `Waiting out the return window on ${name}.`;
    default:
      return `Somewhere in the middle of ${name}.`;
  }
}

function describeBlocker(task: JourneyTask): string | null {
  if (task.blockerReason && task.blockerReason.trim() !== '') {
    return `Something is in the way on ${quoted(task.offer)}: ${task.blockerReason.trim()}`;
  }
  if (task.blocker && task.blocker.trim() !== '') {
    return `Something is in the way on ${quoted(task.offer)}: ${plainCode(task.blocker)}.`;
  }
  return null;
}

// ── the steps ─────────────────────────────────────────────────────────────

/** When a task's stage changed, the change is the story. */
function describeMovedTo(
  toState: string,
  fromState: string,
  offer: string,
): string {
  const name = quoted(offer);
  switch (toState) {
    case 'CLAIMED':
      return `Joined ${name}.`;
    case 'PURCHASED':
      return `Fayr matched the order for ${name}.`;
    case 'DELIVERED':
      return `Fayr saw that ${name} had arrived.`;
    case 'REVIEWED':
      return `Fayr found the review for ${name}.`;
    case 'HOLDING':
      return `The return-window wait started for ${name}.`;
    case 'REFUNDED':
      return `The refund for ${name} was released.`;
    default:
      return `${name} moved from ${quoted(plainStateName(fromState))} to ${quoted(plainStateName(toState))}.`;
  }
}

/** When nothing changed, what was attempted is the story. */
function describeAttempt(type: string, offer: string): string {
  const name = quoted(offer);
  switch (type) {
    case 'EVIDENCE':
      return `Fayr looked for proof on ${name} and nothing changed.`;
    case 'VISIBILITY_CHECK':
      return `Fayr checked that the review for ${name} was still there.`;
    case 'CONFIRM_ORDER':
      return `Confirmed the order for ${name}.`;
    default:
      return `Fayr looked at ${name} and nothing changed.`;
  }
}

function describeTaskEvent(event: JourneyTaskEvent, offer: string): string {
  const base =
    event.fromState === event.toState
      ? describeAttempt(event.type, offer)
      : describeMovedTo(event.toState, event.fromState, offer);
  const reason = event.reason?.trim();
  return reason ? `${base.replace(/\.$/, '')} — ${reason}` : base;
}

function describeTicket(delta: number, reason: string): string {
  const count = Math.abs(delta);
  switch (reason) {
    case 'SIGNUP_GRANT':
      return `Got ${count} tickets for joining Fayr.`;
    case 'CLAIM':
      return `Used ${count} tickets to join an offer.`;
    case 'EXPIRY_RETURN':
      return `Got ${count} tickets back because an offer ran out of time.`;
    case 'COMPLETION_RETURN':
      return `Got ${count} tickets back after finishing an offer.`;
    default:
      return delta >= 0
        ? `Fayr corrected the ticket count, ${count} more.`
        : `Fayr corrected the ticket count, ${count} fewer.`;
  }
}

function describeWallet(
  amountPaise: bigint,
  kind: string,
  memo: string | null,
): string {
  const amount = money(amountPaise);
  const note = memo?.trim() ? ` — ${memo.trim()}` : '';
  switch (kind) {
    case 'REFUND':
      return `${amount} was added to the wallet as a refund${note}`;
    case 'WITHDRAWAL':
      return amountPaise < 0n
        ? `${amount} was set aside to be paid out${note}`
        : `${amount} came back into the wallet from a payout that did not happen${note}`;
    default:
      return amountPaise < 0n
        ? `Fayr took ${amount} off the wallet balance${note}`
        : `Fayr added ${amount} to the wallet balance${note}`;
  }
}

function describeWithdrawal(amountPaise: bigint, status: string): string {
  const amount = money(amountPaise);
  switch (status) {
    case 'REQUESTED':
      return `Asked for ${amount} to be paid out.`;
    case 'APPROVED':
      return `The ${amount} payout was approved and is waiting to be sent.`;
    case 'PAID':
      return `${amount} was paid out.`;
    case 'REJECTED':
      return `The ${amount} payout was refused and the money went back to the wallet.`;
    case 'FAILED':
      return `The ${amount} payout did not go through, and the money went back to the wallet.`;
    default:
      return `A ${amount} payout is at a stage Fayr has no words for yet.`;
  }
}

const PROOF_NAMES: Record<string, string> = {
  PURCHASE: 'the order',
  DELIVERY: 'the delivery',
  REVIEW: 'the review',
};

function describeProof(kind: string, offer: string | null): string {
  const what = PROOF_NAMES[kind] ?? plainCode(kind);
  return offer && offer.trim() !== ''
    ? `Sent a picture of ${what} as proof for ${quoted(offer)}.`
    : `Sent a picture of ${what} as proof.`;
}

// ── putting it together ───────────────────────────────────────────────────

export function buildJourney(facts: JourneyFacts): JourneySnapshot {
  const steps: JourneyStep[] = [];
  const add = (at: Date, what: string, from: JourneySource): void => {
    steps.push({ at: at.toISOString(), what, from });
  };

  add(facts.account.joinedAt, 'Joined Fayr.', 'account');
  if (facts.account.setupDoneAt) {
    add(
      facts.account.setupDoneAt,
      'Finished setting up their account.',
      'account',
    );
  }
  for (const task of facts.tasks) {
    for (const event of task.events) {
      add(event.at, describeTaskEvent(event, task.offer), 'task');
    }
  }
  for (const t of facts.tickets.entries) {
    add(t.at, describeTicket(t.delta, t.reason), 'tickets');
  }
  for (const w of facts.wallet.entries) {
    add(w.at, describeWallet(w.amountPaise, w.kind, w.memo), 'wallet');
  }
  for (const w of facts.withdrawals) {
    add(w.at, describeWithdrawal(w.amountPaise, w.status), 'withdrawal');
  }
  for (const p of facts.proofs) {
    add(p.at, describeProof(p.kind, p.offer), 'proof');
  }

  // Newest first, and by the sentence when two land in the same millisecond, so
  // two identical reads never come back in a different order.
  steps.sort(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) || a.what.localeCompare(b.what),
  );
  const total = steps.length;
  const recent = steps.slice(0, RECENT_STEP_LIMIT);

  const open = facts.tasks.filter((t) => t.closedAt === null);
  const nowDoing: string[] = [];
  for (const task of open) {
    nowDoing.push(describeOpenTask(task));
    const blocked = describeBlocker(task);
    if (blocked) nowDoing.push(blocked);
  }
  const waitingPayouts = facts.withdrawals.filter(
    (w) => w.status === 'REQUESTED' || w.status === 'APPROVED',
  );
  for (const w of waitingPayouts) {
    nowDoing.push(
      `Waiting for ${money(w.amountPaise)} to be paid out, asked for on ${plainDate(w.at)}.`,
    );
  }
  if (nowDoing.length === 0) nowDoing.push('Nothing is in progress right now.');

  const notIncluded: string[] = [
    'Which screens they opened, what they tapped, and what they typed before this — the app does not record any of that, and this does not guess.',
  ];
  if (total > recent.length) {
    notIncluded.push(
      `Only the most recent ${recent.length} steps are here. There were ${total} in all, so ${total - recent.length} older steps are not shown.`,
    );
  }

  return {
    takenAt: facts.takenAt.toISOString(),
    nowDoing,
    recent,
    standing: {
      ticketBalance: facts.tickets.balance,
      walletBalance: rupeesOf(facts.wallet.balancePaise),
      offersInProgress: open.length,
      offersRefunded: facts.tasks.filter((t) => t.state === 'REFUNDED').length,
      payoutsWaiting: waitingPayouts.length,
      hasWrittenInBefore: facts.questionsWrittenBefore > 0,
    },
    notIncluded,
  };
}
