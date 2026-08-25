import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * End-to-end for staff auth (step 2.1). Boots the REAL app and drives the
 * `/admin/auth` routes over HTTP. The load-bearing assertions are the trust-
 * domain isolation in BOTH directions:
 *   - a genuine USER access token is rejected at an /admin route, and
 *   - a genuine STAFF token is rejected at a user route.
 * Because staff and user tokens are signed with different secrets, neither
 * verifies in the other's guard — this proves it end-to-end.
 */
describe('Admin auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newEmail = (): string =>
    `staff${Date.now()}${seq++}@fayr.local`.toLowerCase();

  async function createStaff(opts: {
    email?: string;
    password?: string;
    role?: StaffRole;
    status?: 'ACTIVE' | 'DISABLED';
  }): Promise<{ id: string; email: string; password: string }> {
    const email = (opts.email ?? newEmail()).toLowerCase();
    const password = opts.password ?? 'a-strong-staff-passphrase';
    const staff = await prisma.staffUser.create({
      data: {
        email,
        passwordHash: await argon2.hash(password),
        name: 'Test Staff',
        role: opts.role ?? 'SUPPORT',
        status: opts.status ?? 'ACTIVE',
      },
    });
    return { id: staff.id, email, password };
  }

  /** Mint a genuine USER access token (signed with the USER secret). */
  async function userToken(): Promise<string> {
    const user = await prisma.user.create({
      data: { mobile: `+9199${String(Date.now()).slice(-8)}` },
    });
    return jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Admin e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const server = () => app.getHttpServer();

  describe('login', () => {
    it('issues a staff access token for correct credentials, stamps lastLoginAt, and audits', async () => {
      const staff = await createStaff({ role: 'ADMIN' });

      const res = await request(server())
        .post('/admin/auth/login')
        .send({ email: staff.email, password: staff.password })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.staff).toEqual({
        id: staff.id,
        email: staff.email,
        role: 'ADMIN',
      });

      const row = await prisma.staffUser.findUniqueOrThrow({
        where: { id: staff.id },
      });
      expect(row.lastLoginAt).not.toBeNull();

      const audits = await prisma.adminAuditLog.findMany({
        where: { staffUserId: staff.id },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe('STAFF_LOGIN');
    });

    it('normalizes the email (case/space-insensitive login)', async () => {
      const staff = await createStaff({ email: 'boss@fayr.local' });
      await request(server())
        .post('/admin/auth/login')
        .send({ email: '  Boss@Fayr.Local  ', password: staff.password })
        .expect(200);
    });

    it('rejects a wrong password with a generic 401 (no audit, no lastLoginAt)', async () => {
      const staff = await createStaff({});
      const res = await request(server())
        .post('/admin/auth/login')
        .send({ email: staff.email, password: 'wrong-password' })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');

      const row = await prisma.staffUser.findUniqueOrThrow({
        where: { id: staff.id },
      });
      expect(row.lastLoginAt).toBeNull();
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it('rejects an unknown email with the SAME generic 401', async () => {
      const res = await request(server())
        .post('/admin/auth/login')
        .send({ email: 'nobody@fayr.local', password: 'whatever-1234' })
        .expect(401);
      expect(res.body.message).toBe('Invalid credentials');
    });

    it('rejects a DISABLED account even with the right password', async () => {
      const staff = await createStaff({ status: 'DISABLED' });
      await request(server())
        .post('/admin/auth/login')
        .send({ email: staff.email, password: staff.password })
        .expect(401);
    });

    it('rejects a malformed email at validation (400)', async () => {
      await request(server())
        .post('/admin/auth/login')
        .send({ email: 'not-an-email', password: 'whatever-1234' })
        .expect(400);
    });
  });

  describe('me + trust-domain isolation', () => {
    async function login(role: StaffRole = 'SUPPORT'): Promise<string> {
      const staff = await createStaff({ role });
      const res = await request(server())
        .post('/admin/auth/login')
        .send({ email: staff.email, password: staff.password })
        .expect(200);
      return res.body.accessToken as string;
    }

    it('returns the principal for a valid staff token', async () => {
      const token = await login('ADMIN');
      const res = await request(server())
        .get('/admin/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.role).toBe('ADMIN');
      expect(res.body.email).toBeDefined();
    });

    it('is 401 without a token', async () => {
      await request(server()).get('/admin/auth/me').expect(401);
    });

    it('rejects a genuine USER token at an /admin route (401)', async () => {
      const token = await userToken();
      await request(server())
        .get('/admin/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('rejects a genuine STAFF token at a user route (401)', async () => {
      const token = await login('ADMIN');
      await request(server())
        .get('/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(401);
    });
  });
});
