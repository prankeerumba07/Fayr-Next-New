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
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users","wallet_accounts","wallet_entries","ledger_transactions","ticket_entries" RESTART IDENTITY CASCADE',
    );
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
});
