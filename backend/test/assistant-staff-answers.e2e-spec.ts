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
import { AnswerEngine } from '../src/assistant/answer-engine.service';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { resetDatabase } from './reset-db';

/**
 * THE STAFF SIDE OF THE ANSWER BOOK.
 *
 * Four things can only be proved here.
 *
 * That approving a drafted answer is a real, separate, recorded act — nothing the
 * assistant wrote reaches a person until somebody does it.
 *
 * That a corrected answer is live IMMEDIATELY. That is the whole promise of this
 * phase: the system visibly gets better the same day a person fixes something, and
 * a cache anywhere in the path would quietly break it.
 *
 * That the plain-language rule applies to what STAFF write too — warned when
 * saving a draft, and refused outright when approving, because approving is what
 * lets it reach somebody.
 *
 * And that a normal app login still cannot touch any of it.
 */
describe('Assistant answer book, staff side (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: AssistantStore;
  let engine: AnswerEngine;
  let seed: AssistantSeedService;
  let staffTokens: StaffTokenService;

  let seq = 0;

  async function staffMember(role: StaffRole) {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('not-used-here'),
        name: `Demo ${role}`,
        role,
      },
    });
    const { accessToken } = await staffTokens.issueSession(staff);
    return { id: staff.id, token: accessToken };
  }

  const goodAnswer = {
    key: 'a-new-answer',
    language: 'en',
    title: 'Something a person wrote',
    body: 'We put your money back in your wallet once your review is showing.',
    topic: 'refund',
    phrases: ['a brand new way of asking about this'],
  };

  const jargonAnswer = {
    key: 'a-jargon-answer',
    language: 'en',
    title: 'Clawback of remittances',
    body: 'The API endpoint will authenticate your credentials -- e.g. HOLDING.',
    topic: 'refund',
    phrases: ['clawback of remittances'],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    store = app.get(AssistantStore);
    engine = app.get(AnswerEngine);
    seed = app.get(AssistantSeedService);
    staffTokens = app.get(StaffTokenService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Staff answer e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('writing an answer', () => {
    it('saves it as a draft, marked as written by a person', async () => {
      const staff = await staffMember('SUPPORT');
      const res = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);

      expect(res.body.answer.status).toBe('DRAFT');
      expect(res.body.answer.origin).toBe('STAFF');
      expect(res.body.answer.waysOfAsking).toBe(1);
      // Nothing a person writes is live until they approve it either.
      expect(res.body.plainLanguage.ok).toBe(true);
      expect(res.body.plainLanguage.problems).toEqual([]);
    });

    it('records who wrote it', async () => {
      const staff = await staffMember('SUPPORT');
      await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);

      const rows = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.ASSISTANT_ANSWER_SAVE },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].staffUserId).toBe(staff.id);
      expect(rows[0].metadata).toMatchObject({
        key: goodAnswer.key,
        language: 'en',
      });
    });

    it('warns about jargon but still saves the draft', async () => {
      // A warning, not a refusal. Somebody mid-edit must not lose their work
      // because the wording is not finished yet.
      const staff = await staffMember('SUPPORT');
      const res = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(jargonAnswer)
        .expect(201);

      expect(res.body.answer.status).toBe('DRAFT');
      expect(res.body.plainLanguage.ok).toBe(false);
      expect(res.body.plainLanguage.problems.length).toBeGreaterThan(3);
      for (const line of res.body.plainLanguage.problems) {
        expect(typeof line).toBe('string');
        expect(line.length).toBeGreaterThan(5);
      }
    });

    it('counts a correction as a new revision', async () => {
      const staff = await staffMember('SUPPORT');
      const first = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);
      expect(first.body.answer.revision).toBe(1);

      const second = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ ...goodAnswer, body: 'Better words, written by a person.' })
        .expect(201);
      expect(second.body.answer.revision).toBe(2);
      expect(second.body.answer.id).toBe(first.body.answer.id);
    });

    it('refuses an answer with nothing in it, and a language it has no name for', async () => {
      const staff = await staffMember('SUPPORT');
      for (const bad of [
        { ...goodAnswer, body: '   ' },
        { ...goodAnswer, title: '' },
        { ...goodAnswer, language: 'fr' },
        { ...goodAnswer, key: 'Not A Key' },
      ]) {
        await request(app.getHttpServer())
          .post('/admin/assistant/answers')
          .set('Authorization', `Bearer ${staff.token}`)
          .send(bad)
          .expect(400);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('checking the words before saving', () => {
    it('says what is wrong without writing anything down', async () => {
      const staff = await staffMember('SUPPORT');
      const res = await request(app.getHttpServer())
        .post('/admin/assistant/answers/check')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ language: 'en', title: 'A title', body: jargonAnswer.body })
        .expect(200);

      expect(res.body.ok).toBe(false);
      expect(res.body.problems.length).toBeGreaterThan(3);
      expect(await prisma.answerEntry.count()).toBe(0);
    });

    it('says so plainly when there is nothing wrong', async () => {
      const staff = await staffMember('SUPPORT');
      const res = await request(app.getHttpServer())
        .post('/admin/assistant/answers/check')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ language: 'en', title: 'A title', body: goodAnswer.body })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.problems).toEqual([]);
    });

    it('checks Hindi by the rules that apply to Hindi', async () => {
      const staff = await staffMember('SUPPORT');
      const res = await request(app.getHttpServer())
        .post('/admin/assistant/answers/check')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          language: 'hi',
          title: 'शीर्षक',
          body: 'आपका पैसा वापस तब आता है जब आपका रिव्यू दिख जाता है।',
        })
        .expect(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('approving an answer', () => {
    it('publishes it, and records who approved it', async () => {
      const staff = await staffMember('SUPPORT');
      await seed.seedDrafts();
      const draft = await prisma.answerEntry.findFirstOrThrow({
        where: { key: 'tickets', language: 'en' },
      });
      expect(draft.status).toBe('DRAFT');

      const res = await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${draft.id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      expect(res.body.answer.status).toBe('PUBLISHED');
      const rows = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.ASSISTANT_ANSWER_APPROVE },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].staffUserId).toBe(staff.id);
    });

    it('REFUSES to approve one that does not read plainly', async () => {
      // Publishing something the engine will always hold back is a trap: staff
      // think they have fixed it and users still get "I do not know".
      const staff = await staffMember('SUPPORT');
      const saved = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(jargonAnswer)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(400);

      expect(JSON.stringify(res.body)).toMatch(/plain|jargon|dash|short/i);
      const after = await prisma.answerEntry.findUniqueOrThrow({
        where: { id: saved.body.answer.id },
      });
      expect(after.status).toBe('DRAFT');
    });

    it('says there is no such answer rather than showing an empty one', async () => {
      const staff = await staffMember('SUPPORT');
      await request(app.getHttpServer())
        .post(
          '/admin/assistant/answers/00000000-0000-4000-8000-000000000000/approve',
        )
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(404);
    });

    it('can withdraw one again', async () => {
      const staff = await staffMember('SUPPORT');
      const saved = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/retire`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      expect(res.body.answer.status).toBe('RETIRED');
      expect(
        await prisma.adminAuditLog.count({
          where: { action: AUDIT_ACTIONS.ASSISTANT_ANSWER_RETIRE },
        }),
      ).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('a fix is live the same day', () => {
    it('an answer nobody has approved cannot be given', async () => {
      const staff = await staffMember('SUPPORT');
      await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);

      const user = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      const before = await engine.ask(
        user.id,
        'a brand new way of asking about this',
      );
      expect(before.answered).toBe(false);
    });

    it('and the moment somebody approves it, the same question is answered', async () => {
      // THE PROMISE OF THIS PHASE. No restart, no cache to clear, no waiting.
      const staff = await staffMember('SUPPORT');
      const saved = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);

      const user = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      expect(
        (await engine.ask(user.id, 'a brand new way of asking about this'))
          .answered,
      ).toBe(false);

      await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const after = await engine.ask(
        user.id,
        'a brand new way of asking about this',
      );
      expect(after.answered).toBe(true);
      expect(after.answer).toBe(goodAnswer.body);
    });

    it('a correction to a live answer reaches the next person who asks', async () => {
      const staff = await staffMember('SUPPORT');
      const saved = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          ...goodAnswer,
          body: 'The corrected words, live straight away.',
        })
        .expect(201);

      const user = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      const asked = await engine.ask(
        user.id,
        'a brand new way of asking about this',
      );
      expect(asked.answer).toBe('The corrected words, live straight away.');
    });

    it('correcting a draft leaves it a draft', async () => {
      // The other half of the rule: a correction keeps whatever state the answer
      // was already in. An unapproved answer must not become live by being edited.
      const staff = await staffMember('SUPPORT');
      const first = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);
      expect(first.body.answer.status).toBe('DRAFT');

      const second = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ ...goodAnswer, body: 'Corrected while still a draft.' })
        .expect(201);
      expect(second.body.answer.status).toBe('DRAFT');
    });

    it('withdrawing one stops it being given', async () => {
      const staff = await staffMember('SUPPORT');
      const saved = await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/admin/assistant/answers/${saved.body.answer.id}/retire`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const user = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      expect(
        (await engine.ask(user.id, 'a brand new way of asking about this'))
          .answered,
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('closing a question', () => {
    it('marks it resolved, and records who closed it', async () => {
      const staff = await staffMember('SUPPORT');
      const user = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      const asked = await engine.ask(
        user.id,
        'something nobody has an answer for',
      );
      expect(asked.answered).toBe(false);

      const res = await request(app.getHttpServer())
        .post(`/admin/assistant/questions/${asked.questionId}/resolve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      expect(res.body.status).toBe('RESOLVED');
      const stored = await store.getQuestion(asked.questionId);
      expect(stored.resolvedByStaffId).toBe(staff.id);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: AUDIT_ACTIONS.ASSISTANT_QUESTION_RESOLVE },
        }),
      ).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('who is allowed to do any of this', () => {
    const writes = [
      ['post', '/admin/assistant/answers'],
      ['post', '/admin/assistant/answers/check'],
    ] as const;

    it('turns away anybody with no staff token', async () => {
      for (const [, path] of writes) {
        await request(app.getHttpServer()).post(path).send({}).expect(401);
      }
    });

    it('keeps finance and operations out', async () => {
      for (const role of ['FINANCE', 'OPERATIONS'] as StaffRole[]) {
        const staff = await staffMember(role);
        await request(app.getHttpServer())
          .post('/admin/assistant/answers')
          .set('Authorization', `Bearer ${staff.token}`)
          .send(goodAnswer)
          .expect(403);
      }
    });

    it('lets an admin through', async () => {
      const staff = await staffMember('ADMIN');
      await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${staff.token}`)
        .send(goodAnswer)
        .expect(201);
    });
  });
});
