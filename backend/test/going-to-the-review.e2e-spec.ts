import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';

/**
 * "THEY LEFT TO WRITE THE REVIEW", ON THE RECORD AND NOT ONLY ON THE PHONE.
 *
 * REVIEW-FLOW-PROMPT.md, step fourteen, in the owner's own words: "When they tap
 * through to the review page, the backend must know they left for the review —
 * the same way the shop visit for buying is recorded. It belongs on the record,
 * not only on the phone."
 *
 * ── WHAT IT BUYS, WHICH A NOTE ON A PHONE CANNOT ──────────────────────────
 *
 * Two things. The screen at step seventeen says "you told us you posted it two
 * hours ago", and that needs an instant somebody other than the phone can vouch
 * for. And a person who reinstalls the app, or picks up a second phone, must not
 * be asked to start the review half again.
 *
 * ── AND WHAT IT MUST NOT BE MISTAKEN FOR ──────────────────────────────────
 *
 * It is not a claim that a review exists. Whether a review is publicly visible is
 * read off the shop's own page and settled nowhere else, so this route moves no
 * state, writes no evidence and fires no event. The checks below say so by
 * looking at what the task is afterwards.
 */
describe('Going to write the review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let ticketsSvc: TicketService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
  const bearer = (token: string): string => `Bearer ${token}`;
  const server = () => app.getHttpServer();

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
        title: 'Review the garment rack',
        productName: 'Lukzer Heavy-Duty Metal Garment Rack',
        category: 'home',
        productPricePaise: 93800n,
        payoutPercent: 85,
        ticketCost: 5,
        ...over,
      },
    });

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

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`aborted: connected to non-test database "${db}"`);
    }
  });

  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDatabase(prisma); });

  /** A claimed task, moved to whatever state the check is about. */
  async function ready(state?: 'DELIVERED' | 'REVIEWED') {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign();
    const claim = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = claim.body.id as string;
    if (state) {
      await prisma.task.update({ where: { id: taskId }, data: { state } });
    }
    return { userId, token, campaign, taskId };
  }

  it('RECORDS THE MOMENT THEY LEFT, and hands the task back with it on', async () => {
    const { token, taskId } = await ready('DELIVERED');
    const before = Date.now();
    const res = await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(200);
    const after = Date.now();

    expect(res.body.wentToReviewAt).toEqual(expect.any(String));
    const at = Date.parse(res.body.wentToReviewAt as string);
    // Inside the window the request itself took, so this cannot pass on a
    // defaulted or stale date.
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(after + 1000);
  });

  it('and it is on the record, not only in the answer', async () => {
    const { token, taskId } = await ready('DELIVERED');
    await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(200);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.wentToReviewAt).toBeInstanceOf(Date);
  });

  it('WRITE ONCE: a second tap returns the first tap’s instant unchanged', async () => {
    // Tapping twice is a normal thing to do on a phone and is not an error.
    // "When did they go" has one answer and the first one is it.
    const { token, taskId } = await ready('DELIVERED');
    const first = await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(200);
    const second = await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(second.body.wentToReviewAt).toBe(first.body.wentToReviewAt);
  });

  it('IT MOVES NO STATE AND WRITES NO EVIDENCE', async () => {
    // It says only that somebody left to write a review. Whether one exists, and
    // whether it is publicly visible, is read off the shop's own page.
    const { token, taskId } = await ready('DELIVERED');
    // COUNTED BEFORE AND AFTER, not against zero: claiming the offer writes an
    // event of its own, and a check against zero would be testing the claim
    // rather than this route.
    const before = await prisma.taskEvent.count({ where: { taskId } });
    await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(200);

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.state).toBe('DELIVERED');
    expect(row.reviewPublished).toBeNull();
    expect(row.evidence).toBeNull();
    expect(await prisma.taskEvent.count({ where: { taskId } })).toBe(before);
  });

  it('REFUSED BEFORE THE PARCEL HAS ARRIVED, because it cannot have happened', async () => {
    // The screen that sends somebody to write a review is only reachable once
    // the record carries a delivery. A visit recorded on a claimed task would be
    // a record of something that did not happen.
    const { token, taskId } = await ready();
    const res = await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(400);
    expect(String(res.body.message)).toMatch(/has not arrived/i);

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.wentToReviewAt).toBeNull();
  });

  it('and still accepted once the review has landed, so a second tap never fails', async () => {
    // Somebody who opens the shop again while the review is being checked has
    // still gone to the review. Refusing them would put a red message in front
    // of a person who did nothing wrong.
    const { token, taskId } = await ready('REVIEWED');
    await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(token))
      .expect(200);
  });

  it('SOMEBODY ELSE’S TASK READS AS MISSING, never as forbidden', async () => {
    const { taskId } = await ready('DELIVERED');
    const { token: stranger } = await newUser();
    await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(stranger))
      .expect(404);
  });

  it('AND A STRANGER LEARNS NOTHING FROM THE STATE OF IT EITHER', async () => {
    // ── THE ONE THAT A DELIVERED TASK CANNOT SHOW ─────────────────────────
    //
    // Found by breaking the ownership test in the lookup on 17 September 2026.
    // With the owner dropped from it, a stranger asking about a DELIVERED task
    // still got 404 — the ownership check further down caught it — so nothing
    // looked wrong. A task that has NOT been delivered is the case that tells
    // them apart: without the owner in the lookup, the state test runs first and
    // answers 400 "your product has not arrived yet", which says both that the
    // task exists and where in the journey it is.
    //
    // A task that is not theirs reads as missing, never as forbidden, and never
    // as a sentence about somebody else's parcel.
    const { taskId } = await ready();
    const { token: stranger } = await newUser();
    const res = await request(server())
      .post(`/tasks/${taskId}/going-to-the-review`)
      .set('Authorization', bearer(stranger));
    expect(res.status).toBe(404);
    expect(String(res.body.message)).not.toMatch(/has not arrived/i);
  });

  it('and it is null on every task nobody has gone from', async () => {
    const { token, taskId } = await ready('DELIVERED');
    const res = await request(server())
      .get(`/tasks/${taskId}`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(res.body.wentToReviewAt).toBeNull();
  });
});
