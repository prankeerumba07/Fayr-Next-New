import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { resetDatabase } from './reset-db';

const DAY = 86_400_000;

/**
 * End-to-end for the task loop: boots the real app (guard + ValidationPipe live)
 * and drives claim → evidence → hold → refund over HTTP, asserting the ticket and
 * wallet ledgers move by the right amounts. Eligibility is controlled purely
 * through the evidence delivery date, so no clock mocking is needed. System-only
 * operations (signup grant, visibility re-check, expiry sweep) are called on the
 * services directly.
 */
describe('Task loop (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let ticketsSvc: TicketService;
  let walletSvc: WalletService;
  let taskSvc: TaskService;

  let seq = 0;
  const newMobile = (): string =>
    `+9194${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const bearer = (token: string): string => `Bearer ${token}`;

  async function newUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
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
        category: 'electronics', // 10-day window
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
        ...over,
      },
    });

  const server = () => app.getHttpServer();

  /** Advance a claimed task all the way to HOLDING with a chosen delivery date. */
  async function driveToHolding(
    token: string,
    taskId: string,
    deliveredAt: number,
    line?: { itemId?: string; orderId?: string },
  ): Promise<void> {
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: {
          id: line?.orderId ?? 'o1',
          itemPaise: '129900',
          quantity: 1,
          source: 'order-details',
          // WHICH line of the order. Omitted by default, which is the honest
          // shape for a platform that states none — and the case the gate has to
          // keep failing closed on.
          ...(line?.itemId
            ? { itemId: line.itemId, itemIdSource: 'asin' }
            : {}),
        },
        returned: false,
      })
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        delivery: { at: deliveredAt, source: 'order-details' },
        review: { published: true, product: 'boAt Rockerz 255 Pro+' },
      })
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/reviewed`)
      .set('Authorization', bearer(token))
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', bearer(token))
      .expect(200);
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
    walletSvc = app.get(WalletService);
    taskSvc = app.get(TaskService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `Task e2e aborted: connected to non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('runs the full claim → evidence → hold → refund loop, moving tickets and money', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId); // 15 tickets
    const campaign = await makeCampaign();

    // Claim → CLAIMED, 5 tickets consumed.
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId: string = claim.body.id;
    expect(claim.body.state).toBe('CLAIMED');
    expect(await ticketsSvc.getBalance(userId)).toBe(10);

    // Order evidence → PURCHASED.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '129900', quantity: 1, source: 'order-details' },
        returned: false,
      })
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('PURCHASED'));

    // Delivery (30 days ago, so the 10-day window has long elapsed) + published
    // review → DELIVERED.
    const deliveredAt = Date.now() - 30 * DAY;
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        delivery: { at: deliveredAt, source: 'order-details' },
        review: { published: true, product: 'boAt Rockerz 255 Pro+' },
      })
      .expect(200)
      .expect((r) => {
        expect(r.body.state).toBe('DELIVERED');
        expect(r.body.review.published).toBe(true);
        expect(r.body.refund.amountPaise).toBe('129900');
      });

    await request(server())
      .post(`/tasks/${taskId}/reviewed`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REVIEWED'));

    await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('HOLDING'));

    // Release → REFUNDED, wallet credited exactly the item price.
    await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n);

    // Idempotent: a second release neither errors nor pays again.
    await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: 'REFUND' } }),
    ).toBe(1);
  });

  it('idempotency key: a re-run is a no-op; a superset key lets a later delivery through', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId: string = claim.body.id;

    // Purchase-only check, keyed as the on-device sync layer keys it.
    const purchaseBody = {
      key: 'evidence:o1:o',
      order: { id: 'o1', itemPaise: '129900', quantity: 1, source: 'order-details' },
      returned: false,
    };
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send(purchaseBody)
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('PURCHASED'));
    expect(
      await prisma.taskEvent.count({ where: { taskId, type: 'EVIDENCE' } }),
    ).toBe(1);

    // Re-run the SAME check (same key) → genuine no-op: still PURCHASED, and NO
    // second event row was written.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send(purchaseBody)
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('PURCHASED'));
    expect(
      await prisma.taskEvent.count({ where: { taskId, type: 'EVIDENCE' } }),
    ).toBe(1);

    // A later purchase+delivery check on the SAME order carries the SUPERSET key
    // (decision A). It must APPLY — advancing to DELIVERED — where reusing the
    // bare order-id key would have collided with the purchase check and silently
    // dropped the delivery.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        key: 'evidence:o1:od',
        order: { id: 'o1', itemPaise: '129900', quantity: 1, source: 'order-details' },
        delivery: { at: Date.now() - 30 * DAY, source: 'order-details' },
        returned: false,
      })
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('DELIVERED'));
    expect(
      await prisma.taskEvent.count({ where: { taskId, type: 'EVIDENCE' } }),
    ).toBe(2);
  });

  /**
   * The refund gate's price half, which had NO backend test before this — the
   * single most sensitive money check in the service was covered only by
   * device-side tests of the input it consumes.
   *
   * It also pins the fix for the erasable-match bug. The gate used to read the
   * device's `match.amountOk`, so a later fetch of the same order (which replaces
   * the order object wholesale among equal-authority sources) erased the refusal
   * and re-opened the auto-refund path. The check now recomputes from the stored
   * amounts at release time, so the erasure cannot decide anything: below, the
   * second fetch deliberately carries NO match at all and the release still
   * refuses.
   */
  it('refuses to release when the charged amount disagrees with the campaign, even after the match is erased', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign(); // productPricePaise 129900n
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = claim.body.id as string;
    const deliveredAt = Date.now() - 30 * DAY; // window long closed

    // First fetch: ₹999 charged against a ₹1,299 campaign, WITH a match saying
    // the price is fine — the device's listed-vs-listed verdict, which the gate
    // must no longer trust either way.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: {
          id: 'o1',
          itemPaise: '99900', quantity: 1,
          source: 'order-history',
          match: { score: 1, amountOk: true, ambiguous: false, candidateCount: 1 },
        },
        returned: false,
      })
      .expect(200);

    // Second fetch of the SAME order with no match — a different idempotency key,
    // so it applies and erases the stored match wholesale.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '99900', quantity: 1, source: 'order-history' },
        delivery: { at: deliveredAt, source: 'order-history' },
        review: { published: true, product: 'boAt Rockerz 255 Pro+' },
        returned: false,
      })
      .expect(200)
      .expect((r) => expect(r.body.order.match ?? null).toBeNull());

    await request(server())
      .post(`/tasks/${taskId}/reviewed`)
      .set('Authorization', bearer(token))
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', bearer(token))
      .expect(200);

    // Eligible in every other respect, and no match to read — the release must
    // still refuse, on the charged amount alone.
    await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(409)
      .expect((r) =>
        expect(String(r.body.message)).toContain("the amount you paid doesn't match this offer"),
      );
    expect(await walletSvc.getUserBalance(userId)).toBe(0n);

    // The user confirms it IS their order → the same release now succeeds and
    // pays the charged figure, not the campaign's price.
    await request(server())
      .post(`/tasks/${taskId}/confirm-order`)
      .set('Authorization', bearer(token))
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    expect(await walletSvc.getUserBalance(userId)).toBe(99900n);
  });

  it('releases without a confirmation tap when the charged amount matches the offer', async () => {
    // The good path must cost nothing: the whole complaint about the old check
    // was that it fired here too.
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = claim.body.id as string;
    await driveToHolding(token, taskId, Date.now() - 30 * DAY); // itemPaise 129900
    await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe('REFUNDED');
    // Never tapped, and never needed: the gate stayed quiet.
    expect(
      await prisma.taskEvent.count({ where: { taskId, type: 'CONFIRM_ORDER' } }),
    ).toBe(0);
  });

  /**
   * A MERGED CART IS NOT A DUPLICATE.
   *
   * The gate was keyed on (platform, orderId), because a comment in the service
   * claimed no per-line-item id survived the wire on any platform. It was my own
   * claim and it was wrong: Amazon's ASIN, Flipkart's pid, Meesho's sub-order id
   * and Instamart's product-variant id all reach the backend already.
   *
   * Order-level keying was wrong in BOTH directions. An Amazon merged cart is two
   * genuinely different products under one order number, and every single one of
   * those needed a staff override — a queue of work created by the key, not by any
   * risk. And two claims on the SAME line, which is the fraud the gate exists to
   * catch, looked identical to it.
   */
  it('pays two DIFFERENT items from one order without anyone being asked', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const first = await makeCampaign({ title: 'Offer A' });
    const second = await makeCampaign({ title: 'Offer B' });
    const deliveredAt = Date.now() - 30 * DAY;

    const drive = async (campaignId: string, itemId: string): Promise<string> => {
      const claim = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId, acceptedTerms: true })
        .expect(201);
      const taskId = claim.body.id as string;
      // ONE order number, two different ASINs — the real fixture shape:
      // 222-2222222-2222222 holds three ASINs in src/__fixtures__/amazon-capture.json.
      await driveToHolding(token, taskId, deliveredAt, { itemId });
      return taskId;
    };
    const taskA = await drive(first.id, 'B0TESTMERGA');
    const taskB = await drive(second.id, 'B0TESTMERGB');

    for (const taskId of [taskA, taskB]) {
      await request(server())
        .post(`/tasks/${taskId}/release-refund`)
        .set('Authorization', bearer(token))
        .expect(200)
        .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    }
    // Both paid, no override, no reviewer involved.
    expect(await walletSvc.getUserBalance(userId)).toBe(259800n);
    const rows = await prisma.task.findMany({
      where: { id: { in: [taskA, taskB] } },
      select: { itemId: true, duplicateOrderApproved: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.itemId).sort()).toEqual(['B0TESTMERGA', 'B0TESTMERGB']);
    expect(rows.every((r) => !r.duplicateOrderApproved)).toBe(true);
  });

  it('still holds two claims on the SAME line, and says it is the same item', async () => {
    // The case the gate exists for. Re-keying must not open it.
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const first = await makeCampaign({ title: 'Offer A' });
    const second = await makeCampaign({ title: 'Offer B' });
    const deliveredAt = Date.now() - 30 * DAY;

    const drive = async (campaignId: string): Promise<string> => {
      const claim = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId, acceptedTerms: true })
        .expect(201);
      const taskId = claim.body.id as string;
      await driveToHolding(token, taskId, deliveredAt, { itemId: 'B0SAMELINE' });
      return taskId;
    };
    const taskA = await drive(first.id);
    const taskB = await drive(second.id);

    await request(server())
      .post(`/tasks/${taskA}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200);
    const held = await request(server())
      .post(`/tasks/${taskB}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(409);
    // Named precisely, because "this order" and "this exact item" are different
    // investigations for the reviewer who has to decide it.
    expect(String(held.body.message)).toContain('this exact item');
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n);
  });

  it('FAILS CLOSED when one side names no line — unknown is never "different"', async () => {
    // The half that matters most. A platform that states no line id must not get
    // a free second payout out of that silence: if either side is unknown we
    // cannot prove the two are different lines, so a human decides. Zepto and
    // Blinkit are exactly this case by design — their only candidate identifier
    // is a row number, which the reader refuses.
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const first = await makeCampaign({ title: 'Offer A' });
    const second = await makeCampaign({ title: 'Offer B' });
    const deliveredAt = Date.now() - 30 * DAY;

    const claimA = await request(server())
      .post('/tasks').set('Authorization', bearer(token))
      .send({ campaignId: first.id, acceptedTerms: true }).expect(201);
    await driveToHolding(token, claimA.body.id, deliveredAt, { itemId: 'B0KNOWN' });
    const claimB = await request(server())
      .post('/tasks').set('Authorization', bearer(token))
      .send({ campaignId: second.id, acceptedTerms: true }).expect(201);
    await driveToHolding(token, claimB.body.id, deliveredAt); // no itemId at all

    await request(server())
      .post(`/tasks/${claimA.body.id}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200);
    const held = await request(server())
      .post(`/tasks/${claimB.body.id}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(409);
    expect(String(held.body.message)).toContain('already been refunded');
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n);
  });

  it('promotes the line id to a column, so the gate reads an index and not JSONB', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign({ title: 'Offer A' });
    const claim = await request(server())
      .post('/tasks').set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true }).expect(201);
    await driveToHolding(token, claim.body.id, Date.now() - 30 * DAY, {
      itemId: 'B0PROMOTED',
    });
    const row = await prisma.task.findUniqueOrThrow({
      where: { id: claim.body.id as string },
    });
    expect(row.itemId).toBe('B0PROMOTED');
    expect(row.orderId).toBe('o1');
  });

  it('refuses a line id from a source it does not recognise', async () => {
    // A free-text source would let a client invent an authority it does not have
    // — the same reasoning as quantitySource. The closed list is the guard.
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign({ title: 'Offer A' });
    const claim = await request(server())
      .post('/tasks').set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true }).expect(201);
    await request(server())
      .post(`/tasks/${claim.body.id}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: {
          id: 'o1', itemPaise: '129900', quantity: 1, source: 'order-details',
          itemId: 'X', itemIdSource: 'i-made-this-up',
        },
      })
      .expect(400);
  });

  /**
   * ONE PURCHASE, ONE REFUND — and one completion grant.
   *
   * Live proof this was open: order OD337767552058345100 paid out twice, 590.40
   * against a 328 purchase, and granted +10 completion tickets twice because
   * markPaid grants per REFUNDED task.
   */
  it('holds the second refund on the same order, and so does not grant its tickets twice', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId); // 15 tickets = 3 claims
    const first = await makeCampaign({ title: 'Offer A' });
    const second = await makeCampaign({ title: 'Offer B' });
    const deliveredAt = Date.now() - 30 * DAY;

    // Same real order number claimed against two different offers.
    const driveBoth = async (campaignId: string): Promise<string> => {
      const claim = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId, acceptedTerms: true })
        .expect(201);
      const taskId = claim.body.id as string;
      await driveToHolding(token, taskId, deliveredAt); // order id 'o1' both times
      return taskId;
    };
    const taskA = await driveBoth(first.id);
    const taskB = await driveBoth(second.id);

    // The first pays normally.
    await request(server())
      .post(`/tasks/${taskA}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n);

    // The second is HELD, not refused outright — a human decides, because a
    // genuine multi-item basket legitimately backs more than one task.
    await request(server())
      .post(`/tasks/${taskB}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(409)
      .expect((r) =>
        expect(String(r.body.message)).toContain('already been refunded on another offer'),
      );
    expect(await walletSvc.getUserBalance(userId)).toBe(129900n); // not doubled
    const held = await prisma.task.findUniqueOrThrow({ where: { id: taskB } });
    expect(held.state).toBe('HOLDING'); // still live, nothing thrown away
    expect(held.orderId).toBe('o1'); // promoted column populated on every write

    // The staff override closes the loop: a human answers "yes, this really is a
    // second item in one basket" and the same release then succeeds. Without this
    // the user was told a reviewer would check it and no reviewer had a button.
    await prisma.task.update({
      where: { id: taskB },
      data: { duplicateOrderApproved: true },
    });
    await request(server())
      .post(`/tasks/${taskB}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.state).toBe('REFUNDED'));
    expect(await walletSvc.getUserBalance(userId)).toBe(259800n); // both now paid

    // Put it back so the ticket assertion below reads the HELD world again.
    await prisma.task.update({
      where: { id: taskB },
      data: { state: 'HOLDING', duplicateOrderApproved: false },
    });

    // And the ticket half, same root cause and no extra machinery needed to show
    // it: markPaid grants COMPLETION_RETURN for every REFUNDED task the user has
    // (withdrawal.service.ts), so the count of REFUNDED tasks IS the number of
    // grants. Held, not refunded → one grant, not two.
    const refundedCount = await prisma.task.count({
      where: { userId, state: 'REFUNDED' },
    });
    expect(refundedCount).toBe(1);

    // Mirror that loop directly to prove the balance effect.
    const before = await ticketsSvc.getBalance(userId);
    for (const t of await prisma.task.findMany({
      where: { userId, state: 'REFUNDED' },
      select: { id: true },
    })) {
      await ticketsSvc.grantCompletion(userId, t.id);
    }
    expect(await ticketsSvc.getBalance(userId)).toBe(before + 10); // ONE grant
  });

  it('rolls the claim back when the user cannot afford it', async () => {
    const { token } = await newUser(); // 0 tickets (no grant)
    const campaign = await makeCampaign();
    await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(409);
    // No task and no ticket entry were written.
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.ticketEntry.count()).toBe(0);
  });

  it('is idempotent per (user, campaign): re-claim returns the same task', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();

    const a = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const b = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);

    expect(b.body.id).toBe(a.body.id);
    expect(await ticketsSvc.getBalance(userId)).toBe(10); // charged once
    expect(await prisma.task.count()).toBe(1);
  });

  it('refuses to claim a non-active campaign', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const paused = await makeCampaign({ status: 'PAUSED' });
    await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: paused.id, acceptedTerms: true })
      .expect(409);
  });

  it('holds the refund until the return window elapses', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    // Delivered today → the 10-day window is still open.
    await driveToHolding(token, claim.body.id, Date.now());

    await request(server())
      .post(`/tasks/${claim.body.id}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(409)
      .expect((r) => expect(r.body.message).toMatch(/return window ends/));
    expect(await walletSvc.getUserBalance(userId)).toBe(0n);
  });

  it('blocks start-hold (without erroring) when the review is not public', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = claim.body.id;

    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '129900', quantity: 1, source: 'order-details' },
        returned: false,
      })
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        delivery: { at: Date.now() - 30 * DAY, source: 'order-details' },
        review: { published: false, product: 'boAt Rockerz 255 Pro+' },
      })
      .expect(200);
    await request(server())
      .post(`/tasks/${taskId}/reviewed`)
      .set('Authorization', bearer(token))
      .expect(200);

    await request(server())
      .post(`/tasks/${taskId}/start-hold`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => {
        expect(r.body.state).toBe('REVIEWED'); // did not enter HOLDING
        expect(r.body.blocker).toBe('review_not_public');
      });
  });

  it("does not leak another user's task (404)", async () => {
    const owner = await newUser();
    await ticketsSvc.grantSignup(owner.id);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(owner.token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);

    const stranger = await newUser();
    await request(server())
      .get(`/tasks/${claim.body.id}`)
      .set('Authorization', bearer(stranger.token))
      .expect(404);
    // And an unauthenticated read is 401.
    await request(server()).get(`/tasks/${claim.body.id}`).expect(401);
  });

  it('claws back a review that vanishes mid-hold (HOLDING → REVIEWED)', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = claim.body.id;
    await driveToHolding(token, taskId, Date.now() - 30 * DAY);

    // The scheduler's re-check finds the review gone → regress + audit row.
    const after = await taskSvc.recordVisibilityCheck(
      taskId,
      false,
      'permalink',
    );
    expect(after.state).toBe('REVIEWED');
    expect(after.blocker).toBe('review_not_public');
    expect(await prisma.visibilityCheck.count({ where: { taskId } })).toBe(1);

    // With the review gone, release is refused.
    await request(server())
      .post(`/tasks/${taskId}/release-refund`)
      .set('Authorization', bearer(token))
      .expect(409);
  });

  // ACCEPTING THE OFFER'S TERMS IS A RECORD, NOT A BUTTON STATE.
  //
  // The owner asked for a tick box on the product page and for the acceptance to be
  // written down. A disabled button is a courtesy that lives in the app; these
  // three checks are the control that lives on the server.
  describe('the offer’s terms', () => {
    it('refuses a claim that does not carry the acceptance', async () => {
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();

      await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id })
        .expect(400);

      // AND NOTHING WAS SPENT. A refusal that had already taken the tickets would
      // be worse than no refusal at all.
      expect(await ticketsSvc.getBalance(userId)).toBe(15);
      expect(await prisma.task.count({ where: { userId } })).toBe(0);
    });

    it('refuses it just as firmly when the answer is a plain no', async () => {
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();

      // `false` is a perfectly valid boolean, so a check that only asked "is this a
      // boolean?" would have created a task recording that somebody declined the
      // terms and claimed anyway.
      const res = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: false })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/accept the terms/i);
      expect(await ticketsSvc.getBalance(userId)).toBe(15);

      // Nor does a string that merely looks like a yes.
      await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: 'true' })
        .expect(400);
      expect(await prisma.task.count({ where: { userId } })).toBe(0);
    });

    it('writes down WHEN they accepted and WHAT they accepted', async () => {
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const terms = 'Buy the exact product.\nOne entry per person.';
      const campaign = await makeCampaign({ terms });

      const before = Date.now();
      const claim = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201);

      const row = await prisma.task.findUniqueOrThrow({
        where: { id: claim.body.id },
      });
      expect(row.offerTermsAcceptedAt).not.toBeNull();
      expect(row.offerTermsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before);

      // THE TEXT IS FROZEN, and it came from the server's own copy. Editing the
      // campaign afterwards must not change what this person is recorded as having
      // agreed to.
      expect(row.offerTermsText).toBe(terms);
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { terms: 'Completely different rules.' },
      });
      const again = await prisma.task.findUniqueOrThrow({
        where: { id: claim.body.id },
      });
      expect(again.offerTermsText).toBe(terms);

      // And it is in the event history too, which is what staff read.
      const claimEvent = await prisma.taskEvent.findFirstOrThrow({
        where: { taskId: claim.body.id, type: 'CLAIM' },
      });
      expect(claimEvent.payload).toMatchObject({ acceptedOfferTerms: true });
    });

    it('is recorded the same when the claim comes from the product page', async () => {
      // THE PATH MOVED ON 2 SEPTEMBER 2026. The app used to claim from a separate
      // "Confirm participation" page; the owner took that page off the path and the
      // product page claims directly now, from the tick box that sits on it.
      //
      // The CONTRACT did not move, and this is the check that says so: the same
      // body, the same two columns filled, the same frozen text. The server has no
      // idea which screen called it, which is exactly the point — the record does
      // not depend on the app's own layout.
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const terms = 'Buy the exact product.\nKeep it, do not return it.';
      const campaign = await makeCampaign({ terms });

      const claim = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201);

      const row = await prisma.task.findUniqueOrThrow({
        where: { id: claim.body.id },
      });
      expect(row.offerTermsAcceptedAt).not.toBeNull();
      expect(row.offerTermsText).toBe(terms);
      expect(row.state).toBe('CLAIMED');
      // And the tickets really moved, because a claim that records consent and
      // spends nothing is not a claim.
      expect(await ticketsSvc.getBalance(userId)).toBe(10);
    });

    it('never takes the acceptance from what the client sent', async () => {
      // A client could send any instant or any wording it liked. Neither is
      // allowed anywhere near the record: the server stamps its own clock and
      // copies its own terms.
      const src = readFileSync(
        join(__dirname, '..', 'src', 'tasks', 'task.service.ts'),
        'utf8',
      );
      expect(src).toMatch(/offerTermsAcceptedAt: new Date\(\)/);
      expect(src).toMatch(/offerTermsText: campaign\.terms/);
    });
  });

  // THE THIRTY MINUTE SLOT, AND THE SWEEP THAT HAS TO KEEP UP WITH IT.
  //
  // The owner asked on 1 September 2026 for a thirty minute purchase window, and
  // named the risk himself: a sweep that used to run once a week is now going to
  // run every half hour. So these two tests do not force a date into the row. The
  // first proves the real claim really is thirty minutes long, and the second lets
  // that real window pass and proves the tickets come back.
  it('gives a fresh claim exactly the operator’s window, in minutes', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();

    const before = Date.now();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const after = Date.now();

    const minutes = config.getOrThrow<number>('CLAIM_TTL_MINUTES');
    expect(minutes).toBe(30); // the default the owner asked for

    const row = await prisma.task.findUniqueOrThrow({
      where: { id: claim.body.id },
    });
    const deadline = row.claimExpiresAt?.getTime() ?? 0;
    // Inside the window the request itself took, so this cannot pass on a stale
    // or defaulted date. A day-long window would be nowhere near this range.
    expect(deadline).toBeGreaterThanOrEqual(before + minutes * 60_000);
    expect(deadline).toBeLessThanOrEqual(after + minutes * 60_000);

    // AND THE APP IS TOLD THE SAME NUMBER. The confirmation screen states the
    // window before the claim exists, so it reads it off the campaign. One
    // setting, two readers, and this is the check that they cannot drift.
    const feed = await request(server())
      .get('/campaigns')
      .set('Authorization', bearer(token))
      .expect(200);
    const card = (feed.body as { id: string; claimWindowMinutes: number }[]).find(
      (c) => c.id === campaign.id,
    );
    expect(card?.claimWindowMinutes).toBe(minutes);
  });

  it('returns the tickets when the thirty minutes really run out', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();

    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    expect(await ticketsSvc.getBalance(userId)).toBe(10);

    const minutes = config.getOrThrow<number>('CLAIM_TTL_MINUTES');

    // A sweep DURING the window must take nothing. This is the half that matters
    // most now: the sweep runs against every open claim, so a boundary that is one
    // comparison out would close a claim somebody is still shopping for.
    expect((await taskSvc.sweepExpiredClaims(new Date())).expired).toBe(0);
    expect(await ticketsSvc.getBalance(userId)).toBe(10);

    // The clock is moved, not the row: the sweep is told a later `now`, exactly as
    // the scheduler tells it the real one. The deadline in the database is the one
    // the claim itself computed.
    const oneMinuteLate = new Date(Date.now() + (minutes + 1) * 60_000);
    expect((await taskSvc.sweepExpiredClaims(oneMinuteLate)).expired).toBe(1);

    expect(await ticketsSvc.getBalance(userId)).toBe(15); // all 5 back
    const closed = await prisma.task.findUniqueOrThrow({
      where: { id: claim.body.id },
    });
    expect(closed.closeReason).toBe('expired');
    expect(closed.closedAt).not.toBeNull();

    // Sweeping again changes nothing. Every half hour means this runs often, and
    // a second pass over an already-closed claim must not hand out five more
    // tickets.
    expect((await taskSvc.sweepExpiredClaims(oneMinuteLate)).expired).toBe(0);
    expect(await ticketsSvc.getBalance(userId)).toBe(15);
  });

  it('returns tickets when a claim expires unpurchased', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    expect(await ticketsSvc.getBalance(userId)).toBe(10);

    // Force the claim past its purchase deadline, then sweep.
    await prisma.task.update({
      where: { id: claim.body.id },
      data: { claimExpiresAt: new Date(Date.now() - DAY) },
    });
    const { expired } = await taskSvc.sweepExpiredClaims();
    expect(expired).toBe(1);

    expect(await ticketsSvc.getBalance(userId)).toBe(15); // 5 returned
    const closed = await prisma.task.findUniqueOrThrow({
      where: { id: claim.body.id },
    });
    expect(closed.closeReason).toBe('expired');
  });

  // Claim-limit rule: a campaign may be claimed once per user, but only a
  // *purchase* is permanent. An unpurchased claim that expires can be re-claimed;
  // once a task ever passes CLAIMED (purchase confirmed), the campaign is locked
  // for that user forever — even after the refund lands.
  describe('claim-limit rule', () => {
    it('(a) allows a fresh claim on a campaign the user has never claimed', async () => {
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201)
        .expect((r) => expect(r.body.state).toBe('CLAIMED'));
    });

    it('(b) allows re-claiming after an unpurchased claim expired', async () => {
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();

      const first = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201);

      // Expire it unpurchased — state stays CLAIMED, task is closed.
      await prisma.task.update({
        where: { id: first.body.id },
        data: { claimExpiresAt: new Date(Date.now() - DAY) },
      });
      expect((await taskSvc.sweepExpiredClaims()).expired).toBe(1);

      // A fresh claim on the same campaign works — a new task, charged again.
      const second = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201)
        .expect((r) => expect(r.body.state).toBe('CLAIMED'));
      expect(second.body.id).not.toBe(first.body.id);
      expect(
        await prisma.task.count({
          where: { userId, campaignId: campaign.id },
        }),
      ).toBe(2);
    });

    it('(c) blocks a second claim once the campaign was ever purchased — even after a full refund', async () => {
      const { id: userId, token } = await newUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();

      const first = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201);
      const taskId: string = first.body.id;

      // Drive all the way to REFUNDED (delivery 30 days ago → window elapsed).
      await driveToHolding(token, taskId, Date.now() - 30 * DAY);
      await request(server())
        .post(`/tasks/${taskId}/release-refund`)
        .set('Authorization', bearer(token))
        .expect(200)
        .expect((r) => expect(r.body.state).toBe('REFUNDED'));

      // The campaign is now permanently locked for this user.
      await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(409)
        .expect((r) => expect(r.body.message).toMatch(/already completed/i));

      // No new task, no extra tickets charged.
      expect(
        await prisma.task.count({
          where: { userId, campaignId: campaign.id },
        }),
      ).toBe(1);
    });
  });

  // A user must not be able to ASSERT evidence about themselves. Anyone can type
  // "I paid ₹5,000" or upload a doctored invoice, so every asserted source has to
  // arrive through the staff-approval funnel — never straight off the device.
  describe('asserted evidence sources are refused on the user endpoint', () => {
    let token: string;
    let taskId: string;

    beforeEach(async () => {
      const user = await newUser();
      token = user.token;
      await ticketsSvc.grantSignup(user.id);
      const campaign = await makeCampaign();
      const res = await request(server())
        .post('/tasks')
        .set('Authorization', bearer(token))
        .send({ campaignId: campaign.id, acceptedTerms: true })
        .expect(201);
      taskId = res.body.id;
    });

    for (const source of ['manual', 'invoice', 'ocr']) {
      it(`rejects an order claiming source "${source}"`, async () => {
        await request(server())
          .post(`/tasks/${taskId}/evidence`)
          .set('Authorization', bearer(token))
          .send({ order: { id: 'made-up', itemPaise: '500000', quantity: 1, source } })
          .expect(400);
      });

      it(`rejects a delivery claiming source "${source}"`, async () => {
        await request(server())
          .post(`/tasks/${taskId}/evidence`)
          .set('Authorization', bearer(token))
          .send({ delivery: { at: Date.now(), source } })
          .expect(400);
      });
    }

    it('still accepts the attested scraper sources', async () => {
      // The SAME order id throughout: changing it mid-task legitimately trips the
      // plausibility guard (order-id-changed), which is a different rule from the
      // one under test here.
      for (const source of ['order-details', 'order-history', 'dkim']) {
        await request(server())
          .post(`/tasks/${taskId}/evidence`)
          .set('Authorization', bearer(token))
          .send({ order: { id: 'o-attested', itemPaise: '129900', quantity: 1, source } })
          .expect(200);
      }
    });

    it('leaves no typed amount on the task after a rejected submission', async () => {
      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', bearer(token))
        .send({ order: { id: 'made-up', itemPaise: '500000', quantity: 1, source: 'manual' } })
        .expect(400);
      const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(row.itemPaise).toBeNull();
      expect(row.orderId).toBeNull();
    });
  });
});
