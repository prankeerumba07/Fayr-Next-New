import { Injectable, Logger } from '@nestjs/common';
import { AssistantStore } from './assistant.store';
import {
  chooseReply,
  journeyTopics,
  type Candidate,
  type Reply,
} from './answer-engine.rules';

/**
 * WHERE AN ANSWER CAN COME FROM.
 *
 * One small interface, so a real language model can be put in front of the answer
 * book later without a single caller changing. That is the whole point of it
 * existing this early: the seam has to be there BEFORE there is something to plug
 * into it, or putting the something in means rewriting the callers.
 *
 * A source always returns a reply, and the reply says whether it is CONFIDENT. The
 * engine asks each source in turn and takes the first confident one.
 *
 * Why a reply rather than null when a source cannot help: the reply carries the
 * reason. "The closest stored answer does not read plainly enough to send" and
 * "nothing looked like this question" are completely different pieces of news for
 * the person who has to fix it, and returning null threw both away and replaced
 * them with a guess. That was a real bug, found by a test that asked why an
 * unreadable answer had been held back and got told nothing had matched.
 */
export interface AnswerRequest {
  question: string;
  /** The language the question looks like, already worked out. */
  language: string;
  /**
   * Which language to ANSWER in, when that is not the language it was asked in.
   *
   * Two separate things on purpose. The language a question looks like is how the
   * match is found — it is the only way a Hindi question is recognised at all.
   * Which language we reply in is somebody's decision, and inside a conversation
   * it is the shopper's: English until they say otherwise.
   */
  replyIn?: string;
  /** What this person was doing when they asked. May be absent. */
  journey?: unknown;
}

export interface AnswerSource {
  /** Short name, used in logs and in the reason shown to staff. */
  readonly name: string;
  /** A reply. Check `confident` — an unconfident one still carries the reason. */
  answer(request: AnswerRequest): Promise<Reply>;
}

/**
 * THE ANSWER BOOK. What actually answers questions today.
 *
 * Searches the stored wordings, scores them, and hands the shortlist to the pure
 * deciding code. It returns null only when it is not confident — and the engine
 * turns that into the honest "I could not answer this yet", so the honest reply is
 * written in exactly one place.
 */
@Injectable()
export class AnswerBookSource implements AnswerSource {
  readonly name = 'answer book';

  constructor(private readonly store: AssistantStore) {}

  async answer(request: AnswerRequest): Promise<Reply> {
    const hits = await this.store.searchAnswers({
      text: request.question,
      language: request.language,
      limit: 5,
    });

    let candidates: Candidate[] = hits.map((hit) => ({
      answerEntryId: hit.answer.id,
      key: hit.answer.key,
      language: hit.answer.language,
      topic: hit.answer.topic,
      title: hit.answer.title,
      body: hit.answer.body,
      revision: hit.answer.revision,
      score: hit.score,
      matchedPhrase: hit.matchedPhrase,
      how: hit.how,
    }));

    const replyIn = request.replyIn ?? request.language;
    if (replyIn !== request.language) {
      candidates = await this.inLanguage(candidates, replyIn);
    }

    // Returned whether or not it is confident. An unconfident reply is where the
    // honest reason lives.
    return chooseReply(replyIn, candidates, journeyTopics(request.journey));
  }

  /**
   * Swap each candidate for the same answer written in the reply language.
   *
   * THE SCORE IS KEPT. It was earned by the words somebody typed matching a
   * wording in their own language, and that match is just as true whichever
   * language we read the answer out in. Re-scoring against the translation would
   * throw away the only evidence we have.
   *
   * A candidate with no wording in the reply language is DROPPED, not translated
   * and not sent in the wrong language. Dropping it means we say we do not know
   * and a person looks, which is the honest outcome — sending Hindi to somebody
   * who asked us for English is not.
   */
  private async inLanguage(
    candidates: Candidate[],
    language: string,
  ): Promise<Candidate[]> {
    const wordings = await this.store.wordingsFor(
      candidates.map((c) => c.key),
      language,
    );
    return candidates
      .map((c) => {
        const other = wordings.get(c.key);
        if (!other) return null;
        return {
          ...c,
          answerEntryId: other.id,
          language: other.language,
          title: other.title,
          body: other.body,
          revision: other.revision,
        };
      })
      .filter((c): c is Candidate => c !== null);
  }
}

/**
 * A REAL LANGUAGE MODEL — the placeholder, and deliberately inert.
 *
 * NOTHING IS WIRED UP. There is no paid call here, no prompt, and no key. What
 * exists is the shape: put this in front of the answer book with one setting, and
 * every caller carries on unchanged.
 *
 * IT IS NEVER CONFIDENT, ALWAYS, AND THAT IS THE SAFE CHOICE. Turning the setting
 * on today changes nothing at all — the chain simply falls through to the answer
 * book. Nobody can accidentally make the assistant worse, or spend money, by
 * flipping a flag; and when this is filled in, the answer book stays behind it as
 * the fallback rather than being replaced.
 *
 * WHAT IT WILL NEED WHEN WE DO SWITCH IT ON: one Anthropic API key, in
 * ANTHROPIC_API_KEY in backend/.env — the same variable the screenshot reading
 * already uses, and the same key-gated client. It is read from the environment and
 * never appears in code, in a prompt, or in any log line.
 *
 * AND ONE RULE THAT DOES NOT CHANGE: whatever a model writes still has to pass the
 * plain-language check before it reaches a person, exactly like a stored answer.
 * The gate is in the pure deciding code, not in the source, so a new source cannot
 * skip it.
 */
@Injectable()
export class ModelAnswerSource implements AnswerSource {
  readonly name = 'language model';
  private readonly log = new Logger(ModelAnswerSource.name);
  private warned = false;

  answer(request: AnswerRequest): Promise<Reply> {
    if (!this.warned) {
      this.warned = true;
      this.log.warn(
        'the language model answer source is selected but not built yet, so ' +
          'every question is falling through to the answer book',
      );
    }
    // No candidates, so this is the honest reply in the right language, built by
    // the same pure code everything else uses.
    return Promise.resolve(chooseReply(request.language, [], []));
  }
}
