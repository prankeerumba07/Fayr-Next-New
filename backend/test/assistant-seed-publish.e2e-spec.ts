import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { ANSWER_DRAFTS, DRAFT_LANGUAGES } from '../src/assistant/answer-drafts';

/**
 * How many answers the book really holds.
 *
 * Every draft in answer-drafts.ts PLUS ONE: the answer that carries the support
 * number is built from a setting rather than written into the file, so it is not
 * in ANSWER_DRAFTS and it is still an answer, in all three languages, waiting for
 * a person exactly like the rest.
 */
const EVERY_ANSWER = ANSWER_DRAFTS.length + 1;
import { CANNOT_ANSWER_YET } from '../src/assistant/answer-engine.rules';
import { seedDemo } from '../prisma/demo-seed';
import { resetDatabase } from './reset-db';

/**
 * THE TWO HALVES OF WHO MAY PUBLISH AN ANSWER.
 *
 * On a practice database the drafted answers are published for us, so "Chat with
 * us" answers something the moment the app opens. Nobody wants to approve seventy
 * five answers by hand before a screen can be shown working.
 *
 * On a real one, nothing is published unless a person does it. The drafts were
 * written by the assistant from the policy screens; they have not been read by
 * anyone, and the Hindi ones have not been read by a Hindi speaker at all.
 *
 * Both halves are proved here, in the only way that counts: by asking the real
 * question through the real endpoint and seeing what comes back.
 */
describe('Publishing the drafted answers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seed: AssistantSeedService;
  let store: AssistantStore;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function askAs(question: string): Promise<{
    answer: string;
    answered: boolean;
    language: string;
  }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    const res = await request(app.getHttpServer())
      .post('/assistant/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question })
      .expect(201);
    return res.body;
  }

  async function anAdmin(): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `publisher${seq++}@fayr.local`,
        name: 'Publisher',
        role: 'ADMIN',
        passwordHash: 'not-used-here',
      },
    });
    return staff.id;
  }

  /** One question per language, all three answered by the same drafted answer. */
  const IN_EVERY_LANGUAGE = [
    { language: 'en', question: 'what are tickets' },
    { language: 'hi', question: 'टिकट क्या है' },
    { language: 'hi-en', question: 'ticket kya hai' },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    seed = app.get(AssistantSeedService);
    store = app.get(AssistantStore);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Publish e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ── half one: a real deployment publishes nothing on its own ──────────────
  describe('a real deployment still waits for a person', () => {
    it('puts every drafted answer in as a draft, in all three languages', async () => {
      await seed.seedDrafts();
      const expected = EVERY_ANSWER * DRAFT_LANGUAGES.length;
      expect(await prisma.answerEntry.count()).toBe(expected);
      expect(
        await prisma.answerEntry.count({ where: { status: 'DRAFT' } }),
      ).toBe(expected);
      expect(
        await prisma.answerEntry.count({ where: { status: 'PUBLISHED' } }),
      ).toBe(0);
    });

    it('so the chat says a person will look at it, in the asker’s language', async () => {
      // The point of the whole half. The answer exists, word for word, and is
      // still not sent, because nobody has read it.
      await seed.seedDrafts();
      for (const { language, question } of IN_EVERY_LANGUAGE) {
        const reply = await askAs(question);
        expect(reply.answered).toBe(false);
        expect(reply.language).toBe(language);
        expect(reply.answer).toBe(CANNOT_ANSWER_YET[language]);
      }
    });

    it('refuses to publish on a database that is not a practice one', async () => {
      await seed.seedDrafts();
      const adminId = await anAdmin();
      await expect(
        seed.publishDraftsForPractice(adminId, 'fayr_prod'),
      ).rejects.toThrow(/dev|test|practice/i);
      expect(
        await prisma.answerEntry.count({ where: { status: 'PUBLISHED' } }),
      ).toBe(0);
    });
  });

  // ── half two: a practice database is usable straight away ─────────────────
  describe('a practice database answers straight away', () => {
    it('publishes every drafted answer, in all three languages', async () => {
      await seedDemo(app, { quiet: true });
      const expected = EVERY_ANSWER * DRAFT_LANGUAGES.length;
      expect(
        await prisma.answerEntry.count({ where: { status: 'PUBLISHED' } }),
      ).toBe(expected);
      for (const language of DRAFT_LANGUAGES) {
        expect(
          await prisma.answerEntry.count({
            where: { language, status: 'PUBLISHED' },
          }),
        ).toBe(EVERY_ANSWER);
      }
    });

    it('so the chat answers a real question in each language', async () => {
      await seedDemo(app, { quiet: true });
      for (const { language, question } of IN_EVERY_LANGUAGE) {
        const reply = await askAs(question);
        expect(reply.answered).toBe(true);
        expect(reply.language).toBe(language);
        expect(reply.answer).not.toBe(CANNOT_ANSWER_YET[language]);
        // Not just "something came back": the right answer came back.
        expect(reply.answer.toLowerCase()).toContain(
          language === 'hi' ? 'टिकट' : 'ticket',
        );
      }
    });

    it('says how many it published, so the seed log is honest', async () => {
      const report = await seedDemo(app, { quiet: true });
      expect(report.answersPublished).toBe(EVERY_ANSWER * DRAFT_LANGUAGES.length);
    });

    it('leaves a person’s decision alone on a second run', async () => {
      // Somebody retired an answer because it was wrong. Re-running the seed must
      // not quietly put it back in front of people.
      await seedDemo(app, { quiet: true });
      const adminId = await anAdmin();
      const retired = await prisma.answerEntry.findFirstOrThrow({
        where: { key: 'tickets', language: 'en' },
      });
      await store.setAnswerStatus(retired.id, 'RETIRED', adminId);

      const report = await seed.publishDraftsForPractice(adminId);
      expect(report.published).toBe(0);
      expect(report.leftAlone).toBeGreaterThan(0);
      const after = await prisma.answerEntry.findUniqueOrThrow({
        where: { id: retired.id },
      });
      expect(after.status).toBe('RETIRED');
    });

    it('never publishes an answer a member of staff wrote', async () => {
      // A staff answer is theirs to publish. The seed has no business deciding
      // that something half-written by a person is ready to be read.
      await store.saveAnswer({
        key: 'a-staff-answer',
        language: 'en',
        title: 'Written by a person',
        body: 'This one is still being worked on and is not ready to be read.',
        topic: 'tickets',
        status: 'DRAFT',
        origin: 'STAFF',
        phrases: ['a staff answer'],
      });

      await seedDemo(app, { quiet: true });

      const staffOne = await prisma.answerEntry.findFirstOrThrow({
        where: { key: 'a-staff-answer' },
      });
      expect(staffOne.status).toBe('DRAFT');
    });
  });
});
