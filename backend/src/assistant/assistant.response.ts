import type {
  AnswerOrigin,
  AnswerStatus,
  AssistantAnswerOrigin,
  AssistantQuestionStatus,
} from '@prisma/client';
import { languageName } from './language';
import type {
  AnswerWithPhraseCount,
  QuestionWithAnswer,
  ResolutionStats,
} from './assistant.types';

/**
 * WHAT THE STAFF SCREENS ARE HANDED.
 *
 * Two rules run through all of it.
 *
 * Every date and every duration crosses the wire as text a person can read, the
 * same convention as the rest of the backend — a screen should never have to work
 * out what 1200 means.
 *
 * The QUEUE shows less than the single question does. Scanning a list of who is
 * waiting is not the same act as opening one person's own words and the record of
 * their movements, so the phone number and the journey are only in the second —
 * which is the one written to the audit trail.
 */

/** Who asked. In the queue, by their Fayr number and nothing else. */
export interface AskerInQueue {
  id: string;
  displayId: string;
}

/** In the single view, with the number somebody would call them back on. */
export interface AskerInDetail extends AskerInQueue {
  mobile: string;
}

export interface AnswerGivenResponse {
  origin: AssistantAnswerOrigin;
  text: string | null;
  /** 0 to 100, or null when nothing was matched. */
  score: number | null;
  revision: number | null;
  entry: {
    id: string;
    key: string;
    language: string;
    languageName: string;
    title: string;
    revision: number;
    status: AnswerStatus;
  } | null;
}

export interface AssistantQuestionSummary {
  id: string;
  askedAt: string;
  /** Exactly what was typed. Never tidied on the way out either. */
  rawText: string;
  language: { tag: string; name: string; confidence: number };
  status: AssistantQuestionStatus;
  answer: AnswerGivenResponse | null;
  helpful: boolean | null;
  helpfulAt: string | null;
  resolvedAt: string | null;
  secondsToResolve: number | null;
  timeToResolve: string | null;
  user: AskerInQueue;
}

export interface AssistantQuestionDetail extends Omit<
  AssistantQuestionSummary,
  'user'
> {
  user: AskerInDetail;
  /** What they were doing when they asked, as it was captured then. */
  journey: unknown;
  /** Why there is no journey, when there is none. Never left to be guessed at. */
  journeyNote: string | null;
}

export interface AnswerSummaryResponse {
  id: string;
  key: string;
  language: string;
  languageName: string;
  title: string;
  body: string;
  topic: string;
  status: AnswerStatus;
  origin: AnswerOrigin;
  revision: number;
  /** How many stored wordings lead to this one answer. */
  waysOfAsking: number;
  updatedByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DurationResponse {
  seconds: number | null;
  inWords: string | null;
}

export interface StatsResponse {
  windowDays: number;
  asked: number;
  answered: number;
  unresolved: number;
  resolved: number;
  saidItHelped: number;
  saidItDidNotHelp: number;
  didNotSay: number;
  resolution: {
    counted: number;
    fastest: DurationResponse;
    typical: DurationResponse;
    slowest: DurationResponse;
    nineOutOfTenWithin: DurationResponse;
  };
}

/**
 * A length of time in words. Whole words only — no "min", no "hrs", no "20s" —
 * because these go on a screen a person reads, and the plain-language rule is not
 * only for the answers.
 *
 * Rounded to the nearest whole unit, which means two and a half hours reads as
 * three. That is the right direction for these particular numbers: they are about
 * how long FAYR took, and a figure about our own speed should never round in the
 * direction that flatters us.
 *
 * The step up happens on the rounded number, not the raw one, so 3,599 seconds
 * reads as "1 hour" rather than "60 minutes".
 */
export function durationInWords(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return null;
  }
  const s = Math.max(0, Math.round(seconds));
  if (s === 0) return 'less than a second';
  const say = (n: number, unit: string): string =>
    `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (s < 60) return say(s, 'second');

  const minutes = Math.round(s / 60);
  if (minutes < 60) return say(minutes, 'minute');

  const hours = Math.round(s / 3_600);
  if (hours < 24) return say(hours, 'hour');

  return say(Math.round(s / 86_400), 'day');
}

function toAnswerGiven(q: QuestionWithAnswer): AnswerGivenResponse | null {
  // NONE means nothing matched and we said so. There is no answer to show, and
  // showing an empty one would read as an answer that failed to load.
  if (q.answerOrigin === 'NONE') return null;
  return {
    origin: q.answerOrigin,
    text: q.answerText,
    score: q.matchScore,
    revision: q.answerRevision,
    entry: q.answerEntry
      ? {
          id: q.answerEntry.id,
          key: q.answerEntry.key,
          language: q.answerEntry.language,
          languageName: languageName(q.answerEntry.language),
          title: q.answerEntry.title,
          revision: q.answerEntry.revision,
          status: q.answerEntry.status,
        }
      : null,
  };
}

function secondsBetween(from: Date, to: Date | null): number | null {
  if (!to) return null;
  return Math.round((to.getTime() - from.getTime()) / 1_000);
}

export function toQuestionSummary(
  q: QuestionWithAnswer,
  user: AskerInQueue,
): AssistantQuestionSummary {
  const took = secondsBetween(q.askedAt, q.resolvedAt);
  return {
    id: q.id,
    askedAt: q.askedAt.toISOString(),
    rawText: q.rawText,
    language: {
      tag: q.detectedLanguage,
      name: languageName(q.detectedLanguage),
      confidence: q.languageConfidence,
    },
    status: q.status,
    answer: toAnswerGiven(q),
    helpful: q.helpful,
    helpfulAt: q.helpfulAt ? q.helpfulAt.toISOString() : null,
    resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
    secondsToResolve: took,
    timeToResolve: durationInWords(took),
    user: { id: user.id, displayId: user.displayId },
  };
}

export function toQuestionDetail(
  q: QuestionWithAnswer,
  user: AskerInDetail,
): AssistantQuestionDetail {
  const summary = toQuestionSummary(q, user);
  const hasJourney = q.journey !== null && q.journey !== undefined;
  return {
    ...summary,
    user,
    journey: hasJourney ? q.journey : null,
    journeyNote: hasJourney
      ? null
      : 'What this person was doing when they asked could not be read at the time, so it was not captured. It cannot be filled in now — reading their account today would show today.',
  };
}

export function toAnswerSummary(
  a: AnswerWithPhraseCount,
): AnswerSummaryResponse {
  return {
    id: a.id,
    key: a.key,
    language: a.language,
    languageName: languageName(a.language),
    title: a.title,
    body: a.body,
    topic: a.topic,
    status: a.status,
    origin: a.origin,
    revision: a.revision,
    waysOfAsking: a._count?.phrases ?? 0,
    updatedByStaffId: a.updatedByStaffId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

const duration = (seconds: number | null): DurationResponse => ({
  seconds,
  inWords: durationInWords(seconds),
});

export function toStatsResponse(stats: ResolutionStats): StatsResponse {
  return {
    windowDays: stats.windowDays,
    asked: stats.asked,
    answered: stats.answered,
    unresolved: stats.unresolved,
    resolved: stats.resolved,
    saidItHelped: stats.saidItHelped,
    saidItDidNotHelp: stats.saidItDidNotHelp,
    didNotSay: stats.didNotSay,
    resolution: {
      counted: stats.resolution.counted,
      fastest: duration(stats.resolution.fastestSeconds),
      typical: duration(stats.resolution.typicalSeconds),
      slowest: duration(stats.resolution.slowestSeconds),
      nineOutOfTenWithin: duration(stats.resolution.nineOutOfTenWithinSeconds),
    },
  };
}
