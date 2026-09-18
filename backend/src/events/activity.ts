import { plainStateName } from '../assistant/journey';
import { platformDisplayName } from '../common/platform-name';
import { rupeesOf } from '../common/rupees';

/**
 * ONE PERSON'S TRAIL, TURNED INTO SENTENCES.
 *
 * Pure. No database, no clock of its own, no Nest. Every decision about what a
 * row MEANS lives here so it can be argued with in a test, exactly the way
 * funnel.ts sits beside insights.service.ts.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS DELIBERATELY NOT ─────────────────────
 *
 * It answers "what did this person do, and when", for a support agent who does
 * not know the schema and should not have to. So every line is a sentence:
 * "Claimed Keep the Oil Flowing", never "task_events row, fromState=CLAIMED".
 *
 * IT IS BEHAVIOUR, NOT IDENTITY, and that split is the whole privacy design.
 * Who somebody IS — their number, their payout instrument, their PAN — is the
 * unified user view's job and has its own audit tag. Nothing in this file may
 * reach for any of it.
 *
 * AND IT IS NOT A TRANSCRIPT. A shopper's own words never appear here, not in a
 * chat message and not in a question. Two reasons, and either alone would be
 * enough. A person who types their mobile number into the chat box would put it
 * straight into this response, and no rule about column names would catch it.
 * And reading somebody's actual words is a narrower act than reading their
 * trail, which is why CHAT_VIEW and ASSISTANT_QUESTION_VIEW exist as separate
 * audited routes — routing around them from here would quietly widen who can
 * read a conversation without anybody deciding to.
 *
 * ── MONEY ─────────────────────────────────────────────────────────────────
 *
 * The only money here is inside a sentence a person reads, so it goes through
 * rupeesOf, the one converter this project has. No bigint and no paise field
 * reaches this response, so there is no second money format to keep in step.
 */

/** The kinds of thing that can appear, one per source the trail is drawn from. */
export const ACTIVITY_KINDS = [
  'screen', // they looked at something
  'signup', // getting in: onboarding, codes, the account, setup
  'task', // an offer: claimed, bought, reviewed, refunded
  'chat', // they wrote in, or Fayr wrote back
  'question', // they asked the assistant something
  'withdrawal', // money on its way out
  'shop', // a marketplace they connected
  'evidence', // they sent a screenshot
  'session', // signed out, renewed, or a session that lapsed
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One thing that happened, as the panel receives it. */
export interface ActivityEntry {
  /** When, as an ISO instant. */
  at: string;
  kind: ActivityKind;
  /** A sentence. Readable by somebody who has never seen the database. */
  what: string;
  /** The one extra fact worth carrying, or null. Never free text from a person. */
  detail: string | null;
  /**
   * WHICH OFFER THIS BELONGS TO, or null when it belongs to none.
   *
   * ── WHY THE TRAIL CARRIES IT ──────────────────────────────────────────
   *
   * Without it a person's history is one chronological list, and everything
   * about one offer — claimed on Monday, bought on Tuesday, a screenshot on
   * Friday, still holding a fortnight later — is scattered through it with
   * screens and chats in between. A support agent asked "what happened with my
   * kettle" then has to reassemble the offer by reading around it. With the id
   * on every entry the screen can put one offer's own entries together and
   * leave the rest in time order, which is the whole point of the page above it.
   *
   * ONLY TWO KINDS CARRY ONE. A task event is a state change on an offer and a
   * screenshot is evidence FOR an offer, so both belong to exactly one. A screen
   * view, a chat, a question, a withdrawal, a shop sign-in and a session belong
   * to the person and not to any offer, and they carry null rather than a guess.
   *
   * NULL IS A REAL ANSWER and never means "we did not look". An entry with no
   * offer has to land somewhere on the screen rather than being dropped, because
   * a gap in a trail is invisible.
   */
  campaignId: string | null;
  /** That offer's title, carried beside the id so a screen needs no second read. */
  campaignTitle: string | null;
}

/**
 * The same thing before it is sorted.
 *
 * `at` is a real Date so the sort is on the instant and not on a string, and
 * `id` is the source row's own id, used for NOTHING except breaking a tie.
 */
export interface ActivityRow {
  at: Date;
  kind: ActivityKind;
  what: string;
  detail: string | null;
  /** The offer this belongs to, or null. See ActivityEntry.campaignId. */
  campaignId: string | null;
  campaignTitle: string | null;
  id: string;
}

/** What one read hands back. */
export interface Timeline {
  entries: ActivityEntry[];
  /** How many there were before the cap. */
  total: number;
  /** How many are in `entries`. */
  shown: number;
  /** How many the cap left out, so the panel can say "showing 500 of 1,342". */
  trimmed: number;
}

/**
 * NEWEST FIRST, AND THE SAME ORDER EVERY TIME.
 *
 * Eight queries run at once and finish in whatever order the database feels
 * like. Two rows written in the same second — a claim and the screen view that
 * led to it — would otherwise swap places between two reads of the same data,
 * and a support agent watching a trail reorder itself under them stops trusting
 * all of it.
 *
 * So the comparison is TOTAL: the instant, then the kind, then the row's own id.
 * No two rows can tie on all three, because the third is unique. The kind sits
 * in the middle rather than last so that a burst written in one second reads in
 * a stable, explainable grouping rather than in uuid order.
 *
 * Trimming happens AFTER sorting, so the cap keeps the newest rather than
 * whichever query answered first.
 */
export function sortAndTrim(rows: ActivityRow[], limit: number): Timeline {
  const ordered = [...rows].sort((a, b) => {
    const byTime = b.at.getTime() - a.at.getTime();
    if (byTime !== 0) return byTime;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const kept = ordered.slice(0, limit);
  return {
    entries: kept.map((r) => ({
      at: r.at.toISOString(),
      kind: r.kind,
      what: r.what,
      detail: r.detail,
      campaignId: r.campaignId,
      campaignTitle: r.campaignTitle,
    })),
    total: ordered.length,
    shown: kept.length,
    trimmed: ordered.length - kept.length,
  };
}

// ── the sentences, one builder per source ───────────────────────────────────

/** How many steps the setup sequence has. */
export const SETUP_STEPS = 3;

/**
 * user_events — WHAT DID THEY SEE AND WHERE DID THEY GET TO?
 *
 * The only source that knows anything before there is an account, and the only
 * one that knows which screens were drawn. Everything else here is a
 * consequence; this is the behaviour itself.
 */
export function fromUserEvent(row: {
  id: string;
  type: string;
  at: Date;
  payload: unknown;
}): ActivityRow {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const step = typeof p.step === 'number' ? p.step : null;
  const screen = typeof p.screen === 'string' ? p.screen : null;
  const platform = typeof p.platform === 'string' ? p.platform : null;
  const size = typeof p.size === 'number' ? p.size : null;

  const said: Record<string, { kind: ActivityKind; what: string }> = {
    APP_OPENED: { kind: 'screen', what: 'Opened the app' },
    ONBOARDING_DONE: { kind: 'signup', what: 'Finished the opening screens' },
    PHONE_ENTRY_SEEN: {
      kind: 'signup',
      what: 'Reached the screen that asks for a number',
    },
    OTP_REQUESTED: { kind: 'signup', what: 'Asked for a code' },
    OTP_VERIFIED: { kind: 'signup', what: 'Entered a correct code' },
    ACCOUNT_CREATED: { kind: 'signup', what: 'Their account was created' },
    SETUP_STEP_DONE: {
      kind: 'signup',
      what: step === null ? 'Finished a setup step' : `Finished setup step ${step}`,
    },
    SETUP_DONE: { kind: 'signup', what: 'Finished setting up' },
    FEED_OPENED: { kind: 'screen', what: 'Looked at the offers' },
    FIRST_CLAIM: { kind: 'task', what: 'Claimed an offer for the first time' },
    LOGGED_OUT: { kind: 'session', what: 'Signed out' },
    SESSION_RENEWED: {
      kind: 'session',
      what: 'The app renewed their session on its own',
    },
    SCREEN_VIEWED: {
      kind: 'screen',
      what: screen === null ? 'Opened a screen' : `Opened ${screen}`,
    },
  };

  // An unknown type is a step somebody added without telling this file. Saying so
  // in words beats dropping the row: a gap in a trail is invisible, and a line
  // reading "Something we have no words for yet" sends somebody to this comment.
  const known = said[row.type] ?? {
    kind: 'screen' as ActivityKind,
    what: 'Something Fayr has no words for yet',
  };

  const detail =
    row.type === 'FEED_OPENED'
      ? [
          platformDisplayName(platform),
          size === null ? null : `${size} offers`,
        ]
          .filter((bit) => bit !== null)
          .join(', ') || null
      : null;

  // A screen view belongs to the person, never to an offer — even FEED_OPENED,
  // which is a list of them and not one of them.
  return {
    at: row.at,
    kind: known.kind,
    what: known.what,
    detail,
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

/**
 * task_events — WHAT HAPPENED TO THE OFFERS THEY JOINED?
 *
 * Every state change carries its reason, which is the part a support agent
 * actually needs: "why is this one still holding" is answered here and nowhere
 * else. The offer's title is safe to print; it is a product, not a person.
 */
export function fromTaskEvent(row: {
  id: string;
  type: string;
  fromState: string;
  toState: string;
  reason: string | null;
  createdAt: Date;
  offer: string | null;
  /** The offer's id, carried beside the title the sentence already uses. */
  campaignId: string | null;
}): ActivityRow {
  const name = quoted(row.offer);
  const said: Record<string, string> = {
    CLAIM: `Claimed ${name}`,
    CONFIRM_ORDER: `Confirmed the order for ${name}`,
    EVIDENCE: `Sent evidence for ${name}`,
    EXPIRE: `The claim on ${name} ran out`,
    MARK_REVIEWED: `A review was found for ${name}`,
    START_HOLD: `${name} started waiting out the return window`,
    RELEASE_REFUND: `The refund for ${name} was released`,
    VISIBILITY_CHECK: `The review for ${name} was checked again`,
    FIRST_CLAIM: `Claimed ${name}`,
  };
  const what =
    said[row.type] ??
    `${name} moved from ${plainStateName(row.fromState)} to ${plainStateName(row.toState)}`;
  return {
    at: row.createdAt,
    kind: 'task',
    what,
    detail: row.reason,
    // The title here is the offer's own, unquoted — `what` above is the sentence
    // and this is the thing it is about. A screen groups on the id and labels
    // with the title, so neither has to be read back out of the sentence.
    campaignId: row.campaignId,
    campaignTitle: row.offer,
    id: row.id,
  };
}

/**
 * chats + chat_messages — WHEN DID THEY WRITE IN, AND WHO ANSWERED?
 *
 * The conversation's shape, never its contents. Which side wrote, in which
 * language, and when — enough to see "they wrote in three times on Tuesday and
 * the assistant answered every one" without opening anybody's words.
 */
export function fromChatMessage(row: {
  id: string;
  author: string;
  language: string;
  sentAt: Date;
}): ActivityRow {
  const said: Record<string, string> = {
    PERSON: 'Wrote in',
    ASSISTANT: 'The assistant answered',
    AGENT: 'Somebody at Fayr answered by hand',
    SYSTEM: 'Fayr said something about the conversation',
  };
  return {
    at: row.sentAt,
    kind: 'chat',
    what: said[row.author] ?? 'A message in the conversation',
    detail: languageName(row.language),
    // A conversation is with Fayr, not about one offer, whatever it mentions.
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

/** A conversation being handed to a person is the moment worth seeing. */
export function fromChatHandover(row: {
  id: string;
  handedOverAt: Date;
}): ActivityRow {
  return {
    at: row.handedOverAt,
    kind: 'chat',
    what: 'Their conversation was handed to a person',
    detail: null,
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

/**
 * assistant_questions — WHAT DID THEY ASK, AND DID WE ANSWER IT?
 *
 * The question's TOPIC and its outcome, never the words. A run of questions that
 * nothing matched is the single most useful thing in this whole trail, because
 * it is the shape of somebody being failed quietly.
 */
export function fromQuestion(row: {
  id: string;
  askedAt: Date;
  answerOrigin: string;
  topic: string | null;
  helpful: boolean | null;
}): ActivityRow {
  const outcome: Record<string, string> = {
    ANSWER_BOOK: 'answered from the answer book',
    MODEL: 'answered by the assistant',
    STAFF: 'answered by a person',
    NONE: 'nothing matched it',
  };
  const bits = [
    row.topic === null ? null : `about ${row.topic}`,
    outcome[row.answerOrigin] ?? null,
    row.helpful === null ? null : row.helpful ? 'they said it helped' : 'they said it did not help',
  ].filter((bit) => bit !== null);
  return {
    at: row.askedAt,
    kind: 'question',
    what: 'Asked the assistant a question',
    detail: bits.length > 0 ? bits.join(', ') : null,
    // A question has a topic, never an offer: `topic` is a subject and nothing
    // on the row says which offer, if any, prompted it. Guessing from the words
    // would be inventing a link.
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

/**
 * withdrawals — MONEY ON ITS WAY OUT, AND WHAT HAPPENED TO IT.
 *
 * Two moments per request, because the gap between them is the complaint: asked
 * for on Monday, still not decided on Friday. The amount is written the way a
 * person reads it; the payout instrument it went to is NOT here, and belongs to
 * the identity view.
 */
export function fromWithdrawalRequest(row: {
  id: string;
  amountPaise: bigint;
  requestedAt: Date;
}): ActivityRow {
  return {
    at: row.requestedAt,
    kind: 'withdrawal',
    what: `Asked to withdraw ${rupeesOf(row.amountPaise)}`,
    detail: null,
    // Money leaves the WALLET, which several offers may have paid into. There is
    // no one offer behind a withdrawal and the screen must not imply one.
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

export function fromWithdrawalDecision(row: {
  id: string;
  amountPaise: bigint;
  status: string;
  failureReason: string | null;
  decidedAt: Date;
}): ActivityRow {
  const money = rupeesOf(row.amountPaise);
  const said: Record<string, string> = {
    APPROVED: `Their withdrawal of ${money} was approved`,
    PAID: `Their withdrawal of ${money} was paid`,
    REJECTED: `Their withdrawal of ${money} was refused`,
    FAILED: `Their withdrawal of ${money} failed to send`,
    REQUESTED: `Their withdrawal of ${money} is still waiting`,
  };
  return {
    at: row.decidedAt,
    kind: 'withdrawal',
    what: said[row.status] ?? `Their withdrawal of ${money} changed`,
    detail: row.failureReason,
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

/**
 * shop_sign_ins — WHICH MARKETPLACES ARE THEY CONNECTED TO?
 *
 * Written down exactly once per shop, so this is genuinely "the day they
 * connected Amazon" and not a login count. Answers the first question asked
 * about a read that found nothing: were they ever signed in there at all.
 */
export function fromShopSignIn(row: {
  id: string;
  platform: string;
  firstAt: Date;
  howWeKnew: string;
}): ActivityRow {
  const shop = platformDisplayName(row.platform) ?? 'a shop';
  return {
    at: row.firstAt,
    kind: 'shop',
    what: `Connected ${shop}`,
    detail: row.howWeKnew,
    // Connecting a marketplace is done once and serves every offer on it.
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

/**
 * screenshot_uploads — THAT they sent evidence, and never the image.
 *
 * The row, the kind and the moment. No storage key, no hash, no size, and above
 * all no picture: a screenshot is private and has its own RBAC-checked streaming
 * endpoint with its own SCREENSHOT_VIEW audit row. This line exists so an agent
 * can see that something was sent and go and ask for it properly.
 */
export function fromScreenshot(row: {
  id: string;
  kind: string;
  uploadedAt: Date;
  /**
   * The offer the picture was sent FOR. A screenshot hangs off a task and a task
   * hangs off exactly one campaign, so this is a fact on the record rather than
   * an inference — which is why evidence groups with its offer and a chat does
   * not.
   */
  campaignId: string | null;
  campaignTitle: string | null;
}): ActivityRow {
  const said: Record<string, string> = {
    PURCHASE: 'Sent a picture of the order',
    DELIVERY: 'Sent a picture showing it arrived',
    REVIEW: 'Sent a picture of the review',
  };
  return {
    at: row.uploadedAt,
    kind: 'evidence',
    what: said[row.kind] ?? 'Sent a picture as evidence',
    detail: null,
    campaignId: row.campaignId,
    campaignTitle: row.campaignTitle,
    id: row.id,
  };
}

/**
 * refresh_tokens — SESSIONS THAT LAPSED WITHOUT EVER BEING USED.
 *
 * A session that reached its expiry un-revoked is somebody who stopped opening
 * the app, as opposed to somebody who signed out or whose app renewed quietly.
 * The same definition insights.service.ts counts on, so a trail and the dashboard
 * cannot disagree about what "ran out" means.
 */
export function fromLapsedSession(row: {
  id: string;
  expiresAt: Date;
}): ActivityRow {
  return {
    at: row.expiresAt,
    kind: 'session',
    what: 'Their session ran out without being used again',
    detail: null,
    campaignId: null,
    campaignTitle: null,
    id: row.id,
  };
}

// ── the summary ─────────────────────────────────────────────────────────────

/** The shape of the person, rather than of the window. */
export interface ActivitySummary {
  /** The earliest thing Fayr ever recorded about them. */
  firstSeen: string | null;
  /** The most recent. */
  lastSeen: string | null;
  /** Whole days since lastSeen. Null when they have never been seen. */
  daysQuiet: number | null;
  totalScreens: number;
  totalTasks: number;
  setupFinished: boolean;
  /**
   * The first setup step with no SETUP_STEP_DONE behind it, when setup was not
   * finished. Null once it is finished, and null when every step is done but the
   * finish was never written — that is a real state and guessing a number for it
   * would be the kind of invention this project does not do.
   */
  setupStoppedAt: number | null;
}

/**
 * WHERE SETUP STOPPED.
 *
 * The FIRST step with nothing behind it, not the highest one done plus one.
 * Those differ when somebody skipped a step and came back, and the first gap is
 * the one an agent should ask about.
 */
export function whereSetupStopped(
  stepsDone: readonly number[],
  setupFinished: boolean,
): number | null {
  if (setupFinished) return null;
  const done = new Set(stepsDone);
  for (let step = 1; step <= SETUP_STEPS; step += 1) {
    if (!done.has(step)) return step;
  }
  return null;
}

/** Whole days between two instants, floored, never negative. */
export function daysBetween(then: Date, now: Date): number {
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

// ── small shared bits ───────────────────────────────────────────────────────

function quoted(offer: string | null | undefined): string {
  const trimmed = String(offer ?? '').trim();
  return trimmed === '' ? 'an offer' : `“${trimmed}”`;
}

/**
 * A language tag as a person says it.
 *
 * The same three the assistant knows. An unrecognised tag comes back as null
 * rather than as its code, for the reason platformDisplayName gives: a screen
 * printing "hi-en" looks broken.
 */
function languageName(tag: string): string | null {
  const said: Record<string, string> = {
    en: 'in English',
    hi: 'in Hindi',
    'hi-en': 'in Hindi, written in English letters',
  };
  return said[tag] ?? null;
}
