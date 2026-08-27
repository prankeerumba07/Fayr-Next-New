import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnswerEngine } from '../src/assistant/answer-engine.service';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { CANNOT_ANSWER_YET } from '../src/assistant/answer-engine.rules';
import { ANSWER_DRAFTS } from '../src/assistant/answer-drafts';
import { checkPlainLanguage } from '../src/assistant/plain-language';
import { resetDatabase } from './reset-db';

/**
 * THE ENGINE, AGAINST THE REAL ANSWER BOOK.
 *
 * The deciding is unit-tested next to the pure code. What can only be proved here
 * is whether the twenty drafted answers, seeded into a real database and searched
 * with the real indexes, actually answer the questions people ask — in all three
 * languages, and with the typos people really type.
 *
 * And the two refusals. Nothing may be invented when there is no answer, and
 * nothing may be sent that does not read plainly, whatever is stored.
 */
describe('Answer engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: AnswerEngine;
  let seed: AssistantSeedService;
  let store: AssistantStore;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function makeUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  /** Publish everything the assistant drafted, so the engine has a book to read. */
  async function publishAllDrafts(): Promise<void> {
    await seed.seedDrafts();
    await prisma.answerEntry.updateMany({
      where: { origin: 'ASSISTANT' },
      data: { status: 'PUBLISHED' },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    engine = app.get(AnswerEngine);
    seed = app.get(AssistantSeedService);
    store = app.get(AssistantStore);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Answer engine e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('putting the drafted answers in the book', () => {
    it('puts every one in, as a draft, marked as written by the assistant', async () => {
      const report = await seed.seedDrafts();
      expect(report.refused).toEqual([]);
      expect(report.created).toBe(ANSWER_DRAFTS.length * 3);

      const all = await prisma.answerEntry.findMany();
      expect(all).toHaveLength(ANSWER_DRAFTS.length * 3);
      for (const entry of all) {
        // NEVER published from the seed. A person has to approve each one.
        expect(entry.status).toBe('DRAFT');
        expect(entry.origin).toBe('ASSISTANT');
      }
    });

    it('stores the ways of asking alongside them', async () => {
      await seed.seedDrafts();
      const phrases = await prisma.answerPhrase.count();
      expect(phrases).toBeGreaterThan(ANSWER_DRAFTS.length * 3);
    });

    it('running it twice changes nothing', async () => {
      await seed.seedDrafts();
      const again = await seed.seedDrafts();
      expect(again.created).toBe(0);
      expect(again.updated).toBe(ANSWER_DRAFTS.length * 3);
      expect(await prisma.answerEntry.count()).toBe(ANSWER_DRAFTS.length * 3);
    });

    it('never undoes a correction a person made', async () => {
      await seed.seedDrafts();
      const mine = await prisma.answerEntry.findFirstOrThrow({
        where: { key: 'tickets', language: 'en' },
      });
      await store.saveAnswer({
        key: 'tickets',
        language: 'en',
        title: 'Tickets, in my own words',
        body: 'A person wrote this and it must survive every restart from now on.',
        topic: 'tickets',
        status: 'PUBLISHED',
        origin: 'STAFF',
      });

      const report = await seed.seedDrafts();
      expect(report.leftAlone).toBeGreaterThan(0);

      const after = await prisma.answerEntry.findUniqueOrThrow({
        where: { id: mine.id },
      });
      expect(after.body).toContain('A person wrote this');
      expect(after.origin).toBe('STAFF');
      expect(after.status).toBe('PUBLISHED');
    });

    it('leaves an approved answer alone even if the assistant wrote it', async () => {
      await seed.seedDrafts();
      const entry = await prisma.answerEntry.findFirstOrThrow({
        where: { key: 'tickets', language: 'en' },
      });
      await prisma.answerEntry.update({
        where: { id: entry.id },
        data: {
          status: 'PUBLISHED',
          body: 'Approved wording, edited on the way through.',
        },
      });

      await seed.seedDrafts();
      const after = await prisma.answerEntry.findUniqueOrThrow({
        where: { id: entry.id },
      });
      expect(after.body).toContain('Approved wording');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('answering real questions', () => {
    beforeEach(publishAllDrafts);

    const shouldFind: [string, string][] = [
      ['when will my refund arrive', 'refund-not-arrived'],
      ['my refund has not arrived', 'refund-not-arrived'],
      ['what are tickets', 'tickets'],
      ['how many tickets do i have', 'tickets'],
      ['my review is not being detected', 'review-not-found'],
      ['my order was not found', 'order-not-found'],
      ['how do i take my money out', 'wallet-and-withdrawals'],
      ['can i use a gift card', 'how-to-pay'],
      ['do i have to give five stars', 'honest-reviews'],
      ['do you know my amazon password', 'we-never-see-your-shop-password'],
      ['how do i delete my account', 'delete-my-account'],
      ['do you sell my data', 'who-else-sees-my-details'],
    ];

    for (const [question, expectedKey] of shouldFind) {
      it(`answers "${question}" from "${expectedKey}"`, async () => {
        const user = await makeUser();
        const result = await engine.ask(user.id, question);
        expect(result.answered).toBe(true);
        const used = await prisma.answerEntry.findUniqueOrThrow({
          where: { id: result.answerEntryId! },
        });
        expect(used.key).toBe(expectedKey);
      });
    }

    it('answers a Hindi question with the Hindi wording', async () => {
      const user = await makeUser();
      const result = await engine.ask(user.id, 'मेरा पैसा कब आएगा');
      expect(result.answered).toBe(true);
      expect(result.language).toBe('hi');
      expect(result.answer).toMatch(/[ऀ-ॿ]/);
    });

    it('answers Hindi typed in English letters with that wording', async () => {
      const user = await makeUser();
      const result = await engine.ask(user.id, 'mera refund kab aayega');
      expect(result.answered).toBe(true);
      expect(result.language).toBe('hi-en');
      // Not Devanagari, and not the English one either.
      expect(result.answer).not.toMatch(/[ऀ-ॿ]/);
      expect(result.answer.toLowerCase()).toMatch(/paisa|aapka|hum/);
    });

    it('answers through a typo', async () => {
      const user = await makeUser();
      const result = await engine.ask(user.id, 'my refnud has not arived');
      expect(result.answered).toBe(true);
    });

    it('answers a question typed in a hurry, with no punctuation', async () => {
      const user = await makeUser();
      const result = await engine.ask(user.id, 'WHERE IS MY REFUND');
      expect(result.answered).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('when it does not know', () => {
    beforeEach(publishAllDrafts);

    it('says so, and does not offer the nearest thing instead', async () => {
      const user = await makeUser();
      const result = await engine.ask(
        user.id,
        'do you deliver washing machines to Kathmandu on a Sunday',
      );
      expect(result.answered).toBe(false);
      expect(result.answer).toBe(CANNOT_ANSWER_YET.en);
      expect(result.answerEntryId).toBeNull();
    });

    it('records it as unresolved, so a person picks it up', async () => {
      const user = await makeUser();
      const result = await engine.ask(user.id, 'do you deliver to Kathmandu');
      const stored = await store.getQuestion(result.questionId);
      expect(stored.status).toBe('UNRESOLVED');
      expect(stored.answerOrigin).toBe('NONE');
      // What we said is still written down. We did reply, and what we replied
      // has to be readable later.
      expect(stored.answerText).toBe(CANNOT_ANSWER_YET.en);
    });

    it('says it in Hindi to somebody who wrote in Hindi', async () => {
      const user = await makeUser();
      const result = await engine.ask(user.id, 'क्या आप काठमांडू भेजते हैं');
      expect(result.answered).toBe(false);
      expect(result.answer).toBe(CANNOT_ANSWER_YET.hi);
    });

    it('never answers from an unapproved draft', async () => {
      // The whole point of DRAFT. Seed the book and approve nothing.
      await prisma.answerEntry.updateMany({ data: { status: 'DRAFT' } });
      const user = await makeUser();
      const result = await engine.ask(user.id, 'when will my refund arrive');
      expect(result.answered).toBe(false);
      expect(result.answerEntryId).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('the plain-language rule at the last gate', () => {
    beforeEach(publishAllDrafts);

    it('every answer it can give reads plainly', async () => {
      const user = await makeUser();
      const questions = [
        'when will my refund arrive',
        'what are tickets',
        'मेरा पैसा कब आएगा',
        'mera refund kab aayega',
        'do you deliver to Kathmandu',
        'how do i delete my account',
      ];
      for (const question of questions) {
        const result = await engine.ask(user.id, question);
        const check = checkPlainLanguage(result.answer, result.language);
        if (!check.ok) {
          throw new Error(
            `the engine replied to "${question}" with something that breaks the rule: ` +
              check.problems.map((p) => p.detail).join(' | '),
          );
        }
      }
    });

    it('holds back a published answer that does not read plainly', async () => {
      // Somebody approves a bad answer. It still never reaches a person.
      await store.saveAnswer({
        key: 'bad-wording',
        language: 'en',
        title: 'Clawback of remittances',
        body: 'The API endpoint will authenticate your credentials -- e.g. HOLDING.',
        topic: 'refund',
        status: 'PUBLISHED',
        origin: 'STAFF',
        phrases: ['clawback of remittances pursuant to the stipulated terms'],
      });

      const user = await makeUser();
      const result = await engine.ask(
        user.id,
        'clawback of remittances pursuant to the stipulated terms',
      );
      expect(result.answered).toBe(false);
      expect(result.answer).toBe(CANNOT_ANSWER_YET.en);
      expect(result.because).toMatch(/plainly/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('using what the person was doing', () => {
    beforeEach(publishAllDrafts);

    it('records the journey on the question it answered', async () => {
      const user = await makeUser();
      const result = await engine.ask(
        user.id,
        'what is happening with my offer',
      );
      const stored = await store.getQuestion(result.questionId);
      expect(stored.journey).not.toBeNull();
    });

    it('refuses honestly for an account that does not exist', async () => {
      // No such account, so there is no journey to read AND no question to write
      // down. That must be an honest error, never a silent nothing that looks
      // like a reply nobody received.
      await expect(
        engine.ask(
          '00000000-0000-4000-8000-000000000000',
          'when will my refund arrive',
        ),
      ).rejects.toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('swapping the answer source', () => {
    beforeEach(publishAllDrafts);

    it('turning the model on today changes nothing at all', async () => {
      // The placeholder returns nothing, so the chain falls through to the answer
      // book and the same question gets the same answer.
      const user = await makeUser();
      const before = await engine.ask(user.id, 'what are tickets');

      const spy = jest
        .spyOn(app.get(ConfigService), 'get')
        .mockImplementation((key: string, ...rest: unknown[]) => {
          if (key === 'ASSISTANT_ANSWER_SOURCE') return 'model';
          return (
            ConfigService.prototype.get as never as (...a: unknown[]) => unknown
          ).call(config, key, ...rest);
        });
      try {
        const after = await engine.ask(user.id, 'what are tickets');
        expect(after.answered).toBe(true);
        expect(after.answerEntryId).toBe(before.answerEntryId);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('over the wire, from the app', () => {
    beforeEach(publishAllDrafts);

    it('asks, answers, and comes back with the language named in words', async () => {
      const user = await makeUser();
      const res = await request(app.getHttpServer())
        .post('/assistant/ask')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ question: 'mera refund kab aayega' })
        .expect(201);

      expect(res.body.answered).toBe(true);
      expect(res.body.languageName).toBe('Hindi written in English letters');
      expect(res.body.questionId).toBeTruthy();
      // The engine's own reasoning is for staff, not for the person asking.
      expect(res.body.because).toBeUndefined();
      expect(res.body.from).toBeUndefined();
    });

    it('takes a yes or no on whether it helped', async () => {
      const user = await makeUser();
      const asked = await request(app.getHttpServer())
        .post('/assistant/ask')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ question: 'what are tickets' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/assistant/questions/${asked.body.questionId}/helpful`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ helpful: true })
        .expect(200);

      const stored = await store.getQuestion(asked.body.questionId);
      expect(stored.helpful).toBe(true);
      expect(stored.status).toBe('RESOLVED');
    });

    it('puts it back in the queue when somebody says it did not help', async () => {
      const user = await makeUser();
      const asked = await request(app.getHttpServer())
        .post('/assistant/ask')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ question: 'what are tickets' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/assistant/questions/${asked.body.questionId}/helpful`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ helpful: false })
        .expect(200);

      const stored = await store.getQuestion(asked.body.questionId);
      expect(stored.status).toBe('UNRESOLVED');
    });

    it("lists only this person's own questions", async () => {
      const me = await makeUser();
      const someoneElse = await makeUser();
      await engine.ask(me.id, 'what are tickets');
      await engine.ask(
        someoneElse.id,
        'their private question about their money',
      );

      const res = await request(app.getHttpServer())
        .get('/assistant/questions')
        .set('Authorization', `Bearer ${me.token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].question).toBe('what are tickets');
      expect(JSON.stringify(res.body)).not.toContain('their private question');
    });

    it("refuses to let one person mark another person's question as helpful", async () => {
      const me = await makeUser();
      const someoneElse = await makeUser();
      const theirs = await engine.ask(someoneElse.id, 'their question');

      await request(app.getHttpServer())
        .post(`/assistant/questions/${theirs.questionId}/helpful`)
        .set('Authorization', `Bearer ${me.token}`)
        .send({ helpful: true })
        // Refused as if it did not exist. Never "not yours", which would confirm
        // that it is somebody's.
        .expect(404);

      const stored = await store.getQuestion(theirs.questionId);
      expect(stored.helpful).toBeNull();
    });

    it('turns away anybody who is not signed in', async () => {
      await request(app.getHttpServer())
        .post('/assistant/ask')
        .send({ question: 'hello' })
        .expect(401);
      await request(app.getHttpServer())
        .get('/assistant/questions')
        .expect(401);
    });

    it('refuses an empty question and one nobody could type', async () => {
      const user = await makeUser();
      for (const bad of [
        { question: '' },
        { question: 'x'.repeat(5000) },
        {},
      ]) {
        await request(app.getHttpServer())
          .post('/assistant/ask')
          .set('Authorization', `Bearer ${user.token}`)
          .send(bad)
          .expect(400);
      }
    });

    it('refuses anything that is not a plain yes or no', async () => {
      const user = await makeUser();
      const asked = await engine.ask(user.id, 'what are tickets');
      for (const bad of [{ helpful: 'yes' }, { helpful: 1 }, {}]) {
        await request(app.getHttpServer())
          .post(`/assistant/questions/${asked.questionId}/helpful`)
          .set('Authorization', `Bearer ${user.token}`)
          .send(bad)
          .expect(400);
      }
    });
  });
});
