import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AUDIT_ACTIONS } from '../src/admin/admin.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { MAX_PAGE_SIZE } from '../src/assistant/assistant.constants';
import { resetDatabase } from './reset-db';

/**
 * THE STAFF READ ENDPOINTS.
 *
 * Three things can only be proved here. Who is allowed in — SUPPORT and ADMIN, and
 * not the two teams this has nothing to do with. What the queue shows compared with
 * what one question shows, because the difference between them is a decision about
 * somebody's personal detail and not a detail of shaping. And that opening one
 * question really does leave a line in the audit trail, with the right person
 * named against it.
 */
describe('Assistant staff API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: AssistantStore;
  let staffTokens: StaffTokenService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  /** A real staff account and a real token for it. The id is returned too, so a
   *  test asserting on the audit trail names the person it actually signed in as
   *  rather than whichever account happens to be newest. */
  async function staffMember(
    role: StaffRole,
  ): Promise<{ id: string; token: string }> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-for-this-test'),
        name: `Demo ${role}`,
        role,
      },
    });
    const { accessToken } = await staffTokens.issueSession(staff);
    return { id: staff.id, token: accessToken };
  }

  const tokenFor = async (role: StaffRole): Promise<string> =>
    (await staffMember(role)).token;

  async function seedQuestion(rawText: string, resolved = false) {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const q = await store.recordQuestion({ userId: user.id, rawText });
    if (resolved) {
      await store.recordAnswer(q.id, {
        origin: 'ANSWER_BOOK',
        answerText: 'Here is the answer.',
        matchScore: 90,
      });
      await store.recordHelpful(q.id, true);
    }
    return { user, questionId: q.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    store = app.get(AssistantStore);
    staffTokens = app.get(StaffTokenService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Assistant API e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const ROUTES = [
    '/admin/assistant/questions',
    '/admin/assistant/answers',
    '/admin/assistant/stats',
  ];

  describe('who is allowed in', () => {
    it('turns away anybody with no staff token', async () => {
      for (const route of ROUTES) {
        await request(app.getHttpServer()).get(route).expect(401);
      }
    });

    it('turns away a made-up token', async () => {
      for (const route of ROUTES) {
        await request(app.getHttpServer())
          .get(route)
          .set('Authorization', 'Bearer not-a-real-token')
          .expect(401);
      }
    });

    it('lets customer support in', async () => {
      const token = await tokenFor('SUPPORT');
      for (const route of ROUTES) {
        await request(app.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
    });

    it('lets an admin in, through the super-role', async () => {
      const token = await tokenFor('ADMIN');
      for (const route of ROUTES) {
        await request(app.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
    });

    it('keeps finance and operations out — none of this is money or offers', async () => {
      for (const role of ['FINANCE', 'OPERATIONS'] as StaffRole[]) {
        const token = await tokenFor(role);
        for (const route of ROUTES) {
          await request(app.getHttpServer())
            .get(route)
            .set('Authorization', `Bearer ${token}`)
            .expect(403);
        }
      }
    });

    it('turns away a USER token, not just a missing one', async () => {
      // The staff side is a separate trust domain. A perfectly valid app login
      // must not open a staff screen.
      await request(app.getHttpServer())
        .get('/admin/assistant/questions')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiJ9.e30.invalid-user-token',
        )
        .expect(401);
    });
  });

  describe('the queue', () => {
    it('lists questions, newest first', async () => {
      await seedQuestion('first question');
      await seedQuestion('second question');
      const token = await tokenFor('SUPPORT');

      const res = await request(app.getHttpServer())
        .get('/admin/assistant/questions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.total).toBe(2);
      const times = res.body.questions.map((q: { askedAt: string }) =>
        Date.parse(q.askedAt),
      );
      expect([...times].sort((a: number, b: number) => b - a)).toEqual(times);
    });

    it('shows only the ones nobody has answered when asked to', async () => {
      await seedQuestion('still stuck');
      await seedQuestion('sorted out', true);
      const token = await tokenFor('SUPPORT');

      const res = await request(app.getHttpServer())
        .get('/admin/assistant/questions?status=UNRESOLVED')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.questions[0].rawText).toBe('still stuck');
    });

    it('keeps the words exactly as they were typed', async () => {
      await seedQuestion('  MERA refnud kab AAYEGA???  ');
      const token = await tokenFor('SUPPORT');
      const res = await request(app.getHttpServer())
        .get('/admin/assistant/questions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.questions[0].rawText).toBe(
        '  MERA refnud kab AAYEGA???  ',
      );
    });

    it('names the language in words', async () => {
      await seedQuestion('mera refund kab aayega');
      const token = await tokenFor('SUPPORT');
      const res = await request(app.getHttpServer())
        .get('/admin/assistant/questions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.questions[0].language.name).toBe(
        'Hindi written in English letters',
      );
    });

    it('does NOT carry the phone number or what they were doing', async () => {
      const { user } = await seedQuestion(
        'scanning the list is not opening one',
      );
      const token = await tokenFor('SUPPORT');
      const res = await request(app.getHttpServer())
        .get('/admin/assistant/questions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const written = JSON.stringify(res.body);
      expect(written).not.toContain(user.mobile);
      expect(written).not.toContain('nowDoing');
      // The Fayr number is there, which is what staff read back to somebody.
      expect(res.body.questions[0].user.displayId).toMatch(/^FAYR-/);
    });

    it('hands back one page and says how many there are in all', async () => {
      for (let i = 0; i < 5; i += 1) await seedQuestion(`question ${i}`);
      const token = await tokenFor('SUPPORT');
      const res = await request(app.getHttpServer())
        .get('/admin/assistant/questions?limit=2&offset=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.questions).toHaveLength(2);
      expect(res.body.total).toBe(5);
      expect(res.body.offset).toBe(1);
    });

    it('refuses a page size that would pull the whole history', async () => {
      const token = await tokenFor('SUPPORT');
      for (const bad of [0, -1, MAX_PAGE_SIZE + 1, 99_999]) {
        await request(app.getHttpServer())
          .get(`/admin/assistant/questions?limit=${bad}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(400);
      }
    });

    it('refuses a status it has never heard of', async () => {
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get('/admin/assistant/questions?status=SORT_OF')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('refuses a filter it does not know about', async () => {
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get('/admin/assistant/questions?somethingElse=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('one question', () => {
    it('shows what they were doing and the number to call back', async () => {
      const { user, questionId } = await seedQuestion('why is my money stuck');
      const token = await tokenFor('SUPPORT');

      const res = await request(app.getHttpServer())
        .get(`/admin/assistant/questions/${questionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.user.mobile).toBe(user.mobile);
      expect(res.body.journey).not.toBeNull();
      expect(Array.isArray(res.body.journey.nowDoing)).toBe(true);
      expect(res.body.journeyNote).toBeNull();
    });

    it('writes exactly one line in the audit trail, naming the right person', async () => {
      const { user, questionId } = await seedQuestion('audit me');
      const { id: staffId, token } = await staffMember('SUPPORT');

      await request(app.getHttpServer())
        .get(`/admin/assistant/questions/${questionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const rows = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.ASSISTANT_QUESTION_VIEW },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].staffUserId).toBe(staffId);
      expect(rows[0].targetUserId).toBe(user.id);
      expect(rows[0].metadata).toMatchObject({
        questionId,
        journeyCaptured: true,
      });
    });

    it('records who looked, never what they saw', async () => {
      const { questionId } = await seedQuestion('nothing of mine in the trail');
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get(`/admin/assistant/questions/${questionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const [row] = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.ASSISTANT_QUESTION_VIEW },
      });
      const written = JSON.stringify(row.metadata);
      expect(written).not.toContain('nothing of mine in the trail');
      expect(written).not.toContain('nowDoing');
    });

    it('leaves no audit line when somebody only scans the queue', async () => {
      await seedQuestion('just scanning');
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get('/admin/assistant/questions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: AUDIT_ACTIONS.ASSISTANT_QUESTION_VIEW },
        }),
      ).toBe(0);
    });

    it('says there is no such question rather than showing an empty one', async () => {
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get('/admin/assistant/questions/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('refuses something that is not an identifier at all', async () => {
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get('/admin/assistant/questions/not-a-real-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('the answer book', () => {
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
        phrases: ['mera refund kab aayega'],
      });
      await store.saveAnswer({
        key: 'not-finished',
        language: 'en',
        title: 'Being written',
        body: 'Nobody should see this yet.',
        topic: 'review',
      });
    });

    it('lists the whole book with how many wordings lead to each answer', async () => {
      const token = await tokenFor('SUPPORT');
      const res = await request(app.getHttpServer())
        .get('/admin/assistant/answers')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.total).toBe(3);
      const english = res.body.answers.find(
        (a: { key: string; language: string }) =>
          a.key === 'refund-timing' && a.language === 'en',
      );
      expect(english.waysOfAsking).toBe(2);
      expect(english.languageName).toBe('English');
    });

    it('filters by language, by state and by what it is about', async () => {
      const token = await tokenFor('SUPPORT');
      const byLanguage = await request(app.getHttpServer())
        .get('/admin/assistant/answers?language=hi-en')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byLanguage.body.total).toBe(1);

      const published = await request(app.getHttpServer())
        .get('/admin/assistant/answers?status=PUBLISHED')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(published.body.total).toBe(2);

      const byTopic = await request(app.getHttpServer())
        .get('/admin/assistant/answers?topic=review')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byTopic.body.total).toBe(1);
    });

    it('refuses a language it has no name for', async () => {
      const token = await tokenFor('SUPPORT');
      await request(app.getHttpServer())
        .get('/admin/assistant/answers?language=fr')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('how long things are taking', () => {
    it('counts what happened and says every duration in words', async () => {
      await seedQuestion('sorted out', true);
      await seedQuestion('still stuck');
      const token = await tokenFor('SUPPORT');

      const res = await request(app.getHttpServer())
        .get('/admin/assistant/stats?days=30')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.asked).toBe(2);
      expect(res.body.resolved).toBe(1);
      expect(res.body.unresolved).toBe(1);
      expect(res.body.saidItHelped).toBe(1);
      expect(res.body.resolution.counted).toBe(1);
      expect(typeof res.body.resolution.typical.inWords).toBe('string');
    });

    it('says nothing rather than zero when nothing has been resolved', async () => {
      const token = await tokenFor('SUPPORT');
      const res = await request(app.getHttpServer())
        .get('/admin/assistant/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.resolution.counted).toBe(0);
      expect(res.body.resolution.typical.seconds).toBeNull();
      expect(res.body.resolution.typical.inWords).toBeNull();
    });

    it('refuses a window that makes no sense', async () => {
      const token = await tokenFor('SUPPORT');
      for (const bad of [0, -5, 100_000, 'lots']) {
        await request(app.getHttpServer())
          .get(`/admin/assistant/stats?days=${bad}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(400);
      }
    });
  });
});
