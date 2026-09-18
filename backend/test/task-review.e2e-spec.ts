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
 * THE REVIEW A PERSON WROTE INSIDE FAYR.
 *
 * Zepto, Blinkit and Instamart have no review form — only a private star rating
 * on the order — so for those shops the words are written in Fayr and stay with
 * Fayr. This suite checks the three things that matter about keeping them:
 *
 *   THE TEXT IS STORED EXACTLY AS IT WAS TYPED. Not trimmed, not collapsed, not
 *   tidied. A system that edits somebody's review has started writing it.
 *
 *   THE SERVER SCORES IT, not the phone. A score arriving in the body is
 *   ignored, because a number a phone can set is a number nobody can vouch for.
 *
 *   AND IT MOVES NOTHING. No state, no wallet, no evidence. The refund still
 *   waits on the shop's own page after the return window, exactly as before, and
 *   the checks below prove it by reading the task afterwards.
 */
describe('The review written inside Fayr (e2e)', () => {
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


  /** A claimed task whose order the server has matched — the only kind that may carry a review. */
  async function withAMatchedOrder() {
    const { userId, token, campaign, taskId } = await ready('DELIVERED');
    await prisma.task.update({
      where: { id: taskId },
      data: { orderId: 'SOSIJGGRL26770' },
    });
    return { userId, token, campaign, taskId };
  }

  const put = (token: string, taskId: string, body: object) =>
    request(server())
      .put(`/tasks/${taskId}/review`)
      .set('Authorization', bearer(token))
      .send(body);

  it('REFUSES A REVIEW ABOUT A PURCHASE NOBODY HAS CONFIRMED', async () => {
    // A task with no matched order is a task nobody has shown bought anything,
    // and a review about that is a review about nothing. It would also be the
    // obvious way to fill the table with writing about things never bought.
    const { token, taskId } = await ready('DELIVERED');
    await put(token, taskId, { text: 'The seal went after a week.' }).expect(409);
    const row = await prisma.taskReview.findUnique({ where: { taskId } });
    expect(row).toBeNull();
  });

  it('STORES THE TEXT EXACTLY AS IT WAS TYPED, whitespace and all', async () => {
    const { token, taskId } = await withAMatchedOrder();
    // Leading and trailing spaces, a double space, a newline and mixed case —
    // every one of which a tidy-minded trim would quietly remove.
    const theirs = '  The  texture is thin.\n\nIt SEPARATED after a week.   ';
    const res = await put(token, taskId, { text: theirs }).expect(200);

    expect(res.body.text).toBe(theirs);
    const row = await prisma.taskReview.findUniqueOrThrow({ where: { taskId } });
    expect(row.text).toBe(theirs);
  });

  it('SCORES IT ITSELF, and a phone cannot send a score at all', async () => {
    const { token, taskId } = await withAMatchedOrder();

    // A BODY CARRYING A SCORE IS REFUSED OUTRIGHT, which is stronger than
    // ignoring it: the DTO has one field, and the app's global validation pipe
    // rejects anything else rather than dropping it quietly. So there is no
    // shape of request in which a number from a phone reaches the column.
    await put(token, taskId, {
      text: 'Good product, very nice product, loved it',
      score: 100,
      band: 'STRONG',
    }).expect(400);
    expect(await prisma.taskReview.findUnique({ where: { taskId } })).toBeNull();

    // AND THE SERVER'S OWN ANSWER IS WHAT LANDS. The owner's own example of the
    // review Fayr does not want: nothing in it describes the product.
    const res = await put(token, taskId, {
      text: 'Good product, very nice product, loved it',
    }).expect(200);
    expect(res.body.score).toBe(0);
    expect(res.body.band).toBe('THIN');
    const row = await prisma.taskReview.findUniqueOrThrow({ where: { taskId } });
    expect(row.score).toBe(0);
    expect(row.band).toBe('THIN');
  });

  it('scores how DESCRIPTIVE it is and never how positive', async () => {
    const { token: tokenA, taskId: taskA } = await withAMatchedOrder();
    const { token: tokenB, taskId: taskB } = await withAMatchedOrder();

    const oneStar = await put(tokenA, taskA, {
      text: 'separated after a week and left an oily film',
    }).expect(200);
    const fiveStar = await put(tokenB, taskB, {
      text: 'Absolutely amazing, best purchase ever, highly recommend to everyone',
    }).expect(200);

    expect(oneStar.body.score).toBeGreaterThan(fiveStar.body.score);
    expect(fiveStar.body.band).toBe('THIN');
  });

  it('MOVES NO TASK STATE, NO MONEY AND NO EVIDENCE', async () => {
    const { userId, token, taskId } = await withAMatchedOrder();
    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const walletBefore = await prisma.walletEntry.count();
    const ticketsBefore = await prisma.ticketEntry.count({ where: { userId } });

    await put(token, taskId, { text: 'The seal went after about a week of use.' })
      .expect(200);

    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.state).toBe(before.state);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.evidence).toEqual(before.evidence);
    // NOT ONE LEDGER ROW AND NOT ONE TICKET MOVED. The refund still waits on
    // the shop's own page after the return window, exactly as it did before.
    expect(await prisma.walletEntry.count()).toBe(walletBefore);
    expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(ticketsBefore);
  });

  it('lets them write it again, and keeps the last thing they wrote', async () => {
    // Somebody who thinks of something else an hour later should be able to add
    // it. One row per task, so the last thing they wrote is what is theirs.
    const { token, taskId } = await withAMatchedOrder();
    await put(token, taskId, { text: 'thin' }).expect(200);
    const second = await put(token, taskId, {
      text: 'The texture is thin and it separated after about a week.',
    }).expect(200);

    expect(second.body.text).toBe(
      'The texture is thin and it separated after about a week.',
    );
    expect(await prisma.taskReview.count({ where: { taskId } })).toBe(1);
  });

  it('reads back what is there, and null when there is nothing', async () => {
    const { token, taskId } = await withAMatchedOrder();
    await request(server())
      .get(`/tasks/${taskId}/review`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body).toEqual({}));

    await put(token, taskId, { text: 'The lid cracked after two days.' }).expect(200);
    await request(server())
      .get(`/tasks/${taskId}/review`)
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((r) => expect(r.body.text).toBe('The lid cracked after two days.'));
  });

  it('KEEPS THE STARS, and stores null when they have not said', async () => {
    // The owner's own words: "Fayr should have the reviews that the user has
    // provided for each product and the ratings as well." The shop never shows
    // us the review text back — all an order page ever says is that the product
    // HAS been rated — so this column is the only record of what they gave.
    const { token, taskId } = await withAMatchedOrder();

    // SAVING WITH NO STARS AT ALL WORKS, and stores null. Somebody may write the
    // review before deciding the number, and nothing in Fayr may force one.
    const none = await put(token, taskId, {
      text: 'The seal went after about a week.',
    }).expect(200);
    expect(none.body.stars).toBeNull();
    expect(
      (await prisma.taskReview.findUniqueOrThrow({ where: { taskId } })).stars,
    ).toBeNull();

    // And a real number is kept as given.
    const one = await put(token, taskId, {
      text: 'The seal went after about a week.',
      stars: 1,
    }).expect(200);
    expect(one.body.stars).toBe(1);
    expect(
      (await prisma.taskReview.findUniqueOrThrow({ where: { taskId } })).stars,
    ).toBe(1);

    // NULL IS NOT ZERO, and clearing it puts it back to "they have not said".
    const cleared = await put(token, taskId, {
      text: 'The seal went after about a week.',
    }).expect(200);
    expect(cleared.body.stars).toBeNull();
  });

  it('refuses a star count that is not one to five, and one that is not a number', async () => {
    const { token, taskId } = await withAMatchedOrder();
    // 0 is not "no stars", it is a rating nobody can give. 2.5 is not a star
    // count. '5' is a string, and the pipe converts nothing implicitly, so it is
    // refused rather than quietly coerced.
    for (const bad of [0, 6, -1, 2.5, '5', true, 'five']) {
      await put(token, taskId, { text: 'x y z', stars: bad }).expect(400);
    }
    expect(await prisma.taskReview.findUnique({ where: { taskId } })).toBeNull();
  });

  it('takes an explicit null as "they have not said", exactly like leaving it out', async () => {
    // @IsOptional() treats null as absent, so a client clearing the rating by
    // sending null is accepted and stores null. That is the right answer and not
    // an accident: "they have not decided" is a real state, and it must be
    // reachable both by omitting the field and by clearing it.
    const { token, taskId } = await withAMatchedOrder();
    await put(token, taskId, { text: 'x y z', stars: 3 }).expect(200);
    const res = await put(token, taskId, { text: 'x y z', stars: null }).expect(200);
    expect(res.body.stars).toBeNull();
    expect(
      (await prisma.taskReview.findUniqueOrThrow({ where: { taskId } })).stars,
    ).toBeNull();
  });

  it('PAYS A ONE-STAR REVIEW EXACTLY AS IT PAYS A FIVE-STAR ONE', async () => {
    // The stars are a RECORD and never a reason to pay or not pay. Nothing moves
    // for either of them, and the two tasks end in the same place.
    const a = await withAMatchedOrder();
    const b = await withAMatchedOrder();
    const beforeA = await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
    const beforeB = await prisma.task.findUniqueOrThrow({ where: { id: b.taskId } });
    const walletBefore = await prisma.walletEntry.count();

    await put(a.token, a.taskId, { text: 'the strap loosened after two weeks', stars: 1 })
      .expect(200);
    await put(b.token, b.taskId, { text: 'the strap loosened after two weeks', stars: 5 })
      .expect(200);

    const afterA = await prisma.task.findUniqueOrThrow({ where: { id: a.taskId } });
    const afterB = await prisma.task.findUniqueOrThrow({ where: { id: b.taskId } });
    expect(afterA.state).toBe(beforeA.state);
    expect(afterB.state).toBe(beforeB.state);
    expect(afterA.state).toBe(afterB.state);
    expect(await prisma.walletEntry.count()).toBe(walletBefore);

    // And the score is the same too, because the score reads the words and never
    // the number beside them.
    const scoreA = (await prisma.taskReview.findUniqueOrThrow({ where: { taskId: a.taskId } })).score;
    const scoreB = (await prisma.taskReview.findUniqueOrThrow({ where: { taskId: b.taskId } })).score;
    expect(scoreA).toBe(scoreB);
  });

  it('SOMEBODY ELSE’S TASK READS AS 404, never as 403', async () => {
    // The same rule every other task route follows: a 403 would confirm the task
    // exists to somebody who has no business knowing.
    const { taskId } = await withAMatchedOrder();
    const stranger = await newUser();
    await put(stranger.token, taskId, { text: 'not mine' }).expect(404);
    await request(server())
      .get(`/tasks/${taskId}/review`)
      .set('Authorization', bearer(stranger.token))
      .expect(404);
  });

  it('refuses an empty review and an unauthenticated one', async () => {
    const { token, taskId } = await withAMatchedOrder();
    await put(token, taskId, { text: '' }).expect(400);
    await put(token, taskId, {}).expect(400);
    await request(server())
      .put(`/tasks/${taskId}/review`)
      .send({ text: 'x' })
      .expect(401);
  });
});
