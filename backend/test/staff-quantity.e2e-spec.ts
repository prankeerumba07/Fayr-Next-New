import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { TicketService } from '../src/tickets/ticket.service';
import type { StaffRole } from '@prisma/client';

/**
 * A HELD REFUND MUST HAVE SOMEONE WHO CAN ACT ON IT.
 *
 * The quantity rule refuses to pay a percentage of a line total without knowing
 * how many units it covers, and almost no marketplace page states one. That is
 * the right call for money — but a hold with no human able to clear it is not a
 * safety measure, it is a dead end. The user is told "a Fayr reviewer will
 * check it" and until now no reviewer had a button, on any task that did not
 * arrive through the OCR screenshot flow.
 *
 * This is that button, and these are the tests that it moves the refund from
 * unpayable to payable, that only the right role can press it, and that pressing
 * it leaves a record naming who decided what.
 */
describe('Staff quantity confirmation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTokens: StaffTokenService;
  let ticketsSvc: TicketService;

  let seq = 0;
  const newMobile = () =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function newUser() {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  }

  async function tokenFor(role: StaffRole) {
    const staff = await prisma.staffUser.create({
      data: {
        email: `q-${role.toLowerCase()}-${seq++}@test.fayr`,
        passwordHash: 'x'.repeat(60),
        name: `${role} tester`,
        role,
        status: 'ACTIVE',
      },
    });
    const session = await staffTokens.issueSession(staff);
    return { token: session.accessToken, id: staff.id };
  }

  /** A task with a real, in-window order carrying an amount and NO quantity. */
  async function taskHeldOnQuantity(userToken: string) {
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
    const created = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ campaignId: campaign.id })
      .expect(201);
    const taskId = created.body.id as string;
    const applied = await request(app.getHttpServer())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        order: {
          id: 'Q-HELD-1',
          date: Date.now(),
          itemPaise: '129900',
          source: 'order-details',
        },
      })
      .expect(200);
    return { taskId, applied };
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
    staffTokens = app.get(StaffTokenService);
    ticketsSvc = app.get(TicketService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Staff-quantity e2e aborted: non-test database');
    }
  });

  afterAll(async () => app.close());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "staff_users","admin_audit_log","users","campaigns","tasks","task_events","visibility_checks","ticket_entries","wallet_accounts","wallet_entries","ledger_transactions","payout_methods","withdrawals","refresh_tokens" RESTART IDENTITY CASCADE',
    );
  });

  const server = () => app.getHttpServer();

  it('turns an unpayable refund into a payable one', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId, applied } = await taskHeldOnQuantity(user.token);

    // Before: the purchase is real and accepted, but no refund can be computed.
    expect(applied.body.order.itemPaise).toBe('129900');
    expect(applied.body.order.quantity).toBeNull();
    expect(applied.body.refund.amountPaise).toBeNull();

    const support = await tokenFor('SUPPORT');
    const res = await request(server())
      .post(`/admin/tasks/${taskId}/quantity`)
      .set('authorization', `Bearer ${support.token}`)
      .send({ quantity: 1, reason: 'order page shows a single unit' })
      .expect(200);

    expect(res.body.order.quantity).toBe(1);
    expect(res.body.refund.amountPaise).toBe('129900');

    // And it is the STORED task that changed, not just the response.
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const stored = row.evidence as unknown as {
      order: { quantity: number | null; quantitySource: string | null };
    };
    expect(stored.order.quantity).toBe(1);
    expect(stored.order.quantitySource).toBe('staff');
  });

  it('keeps every other fact about the order exactly as it was', async () => {
    // The fragment resends the whole order, because the engine replaces `order`
    // wholesale rather than merging fields. If that resend dropped anything, the
    // order id or its date would vanish and the task would lose its anchor.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId, applied } = await taskHeldOnQuantity(user.token);
    const support = await tokenFor('SUPPORT');

    const res = await request(server())
      .post(`/admin/tasks/${taskId}/quantity`)
      .set('authorization', `Bearer ${support.token}`)
      .send({ quantity: 1, reason: 'single unit' })
      .expect(200);

    expect(res.body.order.id).toBe(applied.body.order.id);
    expect(res.body.order.date).toBe(applied.body.order.date);
    expect(res.body.order.itemPaise).toBe(applied.body.order.itemPaise);
    expect(res.body.order.source).toBe(applied.body.order.source);
    expect(res.body.state).toBe(applied.body.state);
  });

  it('can be corrected: a second, different number replaces the first', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await taskHeldOnQuantity(user.token);
    const support = await tokenFor('SUPPORT');

    for (const quantity of [1, 3]) {
      await request(server())
        .post(`/admin/tasks/${taskId}/quantity`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ quantity, reason: 'recount' })
        .expect(200);
    }
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const stored = row.evidence as unknown as { order: { quantity: number } };
    expect(stored.order.quantity).toBe(3);
    // 129900 / 3 divides exactly, so the corrected figure is one unit's price.
    const after = await request(server())
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(after.body.refund.amountPaise).toBe('43300');
  });

  it('is idempotent for the SAME number — a double click is one decision', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await taskHeldOnQuantity(user.token);
    const support = await tokenFor('SUPPORT');

    for (let i = 0; i < 2; i++) {
      await request(server())
        .post(`/admin/tasks/${taskId}/quantity`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ quantity: 1, reason: 'single unit' })
        .expect(200);
    }
    const events = await prisma.taskEvent.findMany({ where: { taskId } });
    const quantityEvents = events.filter((e) =>
      (e.idempotencyKey ?? '').startsWith('staff-quantity:'),
    );
    expect(quantityEvents).toHaveLength(1);
  });

  it('refuses a task that has no order to count', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const campaign = await prisma.campaign.create({
      data: {
        platform: 'AMAZON', status: 'ACTIVE', title: 'x', productName: 'x',
        category: 'electronics', productPricePaise: 100n, payoutPercent: 100, ticketCost: 5,
      },
    });
    const created = await request(server())
      .post('/tasks')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ campaignId: campaign.id })
      .expect(201);
    const support = await tokenFor('SUPPORT');
    const res = await request(server())
      .post(`/admin/tasks/${created.body.id}/quantity`)
      .set('authorization', `Bearer ${support.token}`)
      .send({ quantity: 1, reason: 'nothing to count' })
      .expect(409);
    // Plain words, because staff messages get read out to users on the phone.
    expect(String(res.body.message)).toMatch(/no order/i);
  });

  it('requires a plausible number and a reason', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await taskHeldOnQuantity(user.token);
    const support = await tokenFor('SUPPORT');
    const bad = [
      { quantity: 0, reason: 'zero' },
      { quantity: -1, reason: 'negative' },
      { quantity: 2.5, reason: 'fractional' },
      { quantity: 1000, reason: 'absurd' },
      { quantity: 1 }, // no reason — the audit row would be worthless
      { reason: 'no number at all' },
    ];
    for (const body of bad) {
      await request(server())
        .post(`/admin/tasks/${taskId}/quantity`)
        .set('authorization', `Bearer ${support.token}`)
        .send(body)
        .expect(400);
    }
  });

  it('is SUPPORT and ADMIN only', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await taskHeldOnQuantity(user.token);
    const roles: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];
    for (const role of roles) {
      const staff = await tokenFor(role);
      const allowed = role === 'SUPPORT' || role === 'ADMIN';
      await request(server())
        .post(`/admin/tasks/${taskId}/quantity`)
        .set('authorization', `Bearer ${staff.token}`)
        .send({ quantity: 1, reason: 'single unit' })
        .expect(allowed ? 200 : 403);
    }
  });

  it('records WHO decided WHAT, with their reasoning', async () => {
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await taskHeldOnQuantity(user.token);
    const support = await tokenFor('SUPPORT');

    await request(server())
      .post(`/admin/tasks/${taskId}/quantity`)
      .set('authorization', `Bearer ${support.token}`)
      .send({ quantity: 1, reason: 'order page shows one unit' })
      .expect(200);

    const log = await prisma.adminAuditLog.findFirst({
      where: { action: 'TASK_QUANTITY_SET' },
    });
    expect(log).not.toBeNull();
    expect(log!.staffUserId).toBe(support.id);
    expect(log!.targetUserId).toBe(user.id);
    const meta = log!.metadata as unknown as {
      taskId: string; quantity: number; previousQuantity: number | null; reason: string;
    };
    expect(meta.taskId).toBe(taskId);
    expect(meta.quantity).toBe(1);
    expect(meta.previousQuantity).toBeNull();
    expect(meta.reason).toBe('order page shows one unit');
  });

  it('does not move any money by itself', async () => {
    // The whole point of the hold is that a person decides the AMOUNT. Deciding
    // it must not also pay it: the return window, the published review and the
    // FINANCE-gated withdrawal all still stand between this and a rupee.
    const user = await newUser();
    await ticketsSvc.grantSignup(user.id);
    const { taskId } = await taskHeldOnQuantity(user.token);
    const support = await tokenFor('SUPPORT');
    await request(server())
      .post(`/admin/tasks/${taskId}/quantity`)
      .set('authorization', `Bearer ${support.token}`)
      .send({ quantity: 1, reason: 'single unit' })
      .expect(200);

    const entries = await prisma.walletEntry.count();
    expect(entries).toBe(0);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.state).toBe('PURCHASED');
  });
});
