import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { AssistantStore } from './assistant.store';
import { UserJourneyService } from './user-journey.service';
import { detectLanguage } from './language';
import { chooseReply, journeyTopics, type Reply } from './answer-engine.rules';
import {
  AnswerBookSource,
  ModelAnswerSource,
  type AnswerSource,
} from './answer-source';

export interface AskResult {
  /** The question we wrote down. The app sends the "did it help" answer against this. */
  questionId: string;
  /** What to show the person. */
  answer: string;
  language: string;
  /** False means we said we do not know and a person has to look. */
  answered: boolean;
  /** Which answer was used, when one was. */
  answerEntryId: string | null;
  /** Why we replied the way we did. For staff, never sent to the app. */
  because: string;
  /** Which source produced it. For staff and for logs. */
  from: string;
}

/**
 * THE ONE THING THAT ANSWERS A QUESTION.
 *
 * Every path into the assistant goes through `ask`. It writes the question down
 * first, works out what language it is in, asks each answer source in turn, checks
 * the reply, records what was said, and hands it back.
 *
 * THE ORDER OF THE STEPS MATTERS. The question is written down BEFORE anything
 * tries to answer it. If the answering falls over, the question still exists and a
 * person still picks it up — which is the difference between a bad day and a lost
 * customer.
 *
 * SWAPPING THE SOURCE. One setting, ASSISTANT_ANSWER_SOURCE, decides the order the
 * sources are asked in. Today "model" puts an inert placeholder first, so turning
 * it on changes nothing: the chain falls straight through to the answer book. When
 * the model is real, the answer book stays behind it as the fallback. No caller
 * ever changes.
 */
@Injectable()
export class AnswerEngine {
  private readonly log = new Logger(AnswerEngine.name);

  constructor(
    private readonly store: AssistantStore,
    private readonly journeys: UserJourneyService,
    private readonly answerBook: AnswerBookSource,
    private readonly model: ModelAnswerSource,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * The sources, in the order they are asked.
   *
   * Read per call rather than once at construction, so a setting change takes
   * effect on a restart without a second place remembering the old value.
   */
  private sources(): AnswerSource[] {
    const chosen = this.config.get('ASSISTANT_ANSWER_SOURCE', { infer: true });
    return chosen === 'model'
      ? [this.model, this.answerBook]
      : [this.answerBook];
  }

  async ask(
    userId: string,
    question: string,
    opts: { replyIn?: string } = {},
  ): Promise<AskResult> {
    // What they were doing, captured now. Taken here so the same snapshot is
    // stored on the question AND used to choose the answer — two reads could
    // disagree, and then the reason shown to staff would not match the record.
    const journey = await this.journeyOrNothing(userId);

    // Written down FIRST. Nothing below this line can lose the question.
    const recorded = await this.store.recordQuestion({
      userId,
      rawText: question,
      journey: journey ?? undefined,
    });

    const language = detectLanguage(question).language;
    // Which language to ANSWER in. Not the same question as which language it was
    // asked in: inside a conversation the shopper decides, and until they say
    // anything the answer is English.
    const replyIn = opts.replyIn ?? language;
    let reply: Reply | null = null;
    let from = 'nobody';

    // The last thing a source said when it could not help. Kept, because it
    // carries WHY — "the closest answer does not read plainly enough to send" and
    // "nothing looked like this question" are different news for whoever fixes it.
    let heldBack: Reply | null = null;

    for (const source of this.sources()) {
      try {
        const offered = await source.answer({ question, language, replyIn, journey });
        if (offered.confident) {
          reply = offered;
          from = source.name;
          break;
        }
        heldBack = offered;
      } catch (err) {
        // A source that falls over must not take the question with it. The next
        // one gets a turn, and the honest reply is the floor.
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`the ${source.name} could not answer: ${reason}`);
      }
    }

    if (!reply) {
      // The honest reply, written in exactly one place. Either the reason a source
      // gave, or — if every source threw — the same pure code with no candidates,
      // so the wording can never drift.
      reply = heldBack ?? chooseReply(replyIn, [], journeyTopics(journey));
      from = 'nobody';
    }

    await this.store.recordAnswer(recorded.id, {
      origin: reply.origin,
      answerEntryId: reply.answerEntryId,
      answerText: reply.text,
      matchScore: reply.score,
      answerRevision: reply.answerRevision,
      topic: reply.topic,
    });

    return {
      questionId: recorded.id,
      answer: reply.text,
      language: reply.language,
      answered: reply.confident,
      answerEntryId: reply.answerEntryId,
      because: reply.because,
      from,
    };
  }

  /** Record whether the reply helped. Only the person who asked may say. */
  async sayItHelped(
    userId: string,
    questionId: string,
    helpful: boolean,
  ): Promise<void> {
    await this.store.recordHelpfulForOwner(userId, questionId, helpful);
  }

  private async journeyOrNothing(userId: string): Promise<unknown | null> {
    try {
      return await this.journeys.snapshotFor(userId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(`could not read what user ${userId} was doing: ${reason}`);
      return null;
    }
  }
}
