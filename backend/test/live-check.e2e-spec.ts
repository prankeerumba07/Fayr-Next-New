import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AUDIT_ACTIONS } from '../src/admin/admin.constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { LiveCheckService } from '../src/live-check/live-check.service';
import { seedDemo } from '../prisma/demo-seed';
import { resetDatabase } from './reset-db';

/**
 * THE LIVE PAGE CHECK, AGAINST THE REAL CATALOGUE.
 *
 * The judgement is unit-tested next to the pure rules. What can only be proved
 * here is the part that touches real offers: that a morning's findings are written
 * down as one whole thing, that they change what the app shows, that a state
 * nobody recognises is refused rather than stored, and above all that an ordinary
 * app login cannot use this to empty the feed.
 */
describe('Live page check (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let live: LiveCheckService;
  let staffTokens: StaffTokenService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;

  /** An ordinary app login, for the reads a real user does. */
  async function appUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        mobile: `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`,
      },
    });
    return jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
  }

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    live = app.get(LiveCheckService);
    staffTokens = app.get(StaffTokenService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Live check e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedDemo(app, { quiet: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('what there is to look at', () => {
    it('lists every live offer and nothing that is not live', async () => {
      const staff = await staffMember('OPERATIONS');
      const res = await request(app.getHttpServer())
        .get('/admin/live-check/todo')
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const activeCount = await prisma.campaign.count({
        where: { status: 'ACTIVE' },
      });
      expect(res.body).toHaveLength(activeCount);
      for (const offer of res.body) {
        expect(offer.campaignId).toBeTruthy();
        expect(offer.title).toBeTruthy();
        // Null is a real answer and means there is nothing to open.
        expect(
          offer.productUrl === null || typeof offer.productUrl === 'string',
        ).toBe(true);
      }
    });

    it('says how many offers have no page to open at all', async () => {
      // The honest headline. Most of the catalogue carries no shop link, so most of
      // it cannot be checked, and a screen that hid that would look like a pass.
      const staff = await staffMember('OPERATIONS');
      const res = await request(app.getHttpServer())
        .get('/admin/live-check')
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      expect(res.body.toCheck.total).toBeGreaterThan(0);
      expect(res.body.toCheck.withAPage + res.body.toCheck.withNoPage).toBe(
        res.body.toCheck.total,
      );
      expect(res.body.lastRun).toBeNull();
      expect(res.body.recent).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('recording a morning', () => {
    it('writes the run, and says what each offer looked like in words', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      const results = todo.slice(0, 3).map((o, i) => ({
        campaignId: o.campaignId,
        state: ['opened', 'sold-out', 'could-not-open'][i],
        httpStatus: [200, 200, 0][i],
        evidence: ['', 'Currently unavailable', ''][i] || undefined,
      }));

      const res = await request(app.getHttpServer())
        .post('/admin/live-check/run')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ results })
        .expect(200);

      expect(res.body.checked).toBe(3);
      expect(res.body.counts.opened).toBe(1);
      expect(res.body.counts['sold-out']).toBe(1);
      expect(res.body.counts['could-not-open']).toBe(1);
      for (const finding of res.body.findings) {
        expect(finding.says.length).toBeGreaterThan(10);
        // In words, never the stored name.
        expect(finding.says).not.toMatch(/-|_/);
      }
    });

    it('records who started it', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      await request(app.getHttpServer())
        .post('/admin/live-check/run')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          results: [{ campaignId: todo[0].campaignId, state: 'opened' }],
        })
        .expect(200);

      const rows = await prisma.adminAuditLog.findMany({
        where: { action: AUDIT_ACTIONS.LIVE_PAGE_CHECK_RUN },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].staffUserId).toBe(staff.id);

      const run = await prisma.livePageCheckRun.findFirstOrThrow();
      expect(run.startedByStaffId).toBe(staff.id);
    });

    it('ignores a state it has never heard of rather than storing it', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      // Straight through the service, past the request validation, which is where a
      // future caller would come from.
      const report = await live.record(staff.id, [
        { campaignId: todo[0].campaignId, state: 'opened' },
        { campaignId: todo[1].campaignId, state: 'who-knows' },
      ]);
      expect(report.checked).toBe(1);
      const after = await prisma.campaign.findUniqueOrThrow({
        where: { id: todo[1].campaignId },
      });
      expect(after.liveState).toBeNull();
    });

    it('ignores an offer that stopped being live mid-run', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      await prisma.campaign.update({
        where: { id: todo[0].campaignId },
        data: { status: 'PAUSED' },
      });
      const report = await live.record(staff.id, [
        { campaignId: todo[0].campaignId, state: 'expired' },
      ]);
      expect(report.checked).toBe(0);
    });

    it('refuses a run with nothing in it, and a state the request cannot carry', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      for (const bad of [
        { results: [] },
        { results: [{ campaignId: todo[0].campaignId, state: 'nonsense' }] },
        { results: [{ campaignId: 'not-a-uuid', state: 'opened' }] },
        { results: [{ campaignId: todo[0].campaignId }] },
        {},
      ]) {
        await request(app.getHttpServer())
          .post('/admin/live-check/run')
          .set('Authorization', `Bearer ${staff.token}`)
          .send(bad)
          .expect(400);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('what the app then shows', () => {
    it('greys out an offer whose page says it has ended', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      const target = todo[0].campaignId;

      await live.record(staff.id, [{ campaignId: target, state: 'expired' }]);
      const shown = await live.availabilityFor(target);
      expect(shown.greyedOut).toBe(true);
      expect(shown.reason).toBe('page');
      expect(shown.label).toMatch(/come back/i);
    });

    it('and the offer feed itself says so, in plain words', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      const target = todo.find((o) => o.title.length > 0)!.campaignId;
      await live.record(staff.id, [{ campaignId: target, state: 'sold-out' }]);

      const token = await appUser();
      const res = await request(app.getHttpServer())
        .get('/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const card = res.body.find((c: { id: string }) => c.id === target);
      expect(card).toBeTruthy();
      expect(card.availability.greyedOut).toBe(true);
      expect(card.availability.label).toMatch(/run out/i);
      // IT MUST NOT VANISH. A greyed-out card is the whole point.
      expect(res.body.map((c: { id: string }) => c.id)).toContain(target);
    });

    it('does NOT grey one out because our own look failed', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      const target = todo[0].campaignId;
      await live.record(staff.id, [
        { campaignId: target, state: 'could-not-open' },
      ]);
      expect((await live.availabilityFor(target)).greyedOut).toBe(false);
    });

    it('leaves every unchecked offer exactly as it was', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      await live.record(staff.id, [
        { campaignId: todo[0].campaignId, state: 'expired' },
      ]);

      const untouched = await prisma.campaign.findMany({
        where: { id: { not: todo[0].campaignId }, status: 'ACTIVE' },
        select: { liveState: true, liveCheckedAt: true },
      });
      for (const c of untouched) {
        expect(c.liveState).toBeNull();
        expect(c.liveCheckedAt).toBeNull();
      }
    });

    it('a later run replaces the earlier answer', async () => {
      const staff = await staffMember('OPERATIONS');
      const todo = await live.offersToCheck();
      const target = todo[0].campaignId;
      await live.record(staff.id, [{ campaignId: target, state: 'sold-out' }]);
      expect((await live.availabilityFor(target)).greyedOut).toBe(true);

      await live.record(staff.id, [{ campaignId: target, state: 'opened' }]);
      expect((await live.availabilityFor(target)).greyedOut).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('who may do this', () => {
    it('turns away anybody with no staff token', async () => {
      await request(app.getHttpServer()).get('/admin/live-check').expect(401);
      await request(app.getHttpServer())
        .get('/admin/live-check/todo')
        .expect(401);
      await request(app.getHttpServer())
        .post('/admin/live-check/run')
        .send({ results: [] })
        .expect(401);
    });

    it('turns away an ordinary app login, which is the whole risk here', async () => {
      // Marking offers expired hides them from every user's feed. If an app login
      // could do it, one hostile person with a phone could empty the feed.
      await request(app.getHttpServer())
        .post('/admin/live-check/run')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiJ9.e30.a-perfectly-valid-user-token',
        )
        .send({ results: [] })
        .expect(401);
    });

    it('keeps support and finance out', async () => {
      for (const role of ['SUPPORT', 'FINANCE'] as StaffRole[]) {
        const staff = await staffMember(role);
        await request(app.getHttpServer())
          .get('/admin/live-check')
          .set('Authorization', `Bearer ${staff.token}`)
          .expect(403);
      }
    });

    it('lets operations and an admin in', async () => {
      for (const role of ['OPERATIONS', 'ADMIN'] as StaffRole[]) {
        const staff = await staffMember(role);
        await request(app.getHttpServer())
          .get('/admin/live-check')
          .set('Authorization', `Bearer ${staff.token}`)
          .expect(200);
      }
    });
  });
});
