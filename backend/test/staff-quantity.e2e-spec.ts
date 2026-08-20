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

  /** A task whose order has NO readable price — the quick-commerce shape. */
  async function taskHeldOnAmount(userToken: string, campaignPricePaise = 50_000n) {
    const campaign = await prisma.campaign.create({
      data: {
        platform: 'BLINKIT',
        status: 'ACTIVE',
        title: 'Review the groceries',
        productName: 'The Groceries',
        category: 'grocery',
        productPricePaise: campaignPricePaise,
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
          id: 'A-HELD-1',
          date: Date.now(),
          // A total only, no per-item figure at all. Blinkit reads exactly this.
          orderTotalPaise: '60000',
          source: 'order-history',
        },
      })
      .expect(200);
    return { taskId, campaign, applied };
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

  describe('the queue a reviewer works from', () => {
    it('lists a task whose refund is held on the unit count, with what the reader saw', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnQuantity(user.token);
      const support = await tokenFor('SUPPORT');

      const res = await request(server())
        .get('/admin/tasks/awaiting-amount')
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      const item = res.body.items[0];
      expect(item.taskId).toBe(taskId);
      // Everything a reviewer needs to make an obvious call WITHOUT opening the
      // marketplace order themselves.
      expect(item.orderId).toBe('Q-HELD-1');
      expect(item.itemPaise).toBe('129900');
      expect(item.platform).toBe('AMAZON');
      expect(item.quantity).toBeNull();
      expect(item.heldReason).toBe('quantity-unknown');
      // Plain words, not an enum: this is read by a person and sometimes read OUT
      // to the user on the phone.
      expect(item.heldExplanation).toMatch(/how many units/i);
      expect(item.heldExplanation).not.toMatch(/quantity-unknown/);
      expect(item.campaignTitle).toBe('Review the thing');
    });

    it('passes on what the reader OBSERVED but refused to assert', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON', status: 'ACTIVE', title: 'Observed', productName: 'x',
          category: 'electronics', productPricePaise: 38800n, payoutPercent: 100, ticketCost: 5,
        },
      });
      const created = await request(server())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ campaignId: campaign.id })
        .expect(201);
      await request(server())
        .post(`/tasks/${created.body.id}/evidence`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          order: {
            id: 'OBS-1', date: Date.now(), itemPaise: '38800',
            quantityObserved: 3, quantityReason: 'multi-unit-amount-unclear',
            source: 'order-details',
          },
        })
        .expect(200);

      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .get('/admin/tasks/awaiting-amount')
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      const item = res.body.items.find(
        (i: { orderId: string }) => i.orderId === 'OBS-1',
      );
      expect(item.quantityObserved).toBe(3);
      expect(item.quantityReason).toBe('multi-unit-amount-unclear');
    });

    it('leaves out tasks nobody needs to look at', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      // A task with a KNOWN quantity is payable, so it is not work.
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON', status: 'ACTIVE', title: 'Fine', productName: 'x',
          category: 'electronics', productPricePaise: 38800n, payoutPercent: 100, ticketCost: 5,
        },
      });
      const created = await request(server())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ campaignId: campaign.id })
        .expect(201);
      await request(server())
        .post(`/tasks/${created.body.id}/evidence`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          order: { id: 'FINE-1', date: Date.now(), itemPaise: '38800', quantity: 1, source: 'order-details' },
        })
        .expect(200);

      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .get('/admin/tasks/awaiting-amount')
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      expect(res.body.items.map((i: { orderId: string }) => i.orderId)).not.toContain('FINE-1');
    });

    it('drops out of the queue once the count is confirmed', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnQuantity(user.token);
      const support = await tokenFor('SUPPORT');
      await request(server())
        .post(`/admin/tasks/${taskId}/quantity`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ quantity: 1, reason: 'single unit' })
        .expect(200);
      const res = await request(server())
        .get('/admin/tasks/awaiting-amount')
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      expect(res.body.total).toBe(0);
    });

    it('is SUPPORT and ADMIN only', async () => {
      const roles: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];
      for (const role of roles) {
        const staff = await tokenFor(role);
        const allowed = role === 'SUPPORT' || role === 'ADMIN';
        await request(server())
          .get('/admin/tasks/awaiting-amount')
          .set('authorization', `Bearer ${staff.token}`)
          .expect(allowed ? 200 : 403);
      }
    });
  });

  describe('what will actually be paid, before confirming', () => {
    it('previews the refund through the SAME resolver the payout uses', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnQuantity(user.token);
      const support = await tokenFor('SUPPORT');

      const one = await request(server())
        .get(`/admin/tasks/${taskId}/quantity-preview?quantity=1`)
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      expect(one.body.payable).toBe(true);
      expect(one.body.chargedPaise).toBe('129900');
      expect(one.body.refundPaise).toBe('129900');

      const three = await request(server())
        .get(`/admin/tasks/${taskId}/quantity-preview?quantity=3`)
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      expect(three.body.payable).toBe(true);
      expect(three.body.refundPaise).toBe('43300'); // 129900 / 3

      // And the preview must AGREE with what confirming actually does.
      const applied = await request(server())
        .post(`/admin/tasks/${taskId}/quantity`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ quantity: 3, reason: 'three units on the page' })
        .expect(200);
      expect(applied.body.refund.amountPaise).toBe(three.body.refundPaise);
    });

    it('says plainly when a number would still not be payable', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const campaign = await prisma.campaign.create({
        data: {
          platform: 'AMAZON', status: 'ACTIVE', title: 'Odd', productName: 'x',
          category: 'electronics', productPricePaise: 100n, payoutPercent: 100, ticketCost: 5,
        },
      });
      const created = await request(server())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ campaignId: campaign.id })
        .expect(201);
      const taskId = created.body.id as string;
      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ order: { id: 'ODD-1', date: Date.now(), itemPaise: '100', source: 'order-details' } })
        .expect(200);

      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .get(`/admin/tasks/${taskId}/quantity-preview?quantity=3`)
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      expect(res.body.payable).toBe(false);
      expect(res.body.refundPaise).toBeNull();
      expect(res.body.heldReason).toBe('quantity-not-divisible');
      expect(res.body.heldExplanation).not.toMatch(/quantity-not-divisible/);
    });

    it('honours the campaign payout cap, including a cap of zero', async () => {
      // The cap is where the "shown versus paid" defect lived on the device. The
      // preview must not grow its own private calculation that forgets it.
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      for (const [cap, expected] of [
        [50000n, '50000'],
        [0n, '0'],
      ] as [bigint, string][]) {
        const campaign = await prisma.campaign.create({
          data: {
            platform: 'AMAZON', status: 'ACTIVE', title: 'Capped', productName: 'x',
            category: 'electronics', productPricePaise: 129900n, payoutPercent: 100,
            ticketCost: 5, payoutCapPaise: cap,
          },
        });
        const created = await request(server())
          .post('/tasks')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ campaignId: campaign.id })
          .expect(201);
        await request(server())
          .post(`/tasks/${created.body.id}/evidence`)
          .set('Authorization', `Bearer ${user.token}`)
          .send({ order: { id: `CAP-${cap}`, date: Date.now(), itemPaise: '129900', source: 'order-details' } })
          .expect(200);
        const support = await tokenFor('SUPPORT');
        const res = await request(server())
          .get(`/admin/tasks/${created.body.id}/quantity-preview?quantity=1`)
          .set('authorization', `Bearer ${support.token}`)
          .expect(200);
        expect(res.body.refundPaise).toBe(expected);
      }
    });

    it('rejects a quantity it would never accept on the write path', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnQuantity(user.token);
      const support = await tokenFor('SUPPORT');
      for (const q of ['0', '-1', '2.5', '1000', 'two', '']) {
        await request(server())
          .get(`/admin/tasks/${taskId}/quantity-preview?quantity=${q}`)
          .set('authorization', `Bearer ${support.token}`)
          .expect(400);
      }
    });
  });


  describe('what one unit cost, stated by a person', () => {
    it('fills a gap the marketplace never gave us, and makes the refund payable', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId, applied } = await taskHeldOnAmount(user.token);
      expect(applied.body.refund.amountPaise).toBeNull();

      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({
          unitPricePaise: '50000',
          evidenceSource: 'order-page',
          reason: 'Blinkit order page lists this item at ₹500',
        })
        .expect(200);
      expect(res.body.refund.amountPaise).toBe('50000');

      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      const stored = row.evidence as unknown as {
        order: { unitPricePaise: string; amountSource: string; source: string };
      };
      expect(stored.order.unitPricePaise).toBe('50000');
      // WHERE a person read it, recorded separately from where the ORDER came
      // from — the order really was read from the marketplace, only the amount
      // is human-supplied.
      expect(stored.order.amountSource).toBe('staff:order-page');
      expect(stored.order.source).toBe('order-history');
    });

    it('is a per-unit price, so it pays without needing a count at all', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '50000', evidenceSource: 'invoice', reason: 'invoice line' })
        .expect(200);
      const after = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      // No quantity was ever supplied, and none is needed: a stated per-unit
      // price makes the count irrelevant.
      expect(after.body.order.quantity).toBeNull();
      expect(after.body.refund.amountPaise).toBe('50000');
    });

    it('REFUSES to overwrite an amount the marketplace itself gave us', async () => {
      // The gate that matters most. A machine read outranks a person typing, and
      // staff confirmation may not jump that queue because a human is impatient.
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnQuantity(user.token); // has itemPaise 129900
      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '100000', evidenceSource: 'order-page', reason: 'looks wrong to me' })
        .expect(409);
      expect(String(res.body.message)).toMatch(/already has an amount/i);
      expect(String(res.body.message)).toMatch(/₹1,299/); // in rupees, not paise
      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      const stored = row.evidence as unknown as { order: { itemPaise: string } };
      expect(stored.order.itemPaise).toBe('129900');
    });

    it('DOES let a staff member correct their own figure', async () => {
      // The mirror image of the gate above. Refusing every overwrite would mean a
      // reviewer who mistypes has no way back, which is a worse dead end than the
      // one this whole queue exists to remove.
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '50000', evidenceSource: 'order-page', reason: 'first read' })
        .expect(200);
      const fixed = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '49900', evidenceSource: 'order-page', reason: 'misread, it is 499' })
        .expect(200);
      expect(fixed.body.refund.amountPaise).toBe('49900');

      const logs = await prisma.adminAuditLog.findMany({
        where: { action: 'TASK_AMOUNT_SET' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs).toHaveLength(2);
      const meta = logs[1].metadata as unknown as { previousUnitPricePaise: string | null };
      expect(meta.previousUnitPricePaise).toBe('50000');
    });

    it('refuses a figure above a ceiling derived from something real', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      // Campaign ₹500, order total ₹600 — so the tighter bound is the order total.
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '500000', evidenceSource: 'order-page', reason: 'fat finger' })
        .expect(400);
      expect(String(res.body.message)).toMatch(/above the most this can be/i);
      expect(String(res.body.message)).toMatch(/order/i); // names WHICH bound
      expect(String(res.body.message)).toMatch(/typo/i);
    });

    it('makes a disagreement with the campaign price acknowledgeable, not blocked', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      // ₹350 against a ₹500 campaign — a real discount, well outside tolerance.
      const blocked = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '35000', evidenceSource: 'order-page', reason: 'sale price' })
        .expect(409);
      expect(String(blocked.body.message)).toMatch(/does not match/i);
      expect(String(blocked.body.message)).toMatch(/₹350/);
      expect(String(blocked.body.message)).toMatch(/₹500/);

      const allowed = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({
          unitPricePaise: '35000', evidenceSource: 'order-page',
          reason: 'sale price, ₹350 on the order page',
          acknowledgedDisagreement: true,
        })
        .expect(200);
      expect(allowed.body.refund.amountPaise).toBe('35000');
      const log = await prisma.adminAuditLog.findFirstOrThrow({
        where: { action: 'TASK_AMOUNT_SET' },
      });
      const meta = log.metadata as unknown as {
        acknowledgedDisagreement: boolean; evidenceSource: string; reason: string;
      };
      expect(meta.acknowledgedDisagreement).toBe(true);
      expect(meta.evidenceSource).toBe('order-page');
      expect(meta.reason).toMatch(/sale price/);
    });

    it('requires WHERE the figure came from, from a closed list', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      const bad = [
        { unitPricePaise: '50000', reason: 'no source given' },
        { unitPricePaise: '50000', evidenceSource: 'i just know', reason: 'invented source' },
        { unitPricePaise: '50000', evidenceSource: 'order-page' }, // no reason
        { unitPricePaise: '50000', evidenceSource: 'order-page', reason: 'ok' }, // too short
        { evidenceSource: 'order-page', reason: 'no amount' },
        { unitPricePaise: '-1', evidenceSource: 'order-page', reason: 'negative' },
        { unitPricePaise: '4.99', evidenceSource: 'order-page', reason: 'rupees not paise' },
      ];
      for (const body of bad) {
        await request(server())
          .post(`/admin/tasks/${taskId}/amount`)
          .set('authorization', `Bearer ${support.token}`)
          .send(body)
          .expect(400);
      }
    });

    it('is SUPPORT and ADMIN only, and moves no money', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const roles: StaffRole[] = ['FINANCE', 'OPERATIONS'];
      for (const role of roles) {
        const staff = await tokenFor(role);
        await request(server())
          .post(`/admin/tasks/${taskId}/amount`)
          .set('authorization', `Bearer ${staff.token}`)
          .send({ unitPricePaise: '50000', evidenceSource: 'order-page', reason: 'not my job' })
          .expect(403);
      }
      const support = await tokenFor('SUPPORT');
      await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '50000', evidenceSource: 'order-page', reason: 'order page' })
        .expect(200);
      expect(await prisma.walletEntry.count()).toBe(0);
    });

    it('shows up in the SAME queue, marked as needing an amount', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .get('/admin/tasks/awaiting-amount')
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      const item = res.body.items.find((i: { taskId: string }) => i.taskId === taskId);
      expect(item).toBeDefined();
      expect(item.action).toBe('amount');
      expect(item.heldReason).toBe('amount-unknown');
      // Everything the reviewer needs to judge the figure they are about to type.
      expect(item.campaignPricePaise).toBe('50000');
      expect(item.maxAmountPaise).toBe('60000'); // the order total, the tighter bound
      expect(item.maxAmountAnchor).toBe('order-total');
      expect(item.itemPaise).toBeNull();
    });

    it('a count hold is marked as needing a count, in the same list', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnQuantity(user.token);
      const support = await tokenFor('SUPPORT');
      const res = await request(server())
        .get('/admin/tasks/awaiting-amount')
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      const item = res.body.items.find((i: { taskId: string }) => i.taskId === taskId);
      expect(item.action).toBe('count');
    });

    it('previews the amount through the same one route, warning before it is saved', async () => {
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');

      const ok = await request(server())
        .get(`/admin/tasks/${taskId}/amount-preview?unitPricePaise=50000`)
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      expect(ok.body.payable).toBe(true);
      expect(ok.body.refundPaise).toBe('50000');
      expect(ok.body.disagreesWithCampaign).toBe(false);
      expect(ok.body.campaignPricePaise).toBe('50000');
      expect(ok.body.maxAmountPaise).toBe('60000');

      const off = await request(server())
        .get(`/admin/tasks/${taskId}/amount-preview?unitPricePaise=35000`)
        .set('authorization', `Bearer ${support.token}`)
        .expect(200);
      // The warning is available BEFORE anyone confirms, which is the point.
      expect(off.body.disagreesWithCampaign).toBe(true);
      expect(off.body.payable).toBe(true);

      // And the preview agrees with what saving actually does.
      const saved = await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({
          unitPricePaise: '35000', evidenceSource: 'order-page',
          reason: 'sale price on the order page', acknowledgedDisagreement: true,
        })
        .expect(200);
      expect(saved.body.refund.amountPaise).toBe(off.body.refundPaise);
    });

    it('a later marketplace read outranks the typed figure', async () => {
      // Documented on purpose: staff confirmation is a TIER, and the scraper sits
      // above it. If the real amount becomes readable, it wins.
      const user = await newUser();
      await ticketsSvc.grantSignup(user.id);
      const { taskId } = await taskHeldOnAmount(user.token);
      const support = await tokenFor('SUPPORT');
      await request(server())
        .post(`/admin/tasks/${taskId}/amount`)
        .set('authorization', `Bearer ${support.token}`)
        .send({ unitPricePaise: '50000', evidenceSource: 'order-page', reason: 'order page' })
        .expect(200);

      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          order: {
            id: 'A-HELD-1', date: Date.now(), itemPaise: '52000', quantity: 1,
            orderTotalPaise: '60000', source: 'order-history',
          },
        })
        .expect(200);
      const after = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(after.body.refund.amountPaise).toBe('52000');
    });
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
