import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { resetDatabase } from './reset-db';

/** E2E for the user's own balances endpoint (feeds the app's wallet screen). */
describe('Me (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let tickets: TicketService;
  let wallet: WalletService;

  let seq = 0;
  const newMobile = (): string =>
    `+9190${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function newUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
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
    tickets = app.get(TicketService);
    wallet = app.get(WalletService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Me e2e aborted: non-test database');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const server = () => app.getHttpServer();

  it('returns zero balances for a fresh user', async () => {
    const user = await newUser();
    const res = await request(server())
      .get('/me/wallet')
      .set('authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body).toEqual({ ticketBalance: 0, walletBalancePaise: '0' });
  });

  it('reflects the ticket grant and a refund credit, money as a string', async () => {
    const user = await newUser();
    await tickets.grantSignup(user.id); // +15
    await wallet.postRefund({
      userId: user.id,
      amountPaise: 129900n,
      idempotencyKey: `r-${user.id}`,
    });

    const res = await request(server())
      .get('/me/wallet')
      .set('authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.ticketBalance).toBe(15);
    expect(res.body.walletBalancePaise).toBe('129900');
    expect(typeof res.body.walletBalancePaise).toBe('string');
  });

  it('is 401 without a token', async () => {
    await request(server()).get('/me/wallet').expect(401);
  });

  // ── Profile: what the first-run setup sequence writes ────────────────────
  describe('GET/PATCH /me (setup profile)', () => {
    it('a fresh user has an empty profile and setupDone false', async () => {
      const user = await newUser();
      const res = await request(server())
        .get('/me')
        .set('authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.name).toBeNull();
      expect(res.body.ageBand).toBeNull();
      expect(res.body.categories).toEqual([]);
      expect(res.body.platforms).toEqual([]);
      expect(res.body.setupDone).toBe(false);
      expect(res.body.displayId).toMatch(/^FAYR-\d{6}$/);
    });

    it('never returns the PAN itself, only whether one is on file', async () => {
      const user = await newUser();
      await prisma.user.update({
        where: { id: user.id },
        data: { pan: `ABCDE${String(Date.now()).slice(-4)}F` },
      });
      const res = await request(server())
        .get('/me')
        .set('authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(res.body.hasPan).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/ABCDE/);
      expect(res.body.pan).toBeUndefined();
    });

    it('saves PROGRESSIVELY — a later step does not wipe an earlier answer', async () => {
      const user = await newUser();
      await request(server())
        .patch('/me')
        .set('authorization', `Bearer ${user.token}`)
        .send({ ageBand: '25 - 34', gender: 'Female' })
        .expect(200);
      // Step 2 sends only categories. Age/gender must survive — a user who
      // abandons setup halfway keeps what they already answered.
      const res = await request(server())
        .patch('/me')
        .set('authorization', `Bearer ${user.token}`)
        .send({ categories: ['Footwear', 'Home & Kitchen', 'Fashion & Apparel'] })
        .expect(200);
      expect(res.body.ageBand).toBe('25 - 34');
      expect(res.body.gender).toBe('Female');
      expect(res.body.categories).toHaveLength(3);
    });

    it('de-duplicates repeated selections', async () => {
      const user = await newUser();
      const res = await request(server())
        .patch('/me')
        .set('authorization', `Bearer ${user.token}`)
        .send({ platforms: ['amazon', 'amazon', 'flipkart'] })
        .expect(200);
      expect(res.body.platforms).toEqual(['amazon', 'flipkart']);
    });

    it('setupDone latches ON and can never be cleared', async () => {
      const user = await newUser();
      await request(server())
        .patch('/me')
        .set('authorization', `Bearer ${user.token}`)
        .send({ setupDone: true })
        .expect(200);
      // A later profile edit must not reopen onboarding for someone who finished.
      const res = await request(server())
        .patch('/me')
        .set('authorization', `Bearer ${user.token}`)
        .send({ setupDone: false, name: 'Renamed' })
        .expect(200);
      expect(res.body.setupDone).toBe(true);
      expect(res.body.name).toBe('Renamed');
    });

    it('counts as done even with no name — "prefer not to say" must not loop forever', async () => {
      const user = await newUser();
      const res = await request(server())
        .patch('/me')
        .set('authorization', `Bearer ${user.token}`)
        .send({ gender: 'Prefer not to say', setupDone: true })
        .expect(200);
      expect(res.body.setupDone).toBe(true);
      expect(res.body.name).toBeNull();
    });

    it('rejects values outside the offered lists, and a too-short name', async () => {
      const user = await newUser();
      const bad = [
        { ageBand: '12 - 17' },
        { gender: 'banana' },
        { categories: ['Fashion & Apparel', 'Not A Category'] },
        { platforms: ['ebay'] },
        { name: 'A' },
      ];
      for (const body of bad) {
        await request(server())
          .patch('/me')
          .set('authorization', `Bearer ${user.token}`)
          .send(body)
          .expect(400);
      }
    });

    it('is 401 without a token, on both read and write', async () => {
      await request(server()).get('/me').expect(401);
      await request(server()).patch('/me').send({ name: 'Nope' }).expect(401);
    });
  });
});
