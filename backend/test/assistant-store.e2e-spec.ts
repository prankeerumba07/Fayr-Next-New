import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { AssistantError } from '../src/assistant/assistant.types';
import { resetDatabase } from './reset-db';

/**
 * THE STORE THE ASSISTANT LEARNS FROM.
 *
 * Everything here needs a real database, and most of it needs a real database
 * with a lot in it. The judgement calls — which phrase is closest, which words
 * matter — are unit-tested next to the pure functions that make them. What can
 * only be proved here is that the storage keeps what a person actually typed, and
 * that finding one answer among tens of thousands of stored phrasings does not
 * turn into reading all of them.
 */
describe('Assistant store (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: AssistantStore;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const makeUser = async (): Promise<string> =>
    (await prisma.user.create({ data: { mobile: newMobile() } })).id;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    store = app.get(AssistantStore);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Assistant store e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('keeping what a person actually typed', () => {
    it('stores the words exactly as they came, spelling and all', async () => {
      const userId = await makeUser();
      const typed = '  MY refnud has NOT come!!!   why??  ';
      const q = await store.recordQuestion({ userId, rawText: typed });

      // Not trimmed, not corrected, not tidied. Tomorrow's answer gets written
      // from these words and a cleaned-up copy would hide the most useful part.
      expect(q.rawText).toBe(typed);
    });

    it('records which language it looks like, and how sure that is', async () => {
      const userId = await makeUser();
      const english = await store.recordQuestion({
        userId,
        rawText: 'when will my refund arrive',
      });
      const hinglish = await store.recordQuestion({
        userId,
        rawText: 'mera refund kab aayega',
      });
      const hindi = await store.recordQuestion({
        userId,
        rawText: 'मेरा पैसा कब आएगा',
      });

      expect(english.detectedLanguage).toBe('en');
      expect(hinglish.detectedLanguage).toBe('hi-en');
      expect(hindi.detectedLanguage).toBe('hi');
      for (const q of [english, hinglish, hindi]) {
        expect(q.languageConfidence).toBeGreaterThan(0);
        expect(q.languageConfidence).toBeLessThanOrEqual(100);
      }
    });

    it('starts life as nobody having answered it', async () => {
      const userId = await makeUser();
      const q = await store.recordQuestion({ userId, rawText: 'help me' });
      expect(q.status).toBe('UNRESOLVED');
      expect(q.answerOrigin).toBe('NONE');
      expect(q.answerText).toBeNull();
      expect(q.helpful).toBeNull();
      expect(q.resolvedAt).toBeNull();
    });

    it('keeps what the person was doing when they asked', async () => {
      const userId = await makeUser();
      const journey = {
        steps: [{ what: 'claimed an offer', when: 'yesterday' }],
      };
      const q = await store.recordQuestion({
        userId,
        rawText: 'stuck',
        journey,
      });
      expect(q.journey).toEqual(journey);
    });

    it('refuses a question with nothing in it', async () => {
      const userId = await makeUser();
      for (const empty of ['', '   ', '\n\t ']) {
        await expect(
          store.recordQuestion({ userId, rawText: empty }),
        ).rejects.toBeInstanceOf(AssistantError);
      }
    });

    it('refuses something that is not text at all', async () => {
      const userId = await makeUser();
      for (const junk of [null, undefined, 42, {}, []]) {
        await expect(
          store.recordQuestion({ userId, rawText: junk as unknown as string }),
        ).rejects.toBeInstanceOf(AssistantError);
      }
    });

    it('refuses a question longer than anyone would type', async () => {
      const userId = await makeUser();
      await expect(
        store.recordQuestion({ userId, rawText: 'a'.repeat(5000) }),
      ).rejects.toBeInstanceOf(AssistantError);
    });

    it('refuses a question from somebody who does not exist', async () => {
      await expect(
        store.recordQuestion({
          userId: '00000000-0000-4000-8000-000000000000',
          rawText: 'hello',
        }),
      ).rejects.toBeInstanceOf(AssistantError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('what we said back', () => {
    async function seedAnswer() {
      return store.saveAnswer({
        key: 'refund-not-arrived',
        language: 'en',
        title: 'Your refund has not arrived',
        body: 'We send your money back after your review is live and the return window has closed.',
        topic: 'refund',
        status: 'PUBLISHED',
        phrases: ['when will my refund arrive', 'refund not received'],
      });
    }

    it('keeps the reply as shown, even after the answer is rewritten', async () => {
      const userId = await makeUser();
      const answer = await seedAnswer();
      const q = await store.recordQuestion({
        userId,
        rawText: 'when will my refund arrive',
      });
      await store.recordAnswer(q.id, {
        answerEntryId: answer.id,
        answerText: answer.body,
        origin: 'ANSWER_BOOK',
        matchScore: 97,
        answerRevision: answer.revision,
      });

      // Somebody improves the wording afterwards.
      await store.saveAnswer({
        key: 'refund-not-arrived',
        language: 'en',
        title: 'Your refund has not arrived',
        body: 'Completely different words now.',
        topic: 'refund',
        status: 'PUBLISHED',
      });

      const after = await store.getQuestion(q.id);
      expect(after.answerText).toContain('return window has closed');
      expect(after.answerRevision).toBe(1);
      // And it still points at the answer, so staff can see what it became.
      expect(after.answerEntryId).toBe(answer.id);
    });

    it('counts a reply as answered', async () => {
      const userId = await makeUser();
      const answer = await seedAnswer();
      const q = await store.recordQuestion({ userId, rawText: 'refund?' });
      const after = await store.recordAnswer(q.id, {
        answerEntryId: answer.id,
        answerText: answer.body,
        origin: 'ANSWER_BOOK',
        matchScore: 80,
        answerRevision: 1,
      });
      expect(after.status).toBe('ANSWERED');
      expect(after.matchScore).toBe(80);
    });

    it('leaves a question unresolved when nothing matched', async () => {
      const userId = await makeUser();
      const q = await store.recordQuestion({
        userId,
        rawText: 'can I pay with a gift card',
      });
      const after = await store.recordAnswer(q.id, {
        answerText: 'I could not answer this yet. A person will look at it.',
        origin: 'NONE',
      });
      expect(after.status).toBe('UNRESOLVED');
      expect(after.answerEntryId).toBeNull();
      expect(after.matchScore).toBeNull();
      // The honest reply is still recorded — we said something, and what we said
      // has to be readable later.
      expect(after.answerText).toContain('could not answer');
    });

    it('refuses a score that is not a percentage', async () => {
      const userId = await makeUser();
      const q = await store.recordQuestion({ userId, rawText: 'refund?' });
      for (const bad of [-1, 101, 1.5, NaN]) {
        await expect(
          store.recordAnswer(q.id, { origin: 'ANSWER_BOOK', matchScore: bad }),
        ).rejects.toBeInstanceOf(AssistantError);
      }
    });

    it('refuses to answer a question that does not exist', async () => {
      await expect(
        store.recordAnswer('00000000-0000-4000-8000-000000000000', {
          origin: 'NONE',
          answerText: 'x',
        }),
      ).rejects.toBeInstanceOf(AssistantError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('did it help', () => {
    async function answeredQuestion(): Promise<string> {
      const userId = await makeUser();
      const q = await store.recordQuestion({ userId, rawText: 'refund late' });
      await store.recordAnswer(q.id, {
        origin: 'ANSWER_BOOK',
        answerText: 'Here is why.',
        matchScore: 90,
      });
      return q.id;
    }

    it('closes the question when the person says it helped', async () => {
      const id = await answeredQuestion();
      const after = await store.recordHelpful(id, true);
      expect(after.helpful).toBe(true);
      expect(after.helpfulAt).toBeInstanceOf(Date);
      expect(after.status).toBe('RESOLVED');
      expect(after.resolvedAt).toBeInstanceOf(Date);
    });

    it('puts it back in the queue when the person says it did not', async () => {
      const id = await answeredQuestion();
      const after = await store.recordHelpful(id, false);
      expect(after.helpful).toBe(false);
      expect(after.status).toBe('UNRESOLVED');
      // Not resolved, so it must not count towards how fast things get resolved.
      expect(after.resolvedAt).toBeNull();
    });

    it('lets someone change their mind', async () => {
      const id = await answeredQuestion();
      await store.recordHelpful(id, true);
      const after = await store.recordHelpful(id, false);
      expect(after.status).toBe('UNRESOLVED');
      expect(after.resolvedAt).toBeNull();
    });

    it('refuses anything that is not yes or no', async () => {
      const id = await answeredQuestion();
      for (const junk of ['yes', 1, null, undefined]) {
        await expect(
          store.recordHelpful(id, junk as unknown as boolean),
        ).rejects.toBeInstanceOf(AssistantError);
      }
    });

    it('lets a person close it instead', async () => {
      const id = await answeredQuestion();
      const staff = await prisma.staffUser.create({
        data: {
          email: `s${Date.now()}${seq++}@fayr.local`,
          passwordHash: 'x',
          name: 'Support',
          role: 'SUPPORT',
        },
      });
      const after = await store.resolveByStaff(id, staff.id);
      expect(after.status).toBe('RESOLVED');
      expect(after.resolvedByStaffId).toBe(staff.id);
      expect(after.resolvedAt).toBeInstanceOf(Date);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('the answer book', () => {
    it('stores one answer with many ways of asking for it', async () => {
      const answer = await store.saveAnswer({
        key: 'refund-timing',
        language: 'en',
        title: 'When your money comes back',
        body: 'After your review is live and the return window has closed.',
        topic: 'refund',
        status: 'PUBLISHED',
        phrases: [
          'when will my refund arrive',
          'refund not received',
          'where is my money',
        ],
      });
      const phrases = await prisma.answerPhrase.count({
        where: { answerEntryId: answer.id },
      });
      expect(phrases).toBe(3);
    });

    it('carries the same answer in another language as more rows, not more code', async () => {
      const shared = {
        key: 'refund-timing',
        topic: 'refund',
        status: 'PUBLISHED' as const,
      };
      await store.saveAnswer({
        ...shared,
        language: 'en',
        title: 'When your money comes back',
        body: 'After your review is live and the return window has closed.',
        phrases: ['when will my refund arrive'],
      });
      await store.saveAnswer({
        ...shared,
        language: 'hi-en',
        title: 'Paisa kab wapas aayega',
        body: 'Jab aapka review live ho jaye aur return window band ho jaye.',
        phrases: ['mera refund kab aayega'],
      });

      const both = await prisma.answerEntry.findMany({
        where: { key: 'refund-timing' },
      });
      expect(both).toHaveLength(2);
      expect(both.map((a) => a.language).sort()).toEqual(['en', 'hi-en']);
    });

    it('counts a new wording as a new revision', async () => {
      const first = await store.saveAnswer({
        key: 'tickets',
        language: 'en',
        title: 'Tickets',
        body: 'You start with fifteen tickets.',
        topic: 'tickets',
      });
      expect(first.revision).toBe(1);

      const second = await store.saveAnswer({
        key: 'tickets',
        language: 'en',
        title: 'Tickets',
        body: 'You start with fifteen tickets, and joining an offer uses five.',
        topic: 'tickets',
      });
      expect(second.id).toBe(first.id);
      expect(second.revision).toBe(2);
    });

    it('does not count saving the same words again as a change', async () => {
      const draft = {
        key: 'tickets',
        language: 'en',
        title: 'Tickets',
        body: 'You start with fifteen tickets.',
        topic: 'tickets',
      };
      await store.saveAnswer(draft);
      const again = await store.saveAnswer(draft);
      expect(again.revision).toBe(1);
    });

    it('replaces the wordings rather than piling them up', async () => {
      const draft = {
        key: 'tickets',
        language: 'en',
        title: 'Tickets',
        body: 'You start with fifteen tickets.',
        topic: 'tickets',
      };
      await store.saveAnswer({
        ...draft,
        phrases: ['how many tickets', 'tickets'],
      });
      const answer = await store.saveAnswer({
        ...draft,
        phrases: ['what are tickets'],
      });
      const phrases = await prisma.answerPhrase.findMany({
        where: { answerEntryId: answer.id },
      });
      expect(phrases.map((p) => p.text)).toEqual(['what are tickets']);
    });

    it('leaves the wordings alone when none are given', async () => {
      const draft = {
        key: 'tickets',
        language: 'en',
        title: 'Tickets',
        body: 'You start with fifteen tickets.',
        topic: 'tickets',
      };
      const answer = await store.saveAnswer({ ...draft, phrases: ['tickets'] });
      await store.saveAnswer({ ...draft, body: 'Changed.' });
      const phrases = await prisma.answerPhrase.count({
        where: { answerEntryId: answer.id },
      });
      expect(phrases).toBe(1);
    });

    it('throws away duplicate and blank wordings', async () => {
      const answer = await store.saveAnswer({
        key: 'tickets',
        language: 'en',
        title: 'Tickets',
        body: 'Fifteen to start.',
        topic: 'tickets',
        phrases: ['tickets', 'tickets', '  ', '', 'TICKETS'],
      });
      const phrases = await prisma.answerPhrase.findMany({
        where: { answerEntryId: answer.id },
      });
      expect(phrases).toHaveLength(1);
    });

    it('refuses an answer with no words in it', async () => {
      const base = {
        key: 'x',
        language: 'en',
        title: 'Title',
        body: 'Body',
        topic: 'refund',
      };
      for (const broken of [
        { ...base, body: '   ' },
        { ...base, title: '' },
        { ...base, topic: '' },
        { ...base, key: '' },
      ]) {
        await expect(store.saveAnswer(broken)).rejects.toBeInstanceOf(
          AssistantError,
        );
      }
    });

    it('refuses a language it has no name for', async () => {
      await expect(
        store.saveAnswer({
          key: 'x',
          language: 'fr',
          title: 'Title',
          body: 'Body',
          topic: 'refund',
        }),
      ).rejects.toBeInstanceOf(AssistantError);
    });

    it('refuses a key that is not a plain short name', async () => {
      for (const bad of [
        'Has Spaces',
        'UPPER',
        'has_underscore',
        'a'.repeat(200),
      ]) {
        await expect(
          store.saveAnswer({
            key: bad,
            language: 'en',
            title: 'Title',
            body: 'Body',
            topic: 'refund',
          }),
        ).rejects.toBeInstanceOf(AssistantError);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('finding the right answer', () => {
    beforeEach(async () => {
      await store.saveAnswer({
        key: 'refund-timing',
        language: 'en',
        title: 'When your money comes back',
        body: 'After your review is live and the return window has closed.',
        topic: 'refund',
        status: 'PUBLISHED',
        phrases: ['when will my refund arrive', 'refund not received'],
      });
      await store.saveAnswer({
        key: 'refund-timing',
        language: 'hi-en',
        title: 'Paisa kab wapas aayega',
        body: 'Jab aapka review live ho jaye aur return window band ho jaye.',
        topic: 'refund',
        status: 'PUBLISHED',
        phrases: ['mera refund kab aayega', 'paisa kab milega'],
      });
      await store.saveAnswer({
        key: 'review-not-found',
        language: 'en',
        title: 'We cannot see your review',
        body: 'Your review has to be visible on the product page for anyone to see it.',
        topic: 'review',
        status: 'PUBLISHED',
        phrases: ['my review is not showing', 'review not detected'],
      });
      await store.saveAnswer({
        key: 'draft-answer',
        language: 'en',
        title: 'Not finished yet',
        body: 'This answer is still being written and nobody should ever see it.',
        topic: 'refund',
        status: 'DRAFT',
        phrases: ['when will my refund arrive'],
      });
    });

    it('finds an answer from the words in the question', async () => {
      const hits = await store.searchAnswers({
        text: 'when will my refund arrive',
      });
      expect(hits[0].answer.key).toBe('refund-timing');
      expect(hits[0].score).toBeGreaterThan(60);
    });

    it('still finds it when the question is misspelled', async () => {
      const hits = await store.searchAnswers({ text: 'refnud not recieved' });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].answer.key).toBe('refund-timing');
    });

    it('finds the Hindi wording for a Hindi question', async () => {
      const hits = await store.searchAnswers({
        text: 'mera refund kab aayega',
      });
      expect(hits[0].answer.key).toBe('refund-timing');
      expect(hits[0].answer.language).toBe('hi-en');
    });

    it('tells the different questions apart', async () => {
      const hits = await store.searchAnswers({
        text: 'my review is not showing',
      });
      expect(hits[0].answer.key).toBe('review-not-found');
    });

    it('never offers an answer that is not published', async () => {
      const hits = await store.searchAnswers({
        text: 'when will my refund arrive',
      });
      expect(hits.map((h) => h.answer.key)).not.toContain('draft-answer');
    });

    it('returns each answer once, not once per wording', async () => {
      const hits = await store.searchAnswers({
        text: 'refund not received arrive',
      });
      const keys = hits.map((h) => `${h.answer.key}:${h.answer.language}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('says in plain words why each one matched', async () => {
      const hits = await store.searchAnswers({ text: 'refund not received' });
      for (const h of hits) {
        expect(['the same words', 'a near miss', 'both']).toContain(h.how);
        expect(h.matchedPhrase.length).toBeGreaterThan(0);
      }
    });

    it('returns nothing rather than guessing when there is nothing to search for', async () => {
      for (const junk of ['', '   ', '!!!', '12345']) {
        expect(await store.searchAnswers({ text: junk })).toEqual([]);
      }
    });

    it('returns nothing when the question is about something we have no answer for', async () => {
      const hits = await store.searchAnswers({
        text: 'do you deliver to Nepal',
      });
      // It may offer a weak candidate, but nothing may look like a good match.
      for (const h of hits) expect(h.score).toBeLessThan(50);
    });

    it('never returns more than it was asked for', async () => {
      const hits = await store.searchAnswers({
        text: 'refund review money',
        limit: 1,
      });
      expect(hits).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('with a large number of records', () => {
    const BULK_ANSWERS = 4_000;
    const WORDINGS_EACH = 25;

    beforeEach(async () => {
      // The one real answer we will go looking for afterwards.
      await store.saveAnswer({
        key: 'refund-timing',
        language: 'en',
        title: 'When your money comes back',
        body: 'After your review is live and the return window has closed.',
        topic: 'refund',
        status: 'PUBLISHED',
        phrases: ['when will my refund arrive', 'refund not received'],
      });

      // And a hundred thousand stored wordings around it. Written straight to the
      // database on purpose: the point is the volume, not the write path.
      await prisma.$executeRawUnsafe(`
        INSERT INTO "answer_entries"
          (id, key, language, title, body, topic, status, origin, revision, "createdAt", "updatedAt")
        SELECT gen_random_uuid(), 'bulk-' || i, 'en',
               'Answer number ' || i,
               'This answer is about parcels and deliveries, number ' || i || '.',
               'other', 'PUBLISHED', 'SEED', 1, now(), now()
        FROM generate_series(1, ${BULK_ANSWERS}) i
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "answer_phrases" (id, "answerEntryId", "text", language, "createdAt")
        SELECT gen_random_uuid(), e.id,
               'parcel question ' || e.key || ' wording ' || v || ' about a delivery',
               'en', now()
        FROM "answer_entries" e, generate_series(1, ${WORDINGS_EACH}) v
        WHERE e.key LIKE 'bulk-%'
      `);
      await prisma.$executeRawUnsafe('ANALYZE "answer_phrases"');
      await prisma.$executeRawUnsafe('ANALYZE "answer_entries"');
      // An explicit budget, because the default one was never a decision about
      // this. Building four thousand answers and a hundred thousand wordings takes
      // a few seconds on a quiet machine and longer on a busy one, and it had been
      // passing under the five-second default by a margin that eventually ran out
      // mid-run. Nothing about what is asserted changes: only how long the setup
      // is allowed to take before it is called a failure.
    }, 60_000);

    it('really does hold that many', async () => {
      expect(await prisma.answerEntry.count()).toBe(BULK_ANSWERS + 1);
      expect(await prisma.answerPhrase.count()).toBe(
        BULK_ANSWERS * WORDINGS_EACH + 2,
      );
    });

    it('still finds the one right answer', async () => {
      const hits = await store.searchAnswers({
        text: 'when will my refund arrive',
      });
      expect(hits[0].answer.key).toBe('refund-timing');
    });

    it('still finds it through a typo', async () => {
      const hits = await store.searchAnswers({ text: 'refnud not recieved' });
      expect(hits[0].answer.key).toBe('refund-timing');
    });

    it('does not read the whole table to do it', async () => {
      // THE POINT OF THIS WHOLE PHASE. The plan the database chose must reach the
      // rows through the two indexes. If this ever reads the table end to end, the
      // design has stopped scaling and every question gets slower as the answer
      // book grows.
      const plan = await store.explainSearch('refnud not recieved');
      expect(plan).toMatch(/Index Scan|Bitmap Index Scan/);
      expect(plan).not.toMatch(/Seq Scan on answer_phrases/);
      // And not the answers table either. Joining the two here used to make every
      // search read every published answer — invisible at thirteen answers, and a
      // read that grows for ever once there are thousands.
      expect(plan).not.toMatch(/Seq Scan on answer_entries/);
    });

    it('answers fast enough that a person would not notice', async () => {
      const started = Date.now();
      await store.searchAnswers({ text: 'when will my refund arrive' });
      const took = Date.now() - started;
      // Generous on purpose: this is a floor under a catastrophe, not a benchmark.
      expect(took).toBeLessThan(2_000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('with a large number of questions', () => {
    const QUESTIONS = 5_000;

    beforeEach(async () => {
      const userId = await makeUser();
      await prisma.$executeRawUnsafe(`
        INSERT INTO "assistant_questions"
          (id, "userId", "rawText", "detectedLanguage", "languageConfidence",
           "askedAt", "answerOrigin", status)
        SELECT gen_random_uuid(), '${userId}'::uuid,
               'question number ' || i, 'en', 60,
               now() - (i || ' minutes')::interval,
               'NONE', 'UNRESOLVED'
        FROM generate_series(1, ${QUESTIONS}) i
      `);
      await prisma.$executeRawUnsafe('ANALYZE "assistant_questions"');
    });

    it('hands back one page, not five thousand rows', async () => {
      const page = await store.listQuestions({
        status: 'UNRESOLVED',
        limit: 50,
        offset: 0,
      });
      expect(page.questions).toHaveLength(50);
      expect(page.total).toBe(QUESTIONS);
      expect(page.limit).toBe(50);
    });

    it('shows the newest first', async () => {
      const page = await store.listQuestions({ limit: 5, offset: 0 });
      const times = page.questions.map((q) => q.askedAt.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('finds the page through an index rather than reading everything', async () => {
      const plan = await store.explainQuestionQueue('UNRESOLVED', 50);
      expect(plan).not.toMatch(/Seq Scan on assistant_questions/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('how long things take', () => {
    it('counts what happened and how long resolving took', async () => {
      const userId = await makeUser();
      const asked = new Date(Date.now() - 60 * 60 * 1000);

      // Three resolved, at 10, 20 and 60 minutes; one still open.
      for (const minutes of [10, 20, 60]) {
        const q = await prisma.assistantQuestion.create({
          data: {
            userId,
            rawText: `resolved after ${minutes}`,
            detectedLanguage: 'en',
            languageConfidence: 60,
            askedAt: asked,
            answerOrigin: 'ANSWER_BOOK',
            answerText: 'here you go',
            status: 'RESOLVED',
            helpful: true,
            resolvedAt: new Date(asked.getTime() + minutes * 60 * 1000),
          },
        });
        expect(q.id).toBeTruthy();
      }
      await prisma.assistantQuestion.create({
        data: {
          userId,
          rawText: 'still stuck',
          detectedLanguage: 'en',
          languageConfidence: 60,
          askedAt: asked,
          status: 'UNRESOLVED',
        },
      });

      const stats = await store.resolutionStats({ windowDays: 30 });
      expect(stats.asked).toBe(4);
      expect(stats.resolved).toBe(3);
      expect(stats.unresolved).toBe(1);
      expect(stats.saidItHelped).toBe(3);
      expect(stats.resolution.counted).toBe(3);
      expect(stats.resolution.fastestSeconds).toBe(600);
      expect(stats.resolution.typicalSeconds).toBe(1_200);
      expect(stats.resolution.slowestSeconds).toBe(3_600);
    });

    it('says nothing rather than zero when nothing has been resolved', async () => {
      const stats = await store.resolutionStats({ windowDays: 30 });
      expect(stats.asked).toBe(0);
      expect(stats.resolution.counted).toBe(0);
      expect(stats.resolution.typicalSeconds).toBeNull();
      expect(stats.resolution.fastestSeconds).toBeNull();
    });

    it('only counts the days asked for', async () => {
      const userId = await makeUser();
      await prisma.assistantQuestion.create({
        data: {
          userId,
          rawText: 'ancient',
          detectedLanguage: 'en',
          languageConfidence: 60,
          askedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          status: 'UNRESOLVED',
        },
      });
      expect((await store.resolutionStats({ windowDays: 7 })).asked).toBe(0);
      expect((await store.resolutionStats({ windowDays: 365 })).asked).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('what the database itself refuses', () => {
    it('refuses a confidence that is not a percentage, even written directly', async () => {
      const userId = await makeUser();
      await expect(
        prisma.assistantQuestion.create({
          data: {
            userId,
            rawText: 'sneaking past the service',
            detectedLanguage: 'en',
            languageConfidence: 500,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a blank question, even written directly', async () => {
      const userId = await makeUser();
      await expect(
        prisma.assistantQuestion.create({
          data: {
            userId,
            rawText: '   ',
            detectedLanguage: 'en',
            languageConfidence: 60,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses an answer with an empty body, even written directly', async () => {
      await expect(
        prisma.answerEntry.create({
          data: {
            key: 'sneaky',
            language: 'en',
            title: 'Title',
            body: '  ',
            topic: 'refund',
          },
        }),
      ).rejects.toThrow();
    });
  });
});
