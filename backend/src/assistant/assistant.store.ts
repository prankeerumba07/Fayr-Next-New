import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ANSWER_BODY_MAX_LENGTH,
  ANSWER_KEY_PATTERN,
  ANSWER_TITLE_MAX_LENGTH,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_STATS_WINDOW_DAYS,
  MAX_PHRASES_PER_ANSWER,
  MAX_SEARCH_LIMIT,
  MAX_PAGE_SIZE,
  MAX_STATS_WINDOW_DAYS,
  NEAR_MISS_THRESHOLD,
  PHRASE_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  SEARCH_CANDIDATE_CAP,
  TOPIC_MAX_LENGTH,
} from './assistant.constants';
import { detectLanguage, isKnownLanguage } from './language';
import { UserJourneyService } from './user-journey.service';
import { bestMatches, tsQueryFor, type PhraseCandidate } from './matching';
import {
  AssistantError,
  AssistantNotFoundError,
  type AnswerDraft,
  type AnswerFilter,
  type AnswerGiven,
  type AnswerPage,
  type AnswerSearchHit,
  type AnswerSearchOptions,
  type QuestionFilter,
  type QuestionPage,
  type QuestionWithAnswer,
  type RecordQuestionInput,
  type ResolutionStats,
} from './assistant.types';
import type {
  AnswerEntry,
  AssistantQuestion,
  AssistantQuestionStatus,
} from '@prisma/client';

/** One row the database offered as a possible match. */
interface CandidateRow {
  answerEntryId: string;
  phrase: string;
  phraseLanguage: string;
  nearness: number;
}

/** The four things the answer entry that a question points at is read for. */
const ANSWER_SUMMARY = {
  id: true,
  key: true,
  language: true,
  title: true,
  revision: true,
  status: true,
} as const;

/** Who asked, for the staff screens. Never the PAN, never a payout detail. */
const ASKER = { id: true, displayId: true, mobile: true } as const;

const WITH_CONTEXT = {
  answerEntry: { select: ANSWER_SUMMARY },
  user: { select: ASKER },
} as const;

/**
 * EVERYTHING THE ASSISTANT KNOWS, AND EVERYTHING IT HAS BEEN ASKED.
 *
 * The one way in and out of the three tables. Nothing else writes them, so every
 * rule about what may be stored lives here once — and the database carries the
 * same rules as CHECK constraints for any writer that ever appears beside this.
 *
 * The division of labour that makes this scale, and the reason the search reads
 * the way it does:
 *
 *   THE DATABASE NARROWS. Two indexes — one over the words, one over runs of
 *   three letters — take every stored wording down to at most a couple of hundred
 *   candidates without reading the table. That is what keeps a question the same
 *   speed whether there are fifty answers or fifty thousand.
 *
 *   THE PURE CODE JUDGES. Which of those candidates is actually the one is decided
 *   in matching.ts, on a short list, with no database in sight — so the judgement
 *   can be argued with in a test.
 *
 * WHY NOT EMBEDDINGS: they would match meaning rather than words, and they are
 * the obvious next step. They also need a paid model call for every question and
 * every stored phrase, and a second piece of infrastructure to search. Neither
 * exists yet. When they do, they slot in behind `searchAnswers` without moving any
 * of this data.
 */
@Injectable()
export class AssistantStore {
  private readonly log = new Logger(AssistantStore.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journey: UserJourneyService,
  ) {}

  // ── questions ──────────────────────────────────────────────────────────

  /**
   * Write down a question exactly as it was asked.
   *
   * The text is stored untouched — not trimmed, not corrected. It is the evidence,
   * and the whole point of keeping it is that tomorrow's answer gets written from
   * the words people really use.
   */
  async recordQuestion(input: RecordQuestionInput): Promise<AssistantQuestion> {
    const { userId, rawText } = input;
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new AssistantError('a question needs to belong to someone');
    }
    if (typeof rawText !== 'string') {
      throw new AssistantError('a question has to be text');
    }
    if (rawText.trim() === '') {
      throw new AssistantError('there is nothing in that question');
    }
    if (rawText.length > QUESTION_MAX_LENGTH) {
      throw new AssistantError(
        `that question is longer than ${QUESTION_MAX_LENGTH} characters`,
      );
    }

    const guess = detectLanguage(rawText);

    // Taken here rather than left to the caller, because the one moment this can
    // be captured is now. Reading their tasks next week tells you what is true
    // next week, not what was true when they wrote in.
    const journey = input.journey ?? (await this.snapshotOrNothing(userId));

    try {
      return await this.prisma.assistantQuestion.create({
        data: {
          userId,
          rawText,
          detectedLanguage: guess.language,
          languageConfidence: guess.confidence,
          journey,
        },
      });
    } catch (err) {
      throw this.asAssistantError(err, 'that question could not be saved');
    }
  }

  /**
   * The journey snapshot, or nothing at all.
   *
   * A question must never be lost because the CONTEXT for it could not be built.
   * The question is what a person typed and what the whole thing learns from; the
   * snapshot is a convenience for whoever reads it later. So a failure here is
   * logged loudly and leaves the journey empty, which reads as "not captured"
   * rather than as "nothing was happening".
   */
  private async snapshotOrNothing(
    userId: string,
  ): Promise<Prisma.InputJsonValue | undefined> {
    try {
      return this.toJson(await this.journey.snapshotFor(userId));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.warn(
        `could not read what user ${userId} was doing when they asked: ${reason}`,
      );
      return undefined;
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  /** Record the reply that was given, as it was shown. */
  async recordAnswer(
    questionId: string,
    given: AnswerGiven,
  ): Promise<AssistantQuestion> {
    const score = given.matchScore ?? null;
    if (score !== null) {
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        throw new AssistantError(
          `a match score has to be a whole number from 0 to 100, got ${String(score)}`,
        );
      }
    }
    const answered = given.origin !== 'NONE';
    if (answered && score === null && given.origin === 'ANSWER_BOOK') {
      throw new AssistantError('an answer from the answer book needs a score');
    }

    await this.mustExist(questionId);
    return this.prisma.assistantQuestion.update({
      where: { id: questionId },
      data: {
        answerEntryId: given.answerEntryId ?? null,
        answerText: given.answerText ?? null,
        answerOrigin: given.origin,
        matchScore: score,
        answerRevision: given.answerRevision ?? null,
        // Nothing matched means nobody has answered it. It stays in the queue.
        status: answered ? 'ANSWERED' : 'UNRESOLVED',
      },
    });
  }

  /**
   * Record whether it helped.
   *
   * Yes closes it. No puts it back — and clears the resolved time, because a
   * question somebody says was not answered must not count towards how quickly
   * questions get answered.
   */
  async recordHelpful(
    questionId: string,
    helpful: boolean,
  ): Promise<AssistantQuestion> {
    if (typeof helpful !== 'boolean') {
      throw new AssistantError('that has to be a yes or a no');
    }
    await this.mustExist(questionId);
    const now = new Date();
    return this.prisma.assistantQuestion.update({
      where: { id: questionId },
      data: {
        helpful,
        helpfulAt: now,
        status: helpful ? 'RESOLVED' : 'UNRESOLVED',
        resolvedAt: helpful ? now : null,
      },
    });
  }

  /**
   * Record whether it helped, on a question that BELONGS to this person.
   *
   * Separate from recordHelpful on purpose. That one is the plain write and is
   * called from staff paths; this one is what the app calls, and the app is where
   * somebody hostile is holding the phone. A question id belonging to anybody else
   * is refused exactly as if it did not exist — never "not yours", which would
   * confirm that it is somebody's.
   */
  async recordHelpfulForOwner(
    userId: string,
    questionId: string,
    helpful: boolean,
  ): Promise<AssistantQuestion> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new AssistantError('no account was named');
    }
    if (typeof helpful !== 'boolean') {
      throw new AssistantError('that has to be a yes or a no');
    }
    const owned = await this.prisma.assistantQuestion.findFirst({
      where: { id: questionId, userId },
      select: { id: true },
    });
    if (!owned) throw new AssistantNotFoundError('no such question');
    return this.recordHelpful(questionId, helpful);
  }

  /** This person's own questions, newest first. Never anybody else's. */
  async listForOwner(
    userId: string,
    limit: number,
  ): Promise<QuestionWithAnswer[]> {
    if (typeof userId !== 'string' || userId.trim() === '') {
      throw new AssistantError('no account was named');
    }
    return this.prisma.assistantQuestion.findMany({
      where: { userId },
      include: WITH_CONTEXT,
      orderBy: { askedAt: 'desc' },
      take: Math.min(MAX_PAGE_SIZE, Math.max(1, limit)),
    });
  }

  /** A person closed it. */
  async resolveByStaff(
    questionId: string,
    staffUserId: string,
  ): Promise<AssistantQuestion> {
    if (typeof staffUserId !== 'string' || staffUserId.trim() === '') {
      throw new AssistantError('closing a question needs to say who closed it');
    }
    const existing = await this.mustExist(questionId);
    return this.prisma.assistantQuestion.update({
      where: { id: questionId },
      data: {
        status: 'RESOLVED',
        resolvedByStaffId: staffUserId,
        resolvedAt: existing.resolvedAt ?? new Date(),
      },
    });
  }

  async getQuestion(id: string): Promise<QuestionWithAnswer> {
    const found = await this.prisma.assistantQuestion.findUnique({
      where: { id },
      include: WITH_CONTEXT,
    });
    if (!found) throw new AssistantNotFoundError('no such question');
    return found;
  }

  /** One page of questions, newest first. */
  async listQuestions(filter: QuestionFilter): Promise<QuestionPage> {
    const where: Prisma.AssistantQuestionWhereInput = {
      status: filter.status,
      userId: filter.userId,
    };
    const [total, questions] = await this.prisma.$transaction([
      this.prisma.assistantQuestion.count({ where }),
      this.prisma.assistantQuestion.findMany({
        where,
        include: WITH_CONTEXT,
        orderBy: { askedAt: 'desc' },
        take: filter.limit,
        skip: filter.offset,
      }),
    ]);
    return { total, limit: filter.limit, offset: filter.offset, questions };
  }

  // ── the answer book ────────────────────────────────────────────────────

  /**
   * Store an answer, or correct one already stored.
   *
   * Keyed on (key, language): the key is the identity of the ANSWER and the
   * language is which wording of it, so the same answer in Hindi is another row
   * with the same key. Adding a language is adding rows.
   *
   * The revision only moves when the WORDS move. Saving the same text again is not
   * a correction, and counting it as one would make the revision number
   * meaningless the first time anything re-runs the seed.
   */
  async saveAnswer(draft: AnswerDraft): Promise<AnswerEntry> {
    const key = this.requireText(draft.key, 'key');
    if (!ANSWER_KEY_PATTERN.test(key)) {
      throw new AssistantError(
        `"${key}" is not a usable name for an answer — lowercase letters, numbers and dashes only`,
      );
    }
    if (!isKnownLanguage(draft.language)) {
      throw new AssistantError(
        `"${String(draft.language)}" is not a language the assistant knows`,
      );
    }
    const title = this.requireText(
      draft.title,
      'title',
      ANSWER_TITLE_MAX_LENGTH,
    );
    const body = this.requireText(draft.body, 'body', ANSWER_BODY_MAX_LENGTH);
    const topic = this.requireText(draft.topic, 'topic', TOPIC_MAX_LENGTH);
    const phrases = this.cleanPhrases(draft.phrases);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.answerEntry.findUnique({
        where: { key_language: { key, language: draft.language } },
      });

      const wordsChanged =
        existing !== null &&
        (existing.title !== title || existing.body !== body);

      const entry = existing
        ? await tx.answerEntry.update({
            where: { id: existing.id },
            data: {
              title,
              body,
              topic,
              status: draft.status ?? existing.status,
              origin: draft.origin ?? existing.origin,
              revision: wordsChanged
                ? existing.revision + 1
                : existing.revision,
              updatedByStaffId:
                draft.updatedByStaffId ?? existing.updatedByStaffId,
            },
          })
        : await tx.answerEntry.create({
            data: {
              key,
              language: draft.language,
              title,
              body,
              topic,
              status: draft.status ?? 'DRAFT',
              origin: draft.origin ?? 'SEED',
              updatedByStaffId: draft.updatedByStaffId ?? null,
            },
          });

      // Given, they replace. Left out, they are left alone — so correcting the
      // wording of an answer never silently throws away its known phrasings.
      if (phrases !== null) {
        await tx.answerPhrase.deleteMany({
          where: { answerEntryId: entry.id },
        });
        if (phrases.length > 0) {
          await tx.answerPhrase.createMany({
            data: phrases.map((text) => ({
              answerEntryId: entry.id,
              text,
              language: draft.language,
            })),
          });
        }
      }
      return entry;
    });
  }

  /** One page of the answer book. */
  async listAnswers(filter: AnswerFilter): Promise<AnswerPage> {
    const where: Prisma.AnswerEntryWhereInput = {
      language: filter.language,
      status: filter.status,
      topic: filter.topic,
    };
    const [total, answers] = await this.prisma.$transaction([
      this.prisma.answerEntry.count({ where }),
      this.prisma.answerEntry.findMany({
        where,
        include: { _count: { select: { phrases: true } } },
        orderBy: [{ topic: 'asc' }, { key: 'asc' }, { language: 'asc' }],
        take: filter.limit,
        skip: filter.offset,
      }),
    ]);
    return { total, limit: filter.limit, offset: filter.offset, answers };
  }

  // ── finding an answer ──────────────────────────────────────────────────

  /**
   * The answers that might be the one, closest first.
   *
   * Returns an empty list rather than a guess when there is nothing searchable in
   * the text. It does NOT decide whether the best one is good enough — that
   * judgement belongs to the engine that has to look a person in the eye, not to
   * the store.
   */
  async searchAnswers(
    options: AnswerSearchOptions,
  ): Promise<AnswerSearchHit[]> {
    const text = typeof options.text === 'string' ? options.text : '';
    const limit = Math.min(
      MAX_SEARCH_LIMIT,
      Math.max(1, options.limit ?? DEFAULT_SEARCH_LIMIT),
    );
    const language = isKnownLanguage(options.language)
      ? options.language
      : detectLanguage(text).language;

    // STEP ONE — the database narrows, using its two indexes and nothing else.
    const rows = await this.withNearMissThreshold((tx) =>
      tx.$queryRaw<CandidateRow[]>(this.candidateSql(text)),
    );
    if (rows.length === 0) return [];

    // STEP TWO — which of those answers may actually be shown. Looked up by
    // primary key on at most SEARCH_CANDIDATE_CAP ids, so this costs the same
    // whether the answer book holds fifty answers or fifty thousand.
    //
    // Deliberately NOT a join inside step one. Joining there made the database
    // read every published answer on every single search: with four thousand
    // answers the plan was a hash join over all four thousand, and that read grows
    // with the answer book for no benefit. Filtering here instead means nothing in
    // the search reads a whole table.
    const entries = await this.prisma.answerEntry.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.answerEntryId))] },
        status: 'PUBLISHED',
      },
    });
    if (entries.length === 0) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));

    // STEP THREE — the pure code judges, on a short list.
    const candidates: PhraseCandidate[] = rows
      .filter((r) => byId.has(r.answerEntryId))
      .map((r) => ({
        answerEntryId: r.answerEntryId,
        phrase: r.phrase,
        phraseLanguage: r.phraseLanguage,
        nearness: Number(r.nearness),
      }));
    const winners = bestMatches(text, candidates, language, limit);

    return winners
      .map((w) => {
        const answer = byId.get(w.answerEntryId);
        return answer
          ? { answer, score: w.score, matchedPhrase: w.phrase, how: w.how }
          : null;
      })
      .filter((hit): hit is AnswerSearchHit => hit !== null);
  }

  /**
   * The database's own account of how it would run the search.
   *
   * A diagnostic, and the thing a test asserts on: it builds the query with the
   * SAME method the search uses, so a test can prove the indexes are really being
   * used and cannot end up asserting on a copy of the query that has drifted.
   */
  async explainSearch(text: string): Promise<string> {
    const rows = await this.withNearMissThreshold((tx) =>
      tx.$queryRaw<{ 'QUERY PLAN': string }[]>(
        Prisma.sql`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) ${this.candidateSql(text)}`,
      ),
    );
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  /** The same, for the staff queue. */
  async explainQuestionQueue(
    status: AssistantQuestionStatus,
    limit: number,
  ): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(
      Prisma.sql`
        EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
        SELECT * FROM "assistant_questions"
        WHERE "status" = ${status}::"AssistantQuestionStatus"
        ORDER BY "askedAt" DESC
        LIMIT ${limit}
      `,
    );
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  // ── how long things take ───────────────────────────────────────────────

  async resolutionStats(
    options: {
      windowDays?: number;
    } = {},
  ): Promise<ResolutionStats> {
    const windowDays = Math.min(
      MAX_STATS_WINDOW_DAYS,
      Math.max(1, Math.round(options.windowDays ?? DEFAULT_STATS_WINDOW_DAYS)),
    );
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [counts] = await this.prisma.$queryRaw<
      {
        asked: number;
        answered: number;
        unresolved: number;
        resolved: number;
        helped: number;
        didNotHelp: number;
        didNotSay: number;
      }[]
    >(Prisma.sql`
      SELECT count(*)::int AS "asked",
             count(*) FILTER (WHERE "status" = 'ANSWERED')::int   AS "answered",
             count(*) FILTER (WHERE "status" = 'UNRESOLVED')::int AS "unresolved",
             count(*) FILTER (WHERE "status" = 'RESOLVED')::int   AS "resolved",
             count(*) FILTER (WHERE "helpful" IS TRUE)::int       AS "helped",
             count(*) FILTER (WHERE "helpful" IS FALSE)::int      AS "didNotHelp",
             count(*) FILTER (WHERE "helpful" IS NULL)::int       AS "didNotSay"
      FROM "assistant_questions"
      WHERE "askedAt" >= ${since}
    `);

    const [times] = await this.prisma.$queryRaw<
      {
        counted: number;
        fastest: number | null;
        typical: number | null;
        slowest: number | null;
        nineOutOfTen: number | null;
      }[]
    >(Prisma.sql`
      SELECT count(*)::int AS "counted",
             min(EXTRACT(EPOCH FROM ("resolvedAt" - "askedAt")))::float8 AS "fastest",
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM ("resolvedAt" - "askedAt"))
             )::float8 AS "typical",
             max(EXTRACT(EPOCH FROM ("resolvedAt" - "askedAt")))::float8 AS "slowest",
             percentile_cont(0.9) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM ("resolvedAt" - "askedAt"))
             )::float8 AS "nineOutOfTen"
      FROM "assistant_questions"
      WHERE "askedAt" >= ${since} AND "resolvedAt" IS NOT NULL
    `);

    const seconds = (n: number | null | undefined): number | null =>
      n === null || n === undefined ? null : Math.round(Number(n));

    return {
      windowDays,
      asked: Number(counts?.asked ?? 0),
      answered: Number(counts?.answered ?? 0),
      unresolved: Number(counts?.unresolved ?? 0),
      resolved: Number(counts?.resolved ?? 0),
      saidItHelped: Number(counts?.helped ?? 0),
      saidItDidNotHelp: Number(counts?.didNotHelp ?? 0),
      didNotSay: Number(counts?.didNotSay ?? 0),
      resolution: {
        counted: Number(times?.counted ?? 0),
        fastestSeconds: seconds(times?.fastest),
        typicalSeconds: seconds(times?.typical),
        slowestSeconds: seconds(times?.slowest),
        nineOutOfTenWithinSeconds: seconds(times?.nineOutOfTen),
      },
    };
  }

  // ── the search query itself ────────────────────────────────────────────

  /**
   * The candidate query, built once and used by both the search and the diagnostic
   * above.
   *
   * Two ways of matching, joined with OR so the database can use BOTH indexes in
   * one pass:
   *
   *   BY WORD. Any of the meaning words, which is why the query is built from the
   *   same word list the scoring uses. Fast, and blind to a typo.
   *
   *   BY NEAR MISS. `%>` compares runs of three letters, which is what survives a
   *   typo. Written with the indexed column on the LEFT: `text %> query`. The
   *   mirror-image `query <% text` means the same thing and Postgres does rewrite
   *   it to this form, but writing it directly leaves the planner a plain index
   *   condition with no second filter to re-check on every candidate row.
   *
   * ONE TABLE, NO JOIN. Whether an answer may be shown is settled afterwards, by
   * primary key — see searchAnswers. Joining here made every search read every
   * published answer.
   *
   * The 'simple' text configuration, not 'english': English stemming and English
   * stop-word removal both do the wrong thing to Hindi typed in English letters,
   * and 'simple' behaves the same way in all three languages.
   */
  private candidateSql(text: string): Prisma.Sql {
    const words = tsQueryFor(text);
    const byNearMiss = Prisma.sql`p."text" %> ${text}::text`;
    const matches =
      words === null
        ? byNearMiss
        : Prisma.sql`(
            to_tsvector('simple', p."text") @@ ${words}::tsquery
            OR ${byNearMiss}
          )`;
    return Prisma.sql`
      SELECT p."answerEntryId"                          AS "answerEntryId",
             p."text"                                   AS "phrase",
             p."language"                               AS "phraseLanguage",
             word_similarity(${text}::text, p."text")::float8 AS "nearness"
      FROM "answer_phrases" p
      WHERE ${matches}
      ORDER BY "nearness" DESC
      LIMIT ${SEARCH_CANDIDATE_CAP}
    `;
  }

  /**
   * Run something with the near-miss threshold set to OUR number rather than the
   * database's default.
   *
   * It has to be a transaction. The setting is per connection, and Prisma hands
   * out connections from a pool, so setting it once at startup would apply to
   * whichever connection happened to receive it and to no other — a search that
   * works or does not work depending on which connection it lands on is the worst
   * kind of bug to be handed. `SET LOCAL` inside a transaction applies to exactly
   * this query and is undone the moment it ends.
   */
  private withNearMissThreshold<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    // Formatted from a numeric constant, so there is nothing here a caller could
    // influence. Guarded anyway, because this is the one string in the module that
    // reaches the database without being a parameter.
    const threshold = Number(NEAR_MISS_THRESHOLD);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new AssistantError(
        'the near-miss threshold has to be between 0 and 1',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL pg_trgm.word_similarity_threshold = ${threshold.toFixed(3)}`,
      );
      return run(tx);
    });
  }

  // ── small shared checks ────────────────────────────────────────────────

  private async mustExist(questionId: string): Promise<AssistantQuestion> {
    if (typeof questionId !== 'string' || questionId.trim() === '') {
      throw new AssistantError('no question was named');
    }
    const found = await this.prisma.assistantQuestion.findUnique({
      where: { id: questionId },
    });
    if (!found) throw new AssistantNotFoundError('no such question');
    return found;
  }

  private requireText(value: unknown, what: string, max?: number): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AssistantError(`an answer needs a ${what}`);
    }
    const trimmed = value.trim();
    if (max !== undefined && trimmed.length > max) {
      throw new AssistantError(`that ${what} is longer than ${max} characters`);
    }
    return trimmed;
  }

  /**
   * The stored wordings, tidied. Null means none were given, which is different
   * from an empty list — one leaves what is stored alone, the other clears it.
   */
  private cleanPhrases(phrases: string[] | undefined): string[] | null {
    if (phrases === undefined) return null;
    if (!Array.isArray(phrases)) {
      throw new AssistantError('the ways of asking have to be a list of text');
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of phrases) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (text === '') continue;
      if (text.length > PHRASE_MAX_LENGTH) {
        throw new AssistantError(
          `one of the ways of asking is longer than ${PHRASE_MAX_LENGTH} characters`,
        );
      }
      const seenKey = text.toLowerCase();
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      out.push(text);
    }
    if (out.length > MAX_PHRASES_PER_ANSWER) {
      throw new AssistantError(
        `one answer cannot have more than ${MAX_PHRASES_PER_ANSWER} ways of asking`,
      );
    }
    return out;
  }

  /** Turn a database complaint into something a caller can read. */
  private asAssistantError(err: unknown, fallback: string): AssistantError {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2003' || err.code === 'P2025') {
        return new AssistantError('that account does not exist');
      }
    }
    const detail = err instanceof Error ? err.message : String(err);
    return new AssistantError(`${fallback}: ${detail}`);
  }
}
