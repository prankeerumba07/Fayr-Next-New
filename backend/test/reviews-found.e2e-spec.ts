import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';

/**
 * THE REVIEW THE PHONE FOUND, END TO END.
 *
 * THE PHONE LOOKS. THE SERVER JUDGES. The person is signed in to the shop inside
 * Fayr's own web view, so only the phone can open their own list of reviews. It
 * sends TEXT. Everything that matters — is this a review of the campaign's
 * product, is it public, does the task move — is decided here, and these are the
 * checks that say so over real requests against a real database.
 *
 * The two that matter most: a phone cannot claim `published`, and a real review
 * of the WRONG product does not pay.
 */
describe('The reviews the phone found (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let ticketsSvc: TicketService;

  const fixture = (name: string): string =>
    readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

  /** The owner's own review of the campaign's product, read 16 September 2026. */
  const RACK_REVIEW = fixture('amazon-review-garment-rack.txt');
  /** His review of something else, on the same account, equally genuine. */
  const NIKE_REVIEW = fixture('amazon-review-nike-shoes.txt');

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

  const makeCampaign = (over: Partial<Prisma.CampaignCreateInput> = {}) =>
    prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        status: 'ACTIVE',
        title: 'Hang It Up, Get 85% Back',
        productName:
          'Lukzer Heavy-Duty Metal Garment Rack with Bottom Storage Shelf & 4 Side Hooks',
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

  /**
   * A task that has already been bought and delivered.
   *
   * WRITTEN STRAIGHT ONTO THE ROW rather than driven through the purchase and
   * delivery routes, deliberately: those have their own end-to-end checks next
   * door, and re-running them here would mean this file failing when something
   * unrelated to a review broke.
   */
  async function delivered(over: Partial<Prisma.CampaignCreateInput> = {}) {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign(over);
    const claimed = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = claimed.body.id as string;
    await prisma.task.update({
      where: { id: taskId },
      data: {
        state: 'DELIVERED',
        orderId: '408-1509645-3524313',
        itemPaise: 93800n,
        deliveredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        returned: false,
      },
    });
    return { userId, token, campaign, taskId };
  }

  const post = (token: string, taskId: string, pages: string[]) =>
    request(server())
      .post(`/tasks/${taskId}/reviews-found`)
      .set('Authorization', bearer(token))
      .send({ pages });

  it('READS THE OWNER’S REAL REVIEW AND MOVES THE TASK ON', async () => {
    const { token, taskId } = await delivered();
    const res = await post(token, taskId, [RACK_REVIEW]).expect(200);

    expect(res.body.matched).toBe(true);
    expect(res.body.reason).toBe('matched');
    expect(res.body.review.rating).toBe(5);
    expect(res.body.review.reviewDay).toBe('2026-06-13');
    expect(res.body.review.verifiedPurchase).toBe(true);

    // AND THE RECORD MOVED, which is the part a person sees. Evidence alone
    // leaves a task on DELIVERED; MARK_REVIEWED and START_HOLD are what carry it.
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(['REVIEWED', 'HOLDING']).toContain(task.state);
    expect(task.reviewPublished).toBe(true);
  });

  it('REFUSES A REAL REVIEW OF THE WRONG PRODUCT, and moves nothing', async () => {
    // The same person, the same account, a genuine verified five-star review —
    // of shoes. This is the one that stops a paste-anything payout.
    const { token, taskId } = await delivered();
    const res = await post(token, taskId, [NIKE_REVIEW]).expect(200);

    expect(res.body.matched).toBe(false);
    expect(res.body.reason).toBe('product_name_not_found');
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe('DELIVERED');
    expect(task.reviewPublished).toBeNull();
  });

  it('finds the right one among several, and only that one', async () => {
    const { token, taskId } = await delivered();
    const res = await post(token, taskId, [NIKE_REVIEW, RACK_REVIEW]).expect(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.review.reviewDay).toBe('2026-06-13');
  });

  it('tells “could not read” apart from “wrong product”', async () => {
    const { token, taskId } = await delivered();
    const res = await post(token, taskId, ['Hello, prakash\nYour Orders']).expect(200);
    expect(res.body.matched).toBe(false);
    expect(res.body.reason).toBe('nothing_readable');
  });

  it('A PHONE CANNOT CLAIM THE REVIEW IS PUBLIC', async () => {
    // `published` is the payout signal. There is no field for it on the way in,
    // and the app-wide validation refuses any field the DTO does not name — so a
    // phone that tried is turned away at the door rather than quietly ignored.
    const { token, taskId } = await delivered();
    await request(server())
      .post(`/tasks/${taskId}/reviews-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [NIKE_REVIEW], published: true, matched: true })
      .expect(400);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.state).toBe('DELIVERED');
    expect(task.reviewPublished).toBeNull();
  });

  it('nor can it send the fields instead of the page', async () => {
    const { token, taskId } = await delivered();
    await request(server())
      .post(`/tasks/${taskId}/reviews-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [], product: 'Lukzer', rating: 5, reviewDay: '2026-06-13' })
      .expect(400);
  });

  it('A ONE STAR REVIEW IS ACCEPTED EXACTLY AS A FIVE STAR ONE IS', async () => {
    // Fayr pays for an honest review and has no opinion about what it says. This
    // is the check that fails the day somebody adds a rule about the rating.
    const { token, taskId } = await delivered();
    const harsh = RACK_REVIEW
      .replace('5 out of 5 stars', '1 out of 5 stars')
      .replace('Good quality garment rack', 'Poor quality garment rack');
    const res = await post(token, taskId, [harsh]).expect(200);
    expect(res.body.matched).toBe(true);
    expect(res.body.review.rating).toBe(1);
  });

  it('is refused on somebody else’s task, which reads as not there at all', async () => {
    const mine = await delivered();
    const other = await newUser();
    await request(server())
      .post(`/tasks/${mine.taskId}/reviews-found`)
      .set('Authorization', bearer(other.token))
      .send({ pages: [RACK_REVIEW] })
      .expect(404);
  });

  it('needs somebody signed in', async () => {
    const { taskId } = await delivered();
    await request(server())
      .post(`/tasks/${taskId}/reviews-found`)
      .send({ pages: [] })
      .expect(401);
  });
});
