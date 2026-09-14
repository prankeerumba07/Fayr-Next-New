import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INestApplication, Logger } from '@nestjs/common';
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
 * THE AUTOMATIC CHECK AFTER "YES, I PURCHASED", END TO END.
 *
 * THE PHONE LOOKS. THE SERVER JUDGES AND REMEMBERS. The phone can open the shop's
 * own list of recent orders, because the person's sign in to the shop lives on the
 * device. It sends the TEXT of each order it found. Everything else — reading the
 * text, deciding whether it is the campaign's product at the campaign's price,
 * keeping the answer — happens on the server, and these are the checks that say
 * so over real requests against a real database.
 *
 * The one that matters most is "a phone claiming a match is refused". A phone is
 * something a person controls, so anything it says about matching is worthless,
 * and there is no field for it on the way in.
 */
describe('The orders the phone found (e2e)', () => {
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
        platform: 'ZEPTO',
        status: 'ACTIVE',
        title: 'Review the Boldfit headband',
        productName: 'Boldfit Strapless Sports Headband',
        category: 'electronics',
        productPricePaise: 14900n,
        payoutPercent: 100,
        ticketCost: 5,
        ...over,
      },
    });

  /** A claimed task, and the day it was claimed. */
  async function claim(
    token: string,
    campaignId: string,
  ): Promise<string> {
    const res = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId, acceptedTerms: true })
      .expect(201);
    return res.body.id as string;
  }

  /**
   * One row out of a shop's own list of recent orders, as the phone reads it.
   *
   * The date is handed in so an order can be placed AFTER the claim: the order
   * window rule refuses an order the campaign cannot have caused, and every real
   * order here has to be a real one.
   */
  const row = (parts: string[]) => parts.join('\n');
  const today = (): string => {
    const d = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  const HEADBAND = (orderNumber: string) => row([
    `Order ID ${orderNumber}`,
    `Placed on ${today()}`,
    'Boldfit Strapless Sports Headband',
    '1 x ₹149',
    'Total ₹149',
  ]);

  const SOMETHING_ELSE = row([
    'Order ID SOSZZZZZZ99999',
    `Placed on ${today()}`,
    'Prestige Induction Cooktop 1900W Black',
    '1 x ₹1,326',
    'Total ₹1,326',
  ]);

  /** The owner's real two shipment Zepto order, in the list row layout. */
  const TWO_PRODUCTS = row([
    'Order ID SOSIJGGRL26770',
    `Placed on ${today()}`,
    'Shipment 1 of 2',
    'Boldfit Strapless Sports Headband',
    '1 x ₹149',
    'Shipment 2 of 2',
    'Hammer Nova earphones',
    '1 x ₹219',
    'Total ₹368',
  ]);

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

  /** A user with tickets, a campaign and a claimed task. */
  async function ready(over: Partial<Prisma.CampaignCreateInput> = {}) {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign(over);
    const taskId = await claim(token, campaign.id);
    return { userId, token, campaign, taskId };
  }

  it('reads the text the phone sent and answers newest first', async () => {
    const { token, taskId } = await ready();
    const res = await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [SOMETHING_ELSE, HEADBAND('SOSIJGGRL26770')] })
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].position).toBe(0);
    expect(res.body[0].orderNumber).toBe('SOSZZZZZZ99999');
    expect(res.body[1].orderNumber).toBe('SOSIJGGRL26770');

    // The server's own answer, worked out from the text.
    expect(res.body[0].matches).toBe(false);
    expect(res.body[0].reason).toBe('product_name_not_found');
    expect(res.body[1].matches).toBe(true);
    expect(res.body[1].reason).toBe('matched');
    // Money crosses the wire as a whole number of paise, written as text.
    expect(res.body[1].totalPaise).toBe('14900');
    expect(res.body[1].items).toEqual([
      { name: 'Boldfit Strapless Sports Headband', pricePaise: '14900' },
    ]);
  });

  it('REFUSES A PHONE THAT CLAIMS A MATCH', async () => {
    const { token, taskId } = await ready();
    // The order plainly does not match: it is a cooktop, and the offer is a
    // headband. The phone says it matched anyway.
    await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [SOMETHING_ELSE], matches: true })
      .expect(400);

    // And it is refused at the door rather than quietly ignored: nothing was
    // written down at all.
    expect(await prisma.orderCandidate.count({ where: { taskId } })).toBe(0);
  });

  it('refuses a phone that sends the fields instead of the text', async () => {
    const { token, taskId } = await ready();
    // A tidy order that never existed. There is no field for any of it.
    await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({
        pages: [],
        orderNumber: 'MADE-UP-1234',
        totalPaise: '14900',
        items: [{ name: 'Boldfit Strapless Sports Headband', pricePaise: '14900' }],
      })
      .expect(400);
  });

  it('says an order does not match even when the text was written to look right', async () => {
    const { token, taskId } = await ready();
    // The right product name at the wrong price. Only the server compares.
    const res = await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [row([
        'Order ID SOSFAKE111111',
        `Placed on ${today()}`,
        'Boldfit Strapless Sports Headband',
        '1 x ₹1',
        'Total ₹1',
      ])] })
      .expect(200);
    expect(res.body[0].matches).toBe(false);
    expect(res.body[0].reason).toBe('price_differs');
  });

  it('never says only that there was no match', async () => {
    const { token, taskId } = await ready();
    const res = await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [
        SOMETHING_ELSE,
        row(['Order ID SOSEMPTY00000', `Placed on ${today()}`]),
      ] })
      .expect(200);
    for (const c of res.body) {
      expect(typeof c.reason).toBe('string');
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.reason).not.toBe('no_match');
    }
    expect(res.body.map((c: { reason: string }) => c.reason)).toEqual([
      'product_name_not_found', 'no_products_read',
    ]);
  });

  it('never keeps more than the twenty most recent orders', async () => {
    const { token, taskId } = await ready();
    // Twenty one is one too many, and the request itself is refused rather than
    // quietly trimmed, so a phone cannot find out where the limit is by trying.
    const many = Array.from({ length: 21 }, (_, i) => HEADBAND(`SOS${1000 + i}AAA`));
    await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: many })
      .expect(400);

    const twenty = many.slice(0, 20);
    const res = await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: twenty })
      .expect(200);
    expect(res.body).toHaveLength(20);
  });

  it('one look replaces the last, so an order is never asked about twice', async () => {
    const { token, taskId } = await ready();
    await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [SOMETHING_ELSE] })
      .expect(200);
    const again = await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [SOMETHING_ELSE, HEADBAND('SOSIJGGRL26770')] })
      .expect(200);
    expect(again.body).toHaveLength(2);
    expect(await prisma.orderCandidate.count({ where: { taskId } })).toBe(2);
  });

  it('reads them back on their own, newest first', async () => {
    const { token, taskId } = await ready();
    await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [SOMETHING_ELSE, HEADBAND('SOSIJGGRL26770')] })
      .expect(200);
    const res = await request(server())
      .get(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(res.body.map((c: { position: number }) => c.position)).toEqual([0, 1]);
  });

  describe('"yes, that is mine"', () => {
    it('moves the task on, and does not ask the same question twice', async () => {
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [HEADBAND('SOSIJGGRL26770')] })
        .expect(200);
      const mine = found.body[0];
      expect(mine.matches).toBe(true);

      const after = await request(server())
        .post(`/tasks/${taskId}/orders-found/${mine.id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

      expect(after.body.state).toBe('PURCHASED');
      // Saying "yes, that is mine" IS the confirmation. Asking again on the next
      // screen would be the second time somebody confirmed the same thing.
      expect(after.body.order.orderConfirmed).toBe(true);
      expect(after.body.order.id).toBe('SOSIJGGRL26770');
    });

    it('records which one they said was theirs', async () => {
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [HEADBAND('SOSIJGGRL26770')] })
        .expect(200);
      await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);
      const row2 = await prisma.orderCandidate.findUnique({
        where: { id: found.body[0].id },
      });
      expect(row2?.chosenAt).not.toBeNull();
    });

    it('refuses an order the server said does not match', async () => {
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [SOMETHING_ELSE] })
        .expect(200);
      expect(found.body[0].matches).toBe(false);
      await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(409);
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      expect(task?.state).toBe('CLAIMED');
      expect(task?.orderId).toBeNull();
    });

    it('takes the product’s price when it is certain', async () => {
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [HEADBAND('SOSIJGGRL26770')] })
        .expect(200);
      const after = await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

      // One product, and the whole bill is exactly its price, so the quantity
      // must be one and there is nothing left to work out. It is sent as what ONE
      // UNIT COST, which is the only figure a refund may be based on.
      expect(after.body.order.unitPricePaise).toBe('14900');
      // AND THE FIGURE THE REFUND WOULD REALLY USE, from the same resolver the
      // payout uses. The old legacy itemPaise COLUMN is null on every task this
      // code produces and must not be read — see task.mapper.ts.
      expect(after.body.refund.basedOnPaise).toBe('14900');
    });

    it('leaves the amount for a person on an order with two products', async () => {
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);
      expect(found.body[0].matches).toBe(true);
      expect(found.body[0].shipments).toBe(2);
      expect(found.body[0].items).toHaveLength(2);

      await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

      // THE ORDER IS ESTABLISHED AND THE AMOUNT IS NOT. A bill of 368 against a
      // product at 149 might be one of each, and it might be something else. A
      // staff member says which, and until then no refund can be released. That
      // is the same answer this project already gives for quick commerce.
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      expect(task?.state).toBe('PURCHASED');
      expect(task?.orderId).toBe('SOSIJGGRL26770');

      // No figure a refund could be based on. The whole bill is on the record,
      // because it is true, and the resolver refuses to fall back to a bare order
      // total precisely so it cannot become somebody's refund.
      const asked = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', bearer(token))
        .expect(200);
      expect(asked.body.order.orderTotalPaise).toBe('36800');
      expect(asked.body.order.unitPricePaise).toBeNull();
      expect(asked.body.order.lineTotalPaise).toBeNull();
      expect(asked.body.refund.basedOnPaise).toBeNull();
    });

    it('is refused on somebody else’s task, which reads as not there at all', async () => {
      const mine = await ready();
      const found = await request(server())
        .post(`/tasks/${mine.taskId}/orders-found`)
        .set('Authorization', bearer(mine.token))
        .send({ pages: [HEADBAND('SOSIJGGRL26770')] })
        .expect(200);

      const other = await newUser();
      await request(server())
        .get(`/tasks/${mine.taskId}/orders-found`)
        .set('Authorization', bearer(other.token))
        .expect(404);
      await request(server())
        .post(`/tasks/${mine.taskId}/orders-found`)
        .set('Authorization', bearer(other.token))
        .send({ pages: [HEADBAND('SOSIJGGRL26770')] })
        .expect(404);
      await request(server())
        .post(`/tasks/${mine.taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(other.token))
        .expect(404);
    });

    it('needs somebody signed in', async () => {
      const { taskId } = await ready();
      await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .send({ pages: [] })
        .expect(401);
      await request(server()).get(`/tasks/${taskId}/orders-found`).expect(401);
    });
  });

  it('refuses an order the offer cannot have caused', async () => {
    const { token, taskId } = await ready();
    // The date rule: a purchase made before the claim was not caused by it. The
    // order reads perfectly and is still refused, and the task stays where it is.
    const res = await request(server())
      .post(`/tasks/${taskId}/orders-found`)
      .set('Authorization', bearer(token))
      .send({ pages: [row([
        'Order ID SOSOLDORDER11',
        'Placed on 1 Jan 2026',
        'Boldfit Strapless Sports Headband',
        '1 x ₹149',
        'Total ₹149',
      ])] })
      .expect(200);
    expect(res.body[0].matches).toBe(true); // it IS the product, at the price

    await request(server())
      .post(`/tasks/${taskId}/orders-found/${res.body[0].id}/mine`)
      .set('Authorization', bearer(token))
      .expect(200);

    // The evidence went down the SAME funnel as the scraper's, so the order
    // window rule applied to it, unchanged.
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.state).toBe('CLAIMED');
    expect(task?.blocker).toBe('order_out_of_window');
  });

  /**
   * ── THE DELIVERY, CARRIED THE WHOLE WAY ──────────────────────────────────
   *
   * An order's own page states the day it arrived and whether it went back. Both
   * were read by the parser and then dropped, because JudgedOrder had nowhere to
   * put them. This is the check that they survive the whole journey: read from
   * the text, written into the row, and handed back on the wire.
   *
   * IT IS NOT FED INTO THE EVIDENCE FUNNEL, deliberately. That is what would
   * move a task to delivered, which is a state change nobody asked for.
   */
  describe('when it arrived, and whether it went back', () => {
    const AMAZON_ORDER_PAGE = [
      'Order placed', '2 June 2026',
      'Order # 408-5094957-4481129',
      'Headband', '1 x ₹149',
      'Order Summary', 'Order Total ₹149',
      'Delivered 5 June 2026',
      'Return window closed',
    ].join('\n');

    it('reads both off the page, keeps them, and hands them back', async () => {
      const { token, taskId } = await ready();
      const res = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [AMAZON_ORDER_PAGE] })
        .expect(200);

      // ON THE WIRE, as a day and a tri-state.
      expect(res.body[0].deliveryDate).toBe('2026-06-05');
      expect(res.body[0].returned).toBe(false);
      // AND THE TWO DATES ARE STILL TWO.
      expect(res.body[0].orderDate).toBe('2026-06-02');

      // AND IN THE ROW, which is the part that survives a restart.
      const row = await prisma.orderCandidate.findFirstOrThrow({
        where: { taskId },
      });
      expect(row.deliveryDate).not.toBeNull();
      expect(row.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-06-05');
      expect(row.returned).toBe(false);
    });

    it('TRUE, and loudly, for an order that really went back', async () => {
      const { token, taskId } = await ready();
      const res = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [`${AMAZON_ORDER_PAGE}\nReturned`] })
        .expect(200);
      expect(res.body[0].returned).toBe(true);
      const row = await prisma.orderCandidate.findFirstOrThrow({
        where: { taskId },
      });
      expect(row.returned).toBe(true);
    });

    it('NULL, not false, when the page said nothing either way', async () => {
      // The two are different facts wherever a refund is decided. An existing
      // row, read before any of this existed, is null for exactly this reason.
      const { token, taskId } = await ready();
      const res = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: ['Order # 408-5094957-4481129\nHeadband\n1 x ₹149'] })
        .expect(200);
      expect(res.body[0].returned).toBeNull();
      expect(res.body[0].deliveryDate).toBeNull();
      const row = await prisma.orderCandidate.findFirstOrThrow({
        where: { taskId },
      });
      expect(row.returned).toBeNull();
      expect(row.deliveryDate).toBeNull();
    });

    it('and the columns are ADDITIVE, so no existing row was rewritten', async () => {
      // The migration adds two nullable columns with NO default. A default would
      // have written an answer into every candidate ever read, none of which was
      // read with these fields — and "not returned" is not a thing we know about
      // any of them.
      const whole = readFileSync(
        resolve(
          __dirname,
          '../prisma/migrations/20260909180000_order_candidate_delivery/migration.sql',
        ),
        'utf8',
      );
      // COMMENTS STRIPPED FIRST, and this file has now been caught by that four
      // times. The migration's own comment EXPLAINS that it uses no default and
      // no not-null, so a check over the whole text reads the explanation as the
      // thing it forbids — which would be a rule against writing the reason down.
      const sql = whole.replace(/--.*$/gm, '');
      expect(sql).toContain('ADD COLUMN "deliveryDate"');
      expect(sql).toContain('ADD COLUMN "returned"');
      expect(sql).not.toMatch(/NOT NULL/i);
      expect(sql).not.toMatch(/DEFAULT/i);
      expect(sql).not.toMatch(/\bDROP\b/i);
      expect(sql).not.toMatch(/\bUPDATE\b/i);
    });
  });

  /**
   * ── THE TWO LINES THAT WOULD HAVE ANSWERED THE 11 SEPTEMBER QUESTION ─────
   *
   * record() deletes the old candidates and then returns BEFORE createMany when
   * nothing was judged. So a request that ARRIVED carrying no readable pages
   * leaves the database in exactly the state of a request that NEVER ARRIVED:
   * no order_candidates row, no task event, nothing at all. On 11 September that
   * was the whole difficulty — the database could not say whether the phone had
   * spoken to the server.
   *
   * RUN, NOT READ. A string match in a spec would pass with a `return;` inserted
   * at the top of the method, which is how the practice-window mark was once
   * switchable off with everything green. The logger is spied on, so the lines
   * have to really be emitted.
   */
  describe('it says out loud that a request arrived', () => {
    const AMAZON_ORDER_PAGE = [
      'Order placed', '2 June 2026',
      'Order # 408-5094957-4481129',
      'Headband', '1 x ₹149',
      'Order Summary', 'Order Total ₹149',
    ].join('\n');

    it('records how many pages arrived, and what it made of them', async () => {
      const { token, taskId } = await ready();
      const said: string[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((m: unknown) => { said.push(String(m)); });
      try {
        await request(server())
          .post(`/tasks/${taskId}/orders-found`)
          .set('Authorization', bearer(token))
          .send({ pages: [AMAZON_ORDER_PAGE] })
          .expect(200);
      } finally {
        spy.mockRestore();
      }

      const arrived = said.find((l) => l.includes('pages='));
      const judged = said.find((l) => l.includes('judged='));
      expect(arrived).toBeDefined();
      expect(judged).toBeDefined();
      expect(arrived).toContain(`task=${taskId}`);
      expect(arrived).toContain('pages=1');
      // THE LENGTH OF EACH PAGE, NEVER THE PAGE. What arrived is somebody's
      // order page and it carries their name and their delivery address.
      expect(arrived).toContain(`lens=[${AMAZON_ORDER_PAGE.length}]`);
      expect(arrived).not.toContain('Headband');
      expect(judged).toContain('judged=1');
      expect(judged).toContain('matched=1');
      expect(judged).toContain('reasons=[matched]');
      expect(judged).not.toContain('408-5094957-4481129');
    });

    it('AND IT SAYS SO WHEN NOTHING READABLE ARRIVED, which is the silent case', async () => {
      // The exact shape that leaves no database row at all. Without this line
      // there is nothing anywhere to say the phone ever spoke.
      const { token, taskId } = await ready();
      const said: string[] = [];
      const spy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((m: unknown) => { said.push(String(m)); });
      try {
        await request(server())
          .post(`/tasks/${taskId}/orders-found`)
          .set('Authorization', bearer(token))
          .send({ pages: [] })
          .expect(200);
      } finally {
        spy.mockRestore();
      }

      expect(said.some((l) => l.includes('pages=0'))).toBe(true);
      expect(said.some((l) => l.includes('judged=0') && l.includes('matched=0'))).toBe(true);
      // And the database really is empty, which is the point: the log line is
      // the ONLY record that this request happened.
      expect(await prisma.orderCandidate.count({ where: { taskId } })).toBe(0);
    });
  });
});
