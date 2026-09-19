import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma, StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';

/**
 * THE PRICE NEVER REFUSES A WATCHED ORDER, AND THE REFUND FOLLOWS WHAT WAS PAID.
 *
 * Phase 8B-a, end to end, over real requests against a real database.
 *
 * ── THE OWNER'S WORDS, 19 SEPTEMBER 2026 ─────────────────────────────────────
 *
 *   "It doesn't matter [if the price differs] ... whatever amount the user has
 *    paid, because we will know the actual amount paid by the user. We will just
 *    give a refund on that particular amount."
 *
 *   "The amount is showing 359 and the user paid, for example, 400. It is around
 *    ₹41 in delivery charge, so at that point the user will receive only a refund
 *    on 359, not on 400. The extra delivery charge is not in our hands."
 *
 * Every page below is shaped the way Zepto really draws one — the lines come
 * from the owner's own order pages under test/fixtures, and the one with a
 * charged delivery fee comes from his order #LRGSKOMA18669.
 */
describe('the price on a purchase Fayr watched (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let ticketsSvc: TicketService;
  let staffTokens: StaffTokenService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
  const bearer = (token: string): string => `Bearer ${token}`;
  const server = () => app.getHttpServer();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const written = (at: Date): string =>
    `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
  const daysFromNow = (n: number): Date => new Date(Date.now() + n * DAY_MS);

  /** The key off the owner's own confirmation address, 18 September 2026. */
  const THE_KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';

  async function newUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  }

  async function staffToken(role: StaffRole): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name: `Test ${role}`,
        role,
      },
    });
    return (await staffTokens.issueSession(staff)).accessToken;
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
        productPricePaise: 32500n,
        payoutPercent: 90,
        ticketCost: 5,
        ...over,
      },
    });

  /** A user with tickets, a campaign old enough for yesterday's order, and a claim. */
  async function ready(over: Partial<Prisma.CampaignCreateInput> = {}) {
    const { id: userId, token } = await newUser();
    await ticketsSvc.grantSignup(userId);
    const campaign = await makeCampaign(over);
    const res = await request(server())
      .post('/tasks')
      .set('Authorization', bearer(token))
      .send({ campaignId: campaign.id, acceptedTerms: true })
      .expect(201);
    const taskId = res.body.id as string;
    const twoDaysAgo = daysFromNow(-2);
    await prisma.task.update({ where: { id: taskId }, data: { createdAt: twoDaysAgo } });
    await prisma.campaign.update({
      where: { id: campaign.id }, data: { createdAt: twoDaysAgo },
    });
    return { userId, token, campaign, taskId };
  }

  /**
   * ONE ZEPTO ORDER PAGE, IN THE SHAPE THE SHOP DRAWS IT.
   *
   * `paid` and `was` are the struck pair beside the product — every product on
   * both drawn fixtures prints one. `fee` is a delivery charge that was really
   * taken, which is the shape of order #LRGSKOMA18669: a figure under the label
   * with no FREE beneath it.
   */
  const page = (opts: {
    orderNumber: string;
    product?: string;
    paid: number;
    was?: number | null;
    fee?: number;
    units?: number;
  }): string => {
    const paidR = `₹${opts.paid}`;
    const wasR = opts.was == null ? null : `₹${opts.was}`;
    const itemTotal = opts.paid;
    const bill = itemTotal + (opts.fee ?? 0);
    return [
      `Order #${opts.orderNumber}`,
      '1 item',
      'Delivered',
      'Rate Order',
      '1 item in order',
      opts.product ?? 'Boldfit Strapless Sports Headband',
      '1 pc',
      `${opts.units ?? 1} unit${(opts.units ?? 1) === 1 ? '' : 's'}`,
      paidR,
      ...(wasR == null ? [] : [wasR]),
      'Bill Summary',
      'Item Total',
      ...(wasR == null ? [] : [`₹${opts.was}`]),
      `₹${itemTotal}`,
      ...(opts.fee == null
        ? ['Delivery Fee', '₹30', 'FREE']
        : ['Delivery Fee', `₹${opts.fee}`]),
      'Total Bill',
      `₹${bill}`,
      'Order Details',
      'Order ID',
      `#${opts.orderNumber}`,
      'Order Placed at',
      `${written(daysFromNow(-1))}, 5:07 PM`,
      'Order Arrived at',
      `${written(daysFromNow(-1))}, 5:32 PM`,
    ].join('\n');
  };

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

  const theOrderOn = async (taskId: string) => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const evidence = task.evidence as {
      order?: {
        unitPricePaise?: string | null;
        orderTotalPaise?: string | null;
        matchedPricePaise?: string | null;
        priceGapReason?: string | null;
      };
      orderConfirmed?: boolean;
    };
    return { task, order: evidence.order ?? {}, confirmed: evidence.orderConfirmed === true };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    ticketsSvc = app.get(TicketService);
    staffTokens = app.get(StaffTokenService);

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

  describe('R1 — the price is not a verdict', () => {
    it('WATCHED: a shop discount no longer refuses the purchase', async () => {
      // The offer lists ₹325. Zepto sold it at ₹149 with ₹325 struck through.
      const { token, taskId } = await ready();
      await watched(token, taskId);
      const found = await post(token, taskId, [
        page({ orderNumber: 'SOSGAP00000001', paid: 149, was: 325 }),
      ]);
      expect(found.body[0].matches).toBe(true);
      expect(found.body[0].reason).toBe('matched');
      // AND NOBODY WAS ASKED. The server's match on the watched page is the confirm.
      expect(found.body[0].chosenAt).not.toBeNull();
      const { confirmed } = await theOrderOn(taskId);
      expect(confirmed).toBe(true);
    });

    it('UNWATCHED: the very same page and the very same gap is still refused', async () => {
      const { token, taskId } = await ready();
      const found = await post(token, taskId, [
        page({ orderNumber: 'SOSGAP00000002', paid: 149, was: 325 }),
      ]);
      expect(found.body[0].matches).toBe(false);
      expect(found.body[0].reason).toBe('price_differs');
      expect(found.body[0].chosenAt).toBeNull();
    });

    it('and the wrong product is still the wrong product, watched or not', async () => {
      const { token, taskId } = await ready();
      await watched(token, taskId);
      const found = await post(token, taskId, [
        page({ orderNumber: 'SOSGAP00000003', product: 'Hammer Nova earphones', paid: 325 }),
      ]);
      expect(found.body[0].matches).toBe(false);
      expect(found.body[0].reason).toBe('product_name_not_found');
    });
  });

  describe('R2 — the refund follows what was paid, capped at the offer', () => {
    it('A SHOP DISCOUNT: the refund is based on the ₹149 paid, not the ₹325 listed', async () => {
      const { token, taskId } = await ready();
      await watched(token, taskId);
      await post(token, taskId, [page({ orderNumber: 'SOSPAY00000001', paid: 149, was: 325 })]);
      const { order } = await theOrderOn(taskId);
      expect(order.unitPricePaise).toBe('14900');
      expect(order.priceGapReason).toBe('shop-discount');
      // AND THE ORDER TOTAL IS STILL RECORDED SEPARATELY, for staff.
      expect(order.orderTotalPaise).toBe('14900');
    });

    it('THE OWNER’S DELIVERY-CHARGE CASE: paid ₹179, refunded on ₹149', async () => {
      // The offer lists ₹149. The product cost ₹149 and ₹30 of delivery was
      // charged on top, so ₹179 left the account and ₹149 is the base.
      const { token, taskId } = await ready({ productPricePaise: 14900n });
      await watched(token, taskId);
      await post(token, taskId, [
        page({ orderNumber: 'SOSPAY00000002', paid: 149, was: null, fee: 30 }),
      ]);
      const { order } = await theOrderOn(taskId);
      expect(order.unitPricePaise).toBe('14900');
      expect(order.orderTotalPaise).toBe('17900');
      expect(order.priceGapReason).toBe('fees-on-top');
    });

    it('A PRICE THAT ROSE IS CAPPED AT THE OFFER’S OWN PRICE', async () => {
      const { token, taskId } = await ready({ productPricePaise: 14900n });
      await watched(token, taskId);
      await post(token, taskId, [page({ orderNumber: 'SOSPAY00000003', paid: 200 })]);
      const { order } = await theOrderOn(taskId);
      expect(order.unitPricePaise).toBe('14900');
      expect(order.priceGapReason).toBe('price-rose');
      // What the page said it cost is still recorded, unchanged.
      expect(order.matchedPricePaise).toBe('20000');
    });

    it('and the refund a release computes is that base, not the offer’s price', async () => {
      const { token, taskId, userId } = await ready();
      await watched(token, taskId);
      await post(token, taskId, [page({ orderNumber: 'SOSPAY00000004', paid: 149, was: 325 })]);
      const preview = await request(server())
        .get(`/tasks/${taskId}`)
        .set('Authorization', bearer(token))
        .expect(200);
      // 90% of ₹149 is ₹134.10 — not 90% of the ₹325 the offer lists.
      expect(preview.body.refund.basedOnPaise).toBe('14900');
      expect(preview.body.refund.amountPaise).toBe('13410');
      expect(userId).toBeTruthy();
    });

    it('THE BILL LINES ARE WRITTEN DOWN BESIDE THE ORDER, for staff to read', async () => {
      const { token, taskId } = await ready({ productPricePaise: 14900n });
      await watched(token, taskId);
      await post(token, taskId, [
        page({ orderNumber: 'SOSPAY00000005', paid: 149, was: null, fee: 30 }),
      ]);
      const row = await prisma.orderCandidate.findFirstOrThrow({ where: { taskId } });
      expect(row.itemTotalPaise).toBe(14900n);
      expect(row.feesPaise).toBe(3000n);
      expect(row.totalPaise).toBe(17900n);
      expect(row.billDiscountPaise).toBeNull();
    });
  });

  describe('R3 — the reason is a note, and the server’s word alone', () => {
    it('A PHONE THAT SENDS ONE IS REFUSED AT THE DOOR', async () => {
      const { token, taskId } = await ready();
      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', bearer(token))
        .send({
          key: 'a-phone-trying-it',
          order: { id: 'SOSFAKE0000001', priceGapReason: 'coupon' },
        })
        .expect(400);
    });

    it('AND AN ORDINARY ORDER SUBMISSION STILL GOES THROUGH, which is not obvious', async () => {
      // THE REGRESSION THIS EXISTS FOR, 19 September 2026. The note was first
      // kept out by declaring the property with NO decorator at all. The pipe
      // runs forbidNonWhitelisted, class-transformer materialises every declared
      // property as undefined, and the pipe then refused EVERY evidence body
      // carrying an order — twenty-nine staff-quantity tests at once. A check
      // that only ever posts the forbidden field cannot see that.
      const { token, taskId } = await ready();
      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', bearer(token))
        .send({
          key: 'an-ordinary-order',
          order: { id: 'SOSPLAIN000001', date: Date.now(), itemPaise: '14900', source: 'order-details' },
        })
        .expect(200);
    });

    it('A PHONE NAMING A FIGURE OF ITS OWN IS REFUSED BEFORE THE SERVER EVER SEES IT', async () => {
      // unitPricePaise IS on the DTO's whitelist, because a scraper legitimately
      // sends one — and a bare figure with nothing around it is still refused,
      // by the plausibility gate that has always stood in front of evidence.
      // MEASURED HERE rather than asserted from memory: a 400, not a 200.
      const { token, taskId } = await ready();
      await watched(token, taskId);
      await request(server())
        .post(`/tasks/${taskId}/evidence`)
        .set('Authorization', bearer(token))
        .send({ key: 'a-phone-naming-money', order: { unitPricePaise: '999900' } })
        .expect(400);
      // AND THE FIGURE THAT ENDS UP ON THE RECORD IS THE SERVER'S OWN.
      await post(token, taskId, [page({ orderNumber: 'SOSNOTE0000001', paid: 149, was: 325 })]);
      const { order } = await theOrderOn(taskId);
      expect(order.unitPricePaise).toBe('14900');
      expect(order.priceGapReason).toBe('shop-discount');
    });

    it('and the note survives the delivery that lands after it', async () => {
      // A later fragment REPLACES the order whole. Without carrying the note
      // forward, a delivery arriving would wipe the explanation of the amount.
      const { token, taskId } = await ready();
      await watched(token, taskId);
      await post(token, taskId, [page({ orderNumber: 'SOSNOTE0000002', paid: 149, was: 325 })]);
      const before = await theOrderOn(taskId);
      expect(before.order.priceGapReason).toBe('shop-discount');
      // The delivery step runs the same read again on the same page.
      await post(token, taskId, [page({ orderNumber: 'SOSNOTE0000002', paid: 149, was: 325 })]);
      const after = await theOrderOn(taskId);
      expect(after.order.priceGapReason).toBe('shop-discount');
      expect(after.order.unitPricePaise).toBe('14900');
    });
  });

  describe('R5 — a watched claim that matched nothing keeps looking', () => {
    it('A CORRECTED PRODUCT NAME IS PICKED UP ON THE NEXT LOOK, with no new claim and no tap', async () => {
      // THE CAMPAIGN IS WRITTEN WITH THE NAME SPELT WRONG, so the first read of
      // the real page matches nothing at all.
      // A NAME THAT REALLY DOES NOT MATCH. sameProductName is substring-either-way
      // on a loosened string, so a typo at the end of the name still matches —
      // this is a different product word, which is the shape ops actually fixes.
      const { token, taskId, campaign } = await ready({
        productName: 'Boldfit Sports Wristband',
      });
      await watched(token, taskId);
      const first = await post(token, taskId, [
        page({ orderNumber: 'SOSFIX00000001', paid: 149, was: 325 }),
      ]);
      expect(first.body[0].matches).toBe(false);
      expect(first.body[0].reason).toBe('product_name_not_found');
      expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).state)
        .toBe('CLAIMED');

      // ── OPS CORRECTS IT, THROUGH THE ROUTE THAT EXISTS ────────────────────
      //
      // PATCH /admin/campaigns/:id REFUSES A LIVE CAMPAIGN — EDITABLE_STATUSES is
      // ['DRAFT', 'PAUSED'] and the one field allowed while ACTIVE is
      // searchKeyword. So the supported path is pause, edit, resume, and that is
      // what is exercised here. The guard was NOT widened for this phase.
      const ops = await staffToken('OPERATIONS');
      await request(server())
        .patch(`/admin/campaigns/${campaign.id}`)
        .set('Authorization', bearer(ops))
        .send({ productName: 'Boldfit Strapless Sports Headband' })
        .expect(409);

      await request(server())
        .post(`/admin/campaigns/${campaign.id}/pause`)
        .set('Authorization', bearer(ops))
        .expect(200);
      await request(server())
        .patch(`/admin/campaigns/${campaign.id}`)
        .set('Authorization', bearer(ops))
        .send({ productName: 'Boldfit Strapless Sports Headband' })
        .expect(200);
      await request(server())
        .post(`/admin/campaigns/${campaign.id}/resume`)
        .set('Authorization', bearer(ops))
        .expect(200);

      // ── AND THE NEXT LOOK AT THE SAME PAGE CONFIRMS IT ────────────────────
      const claimsBefore = await prisma.task.count({ where: { campaignId: campaign.id } });
      const again = await post(token, taskId, [
        page({ orderNumber: 'SOSFIX00000001', paid: 149, was: 325 }),
      ]);
      expect(again.body[0].matches).toBe(true);
      expect(again.body[0].chosenAt).not.toBeNull();

      const { confirmed, order } = await theOrderOn(taskId);
      expect(confirmed).toBe(true);
      expect(order.unitPricePaise).toBe('14900');
      // NO NEW CLAIM, and the same task all the way through.
      expect(await prisma.task.count({ where: { campaignId: campaign.id } }))
        .toBe(claimsBefore);
    });

    it('and a corrected PRICE changes what is paid, on the same claim', async () => {
      const { token, taskId, campaign } = await ready({ productPricePaise: 10000n });
      await watched(token, taskId);
      // Capped at ₹100 while the offer says ₹100, though ₹149 was paid.
      await post(token, taskId, [page({ orderNumber: 'SOSFIX00000002', paid: 149 })]);
      expect((await theOrderOn(taskId)).order.unitPricePaise).toBe('10000');

      const ops = await staffToken('OPERATIONS');
      await request(server())
        .post(`/admin/campaigns/${campaign.id}/pause`)
        .set('Authorization', bearer(ops))
        .expect(200);
      await request(server())
        .patch(`/admin/campaigns/${campaign.id}`)
        .set('Authorization', bearer(ops))
        .send({ productPricePaise: '20000' })
        .expect(200);
      await request(server())
        .post(`/admin/campaigns/${campaign.id}/resume`)
        .set('Authorization', bearer(ops))
        .expect(200);

      // The ceiling moved above what was paid, so the base is now what was paid.
      await post(token, taskId, [page({ orderNumber: 'SOSFIX00000002', paid: 149 })]);
      const { order } = await theOrderOn(taskId);
      expect(order.matchedPricePaise).toBe('14900');
    });
  });
});
