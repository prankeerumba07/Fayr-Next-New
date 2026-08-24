import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * End-to-end for the staff reports (Stage 4). Boots the real app and asserts the
 * per-type RBAC gate, the JSON shape on an empty DB, aggregation correctness over
 * seeded data, date validation, and the .xlsx download (+ its audit row).
 */
describe('Admin reports (e2e)', () => {
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

  const server = () => app.getHttpServer();

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
      throw new Error(`report e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const TYPES = ['campaigns', 'payouts', 'activity', 'users'] as const;
  const ALLOW: Record<string, StaffRole[]> = {
    campaigns: ['OPERATIONS', 'ADMIN'],
    payouts: ['FINANCE', 'ADMIN'],
    activity: ['ADMIN'],
    users: ['ADMIN'],
  };
  const ALL_ROLES: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];

  describe('RBAC', () => {
    for (const type of TYPES) {
      it(`${type}: allowed for [${ALLOW[type].join(', ')}], 403 for the rest, 401 unauth`, async () => {
        for (const role of ALL_ROLES) {
          const { token } = await tokenFor(role);
          await request(server())
            .get(`/admin/reports/${type}`)
            .set('authorization', `Bearer ${token}`)
            .expect(ALLOW[type].includes(role) ? 200 : 403);
        }
        await request(server()).get(`/admin/reports/${type}`).expect(401);
      });
    }
  });

  describe('shape (empty DB)', () => {
    it('each report returns its structure with a resolved range', async () => {
      const { token } = await tokenFor('ADMIN');
      const get = (type: string) =>
        request(server())
          .get(`/admin/reports/${type}`)
          .set('authorization', `Bearer ${token}`)
          .expect(200);

      const campaigns = await get('campaigns');
      expect(campaigns.body.range.granularity).toBe('day');
      expect(campaigns.body.range.from).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(campaigns.body.totals).toEqual({
        campaigns: 0,
        claims: 0,
        purchases: 0,
        reviews: 0,
        refunds: 0,
      });
      expect(campaigns.body.rows).toEqual([]);

      const payouts = await get('payouts');
      expect(payouts.body.refundsCreditedPaise).toBe('0');
      expect(payouts.body.withdrawalsByStatus).toHaveLength(5);
      expect(Array.isArray(payouts.body.series)).toBe(true);

      const activity = await get('activity');
      expect(activity.body.funnel.claimed).toBe(0);

      const users = await get('users');
      expect(users.body.newSignups).toBe(0);
      // Default range is ~30 daily buckets.
      expect(users.body.series.length).toBeGreaterThanOrEqual(28);
      expect(users.body.series.length).toBeLessThanOrEqual(31);
    });
  });

  describe('aggregation (seeded)', () => {
    async function seed() {
      const user = await prisma.user.create({
        data: { mobile: `+9199${String(Date.now()).slice(-8)}` },
      });
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON',
          status: 'ACTIVE',
          title: 'Seed campaign',
          productName: 'Seed product',
          productPricePaise: 100000n,
          totalSlots: 10,
        },
      });
      // Two tasks: one still CLAIMED, one REFUNDED.
      await prisma.task.create({
        data: {
          userId: user.id,
          campaignId: campaign.id,
          platform: 'AMAZON',
          state: 'CLAIMED',
        },
      });
      await prisma.task.create({
        data: {
          userId: user.id,
          campaignId: campaign.id,
          platform: 'AMAZON',
          state: 'REFUNDED',
          closedAt: new Date(),
        },
      });
      // A REFUND ledger transaction: +500.00 to the user, -500.00 from HOUSE.
      const userAcct = await prisma.walletAccount.create({
        data: { kind: 'USER', userId: user.id },
      });
      const houseAcct = await prisma.walletAccount.create({
        data: { kind: 'HOUSE' },
      });
      const txn = await prisma.ledgerTransaction.create({
        data: { kind: 'REFUND', idempotencyKey: `seed-${Date.now()}` },
      });
      await prisma.walletEntry.createMany({
        data: [
          {
            transactionId: txn.id,
            accountId: userAcct.id,
            amountPaise: 50000n,
          },
          {
            transactionId: txn.id,
            accountId: houseAcct.id,
            amountPaise: -50000n,
          },
        ],
      });
      // A REQUESTED withdrawal for ₹300.
      const pm = await prisma.payoutMethod.create({
        data: { userId: user.id, type: 'UPI', upiId: 'seed@bank' },
      });
      await prisma.withdrawal.create({
        data: {
          userId: user.id,
          payoutMethodId: pm.id,
          amountPaise: 30000n,
          status: 'REQUESTED',
        },
      });
      return { campaign };
    }

    it('campaigns: counts claims, purchases (incl. refunded), refunds', async () => {
      const { campaign } = await seed();
      const { token } = await tokenFor('ADMIN');
      const res = await request(server())
        .get('/admin/reports/campaigns')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.totals).toMatchObject({
        campaigns: 1,
        claims: 2,
        purchases: 1,
        refunds: 1,
      });
      const row = res.body.rows[0];
      expect(row.campaignId).toBe(campaign.id);
      expect(row.claims).toBe(2);
      expect(row.purchases).toBe(1);
      expect(row.purchaseConversionPct).toBe(50);
      expect(row.fillRatePct).toBe(20); // 2 claims / 10 slots
    });

    it('activity: funnel reflects the seeded cohort', async () => {
      await seed();
      const { token } = await tokenFor('ADMIN');
      const res = await request(server())
        .get('/admin/reports/activity')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.funnel.claimed).toBe(2);
      expect(res.body.funnel.purchased).toBe(1);
      expect(res.body.funnel.refunded).toBe(1);
    });

    it('users: signups, active claimers, cumulative', async () => {
      await seed();
      const { token } = await tokenFor('ADMIN');
      const res = await request(server())
        .get('/admin/reports/users')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.newSignups).toBe(1);
      expect(res.body.activeClaimers).toBe(1);
      expect(res.body.cumulativeUsers).toBe(1);
    });

    it('payouts: refunds credited + withdrawals by status', async () => {
      await seed();
      const { token } = await tokenFor('FINANCE');
      const res = await request(server())
        .get('/admin/reports/payouts')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.refundsCreditedPaise).toBe('50000');
      expect(res.body.refundsCreditedCount).toBe(1);
      const requested = res.body.withdrawalsByStatus.find(
        (s: { status: string }) => s.status === 'REQUESTED',
      );
      expect(requested).toMatchObject({ count: 1, totalPaise: '30000' });
    });
  });

  describe('validation', () => {
    it('rejects from>to, a bad date, and a bad granularity (400)', async () => {
      const { token } = await tokenFor('ADMIN');
      const bad = (qs: string) =>
        request(server())
          .get(`/admin/reports/campaigns${qs}`)
          .set('authorization', `Bearer ${token}`)
          .expect(400);
      await bad('?from=2026-07-31&to=2026-07-01');
      await bad('?from=notadate');
      await bad('?granularity=hourly');
    });
  });

  describe('xlsx download', () => {
    it('streams an .xlsx attachment and audits REPORT_DOWNLOAD', async () => {
      const { token } = await tokenFor('ADMIN');
      const res = await request(server())
        .get('/admin/reports/payouts?format=xlsx')
        .set('authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain(
        'openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.xlsx');
      // PK\x03\x04 — the ZIP/OOXML magic number.
      const body = res.body as Buffer;
      expect(body.subarray(0, 2).toString('latin1')).toBe('PK');

      const audits = await prisma.adminAuditLog.findMany({
        where: { action: 'REPORT_DOWNLOAD' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toMatchObject({ type: 'payouts' });
    });
  });
});
