import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end for the expanded staff roles (Phase 4). Boots the REAL app and
 * asserts the RBAC matrix per role across every admin area, plus staff-account
 * management (ADMIN-only, audited, last-admin guard) and that a freshly created
 * account can log in and use exactly its role's area.
 */
describe('Staff roles / RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;

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
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`RBAC e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "staff_users","admin_audit_log","users","campaigns","tasks","task_events","visibility_checks","ticket_entries","wallet_accounts","wallet_entries","ledger_transactions","payout_methods","withdrawals","refresh_tokens" RESTART IDENTITY CASCADE',
    );
  });

  const server = () => app.getHttpServer();

  // Each guarded area, the roles allowed, and the status a passing role gets.
  const MATRIX: {
    name: string;
    path: string;
    allow: StaffRole[];
    ok: number;
  }[] = [
    {
      name: 'user view',
      path: '/admin/users/search?mobile=%2B919000000001',
      allow: ['SUPPORT', 'FINANCE', 'ADMIN'],
      ok: 404, // guard passed → "unknown mobile", not 403
    },
    {
      name: 'support questions',
      path: '/admin/questions',
      allow: ['SUPPORT', 'ADMIN'],
      ok: 200,
    },
    {
      name: 'withdrawals',
      path: '/admin/withdrawals',
      allow: ['FINANCE', 'ADMIN'],
      ok: 200,
    },
    { name: 'audit log', path: '/admin/audit', allow: ['ADMIN'], ok: 200 },
    {
      name: 'staff management',
      path: '/admin/staff',
      allow: ['ADMIN'],
      ok: 200,
    },
  ];

  const ALL_ROLES: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];

  describe('RBAC matrix', () => {
    for (const cell of MATRIX) {
      it(`${cell.name}: allowed for [${cell.allow.join(', ')}], 403 for the rest`, async () => {
        for (const role of ALL_ROLES) {
          const { token } = await tokenFor(role);
          const expected = cell.allow.includes(role) ? cell.ok : 403;
          await request(server())
            .get(cell.path)
            .set('authorization', `Bearer ${token}`)
            .expect(expected);
        }
      });
    }

    it('duplicate-order override: SUPPORT and ADMIN only, and a bad task is 404 not 403', async () => {
      // POST, so it sits outside the GET matrix above. A passing role must reach
      // the handler (404 on an unknown task); a failing role must never get that
      // far. This is the button that lets one purchase be paid twice, so who can
      // press it is worth pinning explicitly.
      const unknownTask = '00000000-0000-0000-0000-0000000000ff';
      for (const role of ALL_ROLES) {
        const { token } = await tokenFor(role);
        const expected = role === 'SUPPORT' || role === 'ADMIN' ? 404 : 403;
        await request(server())
          .post(`/admin/tasks/${unknownTask}/allow-duplicate-order`)
          .set('authorization', `Bearer ${token}`)
          .send({ reason: 'merged cart, two separate items' })
          .expect(expected);
      }
    });

    it('duplicate-order override requires a reason', async () => {
      const { token } = await tokenFor('SUPPORT');
      await request(server())
        .post('/admin/tasks/00000000-0000-0000-0000-0000000000ff/allow-duplicate-order')
        .set('authorization', `Bearer ${token}`)
        .send({})
        .expect(400); // the audit row is worthless without the reasoning
    });

    it('ADMIN super-role passes a route it is not explicitly listed on', async () => {
      // /admin/questions is @Roles('SUPPORT') — ADMIN is not in the list but the
      // guard treats ADMIN as a super-role.
      const { token } = await tokenFor('ADMIN');
      await request(server())
        .get('/admin/questions')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('staff management (ADMIN only)', () => {
    it('creates an account (masked of its hash), lists it, and audits STAFF_CREATE', async () => {
      const admin = await tokenFor('ADMIN');
      const res = await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .send({
          email: 'Finance.One@Fayr.APP',
          name: 'Fin One',
          role: 'FINANCE',
          password: 'financepass123',
        })
        .expect(201);
      expect(res.body.role).toBe('FINANCE');
      expect(res.body.email).toBe('finance.one@fayr.app'); // normalized
      expect(res.body.passwordHash).toBeUndefined();

      const list = await request(server())
        .get('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(
        list.body.some(
          (s: { email: string }) => s.email === 'finance.one@fayr.app',
        ),
      ).toBe(true);

      const audits = await prisma.adminAuditLog.findMany({
        where: { action: 'STAFF_CREATE' },
      });
      expect(audits).toHaveLength(1);
    });

    it('refuses a duplicate email (409), a bad role (400), and a short password (400)', async () => {
      const admin = await tokenFor('ADMIN');
      await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .send({
          email: 'dup@fayr.app',
          name: 'A',
          role: 'SUPPORT',
          password: 'longenoughpw12',
        })
        .expect(201);
      await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .send({
          email: 'dup@fayr.app',
          name: 'B',
          role: 'SUPPORT',
          password: 'longenoughpw12',
        })
        .expect(409);
      await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .send({
          email: 'x@fayr.app',
          name: 'X',
          role: 'WIZARD',
          password: 'longenoughpw12',
        })
        .expect(400);
      await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .send({
          email: 'y@fayr.app',
          name: 'Y',
          role: 'SUPPORT',
          password: 'short',
        })
        .expect(400);
    });

    it('changes a role, then blocks removing the last active admin', async () => {
      const admin = await tokenFor('ADMIN');
      const target = await tokenFor('SUPPORT');

      // Promote SUPPORT → OPERATIONS.
      await request(server())
        .patch(`/admin/staff/${target.id}`)
        .set('authorization', `Bearer ${admin.token}`)
        .send({ role: 'OPERATIONS' })
        .expect(200)
        .expect((r) => expect(r.body.role).toBe('OPERATIONS'));

      // The acting admin is the only ADMIN → can't demote or disable them.
      await request(server())
        .patch(`/admin/staff/${admin.id}`)
        .set('authorization', `Bearer ${admin.token}`)
        .send({ role: 'SUPPORT' })
        .expect(409);
      await request(server())
        .patch(`/admin/staff/${admin.id}`)
        .set('authorization', `Bearer ${admin.token}`)
        .send({ status: 'DISABLED' })
        .expect(409);
    });

    it('a non-admin cannot manage staff (403)', async () => {
      const support = await tokenFor('SUPPORT');
      await request(server())
        .get('/admin/staff')
        .set('authorization', `Bearer ${support.token}`)
        .expect(403);
      await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${support.token}`)
        .send({
          email: 'z@fayr.app',
          name: 'Z',
          role: 'SUPPORT',
          password: 'longenoughpw12',
        })
        .expect(403);
    });

    it('a newly created FINANCE account can log in and reach withdrawals (not questions)', async () => {
      const admin = await tokenFor('ADMIN');
      await request(server())
        .post('/admin/staff')
        .set('authorization', `Bearer ${admin.token}`)
        .send({
          email: 'newfin@fayr.app',
          name: 'New Fin',
          role: 'FINANCE',
          password: 'financepass123',
        })
        .expect(201);

      const login = await request(server())
        .post('/admin/auth/login')
        .send({ email: 'newfin@fayr.app', password: 'financepass123' })
        .expect(200);
      const token = login.body.accessToken as string;
      expect(login.body.staff.role).toBe('FINANCE');

      await request(server())
        .get('/admin/withdrawals')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      await request(server())
        .get('/admin/questions')
        .set('authorization', `Bearer ${token}`)
        .expect(403);
    });
  });
});
