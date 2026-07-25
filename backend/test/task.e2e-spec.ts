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
});
