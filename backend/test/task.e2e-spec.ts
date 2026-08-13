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
  ): Promise<void> {
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
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
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users","campaigns","tasks","task_events","visibility_checks","ticket_entries","wallet_accounts","wallet_entries","ledger_transactions" RESTART IDENTITY CASCADE',
    );
  });

  it('runs the full claim → evidence → hold → refund loop, moving tickets and money', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId); // 15 tickets
    const campaign = await makeCampaign();

    // Claim → CLAIMED, 5 tickets consumed.
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id })
      .expect(201);
    const taskId: string = claim.body.id;
    expect(claim.body.state).toBe('CLAIMED');
    expect(await ticketsSvc.getBalance(userId)).toBe(10);

    // Order evidence → PURCHASED.
    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
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
      .send({ campaignId: campaign.id })
      .expect(201);
    const taskId: string = claim.body.id;

    // Purchase-only check, keyed as the on-device sync layer keys it.
    const purchaseBody = {
      key: 'evidence:o1:o',
      order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
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
        order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
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
      .send({ campaignId: campaign.id })
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
          itemPaise: '99900',
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
        order: { id: 'o1', itemPaise: '99900', source: 'order-history' },
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
      .send({ campaignId: campaign.id })
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
        .send({ campaignId })
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
      .send({ campaignId: campaign.id })
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
      .send({ campaignId: campaign.id })
      .expect(201);
    const b = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id })
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
      .send({ campaignId: paused.id })
      .expect(409);
  });

  it('holds the refund until the return window elapses', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id })
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
      .send({ campaignId: campaign.id })
      .expect(201);
    const taskId = claim.body.id;

    await request(server())
      .post(`/tasks/${taskId}/evidence`)
      .set('Authorization', bearer(token))
      .send({
        order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
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
      .send({ campaignId: campaign.id })
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
      .send({ campaignId: campaign.id })
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

  it('returns tickets when a claim expires unpurchased', async () => {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id })
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
        .send({ campaignId: campaign.id })
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
        .send({ campaignId: campaign.id })
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
        .send({ campaignId: campaign.id })
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
        .send({ campaignId: campaign.id })
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
        .send({ campaignId: campaign.id })
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
});
