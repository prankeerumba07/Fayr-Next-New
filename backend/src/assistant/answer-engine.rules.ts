/**
 * HOW THE ENGINE DECIDES — pure, so the deciding can be argued with in a test.
 *
 * The searching, the recording and the swapping of one answer source for another
 * are next door in the service. What is here is the judgement: which candidate to
 * use, whether it is good enough to say out loud, and what to say when it is not.
 *
 * Two things this refuses to do, and both are enforced here rather than hoped for:
 *
 *   IT NEVER RETURNS AN ANSWER THAT BREAKS THE PLAIN-LANGUAGE RULE. Every
 *   candidate goes through the check on its way out, whatever is stored, whoever
 *   approved it. The last gate is here because this is the last place before a
 *   person reads it.
 *
 *   IT NEVER MAKES ANYTHING UP. Below the confidence line it says it does not
 *   know, in the language the person wrote in, and the question is recorded as
 *   unresolved so a person picks it up.
 */

import type { AssistantAnswerOrigin } from '@prisma/client';
import { isPlainLanguage } from './plain-language';
import type { ScoredMatch } from './matching';

/**
 * How close a match has to be before we say it out loud.
 *
 * A PRODUCT DECISION, not a technical one. Raising it means the assistant says
 * "I do not know" more often and is wrong less often. Lowering it means the
 * opposite. Whoever changes this is choosing between a person being given a
 * confidently wrong answer about their money, and a person waiting for a human —
 * so choose the second when in doubt.
 *
 * Measured against the real drafts: an exact wording in the same language scores
 * near 100, a wording with two typos in it lands in the thirties, and a question
 * about something we have no answer for lands near ten. 55 sits above the typo
 * band on its own but below anything that shares real words.
 */
export const MIN_CONFIDENT_SCORE = 55;

/**
 * How much a candidate gains for being about the thing the person is actually
 * stuck on.
 *
 * Deliberately small. A nudge decides between two answers that were BOTH already
 * good enough; it must never lift a bad match over the line, and there is a test
 * that fails if it can.
 */
export const topicNudge = 6;

/**
 * What we say when we do not know. In every language we can be asked in.
 *
 * No timeline in any of them. Nothing in this project says how long anybody waits
 * for a reply, so promising one here would be inventing it.
 */
export const CANNOT_ANSWER_YET: Record<string, string> = {
  en:
    'I could not answer this one yet. A person from Fayr will read it and ' +
    'get back to you.',
  hi: 'मैं इसका जवाब अभी नहीं दे सका। फेयर का कोई व्यक्ति इसे पढ़कर आपको बताएगा।',
  'hi-en':
    'Main iska jawab abhi nahi de saka. Fayr ka koi vyakti ise padhkar aapko ' +
    'bataega.',
};

/** One possible answer, already scored by the matching. */
export interface Candidate {
  answerEntryId: string;
  key: string;
  language: string;
  topic: string;
  title: string;
  body: string;
  revision: number;
  score: number;
  matchedPhrase: string;
  how: ScoredMatch['how'];
}

export interface Reply {
  text: string;
  language: string;
  origin: AssistantAnswerOrigin;
  answerEntryId: string | null;
  answerRevision: number | null;
  score: number | null;
  confident: boolean;
  /** Why we replied the way we did, in plain words. Shown to staff. */
  because: string;
}

/** The "I do not know" reply, in the right language. */
function cannotAnswer(language: string, because: string): Reply {
  const text = CANNOT_ANSWER_YET[language] ?? CANNOT_ANSWER_YET.en;
  return {
    text,
    // The honest reply exists in three languages. Asked in a fourth, we answer in
    // English and say so, rather than replying in a language we did not write.
    language: CANNOT_ANSWER_YET[language] ? language : 'en',
    origin: 'NONE',
    answerEntryId: null,
    answerRevision: null,
    score: null,
    confident: false,
    because,
  };
}

/**
 * Which parts of the app this person is currently caught up in.
 *
 * Read off the journey snapshot that was taken when they asked, and used only to
 * break a tie between two answers that are already good enough. Defensive about
 * the snapshot's shape: an unexpected one means no nudge, never a crash, because
 * a question must never be lost over a convenience.
 */
export function journeyTopics(journey: unknown): string[] {
  if (!journey || typeof journey !== 'object') return [];
  const standing = (journey as { standing?: unknown }).standing;
  if (!standing || typeof standing !== 'object') return [];

  const s = standing as {
    offersInProgress?: unknown;
    payoutsWaiting?: unknown;
    ticketBalance?: unknown;
  };
  const topics: string[] = [];
  const num = (v: unknown): number => (typeof v === 'number' ? v : -1);

  if (num(s.offersInProgress) > 0) topics.push('refund');
  if (num(s.payoutsWaiting) > 0) topics.push('withdrawal');
  if (num(s.ticketBalance) === 0) topics.push('tickets');
  return topics;
}

/**
 * Pick a reply.
 *
 * The question itself is not a parameter: by the time we are here it has already
 * done its work, in the searching and the scoring that produced these candidates.
 * Taking it again would invite a second, different opinion about the same words.
 *
 * Candidates are scored, nudged for what the person is stuck on, and taken in
 * order. The first one that is BOTH above the confidence line and readable wins.
 * A candidate that is above the line but unreadable is skipped, not sent, and if
 * nothing survives we say we do not know.
 */
export function chooseReply(
  language: string,
  candidates: Candidate[],
  topics: string[],
): Reply {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return cannotAnswer(
      language,
      'Nothing in the answer book looked like this question.',
    );
  }

  const nudged = candidates
    .map((c) => ({
      candidate: c,
      // The nudge affects the ORDER, never whether the line is cleared. The line
      // is checked against the real score below.
      ordering: c.score + (topics.includes(c.topic) ? topicNudge : 0),
      nudgedBy: topics.includes(c.topic) ? c.topic : null,
    }))
    .sort(
      (a, b) =>
        b.ordering - a.ordering ||
        a.candidate.answerEntryId.localeCompare(b.candidate.answerEntryId),
    );

  let unreadable = 0;
  for (const { candidate, nudgedBy } of nudged) {
    if (candidate.score < MIN_CONFIDENT_SCORE) continue;
    if (!isPlainLanguage(candidate.body, candidate.language)) {
      unreadable += 1;
      continue;
    }
    return {
      text: candidate.body,
      language: candidate.language,
      origin: 'ANSWER_BOOK',
      answerEntryId: candidate.answerEntryId,
      answerRevision: candidate.revision,
      score: candidate.score,
      confident: true,
      because: nudgedBy
        ? `This is the closest stored answer, and it is about the thing this person is in the middle of.`
        : `This is the closest stored answer to the way the question was asked.`,
    };
  }

  if (unreadable > 0) {
    return cannotAnswer(
      language,
      'The closest stored answer does not read plainly enough to send, so it was held back.',
    );
  }
  return cannotAnswer(
    language,
    'Nothing in the answer book was close enough to be worth sending.',
  );
}
