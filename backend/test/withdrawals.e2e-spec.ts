import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { resetDatabase } from './reset-db';

/**
 * End-to-end for the withdrawal / cash-out flow (Phase 3). Boots the REAL app and
 * drives it over HTTP. Load-bearing assertions: a request RESERVES funds (balance
 * drops immediately), reject REVERSES them, approve→mark-paid pays out and grants
 * the +10 completion tickets, cross-user UPI/PAN dedup is refused, and the staff
 * console is staff-guarded.
 */
describe('Withdrawals (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
  let wallet: WalletService;
  let tickets: TicketService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9196${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
  const newPan = (): string => `ABCDE${String(1000 + seq++).slice(-4)}F`;

  async function makeUser(): Promise<{
    id: string;
    mobile: string;
    token: string;
  }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, mobile: user.mobile, token };
  }

  async function adminToken(): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `admin${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('x'),
        name: 'Test Admin',
        role: 'ADMIN',
      },
    });
    const session = await staffTokens.issueSession(staff);
    return session.accessToken;
  }

  async function fund(userId: string, paise: bigint): Promise<void> {
    await wallet.postRefund({
      userId,
      amountPaise: paise,
      idempotencyKey: `fund-${userId}-${paise.toString()}`,
      referenceType: 'test',
    });
  }

  async function addUpi(token: string, upiId: string): Promise<string> {
    const res = await request(server())
      .post('/me/payout-methods')
      .set('authorization', `Bearer ${token}`)
      .send({ type: 'UPI', pan: newPan(), upiId })
      .expect(201);
    return res.body.id as string;
  }

  async function walletPaise(token: string): Promise<string> {
    const res = await request(server())
      .get('/me/wallet')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.walletBalancePaise as string;
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
    wallet = app.get(WalletService);
    tickets = app.get(TicketService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const server = () => app.getHttpServer();

  describe('payout methods', () => {
    it('adds a UPI method (echoed masked) and lists it', async () => {
      const u = await makeUser();
      const res = await request(server())
        .post('/me/payout-methods')
        .set('authorization', `Bearer ${u.token}`)
        .send({ type: 'UPI', pan: 'abcde1234f', upiId: 'ravi@okaxis' })
        .expect(201);

      expect(res.body.type).toBe('UPI');
      expect(res.body.label).toContain('@okaxis');
      expect(res.body.label).not.toBe('ravi@okaxis'); // masked

      const list = await request(server())
        .get('/me/payout-methods')
        .set('authorization', `Bearer ${u.token}`)
        .expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('rejects a bad PAN (400) and an invalid UPI (400)', async () => {
      const u = await makeUser();
      await request(server())
        .post('/me/payout-methods')
        .set('authorization', `Bearer ${u.token}`)
        .send({ type: 'UPI', pan: 'NOPE', upiId: 'ravi@okaxis' })
        .expect(400);
      await request(server())
        .post('/me/payout-methods')
        .set('authorization', `Bearer ${u.token}`)
        .send({ type: 'UPI', pan: newPan(), upiId: 'not-a-vpa' })
        .expect(400);
    });

    it('refuses a UPI already used by another user (409 dedup)', async () => {
      const a = await makeUser();
      const b = await makeUser();
      await addUpi(a.token, 'shared@okaxis');
      await request(server())
        .post('/me/payout-methods')
        .set('authorization', `Bearer ${b.token}`)
        .send({ type: 'UPI', pan: newPan(), upiId: 'shared@okaxis' })
        .expect(409);
    });

    it('refuses a PAN already anchored to another user (409)', async () => {
      const a = await makeUser();
      const b = await makeUser();
      const pan = newPan();
      await request(server())
        .post('/me/payout-methods')
        .set('authorization', `Bearer ${a.token}`)
        .send({ type: 'UPI', pan, upiId: 'ravi.a@okaxis' })
        .expect(201);
      await request(server())
        .post('/me/payout-methods')
        .set('authorization', `Bearer ${b.token}`)
        .send({ type: 'UPI', pan, upiId: 'ravi.b@okaxis' })
        .expect(409);
    });
  });

  describe('request → reserve', () => {
    it('reserves funds so the available balance drops immediately', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');

      const res = await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(201);
      expect(res.body.status).toBe('REQUESTED');
      expect(res.body.amountPaise).toBe('50000');

      expect(await walletPaise(u.token)).toBe('150000');
    });

    it('refuses a withdrawal larger than the balance (409)', async () => {
      const u = await makeUser();
      await fund(u.id, 20_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(409);
      expect(await walletPaise(u.token)).toBe('20000'); // untouched
    });

    it('refuses an amount below the minimum (400)', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '5000', payoutMethodId: methodId })
        .expect(400);
    });
  });

  describe('staff lifecycle', () => {
    it('reject reverses the reserved funds back to the user', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      const req = await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(201);
      expect(await walletPaise(u.token)).toBe('150000');

      const admin = await adminToken();
      const rejected = await request(server())
        .post(`/admin/withdrawals/${req.body.id}/reject`)
        .set('authorization', `Bearer ${admin}`)
        .send({ reason: 'looks off' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');

      expect(await walletPaise(u.token)).toBe('200000'); // reversed
    });

    it('approve → mark-paid pays out and grants +10 for a refunded task', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');

      // A fully-completed (REFUNDED) task makes the +10 completion grant due.
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON',
          status: 'ACTIVE',
          title: 'Review the boAt Rockerz',
          productName: 'boAt Rockerz 255',
          productPricePaise: 129900n,
          payoutPercent: 100,
        },
      });
      await prisma.task.create({
        data: {
          userId: u.id,
          campaignId: campaign.id,
          platform: 'AMAZON',
          state: 'REFUNDED',
        },
      });
      expect(await tickets.getBalance(u.id)).toBe(0);

      const req = await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(201);
      const admin = await adminToken();

      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/approve`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      const paid = await request(server())
        .post(`/admin/withdrawals/${req.body.id}/mark-paid`)
        .set('authorization', `Bearer ${admin}`)
        .send({ utr: 'UTR-123456' })
        .expect(200);
      expect(paid.body.status).toBe('PAID');
      expect(paid.body.utr).toBe('UTR-123456');

      // Money already left the wallet at request; PAID moves none more.
      expect(await walletPaise(u.token)).toBe('150000');
      // ...and the +10 completion tickets landed exactly once.
      expect(await tickets.getBalance(u.id)).toBe(10);

      // mark-paid is not repeatable — the withdrawal is already terminal.
      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/mark-paid`)
        .set('authorization', `Bearer ${admin}`)
        .send({ utr: 'UTR-999' })
        .expect(409);
    });

    it('lists the staff queue and guards it from user tokens', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(201);

      // A user token must never reach the staff console.
      await request(server())
        .get('/admin/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .expect(401);

      const admin = await adminToken();
      const queue = await request(server())
        .get('/admin/withdrawals')
        .query({ status: 'REQUESTED' })
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect(queue.body).toHaveLength(1);
      expect(queue.body[0].user.mobile).toBe(u.mobile);
      expect(queue.body[0].payoutMethod.label).toContain('@okaxis');
    });
  });
});
