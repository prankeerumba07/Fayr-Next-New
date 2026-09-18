import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { resetDatabase } from './reset-db';

/**
 * End-to-end for the staff unified user view (2.2). Boots the REAL app; the load-
 * bearing assertions are: search is BY MOBILE only (a Fayr id or UUID is rejected
 * at validation), the aggregated view is correct across all four ledgers/histories,
 * every access is audited, and the routes are staff-guarded.
 */
describe('Admin user view (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  let tickets: TicketService;
  let wallet: WalletService;
  let tasks: TaskService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9197${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function adminToken(): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `admin${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: 'Test Admin',
        role: 'ADMIN',
      },
    });
    const session = await staffTokens.issueSession(staff);
    return session.accessToken;
  }

  const makeCampaign = (
    over: Partial<Prisma.CampaignCreateInput> = {},
  ): Promise<Campaign> =>
    prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Review the boAt Rockerz',
        productName: 'boAt Rockerz 255 Pro+',
        category: 'electronics',
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
        ...over,
      },
    });

  /** Create a user with a full spread of activity for the view to aggregate. */
  async function seedUser(): Promise<{ id: string; mobile: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    await tickets.grantSignup(user.id); // +15
    const campaign = await makeCampaign();
    await tasks.claim(user.id, campaign.id, { terms: true }); // -5 tickets, 1 task

    // A refund credit, then a withdrawal debit, so both wallet sections populate.
    await wallet.postRefund({
      userId: user.id,
      amountPaise: 129900n,
      idempotencyKey: `refund-${user.id}`,
      referenceType: 'task',
    });
    const userAcct = await wallet.getOrCreateUserAccount(user.id);
    const payout = await wallet.ensureSystemAccount('PAYOUT');
    await wallet.post({
      kind: 'WITHDRAWAL',
      idempotencyKey: `wd-${user.id}`,
      legs: [
        { accountId: userAcct.id, amountPaise: -50000n },
        { accountId: payout.id, amountPaise: 50000n },
      ],
    });
    return { id: user.id, mobile: user.mobile };
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
    tickets = app.get(TicketService);
    wallet = app.get(WalletService);
    tasks = app.get(TaskService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Admin-users e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const server = () => app.getHttpServer();

  describe('search by mobile', () => {
    it('finds a user and returns a correct summary', async () => {
      const token = await adminToken();
      const user = await seedUser();

      const res = await request(server())
        .post('/admin/users/search')
        .send({ mobile: user.mobile })
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(user.id);
      expect(res.body.mobile).toBe(user.mobile);
      expect(res.body.displayId).toMatch(/^FAYR-\d{6}$/);
      expect(res.body.ticketBalance).toBe(10); // 15 - 5
      expect(res.body.walletBalancePaise).toBe('79900'); // 129900 - 50000
      expect(res.body.taskCount).toBe(1);
    });

    it('audits the search with the target user', async () => {
      const token = await adminToken();
      const user = await seedUser();
      await request(server())
        .post('/admin/users/search')
        .send({ mobile: user.mobile })
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const audits = await prisma.adminAuditLog.findMany({
        where: { action: 'USER_SEARCH' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].targetUserId).toBe(user.id);
    });

    it('404s an unknown mobile (still a valid E.164)', async () => {
      const token = await adminToken();
      await request(server())
        .post('/admin/users/search')
        .send({ mobile: '+919000000001' })
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects a Fayr display id as the lookup input (400)', async () => {
      const token = await adminToken();
      await request(server())
        .post('/admin/users/search')
        .send({ mobile: 'FAYR-100001' })
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects a UUID as the lookup input (400)', async () => {
      const token = await adminToken();
      await request(server())
        .post('/admin/users/search')
        .send({ mobile: '11111111-1111-4111-8111-111111111111' })
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('is 401 without a staff token, and for a user token', async () => {
      await request(server())
        .post('/admin/users/search')
        .send({ mobile: '+919000000002' })
        .expect(401);

      const someUser = await prisma.user.create({
        data: { mobile: newMobile() },
      });
      const userJwt = await jwt.signAsync(
        { sub: someUser.id, mobile: someUser.mobile },
        { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
      );
      await request(server())
        .post('/admin/users/search')
        .send({ mobile: someUser.mobile })
        .set('authorization', `Bearer ${userJwt}`)
        .expect(401);
    });
  });

  describe('full view', () => {
    it('aggregates profile, ledgers, tasks and withdrawals; audits the access', async () => {
      const token = await adminToken();
      const user = await seedUser();

      const res = await request(server())
        .get(`/admin/users/${user.id}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile.id).toBe(user.id);
      expect(res.body.tickets.balance).toBe(10);
      expect(res.body.tickets.entries).toHaveLength(2); // signup + claim
      expect(res.body.wallet.balancePaise).toBe('79900');
      expect(res.body.wallet.entries).toHaveLength(2); // refund + withdrawal
      expect(res.body.withdrawals).toHaveLength(1);
      expect(res.body.withdrawals[0].amountPaise).toBe('-50000');
      expect(res.body.tasks).toHaveLength(1);

      const audits = await prisma.adminAuditLog.findMany({
        where: { action: 'USER_VIEW' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].targetUserId).toBe(user.id);
    });

    it('carries the name when there is one, and null when there is not', async () => {
      // ── THE FIELD A SUPPORT AGENT READS BACK ALOUD ────────────────────
      //
      // Both halves in one test, because the risk is the pair: a view that can
      // only be trusted to show a name honestly if the absence of one arrives as
      // an absence. The seeded user gives no name, which is the ordinary case \u2014
      // setup can be finished without one and the practice data creates none.
      const token = await adminToken();
      const nameless = await seedUser();
      const named = await prisma.user.create({
        data: { mobile: newMobile(), name: 'Asha Kumari' },
      });

      const view = (id: string) =>
        request(server())
          .get(`/admin/users/${id}`)
          .set('authorization', `Bearer ${token}`)
          .expect(200);

      const without = await view(nameless.id);
      expect(without.body.profile.name).toBeNull();
      // NOT an empty string, and not a placeholder somebody could read back.
      expect(without.body.profile.name).not.toBe('');
      expect(JSON.stringify(without.body.profile)).not.toMatch(/Unknown|Anonymous/i);
      // And the mobile is still there, so the screen always has something real
      // to identify somebody by.
      expect(without.body.profile.mobile).toBe(nameless.mobile);

      const with_ = await view(named.id);
      expect(with_.body.profile.name).toBe('Asha Kumari');
      expect(with_.body.profile.mobile).toBe(named.mobile);
    });

    it('rejects a non-UUID id (e.g. a display id) at the route (400)', async () => {
      const token = await adminToken();
      await request(server())
        .get('/admin/users/FAYR-100001')
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('404s a well-formed but unknown user id', async () => {
      const token = await adminToken();
      await request(server())
        .get('/admin/users/22222222-2222-4222-8222-222222222222')
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
