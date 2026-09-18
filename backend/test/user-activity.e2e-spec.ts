import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AUDIT_ACTIONS } from '../src/admin/admin.constants';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * ONE PERSON'S TRAIL, END TO END.
 *
 * The load-bearing assertions, in the order they matter: nothing identifying
 * reaches the response, every read leaves exactly one audit row, an out-of-range
 * query is REFUSED rather than quietly clamped, and a person with nothing to show
 * gets an empty trail rather than an error.
 */
describe('User activity trail (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  const server = () => app.getHttpServer();

  let seq = 0;
  const newMobile = (): string =>
    `+9198${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function supportToken(): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `support${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: 'Test Support',
        role: 'SUPPORT',
      },
    });
    const session = await staffTokens.issueSession(staff);
    return session.accessToken;
  }

  const trail = (token: string, id: string, query = '') =>
    request(server())
      .get(`/admin/users/${id}/activity${query}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    staffTokens = app.get(StaffTokenService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Activity e2e aborted: non-test database');
    }
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('somebody who has done nothing', () => {
    it('gets an empty trail and a real summary, not an error and not a 404', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const res = await trail(await supportToken(), user.id).expect(200);

      expect(res.body.timeline).toEqual({
        entries: [],
        total: 0,
        shown: 0,
        trimmed: 0,
      });
      // A real summary, not nulls and not an absent object. firstSeen falls back
      // to the account being made, which is the earliest thing there is.
      expect(res.body.summary.firstSeen).toBe(user.createdAt.toISOString());
      expect(res.body.summary.totalScreens).toBe(0);
      expect(res.body.summary.totalTasks).toBe(0);
      expect(res.body.summary.setupFinished).toBe(false);
      expect(res.body.summary.setupStoppedAt).toBe(1);
      expect(typeof res.body.summary.daysQuiet).toBe('number');
    });

    it('404s for an id that belongs to nobody, and still leaves an audit row', async () => {
      // A staff member probing ids is exactly the pattern a trail is kept for, so
      // a miss must not be the one read that leaves no trace.
      const token = await supportToken();
      const nowhere = '9f1c2f70-1f6b-4a4e-9f0e-2b6c7a3d5e11';
      await trail(token, nowhere).expect(404);
      const rows = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.USER_ACTIVITY_VIEW },
      });
      expect(rows).toHaveLength(1);
      expect((rows[0].metadata as { found: boolean }).found).toBe(false);
    });
  });

  describe('what it refuses to say', () => {
    it('carries no mobile number, no UPI id, no bank account and no PAN', async () => {
      // The fixture has all four, and a spread of activity, so the assertion is
      // about what the endpoint CHOSE not to say rather than about an empty user.
      const mobile = newMobile();
      const user = await prisma.user.create({
        data: { mobile, pan: 'ABCDE1234F', name: 'Asha Kumari' },
      });
      await prisma.payoutMethod.create({
        data: {
          userId: user.id,
          type: 'UPI',
          upiId: 'asha@okhdfcbank',
        },
      });
      await prisma.payoutMethod.create({
        data: {
          userId: user.id,
          type: 'BANK',
          bankAccount: '50100123456789',
          ifsc: 'HDFC0001234',
          accountName: 'Asha Kumari',
        },
      });
      const method = await prisma.payoutMethod.findFirstOrThrow({
        where: { userId: user.id, type: 'UPI' },
      });
      await prisma.withdrawal.create({
        data: {
          userId: user.id,
          payoutMethodId: method.id,
          amountPaise: 25000n,
          status: 'PAID',
          decidedAt: new Date(),
          utr: 'UTR123456789',
        },
      });
      // Somebody who typed their own number into the chat box. If message bodies
      // were ever put on this response, this is the row that would leak it.
      const chat = await prisma.chat.create({ data: { userId: user.id } });
      await prisma.chatMessage.create({
        data: {
          chatId: chat.id,
          author: 'PERSON',
          body: `please call me on ${mobile}`,
          language: 'en',
        },
      });
      await prisma.assistantQuestion.create({
        data: {
          userId: user.id,
          rawText: `my pan is ABCDE1234F and my upi is asha@okhdfcbank`,
          detectedLanguage: 'en',
          languageConfidence: 90,
        },
      });

      const res = await trail(await supportToken(), user.id).expect(200);
      const body = JSON.stringify(res.body);

      expect(body).not.toContain(mobile);
      expect(body).not.toContain(mobile.replace('+91', ''));
      expect(body).not.toContain('asha@okhdfcbank');
      expect(body).not.toContain('50100123456789');
      expect(body).not.toContain('HDFC0001234');
      expect(body).not.toContain('ABCDE1234F');
      expect(body).not.toContain('UTR123456789');
      // And it did read the person: the trail is not empty, so the absence above
      // is a decision rather than a lack of data.
      expect(res.body.timeline.total).toBeGreaterThan(0);
    });

    it('says a picture was sent without saying anything about the picture', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON', status: 'ACTIVE', title: 'An offer',
          productName: 'A product', category: 'electronics',
          productPricePaise: 129900n, payoutPercent: 100, ticketCost: 5,
        },
      });
      const task = await prisma.task.create({
        data: { userId: user.id, campaignId: campaign.id, platform: 'AMAZON', state: 'CLAIMED' },
      });
      await prisma.screenshotUpload.create({
        data: {
          taskId: task.id, userId: user.id, kind: 'REVIEW',
          storageKey: 'private/secret-key-abc123', mimetype: 'image/png',
          sizeBytes: 4096, sha256: 'deadbeef'.repeat(8),
        },
      });

      const res = await trail(await supportToken(), user.id).expect(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain('Sent a picture of the review');
      expect(body).not.toContain('private/secret-key-abc123');
      expect(body).not.toContain('deadbeef');
      expect(body).not.toContain('image/png');
    });
  });

  describe('which offer each entry belongs to', () => {
    it('files the offer\u2019s own entries under it and leaves the rest alone', async () => {
      // ── THE POINT OF THE WHOLE FIELD ──────────────────────────────────
      //
      // Everything about one offer has to be able to sit together on the screen,
      // and everything that belongs to the person rather than to an offer has to
      // stay out of it. Both halves are asserted here, on one person, in one
      // read \u2014 because the failure is not an error, it is entries quietly
      // landing in the wrong place.
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON', status: 'ACTIVE', title: 'Keep the Oil Flowing',
          productName: 'A product', category: 'electronics',
          productPricePaise: 129900n, payoutPercent: 100, ticketCost: 5,
        },
      });
      const task = await prisma.task.create({
        data: { userId: user.id, campaignId: campaign.id, platform: 'AMAZON', state: 'CLAIMED' },
      });
      await prisma.taskEvent.create({
        data: {
          taskId: task.id, type: 'CLAIM', fromState: 'CLAIMED', toState: 'CLAIMED',
        },
      });
      await prisma.screenshotUpload.create({
        data: {
          taskId: task.id, userId: user.id, kind: 'REVIEW',
          storageKey: 'private/key', mimetype: 'image/png',
          sizeBytes: 4096, sha256: 'abcd1234'.repeat(8),
        },
      });
      await prisma.userEvent.create({
        data: { userId: user.id, type: 'SCREEN_VIEWED', payload: { screen: 'Wallet' } },
      });
      const chat = await prisma.chat.create({ data: { userId: user.id } });
      await prisma.chatMessage.create({
        data: { chatId: chat.id, author: 'PERSON', body: 'hello', language: 'en' },
      });

      const res = await trail(await supportToken(), user.id).expect(200);
      type Entry = {
        kind: string;
        campaignId: string | null;
        campaignTitle: string | null;
      };
      const entries: Entry[] = res.body.timeline.entries;

      // THE TWO THAT BELONG TO AN OFFER. A state change on it, and a picture
      // sent for it.
      const taskEntry = entries.find((e) => e.kind === 'task');
      expect(taskEntry?.campaignId).toBe(campaign.id);
      expect(taskEntry?.campaignTitle).toBe('Keep the Oil Flowing');
      const evidence = entries.find((e) => e.kind === 'evidence');
      expect(evidence?.campaignId).toBe(campaign.id);
      expect(evidence?.campaignTitle).toBe('Keep the Oil Flowing');

      // AND THE TWO THAT DO NOT. A screen and a message are the person's, not
      // the offer's, whatever they were looking at when they wrote in.
      expect(entries.find((e) => e.kind === 'screen')?.campaignId).toBeNull();
      expect(entries.find((e) => e.kind === 'chat')?.campaignId).toBeNull();

      // Every entry answers the question, one way or the other. An entry with no
      // field at all is the shape that makes a screen drop it silently.
      for (const e of entries) {
        expect(e).toHaveProperty('campaignId');
        expect(e).toHaveProperty('campaignTitle');
      }
      expect(entries.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('ordering and trimming', () => {
    it('orders two sources in the same second deterministically', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const sameSecond = new Date();
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON', status: 'ACTIVE', title: 'Keep the Oil Flowing',
          productName: 'A product', category: 'electronics',
          productPricePaise: 129900n, payoutPercent: 100, ticketCost: 5,
        },
      });
      const task = await prisma.task.create({
        data: { userId: user.id, campaignId: campaign.id, platform: 'AMAZON', state: 'CLAIMED' },
      });
      await prisma.taskEvent.create({
        data: {
          taskId: task.id, type: 'CLAIM', fromState: 'CLAIMED', toState: 'CLAIMED',
          createdAt: sameSecond,
        },
      });
      await prisma.userEvent.create({
        data: {
          userId: user.id, type: 'SCREEN_VIEWED',
          payload: { screen: 'Wallet' }, at: sameSecond,
        },
      });
      const chat = await prisma.chat.create({ data: { userId: user.id } });
      await prisma.chatMessage.create({
        data: { chatId: chat.id, author: 'PERSON', body: 'hello', language: 'en', sentAt: sameSecond },
      });

      const token = await supportToken();
      const first = await trail(token, user.id).expect(200);
      const again = await trail(token, user.id).expect(200);
      const third = await trail(token, user.id).expect(200);

      // Three reads of identical data, three identical orders. The sources finish
      // in whatever order the database feels like; the answer must not.
      expect(again.body.timeline.entries).toEqual(first.body.timeline.entries);
      expect(third.body.timeline.entries).toEqual(first.body.timeline.entries);
      // And the stated order: kind ascending inside one instant.
      expect(first.body.timeline.entries.map((e: { kind: string }) => e.kind)).toEqual([
        'chat', 'screen', 'task',
      ]);
    });

    it('counts what it trimmed instead of lying by omission', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const base = Date.now();
      await prisma.userEvent.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          userId: user.id,
          type: 'SCREEN_VIEWED' as const,
          payload: { screen: 'Home' },
          at: new Date(base - i * 60_000),
        })),
      });

      const res = await trail(await supportToken(), user.id, '?limit=5').expect(200);
      expect(res.body.timeline.total).toBe(12);
      expect(res.body.timeline.shown).toBe(5);
      expect(res.body.timeline.trimmed).toBe(7);
      expect(res.body.timeline.entries).toHaveLength(5);
      // The five it kept are the NEWEST five, not the first five to arrive.
      const times = res.body.timeline.entries.map((e: { at: string }) => e.at);
      expect([...times].sort().reverse()).toEqual(times);
      expect(new Date(times[0]).getTime()).toBeGreaterThanOrEqual(
        new Date(times[4]).getTime(),
      );
    });
  });

  describe('the audit row', () => {
    it('is written once per read, against the right person and staff member', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const token = await supportToken();
      const staff = await prisma.staffUser.findFirstOrThrow();

      await trail(token, user.id).expect(200);
      const after1 = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.USER_ACTIVITY_VIEW },
      });
      expect(after1).toHaveLength(1);
      expect(after1[0].targetUserId).toBe(user.id);
      expect(after1[0].staffUserId).toBe(staff.id);
      expect(after1[0].metadata).toMatchObject({ days: 30, limit: 500, found: true });

      await trail(token, user.id).expect(200);
      const after2 = await prisma.adminAuditLog.count({
        where: { action: AUDIT_ACTIONS.USER_ACTIVITY_VIEW },
      });
      expect(after2).toBe(2);
    });

    it('records no mobile number, so the trail of the trail is clean too', async () => {
      const mobile = newMobile();
      const user = await prisma.user.create({ data: { mobile } });
      await trail(await supportToken(), user.id).expect(200);
      const row = await prisma.adminAuditLog.findFirstOrThrow({
        where: { action: AUDIT_ACTIONS.USER_ACTIVITY_VIEW },
      });
      expect(JSON.stringify(row.metadata)).not.toContain(mobile);
    });
  });

  describe('the query is refused, not clamped', () => {
    it('refuses a days outside the range rather than quietly serving a year', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const token = await supportToken();
      await trail(token, user.id, '?days=0').expect(400);
      await trail(token, user.id, '?days=9999').expect(400);
      await trail(token, user.id, '?days=-1').expect(400);
      await trail(token, user.id, '?days=notanumber').expect(400);
    });

    it('refuses a limit outside the range rather than quietly serving fewer', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const token = await supportToken();
      await trail(token, user.id, '?limit=0').expect(400);
      await trail(token, user.id, '?limit=100000').expect(400);
      await trail(token, user.id, '?limit=-5').expect(400);
    });

    it('takes the ones inside the range, and defaults when nobody says', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const token = await supportToken();
      const given = await trail(token, user.id, '?days=7&limit=10').expect(200);
      expect(given.body.window.days).toBe(7);
      const defaulted = await trail(token, user.id).expect(200);
      expect(defaulted.body.window.days).toBe(30);
    });

    it('refuses an id that is not a uuid, so a Fayr display id is never accepted', async () => {
      await trail(await supportToken(), 'FAYR-1234').expect(400);
    });
  });

  describe('the guard', () => {
    it('refuses a request with no staff token', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      await request(server()).get(`/admin/users/${user.id}/activity`).expect(401);
    });

    it('refuses a staff member without the role, and writes nothing', async () => {
      const user = await prisma.user.create({ data: { mobile: newMobile() } });
      const ops = await prisma.staffUser.create({
        data: {
          email: `ops${Date.now()}${seq++}@fayr.local`,
          passwordHash: await argon2.hash('irrelevant-here'),
          name: 'Test Ops',
          role: 'OPERATIONS',
        },
      });
      const session = await staffTokens.issueSession(ops);
      await trail(session.accessToken, user.id).expect(403);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: AUDIT_ACTIONS.USER_ACTIVITY_VIEW },
        }),
      ).toBe(0);
    });
  });
});
