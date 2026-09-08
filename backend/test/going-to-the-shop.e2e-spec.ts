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
import { HOURS_TO_COME_BACK, THE_HOLD_MS } from '../src/tasks/engine/shop-visit';
import { clockInIndia, theNotice } from '../src/tasks/engine/shop-visit-words';
import { resetDatabase } from './reset-db';

/**
 * THEY TAPPED BUY AND WENT TO THE SHOP, over real HTTP.
 *
 * The pure halves of this are checked under engine/shop-visit.spec.ts and
 * engine/shop-visit-words.spec.ts, where every clock edge is walked minute by
 * minute. What can only be checked HERE is the row: that the tap is written once,
 * that a second tap does not move it, and that the sentence frozen onto the task
 * is the sentence the person was shown.
 *
 * NO MOBILE NUMBER IN THIS FILE IS A REAL ONE. Every user is created with a
 * generated +9194 number, which is the harness the other walks use.
 */
describe('going to the shop (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let tickets: TicketService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
  const bearer = (t: string): string => `Bearer ${t}`;
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
        title: 'Review the boAt Rockerz',
        productName: 'boAt Rockerz 255 Pro+',
        category: 'electronics',
        productPricePaise: 129900n,
        payoutPercent: 100,
        ticketCost: 5,
        ...over,
      },
    });

  /** Claim an offer and hand back its task id. */
  async function claim(token: string, campaignId: string): Promise<string> {
    const res = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId, acceptedTerms: true })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    tickets = app.get(TicketService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Aborted: connected to non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('records the tap and starts a two hour hold', async () => {
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);

    const before = Date.now();
    const res = await request(server())
      .post(`/tasks/${taskId}/going-to-the-shop`)
      .set('Authorization', bearer(token))
      .expect(200);
    const after = Date.now();

    expect(res.body.wentToShopAt).not.toBeNull();
    const tapped = Date.parse(res.body.wentToShopAt as string);
    // The recorded tap is the server's own clock, so it sits inside the window
    // this check itself spanned. Asserted rather than compared to a fixed date.
    expect(tapped).toBeGreaterThanOrEqual(before - 1000);
    expect(tapped).toBeLessThanOrEqual(after + 1000);

    const ends = Date.parse(res.body.shopHoldEndsAt as string);
    expect(ends - tapped).toBe(THE_HOLD_MS);
    expect(HOURS_TO_COME_BACK).toBe(2);
  });

  it('freezes the pop-up words, with the real clock time inside them', async () => {
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);

    const res = await request(server())
      .post(`/tasks/${taskId}/going-to-the-shop`)
      .set('Authorization', bearer(token))
      .expect(200);

    const text = res.body.shopVisitNoticeText as string;
    const tapped = Date.parse(res.body.wentToShopAt as string);
    const ends = Date.parse(res.body.shopHoldEndsAt as string);

    // WORD FOR WORD WHAT THE WORDS MODULE BUILDS, so the screen and the record
    // cannot be two different promises.
    expect(text).toBe(
      theNotice({ shopName: 'Amazon', endsAt: ends, from: tapped }).wholeThing,
    );
    expect(text).toContain('You have 2 hours');
    expect(text).toContain('Buy the product at Amazon');
    // The real time, not a placeholder. This is the assertion that would catch a
    // template shipped as a promise.
    expect(text).toContain(clockInIndia(ends));
    expect(text).not.toContain('{');
    expect(text).toContain('We cannot pay you after that');
  });

  it('TWO TAPS BY THE SAME PERSON ON THE SAME TASK DO NOT MOVE THE HOLD', async () => {
    // The owner's own sixth edge. Without this somebody could walk their own two
    // hour deadline forward for ever by tapping again, and the hold would mean
    // nothing at all.
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);

    const first = await request(server())
      .post(`/tasks/${taskId}/going-to-the-shop`)
      .set('Authorization', bearer(token))
      .expect(200);
    const second = await request(server())
      .post(`/tasks/${taskId}/going-to-the-shop`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(second.body.wentToShopAt).toBe(first.body.wentToShopAt);
    expect(second.body.shopHoldEndsAt).toBe(first.body.shopHoldEndsAt);
    expect(second.body.shopVisitNoticeText).toBe(first.body.shopVisitNoticeText);
  });

  it('and two taps arriving together still write only one', async () => {
    // The conditional update is what makes this true, not the read above it.
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);

    const both = await Promise.all([
      request(server()).post(`/tasks/${taskId}/going-to-the-shop`)
        .set('Authorization', bearer(token)),
      request(server()).post(`/tasks/${taskId}/going-to-the-shop`)
        .set('Authorization', bearer(token)),
    ]);
    for (const r of both) expect(r.status).toBe(200);
    expect(both[0].body.wentToShopAt).toBe(both[1].body.wentToShopAt);
  });

  it('refuses the tap once the thirty minutes have run out, and says why in words', async () => {
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);

    // Move the deadline into the past rather than waiting thirty real minutes.
    await prisma.task.update({
      where: { id: taskId },
      data: { claimExpiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(server())
      .post(`/tasks/${taskId}/going-to-the-shop`)
      .set('Authorization', bearer(token))
      .expect(400);
    // WORDS, NOT AN ENUM, because this is read by the person whose place went back.
    expect(String(res.body.message)).toContain('time to tap Buy has run out');
    expect(String(res.body.message)).toContain('Claim the offer again');

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.wentToShopAt).toBeNull();
    expect(row.shopHoldEndsAt).toBeNull();
  });

  it('somebody else task is missing, never forbidden', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    await tickets.grantSignup(owner.id);
    const campaign = await makeCampaign();
    const taskId = await claim(owner.token, campaign.id);

    await request(server())
      .post(`/tasks/${taskId}/going-to-the-shop`)
      .set('Authorization', bearer(stranger.token))
      .expect(404);

    const row = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.wentToShopAt).toBeNull();
  });

  it('a task with no tap says so, rather than pretending to a hold', async () => {
    const { id: userId, token } = await newUser();
    await tickets.grantSignup(userId);
    const campaign = await makeCampaign();
    const taskId = await claim(token, campaign.id);

    const res = await request(server())
      .get(`/tasks/${taskId}`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(res.body.wentToShopAt).toBeNull();
    expect(res.body.shopHoldEndsAt).toBeNull();
    expect(res.body.shopVisitNoticeText).toBeNull();
  });
});
