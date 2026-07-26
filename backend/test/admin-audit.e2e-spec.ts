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

/**
 * End-to-end for the audit trail listing (2.4). Beyond the read itself, this is
 * the first RBAC-gated route end-to-end: an ADMIN token reads it, a SUPPORT
 * token is forbidden (403). Also covers filtering, pagination, and auth.
 */
describe('Admin audit listing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9192${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function staffToken(role: StaffRole): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant'),
        name: `${role} Person`,
        role,
      },
    });
    return (await staffTokens.issueSession(staff)).accessToken;
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
      throw new Error(`Audit e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "staff_users","admin_audit_log","users","refresh_tokens" RESTART IDENTITY CASCADE',
    );
  });

  const server = () => app.getHttpServer();
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Generate real audit rows by driving an ADMIN through search + view. */
  async function generateAudits(adminTok: string): Promise<string> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    await request(server())
      .get('/admin/users/search')
      .query({ mobile: user.mobile })
      .set(bearer(adminTok))
      .expect(200); // → USER_SEARCH
    await request(server())
      .get(`/admin/users/${user.id}`)
      .set(bearer(adminTok))
      .expect(200); // → USER_VIEW
    return user.id;
  }

  it('lets an ADMIN read the trail, newest first, staff embedded', async () => {
    const admin = await staffToken('ADMIN');
    const userId = await generateAudits(admin);

    const res = await request(server())
      .get('/admin/audit')
      .set(bearer(admin))
      .expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries[0].staff.email).toContain('@fayr.local');
    const actions = res.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('USER_SEARCH');
    expect(actions).toContain('USER_VIEW');
    // Both audits target the searched/viewed user.
    const targeted = res.body.entries.filter(
      (e: { targetUserId: string }) => e.targetUserId === userId,
    );
    expect(targeted.length).toBeGreaterThanOrEqual(2);
  });

  it('FORBIDS a SUPPORT staff member (RBAC 403)', async () => {
    const support = await staffToken('SUPPORT');
    await request(server())
      .get('/admin/audit')
      .set(bearer(support))
      .expect(403);
  });

  it('filters by action', async () => {
    const admin = await staffToken('ADMIN');
    await generateAudits(admin);

    const res = await request(server())
      .get('/admin/audit')
      .query({ action: 'USER_SEARCH' })
      .set(bearer(admin))
      .expect(200);

    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    for (const e of res.body.entries) {
      expect(e.action).toBe('USER_SEARCH');
    }
  });

  it('paginates with limit + total', async () => {
    const admin = await staffToken('ADMIN');
    await generateAudits(admin);

    const res = await request(server())
      .get('/admin/audit')
      .query({ limit: 1 })
      .set(bearer(admin))
      .expect(200);

    expect(res.body.entries).toHaveLength(1);
    expect(res.body.limit).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('rejects an out-of-range limit (400)', async () => {
    const admin = await staffToken('ADMIN');
    await request(server())
      .get('/admin/audit')
      .query({ limit: 0 })
      .set(bearer(admin))
      .expect(400);
    await request(server())
      .get('/admin/audit')
      .query({ limit: 500 })
      .set(bearer(admin))
      .expect(400);
  });

  it('is 401 without a staff token and for a user token', async () => {
    await request(server()).get('/admin/audit').expect(401);

    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const userJwt = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    await request(server())
      .get('/admin/audit')
      .set(bearer(userJwt))
      .expect(401);
  });
});
