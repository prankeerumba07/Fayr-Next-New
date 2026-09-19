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

    it('SETTLES THE AMOUNT ON AN ORDER WITH TWO PRODUCTS, FROM THE PRODUCT’S OWN LINE', async () => {
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

      // ── THIS CHECK USED TO ASSERT THE OPPOSITE, AND WHY IT CHANGED ────────
      //
      // It read "leaves the amount for a person on an order with two products",
      // on the reasoning that "a bill of 368 against a product at 149 might be
      // one of each, and it might be something else".
      //
      // THAT REASONING IS ABOUT THE BILL, AND THE BILL IS NOT THE QUESTION. This
      // page states the product's own price beside the product — "1 x ₹149" —
      // and 149 is exactly what the offer says the product costs. The bill being
      // larger is the other product, which is a fact about the other product.
      //
      // THE COST OF THE OLD ANSWER WAS MEASURED, on the owner's own Amazon order,
      // 16 September 2026. Two products, ₹938.00 printed beside the one the offer
      // was for, and his refund held for a staff member to "confirm the amount
      // you paid" — from a page that had just stated it twice.
      //
      // NOTHING WAS LOOSENED TO GET HERE. The equality is exact and to the paise,
      // against a number the operator set before anybody bought anything, and a
      // price that is NOT that number now fails closed instead of falling through
      // to the bill question. See itemPriceIsCertain, which carries the argument
      // in full and the three shapes it still refuses.
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      expect(task?.orderId).toBe('SOSIJGGRL26770');

      const asked = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', bearer(token))
        .expect(200);
      // THE WHOLE BILL IS STILL ON THE RECORD, because it is true — and it is
      // still not what the refund is based on. That is the line that must never
      // change: a refund based on 368 would pay for somebody's earphones.
      expect(asked.body.order.orderTotalPaise).toBe('36800');
      expect(asked.body.order.unitPricePaise).toBe('14900');
      expect(asked.body.refund.basedOnPaise).toBe('14900');
      expect(asked.body.refund.basedOnPaise).not.toBe('36800');
    });

    it('AND A PRODUCT THE OFFER DOES NOT PRICE IS STILL LEFT FOR A PERSON', async () => {
      // The other half of the same rule, and the reason the change above is a
      // narrowing rather than a widening. An order whose matching product is not
      // at the offer's price never reaches the amount question at all — it is
      // refused as an order — and an order read on a page that states no price
      // per product is answered by the unchanged bill question.
      const { token, taskId } = await ready({ productPricePaise: 21900n });
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);
      // The offer now prices the headband at 219, and the page says 149. Not the
      // same product at the same price, so there is nothing to confirm.
      expect(found.body[0].matches).toBe(false);
      expect(found.body[0].reason).toBe('price_differs');
      await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(409);
    });

    /**
     * THE DAY AND THE PRODUCT'S PRICE REACH THE SCREEN.
     *
     * ── MEASURED 16 SEPTEMBER 2026, AND BOTH WERE MISSING ────────────────
     *
     * The owner's task showed "Order date: Not available" beside an order whose
     * page says 2 June, and "Order amount ₹1,331.00" beside a product that cost
     * ₹938.00. Both facts had been read, judged and written down; neither was
     * being sent, so no screen could show them however well it was written.
     *
     * THIS IS THE FIRST HOP OF THAT CHAIN, proved here against a real database,
     * and src/ui/orderDetails.test.mjs section 10 proves the rest of it.
     */
    it('the day and the product’s price reach the screen', async () => {
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);
      expect(found.body[0].matches).toBe(true);

      const asked = await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

      // THE DAY, AS THE SHOP PRINTED IT. Not an instant: the time to buy after
      // claiming is measured in minutes and a day cannot settle that, so
      // dateToSubmit leaves the instant off rather than inventing one. The day
      // itself was always on the record and was simply never sent.
      expect(asked.body.order.dateRaw).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // AND THE PRODUCT'S OWN PRICE, on an order holding two of them. This is
      // what stops the screen falling back to the bill.
      expect(asked.body.order.matchedPricePaise).toBe('14900');
      expect(asked.body.order.orderTotalPaise).toBe('36800');
      expect(asked.body.order.matchedPricePaise)
        .not.toBe(asked.body.order.orderTotalPaise);
    });

    it('and the later-look writer carries them, by its own source', () => {
      // ── WHY THIS IS READ AND NOT RUN, SAID PLAINLY ───────────────────
      //
      // priceFromALaterLook only writes when the task has NO price, and since
      // the certainty rule learned to ask about the product's own line, a
      // matched order gets its price at the moment it is chosen. So on a task
      // created today this writer does not fire, and a check that posted pages
      // twice and asserted the fields survived would pass while proving
      // nothing — it did, before this comment replaced it.
      //
      // IT IS STILL LIVE IN PRODUCTION, on every task confirmed before that rule
      // changed, which is exactly the population the delivery step re-reads. So
      // the carrier is pinned by reading the source, the way this project
      // already pins what it cannot execute, and the behaviour itself is proved
      // end to end by the backfill command's own checks, which reach the same
      // carrier through a task built in the old shape (see
      // settle-known-item-prices.e2e-spec.ts, "TAKES NOTHING AWAY").
      const src = readFileSync(
        resolve(__dirname, '..', 'src', 'tasks', 'order-candidates.service.ts'),
        'utf8',
      );
      const start = src.indexOf('private async priceFromALaterLook');
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start);
      expect(body).toContain('...whatTheOrderAlreadySays(existing),');
      // And the guard asks the evidence, never the legacy column the mapper
      // documents as null on essentially every task.
      expect(body).toContain('resolveChargedPaise(existing)');
      expect(body).not.toMatch(/if \(task\.itemPaise != null\) return;/);
    });

    it('and a later look does not take either of them away again', async () => {
      // A second read of the same pages must leave a settled task exactly as it
      // was. This one DOES run the real route; what it proves is that the route
      // is quiet, not that the carrier fired.
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);
      await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

      // The same read again, which is what the delivery step does.
      await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);

      const after = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', bearer(token))
        .expect(200);
      expect(after.body.order.dateRaw).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(after.body.order.matchedPricePaise).toBe('14900');
    });

    it('A LATER LOOK NEVER OVERWRITES A PRICE THAT IS ALREADY THERE', async () => {
      // ── THE GUARD THAT WAS NOT GUARDING ──────────────────────────────
      //
      // The later-look price writer asked `task.itemPaise` — the promoted
      // COLUMN — and task.mapper.ts says of it, in as many words: DO NOT READ
      // THE itemPaise COLUMN, it is a legacy projection and is NULL on
      // essentially every task the current code produces. So the guard never
      // fired: a task settled through unitPricePaise has a real price and a null
      // column, and the later look overwrote it — including a figure somebody
      // had entered by hand after looking at the order themselves, which is the
      // one thing this path promises not to touch.
      const { token, taskId } = await ready();
      const found = await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);
      await request(server())
        .post(`/tasks/${taskId}/orders-found/${found.body[0].id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

      // Somebody decides the amount is something else. Whatever we think of it,
      // it is an answer, and it may already have been acted on.
      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', bearer(token))
        .send({
          key: `decided:${taskId}`,
          order: {
            id: 'SOSIJGGRL26770',
            unitPricePaise: '12300',
            quantity: 1,
            amountSource: 'order-details',
            source: 'order-details',
          },
        })
        .expect(200);

      const decided = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', bearer(token))
        .expect(200);
      expect(decided.body.order.unitPricePaise).toBe('12300');

      // The delivery step runs the same read again.
      await request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages: [TWO_PRODUCTS] })
        .expect(200);

      const after = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', bearer(token))
        .expect(200);
      expect(after.body.order.unitPricePaise).toBe('12300');
      expect(after.body.refund.basedOnPaise).toBe('12300');
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
  /**
   * THE DELIVERY REACHING THE ENGINE, WHICH IS THE WHOLE CLAIM OF THE PRODUCT.
   *
   * "Fayr finds your purchase and confirms delivery by itself." Everything above
   * this block reads the delivery off the page and writes it on a row. None of
   * that moves a task, and a fact on a row that no gate reads is a fact nobody
   * has. These are the checks that fail if the delivery is parsed and then goes
   * nowhere.
   */
  describe('the delivery reaches the engine by itself', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    /** A day the way a shop writes one: "5 Jun 2026". */
    const written = (at: Date): string =>
      `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
    const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY_MS);

    /**
     * An Amazon order page, with the two lines this is all about.
     *
     * YESTERDAY AND NOT TODAY, on purpose. A day becomes an instant at NOON, so a
     * delivery dated today is up to twelve hours in the future — and
     * checkPlausibility refuses a delivery in the future with six hours of skew.
     * Dating it today would pass in the afternoon and fail before lunch.
     */
    const orderPage = (
      orderNumber: string,
      opts: { delivered?: Date | null; windowCloses?: Date | null } = {},
    ) => row([
      'Order placed', written(daysFromNow(-1)),
      `Order # ${orderNumber}`,
      'Boldfit Strapless Sports Headband', '1 x ₹149',
      'Order Summary', 'Order Total ₹149',
      ...(opts.delivered === null ? [] : [`Delivered ${written(opts.delivered ?? daysFromNow(-1))}`]),
      ...(opts.windowCloses == null
        ? ['Return window closed']
        : [`Return window closed on ${written(opts.windowCloses)}`]),
    ]);

    /**
     * A claim old enough for yesterday's order to belong to it.
     *
     * The order window rule refuses an order the campaign cannot have caused, and
     * an order placed yesterday against a claim made a second ago is exactly
     * that. Both the task's and the campaign's own instants are moved, because
     * the floor is the LATER of the two.
     */
    async function readyForYesterday(over: Partial<Prisma.CampaignCreateInput> = {}) {
      const made = await ready(over);
      const twoDaysAgo = daysFromNow(-2);
      await prisma.task.update({
        where: { id: made.taskId }, data: { createdAt: twoDaysAgo },
      });
      await prisma.campaign.update({
        where: { id: made.campaign.id }, data: { createdAt: twoDaysAgo },
      });
      return made;
    }

    const post = (token: string, taskId: string, pages: string[]) =>
      request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages })
        .expect(200);

    const chooseIt = (token: string, taskId: string, id: string) =>
      request(server())
        .post(`/tasks/${taskId}/orders-found/${id}/mine`)
        .set('Authorization', bearer(token))
        .expect(200);

    it('PARSED IS NOT ENOUGH: the shop’s own window date lands in the row', async () => {
      const { token, taskId } = await readyForYesterday();
      const closes = daysFromNow(30);
      const res = await post(token, taskId, [
        orderPage('408-5094957-4481129', { windowCloses: closes }),
      ]);

      // ON THE WIRE, as an instant and not a day — the END of the day it named,
      // because a window that closed on the 19th closed at the end of the 19th.
      expect(res.body[0].returnWindowEndsAt).not.toBeNull();
      expect(String(res.body[0].returnWindowEndsAt).slice(0, 10))
        .toBe(closes.toISOString().slice(0, 10));
      expect(String(res.body[0].returnWindowEndsAt)).toContain('T23:59:59');

      // AND IN THE ROW, which is what survives a restart. This is the assertion
      // that fails if the date is read and then dropped on the way to the table.
      const stored = await prisma.orderCandidate.findFirstOrThrow({ where: { taskId } });
      expect(stored.returnWindowEndsAt).not.toBeNull();
      expect(stored.returnWindowEndsAt?.toISOString().slice(0, 10))
        .toBe(closes.toISOString().slice(0, 10));
      expect(stored.deliveryDate).not.toBeNull();
    });

    it('SAYING "THAT IS MINE" ON A DELIVERED ORDER MOVES THE TASK TO DELIVERED', async () => {
      const { token, taskId } = await readyForYesterday();
      const found = await post(token, taskId, [
        orderPage('408-5094957-4481129', { windowCloses: daysFromNow(30) }),
      ]);
      expect(found.body[0].matches).toBe(true);

      const after = await chooseIt(token, taskId, found.body[0].id);
      // THE STATE MOVED WITHOUT ANYBODY BEING ASKED ABOUT A DELIVERY.
      expect(after.body.state).toBe('DELIVERED');

      // AND THE PROMOTED COLUMNS CARRY IT. deliveredAt is what the page said,
      // statedReturnWindowEndsAt is what the shop said about its own window, and
      // windowEndsAt is the answer worked out from the two.
      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.state).toBe('DELIVERED');
      expect(task.deliveredAt).not.toBeNull();
      expect(task.statedReturnWindowEndsAt).not.toBeNull();
      expect(task.windowEndsAt).not.toBeNull();
    });

    it('THE WINDOW IS THE LATER OF THE TWO, so the shop can only lengthen a hold', async () => {
      // ── ON AMAZON, AND SINCE 20 SEPTEMBER 2026 THAT IS NOT INCIDENTAL ─────
      //
      // This whole test is about a shop that PRINTS its own return window on the
      // order page, and Amazon is the only one of the seven that does — the page
      // posted below is an Amazon one, order number and all. It used to run on
      // the file's default platform, which is Zepto, and passed only because the
      // operator's day table answered the same for both.
      //
      // It stopped being the same answer when Zepto, Blinkit and Instamart were
      // given a three hour hold instead of the day table (see
      // QUICK_COMMERCE_HOLD_HOURS): a two day window printed by the shop is then
      // LONGER than the policy floor, so the second half of this test measured
      // the opposite of what it says. On the shop the test is actually about,
      // both halves say what they always said.
      const long = await readyForYesterday({ platform: 'AMAZON' });
      const closes = daysFromNow(30);
      const foundLong = await post(long.token, long.taskId, [
        orderPage('408-5094957-4481129', { windowCloses: closes }),
      ]);
      await chooseIt(long.token, long.taskId, foundLong.body[0].id);
      const longTask = await prisma.task.findUniqueOrThrow({ where: { id: long.taskId } });
      expect(longTask.windowEndsAt?.toISOString().slice(0, 10))
        .toBe(closes.toISOString().slice(0, 10));

      // AND A SHOP THAT SAYS A SHORTER ONE CHANGES NOTHING. Two days is well
      // inside the ten the operator promised, and the operator's table is what
      // the person was told when they claimed. This is the assertion that fails
      // if windowEnd ever takes the earlier of the two, which is the one way a
      // refund could go out before the window it was held for had run.
      const short = await readyForYesterday({ platform: 'AMAZON' });
      const foundShort = await post(short.token, short.taskId, [
        orderPage('408-5094957-4481129', { windowCloses: daysFromNow(2) }),
      ]);
      await chooseIt(short.token, short.taskId, foundShort.body[0].id);
      const shortTask = await prisma.task.findUniqueOrThrow({ where: { id: short.taskId } });
      const fromThePolicyTable =
        (shortTask.deliveredAt as Date).getTime() + 10 * DAY_MS;
      expect(shortTask.windowEndsAt?.getTime()).toBe(fromThePolicyTable);
      // The shop's word is still written down — it was simply not the answer.
      expect(shortTask.statedReturnWindowEndsAt).not.toBeNull();
    });

    it('A LATER LOOK CONFIRMS THE DELIVERY, WITH NOBODY ASKED ANYTHING', async () => {
      // THE REAL SEQUENCE, and the reason any of this exists. A delivery happens
      // DAYS after an order is confirmed, so the page states no delivery at the
      // moment somebody says "that one is mine". Every later look used to reach
      // the "one has already been chosen" line and stop, which meant the one read
      // that matters most could never happen.
      const { token, taskId } = await readyForYesterday();
      const beforeItCame = await post(token, taskId, [
        orderPage('408-5094957-4481129', { delivered: null }),
      ]);
      expect(beforeItCame.body[0].deliveryDate).toBeNull();

      const afterChoosing = await chooseIt(token, taskId, beforeItCame.body[0].id);
      expect(afterChoosing.body.state).toBe('PURCHASED');

      // The delivery step runs the same read again. The page now says it came.
      const closes = daysFromNow(30);
      await post(token, taskId, [
        orderPage('408-5094957-4481129', { windowCloses: closes }),
      ]);

      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.state).toBe('DELIVERED');
      expect(task.deliveredAt).not.toBeNull();
      expect(task.statedReturnWindowEndsAt?.toISOString().slice(0, 10))
        .toBe(closes.toISOString().slice(0, 10));

      // AND THE ROW WAS ADDED TO, NOT REPLACED. The chosen order is still the
      // chosen order: same row, same id, still chosen.
      const rows = await prisma.orderCandidate.findMany({ where: { taskId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(beforeItCame.body[0].id);
      expect(rows[0].chosenAt).not.toBeNull();
      expect(rows[0].deliveryDate).not.toBeNull();
    });

    it('A LATER LOOK ADDS, AND NEVER REWRITES', async () => {
      // The chosen row's identity is frozen; what the shop says about it
      // afterwards is not. But a fact already on the row is a fact that may
      // already have been acted on — a hold anchored to it, a person told when
      // their refund is due — so a second read of the same page cannot move it.
      const { token, taskId } = await readyForYesterday();
      const firstWindow = daysFromNow(30);
      const found = await post(token, taskId, [
        orderPage('408-5094957-4481129', { windowCloses: firstWindow }),
      ]);
      await chooseIt(token, taskId, found.body[0].id);
      const afterChoosing = await prisma.orderCandidate.findFirstOrThrow({
        where: { taskId },
      });

      // The same order, read again, now claiming it arrived a day later and that
      // the window runs a month longer.
      await post(token, taskId, [
        orderPage('408-5094957-4481129', {
          delivered: daysFromNow(0), windowCloses: daysFromNow(60),
        }),
      ]);

      const afterLooking = await prisma.orderCandidate.findFirstOrThrow({
        where: { taskId },
      });
      expect(afterLooking.deliveryDate?.toISOString())
        .toBe(afterChoosing.deliveryDate?.toISOString());
      expect(afterLooking.returnWindowEndsAt?.toISOString())
        .toBe(afterChoosing.returnWindowEndsAt?.toISOString());
      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.statedReturnWindowEndsAt?.toISOString().slice(0, 10))
        .toBe(firstWindow.toISOString().slice(0, 10));
    });

    it('and a later look at a DIFFERENT order adds nothing at all', async () => {
      // The guard that keeps one purchase's delivery off another purchase. The
      // second page is a real, delivered order — it is simply not this one.
      const { token, taskId } = await readyForYesterday();
      const found = await post(token, taskId, [
        orderPage('408-5094957-4481129', { delivered: null }),
      ]);
      await chooseIt(token, taskId, found.body[0].id);

      await post(token, taskId, [
        orderPage('408-0000000-0000000', { windowCloses: daysFromNow(30) }),
      ]);

      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.state).toBe('PURCHASED');
      expect(task.deliveredAt).toBeNull();
      const rows = await prisma.orderCandidate.findMany({ where: { taskId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].deliveryDate).toBeNull();
    });

    it('the columns are ADDITIVE, so no existing row or task was rewritten', async () => {
      const whole = readFileSync(
        resolve(
          __dirname,
          '../prisma/migrations/20260916130000_return_window_the_shop_stated/migration.sql',
        ),
        'utf8',
      );
      // COMMENTS STRIPPED FIRST, for the reason the block above records: the
      // migration's own comment explains that it uses no default and no not-null,
      // so a check over the whole text would read the explanation as the thing it
      // forbids.
      const sql = whole.replace(/--.*$/gm, '');
      expect(sql).toContain('ADD COLUMN "returnWindowEndsAt"');
      expect(sql).toContain('ADD COLUMN "statedReturnWindowEndsAt"');
      expect(sql).not.toMatch(/NOT NULL/i);
      expect(sql).not.toMatch(/DEFAULT/i);
      expect(sql).not.toMatch(/\bDROP\b/i);
      expect(sql).not.toMatch(/\bUPDATE\b/i);
    });
  });

  /**
   * A PURCHASE FAYR WATCHED, READ OFF ITS OWN PAGE, WITH NOBODY ASKED. Phase 8A.
   *
   * The owner's decision, 19 September 2026: "the phone watched THIS order be
   * placed from THIS claim; the server's match on the watched page is the
   * confirm." And for the review: "Rated -> REVIEWED." Both are checked here
   * over real requests, against a page shaped the way Zepto really draws one —
   * the fixtures under test/fixtures are the owner's own two order pages.
   */
  describe('a purchase Fayr watched', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const written = (at: Date): string =>
      `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
    const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY_MS);

    /** The key off the owner's own confirmation address, 18 September 2026. */
    const THE_KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';

    /**
     * ONE ZEPTO ORDER PAGE, IN THE SHAPE THE SHOP DRAWS IT. Every line here is
     * a line the owner's real pages carry, in the order they carry it:
     * zepto-order-page-drawn.txt (unrated, "Rate Order") and
     * zepto-order-page-drawn-two-shipments.txt (rated, "You rated:").
     *
     * YESTERDAY, for the reason the delivery block above gives: a day becomes an
     * instant at noon, and a delivery dated today would be in the future before
     * lunch.
     */
    const zeptoPage = (
      orderNumber: string,
      opts: { rated?: boolean; arrived?: boolean } = {},
    ) => row([
      `Order #${orderNumber}`,
      '1 item',
      'Delivered',
      ...(opts.rated === true ? ['You rated:'] : ['Rate Order']),
      '1 item in order',
      'Boldfit Strapless Sports Headband',
      '1 pc',
      '1 unit',
      '₹149',
      '₹325',
      'Bill Summary',
      'Item Total',
      '₹325',
      '₹149',
      'Total Bill',
      '₹149',
      'Order Details',
      'Order ID',
      `#${orderNumber}`,
      'Order Placed at',
      `${written(daysFromNow(-1))}, 5:07 PM`,
      ...(opts.arrived === false
        ? []
        : ['Order Arrived at', `${written(daysFromNow(-1))}, 5:32 PM`]),
    ]);

    /** A claim old enough for yesterday's order to belong to it. */
    async function readyForYesterday() {
      const made = await ready();
      const twoDaysAgo = daysFromNow(-2);
      await prisma.task.update({
        where: { id: made.taskId }, data: { createdAt: twoDaysAgo },
      });
      await prisma.campaign.update({
        where: { id: made.campaign.id }, data: { createdAt: twoDaysAgo },
      });
      return made;
    }

    /** The phone reports the key off the confirmation address, once. */
    const watched = (token: string, taskId: string) =>
      request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', bearer(token))
        .send({ key: `watched-order:${THE_KEY}`, watchedOrderKey: THE_KEY })
        .expect(200);

    const post = (token: string, taskId: string, pages: string[]) =>
      request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages })
        .expect(200);

    const theTask = (taskId: string) =>
      prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    it('THE SERVER’S MATCH ON THE WATCHED PAGE IS THE CONFIRM — nobody taps "that is mine"', async () => {
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);

      const found = await post(token, taskId, [zeptoPage('SOSTEST0000001')]);
      expect(found.body).toHaveLength(1);
      expect(found.body[0].matches).toBe(true);
      // CHOSEN BY THE SERVER, not by a tap. There is no /mine request anywhere
      // in this test.
      expect(found.body[0].chosenAt).not.toBeNull();

      const task = await theTask(taskId);
      // The page said it arrived, so the same one read moved it all the way.
      expect(task.state).toBe('DELIVERED');
      expect(task.deliveredAt).not.toBeNull();
      const evidence = task.evidence as { orderConfirmed?: boolean };
      expect(evidence.orderConfirmed).toBe(true);
    });

    it('TWO IDENTIFIERS, NEVER CONFUSED: the page’s number is the order, the address key is where to look', async () => {
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      await post(token, taskId, [zeptoPage('SOSTEST0000002')]);

      const task = await theTask(taskId);
      expect(task.orderId).toBe('SOSTEST0000002');
      expect(task.watchedOrderKey).toBe(THE_KEY);
      expect(task.orderId).not.toBe(task.watchedOrderKey);
    });

    it('A LIST OF MANY PAGES NEVER CONFIRMS, watched key or not', async () => {
      // A phone reading its watched order posts ONE page. Several pages is a
      // list read, and a list is never the watched page.
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      const found = await post(token, taskId, [SOMETHING_ELSE, zeptoPage('SOSTEST0000003')]);
      expect(found.body[1].matches).toBe(true);
      expect(found.body[1].chosenAt).toBeNull();
      expect((await theTask(taskId)).state).toBe('CLAIMED');
    });

    it('AND WITHOUT A WATCHED KEY NOTHING IS CONFIRMED BY ITSELF', async () => {
      // Amazon, Flipkart, Meesho and Myntra: exactly as before. The match is
      // offered and the person is asked.
      const { token, taskId } = await readyForYesterday();
      const found = await post(token, taskId, [zeptoPage('SOSTEST0000004')]);
      expect(found.body[0].matches).toBe(true);
      expect(found.body[0].chosenAt).toBeNull();
      expect((await theTask(taskId)).state).toBe('CLAIMED');
    });

    it('a watched page that does NOT match confirms nothing either', async () => {
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      const found = await post(token, taskId, [SOMETHING_ELSE]);
      expect(found.body[0].matches).toBe(false);
      expect(found.body[0].chosenAt).toBeNull();
      expect((await theTask(taskId)).state).toBe('CLAIMED');
    });

    it('RATED ON THE WATCHED PAGE MOVES A DELIVERED TASK TO REVIEWED, AND INTO THE HOLD', async () => {
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      await post(token, taskId, [zeptoPage('SOSTEST0000005')]);
      expect((await theTask(taskId)).state).toBe('DELIVERED');

      // The review step's one tap opened this same page; they rated; coming
      // back re-read it. The page now says "You rated:" and no "Rate Order".
      await post(token, taskId, [zeptoPage('SOSTEST0000005', { rated: true })]);

      const task = await theTask(taskId);
      expect(task.state).toBe('HOLDING');
      expect(task.reviewPublished).toBe(true);
      const evidence = task.evidence as {
        review?: { published: boolean; publishedSource: string | null; rating: number | null; text: string | null };
      };
      expect(evidence.review?.published).toBe(true);
      expect(evidence.review?.publishedSource).toBe('order-history');
    });

    it('AND THE REVIEW IT WRITES CARRIES NO NUMBER OF STARS AND NO WORDS', async () => {
      // Fayr never reads, scores or checks what was posted at the shop. A low
      // rating passes exactly as a high one, because no rating is read at all.
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      await post(token, taskId, [zeptoPage('SOSTEST0000006')]);
      await post(token, taskId, [zeptoPage('SOSTEST0000006', { rated: true })]);
      const task = await theTask(taskId);
      const evidence = task.evidence as {
        review?: { rating?: number | null; text?: string | null; title?: string | null };
      };
      expect(evidence.review?.rating ?? null).toBeNull();
      expect(evidence.review?.text ?? null).toBeNull();
      expect(evidence.review?.title ?? null).toBeNull();
    });

    it('"Rate Order" on the page leaves a delivered task exactly where it was', async () => {
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      await post(token, taskId, [zeptoPage('SOSTEST0000007')]);
      await post(token, taskId, [zeptoPage('SOSTEST0000007')]);
      const task = await theTask(taskId);
      expect(task.state).toBe('DELIVERED');
      expect(task.reviewPublished).toBeNull();
    });

    it('a rating read before the shop says it arrived waits for the next look', async () => {
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      // The live page: the order exists, has not arrived, and is somehow rated.
      await post(token, taskId, [zeptoPage('SOSTEST0000008', { rated: true, arrived: false })]);
      expect((await theTask(taskId)).state).toBe('PURCHASED');
      await post(token, taskId, [zeptoPage('SOSTEST0000008', { rated: true, arrived: false })]);
      expect((await theTask(taskId)).state).toBe('PURCHASED');

      // The next look sees both on one page: the delivery half moves it to
      // DELIVERED and the rated half, reading the state as it stands after
      // that, carries it on into the hold.
      await post(token, taskId, [zeptoPage('SOSTEST0000008', { rated: true })]);
      expect((await theTask(taskId)).state).toBe('HOLDING');
    });

    it('a page that cannot be read yet is not a failure: the task waits, and nothing is written', async () => {
      // The live tracking page Zepto shows in the first minutes: the order
      // exists and has not settled into a receipt. The owner: "'We have not
      // looked yet' is not a failure", and neither is this.
      const { token, taskId } = await readyForYesterday();
      await watched(token, taskId);
      const found = await post(token, taskId, [row(['Order #SOSTEST0000009', 'Arriving in 8 minutes'])]);
      expect(found.body[0].matches).toBe(false);
      expect(found.body[0].chosenAt).toBeNull();
      const task = await theTask(taskId);
      expect(task.state).toBe('CLAIMED');
      expect(task.blocker).toBeNull();
    });
  });

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
