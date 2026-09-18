// Route uploads written by this suite to a throwaway dir (cleaned in afterAll),
// so test PNGs never mix with dev uploads. Must be set BEFORE the app boots and
// ConfigModule reads the environment.
process.env.UPLOAD_DIR = './uploads-test';

import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

// A 1×1 transparent PNG — a real, valid image for the upload path.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * End-to-end for the OPERATIONS campaign console (Stage 3). Boots the real app
 * and drives create-as-DRAFT → edit → publish/pause/resume/end over HTTP,
 * asserting the RBAC gate (OPERATIONS/ADMIN only), the lifecycle guards, that a
 * DRAFT is hidden from the public GET /campaigns until published, image upload,
 * and the audit trail. Money round-trips as decimal-string paise.
 */
describe('Admin campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;

  async function tokenFor(
    role: StaffRole,
  ): Promise<{ id: string; token: string }> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: `Test ${role}`,
        role,
      },
    });
    const session = await staffTokens.issueSession(staff);
    return { id: staff.id, token: session.accessToken };
  }

  async function userToken(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        mobile: `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`,
      },
    });
    return jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
  }

  type Body = Record<string, unknown>;
  const validBody = (over: Body = {}): Body => ({
    platform: 'AMAZON',
    title: 'Review the boAt Airdopes 141',
    productName: 'boAt Airdopes 141 TWS',
    category: 'electronics',
    productPricePaise: '129900',
    payoutPercent: 80,
    payoutCapPaise: '100000',
    ticketCost: 5,
    returnWindowDays: 7,
    minRating: 4,
    totalSlots: 50,
    terms: 'Buy the exact product & variant.\nOne entry per user.',
    ...over,
  });

  const server = () => app.getHttpServer();

  async function createDraft(
    token: string,
    over: Body = {},
  ): Promise<{ id: string; status: string; [k: string]: unknown }> {
    const res = await request(server())
      .post('/admin/campaigns')
      .set('authorization', `Bearer ${token}`)
      .send(validBody(over))
      .expect(201);
    return res.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    staffTokens = app.get(StaffTokenService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`campaign e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
    // Remove the throwaway upload dir this suite wrote into.
    await rm(resolve(process.cwd(), 'uploads-test'), {
      recursive: true,
      force: true,
    });
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const ALL_ROLES: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];

  describe('RBAC', () => {
    it('only OPERATIONS/ADMIN may list campaigns; others 403; unauth 401', async () => {
      for (const role of ALL_ROLES) {
        const { token } = await tokenFor(role);
        const expected = role === 'OPERATIONS' || role === 'ADMIN' ? 200 : 403;
        await request(server())
          .get('/admin/campaigns')
          .set('authorization', `Bearer ${token}`)
          .expect(expected);
      }
      await request(server()).get('/admin/campaigns').expect(401);
    });

    it('only OPERATIONS/ADMIN may create; others 403', async () => {
      for (const role of ALL_ROLES) {
        const { token } = await tokenFor(role);
        const expected = role === 'OPERATIONS' || role === 'ADMIN' ? 201 : 403;
        await request(server())
          .post('/admin/campaigns')
          .set('authorization', `Bearer ${token}`)
          .send(validBody())
          .expect(expected);
      }
    });
  });

  describe('image upload', () => {
    it('OPERATIONS uploads a PNG and gets a /uploads URL back', async () => {
      const { token } = await tokenFor('OPERATIONS');
      const res = await request(server())
        .post('/admin/uploads/image')
        .set('authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(res.body.url).toMatch(/^\/uploads\/campaigns\/.+\.png$/);
    });

    it('rejects a non-image (400) and a missing file (400)', async () => {
      const { token } = await tokenFor('OPERATIONS');
      await request(server())
        .post('/admin/uploads/image')
        .set('authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('hello'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      await request(server())
        .post('/admin/uploads/image')
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('a non-OPERATIONS staff member cannot upload (403)', async () => {
      const { token } = await tokenFor('SUPPORT');
      await request(server())
        .post('/admin/uploads/image')
        .set('authorization', `Bearer ${token}`)
        .attach('file', PNG_1PX, {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(403);
    });
  });

  describe('create', () => {
    it('always lands in DRAFT, with money as strings and terms stored', async () => {
      const { token } = await tokenFor('OPERATIONS');
      const c = await createDraft(token);
      expect(c.status).toBe('DRAFT');
      expect(c.productPricePaise).toBe('129900');
      expect(typeof c.productPricePaise).toBe('string');
      expect(c.payoutCapPaise).toBe('100000');
      expect(c.terms).toContain('One entry per user.');
    });

    it('refuses to accept a status in the body (forbidden field → 400)', async () => {
      const { token } = await tokenFor('OPERATIONS');
      await request(server())
        .post('/admin/campaigns')
        .set('authorization', `Bearer ${token}`)
        .send(validBody({ status: 'ACTIVE' }))
        .expect(400);
    });

    it('validates input: missing title, non-integer price, out-of-range percent', async () => {
      const { token } = await tokenFor('OPERATIONS');
      await request(server())
        .post('/admin/campaigns')
        .set('authorization', `Bearer ${token}`)
        .send(validBody({ title: '' }))
        .expect(400);
      await request(server())
        .post('/admin/campaigns')
        .set('authorization', `Bearer ${token}`)
        .send(validBody({ productPricePaise: '12.50' }))
        .expect(400);
      await request(server())
        .post('/admin/campaigns')
        .set('authorization', `Bearer ${token}`)
        .send(validBody({ payoutPercent: 0 }))
        .expect(400);
    });
  });

  describe('lifecycle', () => {
    it('publish makes it live and visible to users; a DRAFT stays hidden', async () => {
      const ops = await tokenFor('OPERATIONS');
      const draft = await createDraft(ops.token, { title: 'Still a draft' });
      const toPublish = await createDraft(ops.token, { title: 'Going live' });

      await request(server())
        .post(`/admin/campaigns/${toPublish.id}/publish`)
        .set('authorization', `Bearer ${ops.token}`)
        .expect(200)
        .expect((r) => expect(r.body.status).toBe('ACTIVE'));

      // The public, user-facing list shows ACTIVE only.
      const uToken = await userToken();
      const pub = await request(server())
        .get('/campaigns')
        .set('authorization', `Bearer ${uToken}`)
        .expect(200);
      const ids = (pub.body as { id: string; terms: string | null }[]).map(
        (c) => c.id,
      );
      expect(ids).toContain(toPublish.id);
      expect(ids).not.toContain(draft.id);
      // The public payload carries terms too (wired into the app's detail screen).
      expect(pub.body[0]).toHaveProperty('terms');
    });

    it('enforces the legal transitions and 409s the illegal ones', async () => {
      const { token } = await tokenFor('ADMIN'); // ADMIN via super-role
      const c = await createDraft(token);
      const move = (verb: string, expected: number) =>
        request(server())
          .post(`/admin/campaigns/${c.id}/${verb}`)
          .set('authorization', `Bearer ${token}`)
          .expect(expected);

      await move('pause', 409); // can't pause a draft
      await move('publish', 200); // DRAFT → ACTIVE
      await move('publish', 409); // already active
      await move('pause', 200); // ACTIVE → PAUSED
      await move('resume', 200); // PAUSED → ACTIVE
      await move('pause', 200); // ACTIVE → PAUSED
      await move('end', 200); // PAUSED → ENDED
      await move('resume', 409); // ended is terminal
      await move('pause', 409);
    });

    it('the search phrase — and ONLY it — may be changed while live', async () => {
      // THE ONE EXEMPTION FROM THE LOCK BELOW, and the reason is written where
      // the lock is: a search phrase changes what somebody types into a shop's
      // search box. It is not in the terms, no task reads it, and no refund is
      // computed from it, so it cannot move the goalposts on a claimed task the
      // way a price or a payout percent would.
      const { token } = await tokenFor('OPERATIONS');
      const c = await createDraft(token);
      const patch = (body: Body, expected: number) =>
        request(server())
          .patch(`/admin/campaigns/${c.id}`)
          .set('authorization', `Bearer ${token}`)
          .send(body)
          .expect(expected);

      await request(server())
        .post(`/admin/campaigns/${c.id}/publish`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      // ALONE, ON A LIVE CAMPAIGN: allowed, and it really lands.
      await patch({ searchKeyword: 'boldfit sports headband' }, 200).expect((r) =>
        expect(r.body.searchKeyword).toBe('boldfit sports headband'),
      );
      // And clearing it is the same kind of change, so it is allowed too.
      await patch({ searchKeyword: '' }, 200).expect((r) =>
        expect(r.body.searchKeyword).toBeNull(),
      );

      // EVERY OTHER FIELD IS STILL SHUT while live.
      await patch({ title: 'nope' }, 409);
      await patch({ productPricePaise: '999900' }, 409);
      await patch({ terms: 'new terms' }, 409);
      await patch({ payoutPercent: 50 }, 409);

      // AND THE EXEMPTION CANNOT CARRY A PASSENGER. A body with the keyword AND
      // anything else is refused exactly as before — otherwise the one allowed
      // field becomes a way to smuggle a price change past the lock.
      await patch({ searchKeyword: 'x', payoutPercent: 50 }, 409);
      await patch({ searchKeyword: 'x', terms: 'new terms' }, 409);
      await patch({ searchKeyword: 'x', productPricePaise: '1' }, 409);

      // AN ENDED CAMPAIGN STAYS COMPLETELY SHUT. Nobody types a search phrase
      // for an offer that is over.
      await request(server())
        .post(`/admin/campaigns/${c.id}/pause`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      await request(server())
        .post(`/admin/campaigns/${c.id}/end`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      await patch({ searchKeyword: 'too late' }, 409);
    });

    it('edits are allowed only while DRAFT or PAUSED', async () => {
      const { token } = await tokenFor('OPERATIONS');
      const c = await createDraft(token);
      const patch = (body: Body, expected: number) =>
        request(server())
          .patch(`/admin/campaigns/${c.id}`)
          .set('authorization', `Bearer ${token}`)
          .send(body)
          .expect(expected);

      // DRAFT → editable.
      await patch({ title: 'Edited while draft' }, 200);

      // ACTIVE → not editable.
      await request(server())
        .post(`/admin/campaigns/${c.id}/publish`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      await patch({ title: 'nope' }, 409);

      // PAUSED → editable again; "" clears the payout cap.
      await request(server())
        .post(`/admin/campaigns/${c.id}/pause`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      await request(server())
        .patch(`/admin/campaigns/${c.id}`)
        .set('authorization', `Bearer ${token}`)
        .send({ title: 'Edited while paused', payoutCapPaise: '' })
        .expect(200)
        .expect((r) => {
          expect(r.body.title).toBe('Edited while paused');
          expect(r.body.payoutCapPaise).toBeNull();
        });

      // ENDED → not editable.
      await request(server())
        .post(`/admin/campaigns/${c.id}/end`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      await patch({ title: 'nope again' }, 409);
    });

    it('404s an unknown campaign id', async () => {
      const { token } = await tokenFor('OPERATIONS');
      await request(server())
        .post('/admin/campaigns/00000000-0000-0000-0000-000000000000/publish')
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('audit trail', () => {
    it('records CAMPAIGN_CREATE and CAMPAIGN_STATUS', async () => {
      const { token } = await tokenFor('OPERATIONS');
      const c = await createDraft(token);
      await request(server())
        .post(`/admin/campaigns/${c.id}/publish`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const created = await prisma.adminAuditLog.findMany({
        where: { action: 'CAMPAIGN_CREATE' },
      });
      const status = await prisma.adminAuditLog.findMany({
        where: { action: 'CAMPAIGN_STATUS' },
      });
      expect(created).toHaveLength(1);
      expect(status).toHaveLength(1);
    });
  });
});
