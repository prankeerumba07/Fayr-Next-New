import type {
  AnswerEntry,
  AnswerOrigin,
  AnswerStatus,
  AssistantAnswerOrigin,
  AssistantQuestion,
  AssistantQuestionStatus,
  Prisma,
  User,
} from '@prisma/client';
import type { ScoredMatch } from './matching';

/**
 * Something the assistant's store was asked to do that it will not do. Thrown
 * rather than returned, and translated to an HTTP status at the edge — the same
 * arrangement as TicketError and LedgerError.
 */
export class AssistantError extends Error {}

/**
 * The narrower case, given its own class so the edge can turn it into a 404
 * without matching on the text of a message — the same arrangement as
 * InsufficientTicketsError under TicketError.
 */
export class AssistantNotFoundError extends AssistantError {}

export interface RecordQuestionInput {
  userId: string;
  /** Exactly as typed. Not trimmed here and not trimmed on the way in. */
  rawText: string;
  /** What this person was doing when they asked. A snapshot, taken then. */
  journey?: Prisma.InputJsonValue;
}

/** What we said back, and where it came from. */
export interface AnswerGiven {
  origin: AssistantAnswerOrigin;
  answerEntryId?: string | null;
  answerText?: string | null;
  /** 0 to 100. Null when nothing was matched. */
  matchScore?: number | null;
  /** Which wording of the answer was shown. */
  answerRevision?: number | null;
  /** What kind of question this turned out to be, from the answer that served it. */
  topic?: string | null;
}

/** One question nobody could answer, as much of it as the grouping needs. */
export interface UnansweredRow {
  id: string;
  rawText: string;
  detectedLanguage: string;
  askedAt: Date;
  topic: string | null;
}

/** An answer to store, or a correction to one already stored. */
export interface AnswerDraft {
  key: string;
  language: string;
  title: string;
  body: string;
  topic: string;
  status?: AnswerStatus;
  origin?: AnswerOrigin;
  /**
   * Every way somebody might ask for this. Given: they REPLACE what is stored.
   * Left out: what is stored is left alone.
   */
  phrases?: string[];
  updatedByStaffId?: string | null;
}

export interface AnswerSearchOptions {
  text: string;
  /** The language the question looks like. Worked out from the text if not given. */
  language?: string;
  limit?: number;
}

/** One answer the search thinks might be the one, and why. */
export interface AnswerSearchHit {
  answer: AnswerEntry;
  /** 0 to 100. */
  score: number;
  /** The stored wording that matched. */
  matchedPhrase: string;
  how: ScoredMatch['how'];
}

export interface QuestionFilter {
  status?: AssistantQuestionStatus;
  userId?: string;
  limit: number;
  offset: number;
}

export type QuestionWithAnswer = AssistantQuestion & {
  answerEntry: Pick<
    AnswerEntry,
    'id' | 'key' | 'language' | 'title' | 'revision' | 'status'
  > | null;
  /** Who asked. The staff screens need to know; the app never reads this. */
  user: Pick<User, 'id' | 'displayId' | 'mobile'>;
};

export interface QuestionPage {
  total: number;
  limit: number;
  offset: number;
  questions: QuestionWithAnswer[];
}

export interface AnswerFilter {
  language?: string;
  status?: AnswerStatus;
  topic?: string;
  limit: number;
  offset: number;
}

export type AnswerWithPhraseCount = AnswerEntry & {
  _count: { phrases: number };
};

export interface AnswerPage {
  total: number;
  limit: number;
  offset: number;
  answers: AnswerWithPhraseCount[];
}

/**
 * How long things are taking. Every duration is whole seconds, and null means
 * "nothing to measure yet" — never zero, which would read as instant.
 */
export interface ResolutionStats {
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
    fastestSeconds: number | null;
    /** The middle one. Not the average, which one bad week ruins. */
    typicalSeconds: number | null;
    slowestSeconds: number | null;
    /** Nine out of ten were resolved within this. */
    nineOutOfTenWithinSeconds: number | null;
  };
}
