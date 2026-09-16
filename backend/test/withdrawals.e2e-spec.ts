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

    /**
     * WHAT THE FIGURE IN THE QUEUE IS DRAWN FROM.
     *
     * ── WHY THIS CHECK EXISTS, MEASURED 16 SEPTEMBER 2026 ────────────────
     *
     * The owner read ₹100.00 on a queue card, beside an order whose product was
     * ₹938.00 and whose bill was ₹1,331.00, and took it for that order's refund.
     * It never was. A withdrawal row has a user, a payout method and an amount,
     * and NO link to a task or a campaign anywhere in the schema — so the card
     * was showing a true figure with nothing behind it, and ₹100.00 on the
     * practice account is ₹100.00 only because the demo seed asks for exactly
     * MIN_WITHDRAWAL_PAISE.
     *
     * So the queue now says where the money came from. Nothing about the amount
     * itself changed: it was right, and it still is.
     */
    it('SAYS WHAT THE CASH-OUT IS DRAWN FROM, so a figure is never bare', async () => {
      const u = await makeUser();
      await fund(u.id, 93_800n);
      await fund(u.id, 50_000n);
      const methodId = await addUpi(u.token, 'basis@okaxis');
      await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '10000', payoutMethodId: methodId })
        .expect(201);

      const admin = await adminToken();
      const queue = await request(server())
        .get('/admin/withdrawals')
        .query({ status: 'REQUESTED' })
        .set('authorization', `Bearer ${admin}`)
        .expect(200);

      const row = queue.body[0];
      // THE AMOUNT IS UNCHANGED. It was never wrong.
      expect(row.amountPaise).toBe('10000');
      // AND IT IS NO LONGER BARE.
      expect(row.basis).toBeDefined();
      expect(row.basis.refundsPaise).toBe('143800');
      expect(row.basis.howManyRefunds).toBe(2);
      // The balance is what is left after the request reserved its own money,
      // which is the honest thing to show somebody about to approve it.
      expect(BigInt(row.basis.walletBalancePaise)).toBe(143_800n - 10_000n);

      // ── AND THE REQUEST IS NOT COUNTED AS A REFUND ────────────────────
      //
      // A withdrawal's own reservation sits on the same account and is negative.
      // Netting it in would tell a staff member the refunds were smaller than
      // they were, and on a fully cashed-out account it would read as none. The
      // two figures differing by exactly the reservation is what says the
      // reservation was seen and excluded, rather than never having been there.
      expect(BigInt(row.basis.refundsPaise)).toBeGreaterThan(
        BigInt(row.basis.walletBalancePaise),
      );
      expect(
        BigInt(row.basis.refundsPaise) - BigInt(row.basis.walletBalancePaise),
      ).toBe(10_000n);
      // AND THE COUNT IS OF REFUNDS, NOT OF LEDGER LEGS. Three legs touch this
      // account — two refunds in and one reservation out — and the card must say
      // two, or a person reads it as an extra payment they cannot find.
      expect(row.basis.howManyRefunds).toBe(2);
    });

    it('and one look-up per account, however many requests they have', async () => {
      // Three requests from one person is one wallet, not three reads of it —
      // and all three must agree about it, which they cannot do if each is
      // computed from a different snapshot.
      const u = await makeUser();
      await fund(u.id, 100_000n);
      const methodId = await addUpi(u.token, 'three@okaxis');
      for (const amount of ['10000', '10000', '10000']) {
        await request(server())
          .post('/withdrawals')
          .set('authorization', `Bearer ${u.token}`)
          .send({ amountPaise: amount, payoutMethodId: methodId })
          .expect(201);
      }
      const admin = await adminToken();
      const queue = await request(server())
        .get('/admin/withdrawals')
        .query({ status: 'REQUESTED' })
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect(queue.body).toHaveLength(3);
      const seen = new Set(queue.body.map((r: { basis: { walletBalancePaise: string } }) =>
        r.basis.walletBalancePaise));
      expect(seen.size).toBe(1);
    });
  });
  /**
   * THE TRAIL, END TO END.
   *
   * Before this, approving and paying a withdrawal wrote the staff id onto the
   * withdrawal row and NOTHING to the audit log — the one action that takes money
   * out of the company was the one action with no entry in the trail, while staff
   * viewing a screenshot and staff logging in both had one.
   *
   * Read back through GET /admin/audit deliberately, not straight out of the
   * table: what matters is not that a row exists somewhere, but that a payout
   * appears in the SAME trail an admin already reads for everything else.
   */
  describe('the audit trail', () => {
    async function auditRows(
      admin: string,
      action: string,
    ): Promise<Array<{ metadata: Record<string, unknown> | null }>> {
      const res = await request(server())
        .get('/admin/audit')
        .query({ action })
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      return res.body.entries as Array<{
        metadata: Record<string, unknown> | null;
      }>;
    }

    it('marking a withdrawal paid leaves a row in the same trail as everything else', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      const req = await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '59040', payoutMethodId: methodId })
        .expect(201);
      const admin = await adminToken();

      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/approve`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/mark-paid`)
        .set('authorization', `Bearer ${admin}`)
        .send({ utr: 'AXISR52026082512345' })
        .expect(200);

      const approved = await auditRows(admin, 'WITHDRAWAL_APPROVE');
      expect(approved).toHaveLength(1);
      expect(approved[0].metadata).toEqual({
        withdrawalId: req.body.id,
        amountPaise: '59040',
        previousStatus: 'REQUESTED',
      });

      const paid = await auditRows(admin, 'WITHDRAWAL_MARK_PAID');
      expect(paid).toHaveLength(1);
      expect(paid[0].metadata).toEqual({
        withdrawalId: req.body.id,
        amountPaise: '59040',
        previousStatus: 'APPROVED',
        utr: 'AXISR52026082512345',
      });
    });

    it('names the staff member who decided, and the user it was about', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
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

      // Filtering the trail by the USER must surface the payout decision, or a
      // dispute about one person's money cannot be answered from the trail.
      const byUser = await request(server())
        .get('/admin/audit')
        .query({ targetUserId: u.id, action: 'WITHDRAWAL_APPROVE' })
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect(byUser.body.entries).toHaveLength(1);
      expect(byUser.body.entries[0].targetUserId).toBe(u.id);
      expect(byUser.body.entries[0].staff.email).toMatch(/@fayr\.local$/);
    });

    it('rejecting records the reason and the entry that gave the money back', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      const req = await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(201);
      const admin = await adminToken();
      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/reject`)
        .set('authorization', `Bearer ${admin}`)
        .send({ reason: 'the account name does not match the PAN' })
        .expect(200);

      const rows = await auditRows(admin, 'WITHDRAWAL_REJECT');
      expect(rows).toHaveLength(1);
      const meta = rows[0].metadata as Record<string, string>;
      expect(meta.reason).toBe('the account name does not match the PAN');
      expect(meta.previousStatus).toBe('REQUESTED');
      expect(meta.amountPaise).toBe('50000');
      // The reversal really is the ledger entry that returned the money.
      const txn = await prisma.ledgerTransaction.findUnique({
        where: { id: meta.reversalTxnId },
      });
      expect(txn?.idempotencyKey).toBe(`withdrawal:reversal:${req.body.id}`);
    });

    it('a refused decision writes nothing at all', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
      const req = await request(server())
        .post('/withdrawals')
        .set('authorization', `Bearer ${u.token}`)
        .send({ amountPaise: '50000', payoutMethodId: methodId })
        .expect(201);
      const admin = await adminToken();

      // mark-paid on a REQUESTED withdrawal: refused, so nothing happened, so
      // there is nothing to record.
      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/mark-paid`)
        .set('authorization', `Bearer ${admin}`)
        .send({ utr: 'UTR-NOPE' })
        .expect(409);
      expect(await auditRows(admin, 'WITHDRAWAL_MARK_PAID')).toEqual([]);
    });

    it('marking a payout failed records that it moved from APPROVED', async () => {
      const u = await makeUser();
      await fund(u.id, 200_000n);
      const methodId = await addUpi(u.token, 'ravi@okaxis');
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
      await request(server())
        .post(`/admin/withdrawals/${req.body.id}/mark-failed`)
        .set('authorization', `Bearer ${admin}`)
        .send({ reason: 'the bank returned the transfer' })
        .expect(200);

      const rows = await auditRows(admin, 'WITHDRAWAL_MARK_FAILED');
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata).toMatchObject({
        previousStatus: 'APPROVED',
        reason: 'the bank returned the transfer',
      });
      // And the money is back in the wallet.
      expect(await walletPaise(u.token)).toBe('200000');
    });
  });
});
