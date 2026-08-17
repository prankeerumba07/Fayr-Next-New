import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { BLOCKERS } from '../src/tasks/engine/states';
import { ORDER_WINDOW_RULE_FROM } from '../src/tasks/engine/order-window';

const DAY = 86_400_000;

/**
 * The date rule, over real HTTP against the real app.
 *
 * The rule is enforced in runEvent, OUTSIDE the opt-in plausibility flag, so it
 * binds every evidence source. These tests prove that from the outside: a scraped
 * out-of-window order is refused, and the staff OCR funnel — which turns
 * plausibility OFF — is refused identically.
 */
describe('Order window (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let ticketsSvc: TicketService;
  let taskSvc: TaskService;

  let seq = 0;
  const newMobile = () =>
    `+9196${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function newUser() {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  }

  /** A claimed task whose claim instant is AFTER the rule cutoff, so it is bound. */
  async function claimedTask(token: string) {
    const campaign = await prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Review the thing',
        productName: 'The Thing',
        category: 'electronics',
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
      },
    });
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ campaignId: campaign.id })
      .expect(201);
    return { taskId: res.body.id as string, campaign };
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
    ticketsSvc = app.get(TicketService);
    taskSvc = app.get(TaskService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Order-window e2e aborted: non-test database');
    }
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users","campaigns","tasks","task_events","ticket_entries","wallet_accounts","wallet_entries","ledger_transactions" RESTART IDENTITY CASCADE',
    );
  });

  const server = () => app.getHttpServer();

  it('refuses a scraped order placed before the claim, and writes NO money fields', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await claimedTask(user.token);

    const res = await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        order: {
          id: 'OLD-1',
          date: Date.now() - 71 * DAY, // the Lukzer shape
          itemPaise: '93800',
          source: 'order-details',
        },
      })
      .expect(200);

    // Still CLAIMED: the order never became the anchor.
    expect(res.body.state).toBe('CLAIMED');
    expect(res.body.order).toBeNull();
    expect(res.body.blocker).toBe(BLOCKERS.ORDER_OUT_OF_WINDOW);
    expect(res.body.blockerReason).toMatch(/doesn’t qualify/);
    // And no refund can be computed from it.
    expect(res.body.refund.amountPaise).toBeNull();

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.itemPaise).toBeNull();
    expect(row.orderId).toBeNull();
  });

  it('accepts an order placed after the claim', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await claimedTask(user.token);

    const res = await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        order: { id: 'NEW-1', date: Date.now(), itemPaise: '129900', source: 'order-details' },
      })
      .expect(200);
    expect(res.body.state).toBe('PURCHASED');
    expect(res.body.order.id).toBe('NEW-1');
  });

  it('refuses the SAME date through the staff OCR funnel, which turns plausibility off', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await claimedTask(user.token);

    // The internal funnel the staff approve action uses — no DTO, no plausibility.
    await taskSvc.applyEvidence(
      user.id,
      taskId,
      {
        order: {
          id: 'OLD-OCR',
          date: Date.now() - 71 * DAY,
          itemPaise: 93800n,
          source: 'ocr',
        },
      } as never,
      'ocr:test',
    );

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.state).toBe('CLAIMED');
    expect(row.itemPaise).toBeNull();
    expect(row.blocker).toBe(BLOCKERS.ORDER_OUT_OF_WINDOW);
  });

  it('leaves a grandfathered task alone', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await claimedTask(user.token);
    // Back-date the CLAIM to before the rule shipped.
    await prisma.task.update({
      where: { id: taskId },
      data: { createdAt: new Date(ORDER_WINDOW_RULE_FROM - DAY) },
    });

    const res = await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        order: {
          id: 'GRANDFATHERED',
          date: ORDER_WINDOW_RULE_FROM - 200 * DAY,
          itemPaise: '93800',
          source: 'order-details',
        },
      })
      .expect(200);
    expect(res.body.state).toBe('PURCHASED');
    expect(res.body.order.id).toBe('GRANDFATHERED');
  });
});
