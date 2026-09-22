import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  REVIEW_VISIBILITY_CHECKER,
  type ReviewVisibilityChecker,
} from '../src/scheduler/review-visibility.checker';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import type { SubmitEvidenceDto } from '../src/tasks/dto/submit-evidence.dto';
import { TaskService } from '../src/tasks/task.service';
import { CLAIMED_SEATS_WHERE } from '../src/campaigns/seats';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { resetDatabase } from './reset-db';

const DAY = 86_400_000;
const LOCK_KEY = 999_001;

/** Deterministic, offline stand-in for the HTTP permalink checker. */
class FakeChecker implements ReviewVisibilityChecker {
  readonly results = new Map<string, boolean | 'error'>();
  isPublished(permalink: string): Promise<boolean> {
    const r = this.results.get(permalink);
    if (r === 'error') return Promise.reject(new Error('network blip'));
    return Promise.resolve(r ?? true); // default: still published
  }
}

/**
 * End-to-end for the maintenance scheduler: boots the real app (with a fake
 * visibility checker so no network is hit) and drives runTick() + the advisory
 * lock directly. The cron itself is disabled under NODE_ENV=test.
 */
describe('Scheduler (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: SchedulerService;
  let taskSvc: TaskService;
  let ticketsSvc: TicketService;
  let walletSvc: WalletService;
  let jwt: JwtService;
  let config: ConfigService;
  const checker = new FakeChecker();
  const server = () => app.getHttpServer();
  const bearer = (token: string): string => `Bearer ${token}`;

  let seq = 0;
  const newMobile = (): string =>
    `+9193${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    return user.id;
  };

  /**
   * THE SAME USER, WITH A TOKEN, so a test can drive the real HTTP road.
   *
   * Added with Phase 8B-c: the three hour hold is now proved from the shop's own
   * page text through POST /tasks/:id/orders-found, and a route needs somebody
   * signed in to it.
   */
  const signedIn = async (): Promise<{ id: string; token: string }> => {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    return { id: user.id, token };
  };

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

  const ev = (e: Record<string, unknown>): SubmitEvidenceDto =>
    e as unknown as SubmitEvidenceDto;

  /** Claim + drive a task to HOLDING with a given delivery date and permalink. */
  async function holdingTask(
    userId: string,
    campaign: Campaign,
    deliveredAt: number,
    permalink: string,
  ): Promise<string> {
    const t = await taskSvc.claim(userId, campaign.id, { terms: true });
    await taskSvc.submitEvidence(
      userId,
      t.id,
      ev({
        order: { id: 'o1', itemPaise: '129900', quantity: 1, source: 'order-details' },
        returned: false,
      }),
    );
    await taskSvc.submitEvidence(
      userId,
      t.id,
      ev({
        delivery: { at: deliveredAt, source: 'order-details' },
        review: { published: true, product: 'boAt', permalink },
      }),
    );
    await taskSvc.markReviewed(userId, t.id);
    await taskSvc.startHold(userId, t.id);
    return t.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REVIEW_VISIBILITY_CHECKER)
      .useValue(checker)
      .compile();
    app = moduleRef.createNestApplication();
    // THE REAL REQUEST PIPELINE, so a route driven from here is validated the
    // way production validates it — the same reason the other e2e suites call it.
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    scheduler = app.get(SchedulerService);
    taskSvc = app.get(TaskService);
    ticketsSvc = app.get(TicketService);
    walletSvc = app.get(WalletService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Scheduler e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    checker.results.clear();
    await resetDatabase(prisma);
  });

  describe('advisory lock', () => {
    it('lets only one instance hold the maintenance lock at a time', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });

      // First "instance" acquires the lock and holds it until we release the gate.
      const first = scheduler.withAdvisoryLock(LOCK_KEY, async () => {
        await gate;
        return 'first';
      });
      await new Promise((r) => setTimeout(r, 150)); // let it acquire

      // Second "instance" tries the same key concurrently → must be turned away.
      const second = await scheduler.withAdvisoryLock(
        LOCK_KEY,
        async () => 'second',
      );
      expect(second.ran).toBe(false);

      release();
      const firstResult = await first;
      expect(firstResult.ran).toBe(true);
      expect(firstResult.result).toBe('first');
    });
  });

  describe('runTick', () => {
    it('auto-releases an eligible refund and credits the wallet', async () => {
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const url = 'https://www.amazon.in/review/live';
      checker.results.set(url, true);
      const taskId = await holdingTask(
        userId,
        campaign,
        Date.now() - 30 * DAY,
        url,
      );

      const report = await scheduler.runTick();
      expect(report).toMatchObject({ rechecked: 1, released: 1, regressed: 0 });

      const task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(task.state).toBe('REFUNDED');
      expect(await walletSvc.getUserBalance(userId)).toBe(129900n);
    });

    it('claws back a review that vanished mid-hold (regress, no release)', async () => {
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const url = 'https://www.amazon.in/review/gone';
      checker.results.set(url, false); // removed
      const taskId = await holdingTask(
        userId,
        campaign,
        Date.now() - 30 * DAY,
        url,
      );

      const report = await scheduler.runTick();
      expect(report).toMatchObject({ rechecked: 1, regressed: 1, released: 0 });

      const task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(task.state).toBe('REVIEWED');
      expect(task.blocker).toBe('review_not_public');
      expect(await prisma.visibilityCheck.count({ where: { taskId } })).toBe(1);
      expect(await walletSvc.getUserBalance(userId)).toBe(0n);
    });

    it('rechecks but does not release before the window elapses', async () => {
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const url = 'https://www.amazon.in/review/fresh';
      checker.results.set(url, true);
      const taskId = await holdingTask(userId, campaign, Date.now(), url); // window open

      const report = await scheduler.runTick();
      expect(report).toMatchObject({ rechecked: 1, released: 0 });
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(task.state).toBe('HOLDING');
    });

    it('leaves a task untouched when the visibility check errors', async () => {
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const url = 'https://www.amazon.in/review/flaky';
      checker.results.set(url, 'error');
      const taskId = await holdingTask(
        userId,
        campaign,
        Date.now() - 30 * DAY,
        url,
      );

      const report = await scheduler.runTick();
      // Errored → not counted as rechecked, and not released (can't confirm live).
      expect(report).toMatchObject({ rechecked: 0, released: 0 });
      const task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(task.state).toBe('HOLDING');
    });

    it('runs the whole cron path under the advisory lock (nested txns)', async () => {
      // Exercises the REAL path: handleCron() runs runTick() INSIDE the advisory
      // lock, so each per-task transaction runs while the lock transaction is held.
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const url = 'https://www.amazon.in/review/cron';
      checker.results.set(url, true);
      const taskId = await holdingTask(
        userId,
        campaign,
        Date.now() - 30 * DAY,
        url,
      );

      await scheduler.handleCron();

      const task = await prisma.task.findUniqueOrThrow({
        where: { id: taskId },
      });
      expect(task.state).toBe('REFUNDED');
      expect(await walletSvc.getUserBalance(userId)).toBe(129900n);
    });

    it('expires unpurchased claims and returns tickets', async () => {
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const t = await taskSvc.claim(userId, campaign.id, { terms: true });
      expect(await ticketsSvc.getBalance(userId)).toBe(10);

      await prisma.task.update({
        where: { id: t.id },
        data: { claimExpiresAt: new Date(Date.now() - DAY) },
      });

      const report = await scheduler.runTick();
      expect(report.expired).toBe(1);
      expect(await ticketsSvc.getBalance(userId)).toBe(15);
      const closed = await prisma.task.findUniqueOrThrow({
        where: { id: t.id },
      });
      expect(closed.closeReason).toBe('expired');
    });

    /**
     * ── AND EVERY ORDER THE SHOP SENT BACK, LET GO ON THE TICK ──────────────
     *
     * THE ROW THIS COMES FROM, ON THE OWNER'S OWN DATABASE, 21 SEPTEMBER 2026:
     *
     *   1628de1a  DELIVERED  returned=true  closedAt=NULL  orderId set
     *
     * One slot, his slot, a Cadbury order the shop cancelled. The flag was on the
     * row and the task never closed, so the offer read "All seats taken, 1
     * joined, locked for now" to the one person who could have used it — and
     * would have gone on reading that for ever.
     *
     * THE EVIDENCE PATH ALONE COULD NOT REACH IT. letGoBecauseTheOrderWentBack
     * runs inside submitEvidence, and a cancelled order is exactly the case where
     * the phone never looks again: there is nothing left to do on that task, so
     * nothing brings anybody back to the screen that looks. That is why the close
     * needs a second door that starts itself.
     */
    it('LETS GO OF AN ORDER THE SHOP SENT BACK, WITH NOBODY OPENING THE APP', async () => {
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign({ totalSlots: 1 });
      const t = await taskSvc.claim(userId, campaign.id, { terms: true });
      expect(await ticketsSvc.getBalance(userId)).toBe(10);

      // THE OWNER'S ROW, REPRODUCED EXACTLY: delivered, the shop says it went
      // back, an order on it, and nothing closed.
      await prisma.task.update({
        where: { id: t.id },
        data: {
          state: 'DELIVERED', returned: true, orderId: 'OD-CANCELLED-1',
          closedAt: null, closeReason: null,
        },
      });
      expect(await prisma.task.count({ where: CLAIMED_SEATS_WHERE(campaign.id) })).toBe(1);

      const report = await scheduler.runTick();
      expect(report.letGo).toBe(1);

      const closed = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(closed.closedAt).not.toBeNull();
      expect(closed.closeReason).toBe('returned');
      // THE FIVE COME BACK, through the ledger and not by editing a balance.
      expect(await ticketsSvc.getBalance(userId)).toBe(15);
      // AND THE SEAT IS BACK IN THE POOL, which is the thing he could see.
      expect(await prisma.task.count({ where: CLAIMED_SEATS_WHERE(campaign.id) })).toBe(0);
    });

    it('AND ONLY ONCE, however many ticks run', async () => {
      // The tick runs on a timer for ever. Without the closedAt guard and the
      // ticket key this would print five more tickets every minute.
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign({ totalSlots: 1 });
      const t = await taskSvc.claim(userId, campaign.id, { terms: true });
      await prisma.task.update({
        where: { id: t.id },
        data: { state: 'DELIVERED', returned: true, orderId: 'OD-CANCELLED-2' },
      });

      const first = await scheduler.runTick();
      const closedAt = (await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).closedAt;
      const second = await scheduler.runTick();
      const third = await scheduler.runTick();

      expect(first.letGo).toBe(1);
      expect(second.letGo).toBe(0);
      expect(third.letGo).toBe(0);
      expect(await ticketsSvc.getBalance(userId)).toBe(15);
      expect(await prisma.ticketEntry.count({
        where: { userId, reason: 'CANCELLED_RETURN' },
      })).toBe(1);
      // And the moment it was let go is the first tick's, not the latest.
      const again = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
      expect(again.closedAt?.getTime()).toBe(closedAt?.getTime());
    });

    it('AND LEAVES ALONE AN ORDER THAT DID NOT GO BACK, AND ONE ALREADY CLOSED', async () => {
      // The other half. Without this, the sweep could close every task with an
      // order on it and both checks above would still pass.
      //
      // GUARDED TWICE ON PURPOSE, and that is worth saying plainly because it
      // changes what this check can prove on its own. The sweep's own where
      // clause never selects these rows, AND letGoBecauseTheOrderWentBack
      // re-reads the row and refuses them anyway. Breaking either one alone
      // leaves this passing; the where clause is a narrowing of what the guard
      // already refuses, not a second rule. The guard itself is proven by
      // mutation in orders-found.e2e-spec.ts, where submitEvidence reaches it
      // with no where clause in front of it at all.
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();
      const fine = await taskSvc.claim(userId, campaign.id, { terms: true });
      await prisma.task.update({
        where: { id: fine.id },
        data: { state: 'DELIVERED', returned: false, orderId: 'OD-FINE-1' },
      });
      // A returned order with NO order on it is a flag about nothing.
      const other = await createUser();
      await ticketsSvc.grantSignup(other);
      const bare = await taskSvc.claim(other, campaign.id, { terms: true });
      await prisma.task.update({
        where: { id: bare.id },
        data: { returned: true, orderId: null },
      });

      // AND ONE THAT WENT BACK AND IS ALREADY CLOSED. The tick runs for ever, so
      // the common case after the first sweep is a row in exactly this shape.
      const third = await createUser();
      await ticketsSvc.grantSignup(third);
      const done = await taskSvc.claim(third, campaign.id, { terms: true });
      await prisma.task.update({
        where: { id: done.id },
        data: {
          state: 'DELIVERED', returned: true, orderId: 'OD-ALREADY-1',
          closedAt: new Date('2026-09-20T10:00:00.000Z'), closeReason: 'returned',
        },
      });

      const report = await scheduler.runTick();
      expect(report.letGo).toBe(0);
      for (const id of [fine.id, bare.id]) {
        expect((await prisma.task.findUniqueOrThrow({ where: { id } })).closedAt).toBeNull();
      }
      expect(await ticketsSvc.getBalance(userId)).toBe(10);
      // The closed one kept the moment it was closed, and was not paid again.
      const untouched = await prisma.task.findUniqueOrThrow({ where: { id: done.id } });
      expect(untouched.closedAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
      expect(await prisma.ticketEntry.count({
        where: { userId: third, reason: 'CANCELLED_RETURN' },
      })).toBe(0);
    });
  });

  /**
   * THE THREE-HOUR HOLD, RELEASED BY THE SCHEDULER WITH NOBODY TAPPING ANYTHING.
   *
   * THE OWNER, 19 September 2026: "[Zepto, Blinkit, Instamart] ... once the
   * product is delivered to the user, it cannot be sent back ... give them 2 or
   * 3 hours of time, and then we refund the money to the user."
   *
   * THE CLOCK IS MOVED BY MOVING THE DELIVERY, exactly as every case above moves
   * it: the window is anchored to the delivery instant, so a delivery four hours
   * ago is a window that closed an hour ago. Nothing here fakes a timer.
   *
   * NO PERMALINK, WHICH IS THE REAL QUICK-COMMERCE SHAPE. These shops publish no
   * review text at all — all Fayr ever reads is that the order was rated — so the
   * visibility re-check has nothing to fetch and the tick goes straight to the
   * release. That is why `rechecked` is 0 in every case below.
   */
  /**
   * ── THE THREE HOUR HOLD, DRIVEN FROM THE SHOP'S OWN PAGE ────────────────
   *
   * PHASE 8B-c, 20 SEPTEMBER 2026, AND THIS IS WHY IT WAS REWRITTEN. The Phase
   * 8B-b version of this block built its tasks by POSTING `returned: false` by
   * hand. Every test passed. The real road could not: a Zepto order page never
   * uses the words return, refund or cancel, so `returned` came out NULL on the
   * 18 September run and refundEligibility answered "return status unknown (no
   * readable order data)" — a refund held for ever, invisible to a check that
   * fed the answer in itself.
   *
   * SO NOTHING IS FED IN NOW. Every fact below comes out of the text of a page,
   * through the real POST /tasks/:id/orders-found, and the only things handed to
   * the server are the page and the key Fayr recorded when it watched the order
   * being placed.
   */
  describe('the three hour hold on a shop that cannot be sent back to', () => {
    const HOUR = 60 * 60 * 1000;
    const MINUTE = 60 * 1000;
    /** India is five and a half hours ahead, and the page prints India's clock. */
    const INDIA = 330 * MINUTE;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** The key off the owner's own confirmation address, 18 September 2026. */
    const THE_KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';

    /** An instant on the minute, because a page prints minutes and not milliseconds. */
    const onTheMinute = (at: number): number => Math.floor(at / MINUTE) * MINUTE;

    /** "20 Sep 2026", as the shop writes it — in India's day, not the server's. */
    const indiaDay = (at: number): string => {
      const d = new Date(at + INDIA);
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };

    /** "10:32 AM", as the shop writes it. Midnight is 12 AM and noon is 12 PM. */
    const indiaClock = (at: number): string => {
      const d = new Date(at + INDIA);
      const h24 = d.getUTCHours();
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      return `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
    };

    /** "20 Sep 2026, 10:32 AM" — one line, exactly as the page prints it. */
    const stamped = (at: number): string => `${indiaDay(at)}, ${indiaClock(at)}`;

    /** A quick-commerce campaign with no operator window of its own. */
    const quickCommerce = (platform: 'ZEPTO' | 'BLINKIT' | 'INSTAMART') =>
      makeCampaign({
        platform,
        title: 'Rate the headband',
        productName: 'Boldfit Strapless Sports Headband',
        category: null,
        productPricePaise: 14900n,
        returnWindowDays: null,
      });

    /**
     * ONE ORDER PAGE, IN THE SHAPE THE SHOP DRAWS IT. Every line is a line the
     * owner's own pages carry, in the order they carry it — the same builder
     * orders-found.e2e-spec.ts uses, with the dates moved onto the clock.
     *
     * THE LAYOUT IS THE ONE THE THREE QUICK COMMERCE SHOPS DRAW, and it is used
     * below on an Amazon campaign too. What that test measures is the DAY TABLE
     * and not the layout; Amazon's own page states the same three facts in its
     * own words, and order-text.spec.ts reads the real one.
     */
    const shopPage = (opts: {
      orderNumber: string;
      arrivedAt: number;
      rated?: boolean;
      product?: string;
      paid?: string;
      struck?: string;
      mentionsReturns?: boolean;
      cancelled?: boolean;
    }): string => [
      `Order #${opts.orderNumber}`,
      '1 item',
      'Delivered',
      ...(opts.rated === true ? ['You rated:'] : ['Rate Order']),
      ...(opts.mentionsReturns === true ? ['Return or replace items'] : []),
      ...(opts.cancelled === true ? ['Cancelled'] : []),
      '1 item in order',
      opts.product ?? 'Boldfit Strapless Sports Headband',
      '1 pc',
      '1 unit',
      `₹${opts.paid ?? '149'}`,
      `₹${opts.struck ?? '325'}`,
      'Bill Summary',
      'Item Total',
      `₹${opts.struck ?? '325'}`,
      `₹${opts.paid ?? '149'}`,
      'Total Bill',
      `₹${opts.paid ?? '149'}`,
      'Order Details',
      'Order ID',
      `#${opts.orderNumber}`,
      // Placed a few minutes before it arrived, which is what a ten minute
      // delivery looks like on its own page.
      'Order Placed at',
      stamped(opts.arrivedAt - 8 * MINUTE),
      'Order Arrived at',
      stamped(opts.arrivedAt),
    ].join('\n');

    const post = (token: string, taskId: string, pages: string[]) =>
      request(server())
        .post(`/tasks/${taskId}/orders-found`)
        .set('Authorization', bearer(token))
        .send({ pages })
        .expect(200);

    const theTask = (taskId: string) =>
      prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    let orders = 0;
    const anOrderNumber = (): string =>
      `SOSHOLD${String(orders += 1).padStart(7, '0')}`;

    /**
     * CLAIMED, WATCHED, BOUGHT, DELIVERED AND RATED — every step off the page.
     *
     * Nothing about the delivery, the return or the review is asserted by the
     * caller. The server reads all three out of the text, twice: once when the
     * order is found, and once when they come back from rating it.
     */
    async function holdingFromTheShopsOwnPage(
      who: { id: string; token: string },
      campaign: Campaign,
      arrivedAt: number,
      opts: {
        product?: string; paid?: string; struck?: string;
        mentionsReturns?: boolean; cancelled?: boolean;
      } = {},
    ): Promise<{ taskId: string; orderNumber: string }> {
      const t = await taskSvc.claim(who.id, campaign.id, { terms: true });

      // THE THIRTY MINUTE PURCHASE DEADLINE IS NOT WHAT THIS MEASURES, and it
      // would otherwise decide the answer by the hour of day the check is run:
      // the page's day is INDIA's, so between half past ten at night and
      // midnight universal it is tomorrow's, and a whole day that begins after
      // the deadline is a day the order window rule can refuse on its own. The
      // real claim this is modelled on was bought inside its own deadline.
      await prisma.task.update({
        where: { id: t.id },
        data: { claimExpiresAt: new Date(Date.now() + 24 * HOUR) },
      });

      // The phone reports the key off the confirmation address, once. This is
      // the ONLY thing handed in about the purchase.
      await request(server())
        .post(`/tasks/${t.id}/evidence`)
        .set('Authorization', bearer(who.token))
        .send({ key: `watched-order:${THE_KEY}`, watchedOrderKey: THE_KEY })
        .expect(200);

      const orderNumber = anOrderNumber();
      await post(who.token, t.id, [shopPage({ orderNumber, arrivedAt, ...opts })]);

      // The review step's one tap opened the same page; they rated; coming back
      // re-read it. The page now says "You rated:" and no "Rate Order".
      await post(who.token, t.id, [
        shopPage({ orderNumber, arrivedAt, rated: true, ...opts }),
      ]);

      // ── AND THE WATCH ON THE REVIEW IS AGED TO MATCH — 22 SEPTEMBER 2026 ──
      //
      // This helper's whole premise is "all of this happened `arrivedAt` ago",
      // and it backdates the delivery to say so. Since refundEligibility also
      // requires the review to have been WATCHED for the hold — a second clock,
      // anchored to the review rather than the delivery, because a hold that
      // runs from delivery can expire before the review exists — the watch has
      // to be aged the same way or the helper would be simulating a four-hour-old
      // delivery with a review first seen this instant, which is a different
      // story and not the one any caller here is telling.
      //
      // NOT A WEAKENING. Every caller that wants an unelapsed watch sets it
      // explicitly; see "A REVIEW IS WATCHED FOR THE WHOLE HOLD", which puts it
      // back to now and asserts the refund is held.
      await prisma.task.update({
        where: { id: t.id },
        data: { holdStartedAt: new Date(arrivedAt) },
      });
      return { taskId: t.id, orderNumber };
    }

    it('THE WHOLE ROAD, FROM THE PAGE’S OWN WORDS TO THE MONEY', async () => {
      // Delivered four hours ago, by the clock the page prints. Nobody posts a
      // delivery instant, a return status or a review — all three are read.
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await quickCommerce('ZEPTO');
      const arrivedAt = onTheMinute(Date.now() - 4 * HOUR);
      const { taskId } = await holdingFromTheShopsOwnPage(who, campaign, arrivedAt);

      const held = await theTask(taskId);
      expect(held.state).toBe('HOLDING');
      // THE MINUTE THE PAGE PRINTED, not the day at noon.
      expect(held.deliveredAt!.getTime()).toBe(arrivedAt);
      // THE PAGE NEVER SAID ANYTHING ABOUT RETURNS. On this shop a delivery is
      // the answer, and without that this row would be null and held for ever.
      expect(held.returned).toBe(false);
      expect(held.reviewPublished).toBe(true);
      expect(held.windowEndsAt!.getTime()).toBe(arrivedAt + 3 * HOUR);

      const report = await scheduler.runTick();
      expect(report.released).toBeGreaterThanOrEqual(1);
      // No permalink to fetch, so nothing was re-checked over the network.
      expect(report.rechecked).toBe(0);

      const after = await theTask(taskId);
      expect(after.state).toBe('REFUNDED');
      // ₹149, the price the page printed and the price the offer states.
      expect(await walletSvc.getUserBalance(who.id)).toBe(14900n);
    });

    /**
     * ── THE WATCH RUNS FROM THE REVIEW, NOT FROM THE DELIVERY ──────────────
     *
     * MEASURED, on the owner's own completed Cadbury journey, 22 September 2026:
     *
     *   deliveredAt   09:30:00
     *   windowEndsAt  09:32:00   the two-minute hold, anchored to DELIVERY
     *   review seen   09:37:44   already five minutes past the window
     *   refund        09:38:00   sixteen seconds after the review
     *
     * His review was never held at all. The hold existed to watch a review and
     * had expired before the review did. He asked for the anchor to move, and
     * these are the checks that keep it moved.
     */
    it('A REVIEW IS WATCHED FOR THE WHOLE HOLD, EVEN WHEN DELIVERY IS LONG PAST', async () => {
      // ── ON BLINKIT, AND THE SHOP IS NOT INCIDENTAL — 22 SEPTEMBER 2026 ────
      //
      // This was first written on ZEPTO and then contradicted itself the same
      // afternoon, when the owner's own measurement landed: on Zepto a rating
      // cannot be edited or removed, so watching it protects nothing and the
      // watch is deliberately skipped there. The check went red, correctly, and
      // is kept on a shop where the watch is real. Blinkit and Instamart allow
      // the rating to be EDITED — see rating-mutability.ts — so a review first
      // seen this instant genuinely has not been watched yet.
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await quickCommerce('BLINKIT');
      // Delivered four hours ago: the three-hour quick-commerce window closed an
      // hour before the review. Under the old rule this paid immediately.
      const { taskId } = await holdingFromTheShopsOwnPage(
        who, campaign, onTheMinute(Date.now() - 4 * HOUR),
      );

      // THE HELPER AGES THE WATCH TO MATCH THE DELIVERY; this test is about the
      // case it does not cover, so it puts the watch back to now — a review
      // first seen this instant, on an order delivered four hours ago. That is
      // exactly the owner's Cadbury journey.
      await prisma.task.update({
        where: { id: taskId }, data: { holdStartedAt: new Date() },
      });
      const before = await theTask(taskId);
      expect(before.state).toBe('HOLDING');
      expect(before.holdStartedAt).not.toBeNull();
      // The delivery window really has closed — this is not a test of that.
      expect(before.windowEndsAt!.getTime()).toBeLessThan(Date.now());

      // THE REVIEW HAS ONLY JUST BEEN SEEN, so the watch has not run.
      const report = await scheduler.runTick();
      expect(report.released).toBe(0);
      expect((await theTask(taskId)).state).toBe('HOLDING');

      // AND ONCE IT HAS, IT PAYS. Move the watch's own start back past the hold.
      await prisma.task.update({
        where: { id: taskId },
        data: { holdStartedAt: new Date(Date.now() - 4 * HOUR) },
      });
      const after = await scheduler.runTick();
      expect(after.released).toBeGreaterThanOrEqual(1);
      expect((await theTask(taskId)).state).toBe('REFUNDED');
    });

    it('BUT ZEPTO IS NOT, BECAUSE ITS RATING CANNOT BE CHANGED', async () => {
      // The owner, 22 September 2026: "On ZEPTO, once the user gives a review and
      // rating, they cannot edit it or remove it later." Holding his money to
      // watch something that cannot move is a delay wearing a safeguard's name.
      // The delivery-anchored window still applies — an order can still be
      // cancelled, and his own Cadbury order was.
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await quickCommerce('ZEPTO');
      const { taskId } = await holdingFromTheShopsOwnPage(
        who, campaign, onTheMinute(Date.now() - 4 * HOUR),
      );
      // The review was seen THIS INSTANT — the same shape that holds a Blinkit
      // task above. Zepto pays anyway.
      await prisma.task.update({
        where: { id: taskId }, data: { holdStartedAt: new Date() },
      });

      const report = await scheduler.runTick();
      expect(report.released).toBeGreaterThanOrEqual(1);
      expect((await theTask(taskId)).state).toBe('REFUNDED');
    });

    it('AND A TASK WITH NO WATCH RECORDED IS NOT HELD BY THIS AT ALL', async () => {
      // Every task written before the column existed has holdStartedAt null.
      // Null must mean "no review-anchored watch to satisfy", or this migration
      // would silently postpone refunds that were already due.
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await quickCommerce('ZEPTO');
      const { taskId } = await holdingFromTheShopsOwnPage(
        who, campaign, onTheMinute(Date.now() - 4 * HOUR),
      );
      await prisma.task.update({
        where: { id: taskId }, data: { holdStartedAt: null },
      });

      const report = await scheduler.runTick();
      expect(report.released).toBeGreaterThanOrEqual(1);
      expect((await theTask(taskId)).state).toBe('REFUNDED');
    });

    it('AND A SHOP WHOSE REVIEW CAN BE READ IS NEVER COUNTED AS UNVERIFIED', async () => {
      // The other half of the counter. Without this, releasedUnverified could be
      // incremented on every release and the check above would still pass — the
      // number would then be as useless as the one it replaced.
      const userId = await createUser();
      await ticketsSvc.grantSignup(userId);
      const campaign = await makeCampaign();               // AMAZON, has a permalink
      const url = 'https://www.amazon.in/review/still-there';
      checker.results.set(url, true);
      await holdingTask(userId, campaign, Date.now() - 30 * DAY, url);

      const report = await scheduler.runTick();
      expect(report.released).toBeGreaterThanOrEqual(1);
      expect(report.releasedUnverified).toBe(0);
      expect(report.rechecked).toBeGreaterThanOrEqual(1);
    });

    it('RELEASES ON ITS OWN on all three shops that cannot be sent back to', async () => {
      for (const platform of ['ZEPTO', 'BLINKIT', 'INSTAMART'] as const) {
        const who = await signedIn();
        await ticketsSvc.grantSignup(who.id);
        const campaign = await quickCommerce(platform);
        const { taskId } = await holdingFromTheShopsOwnPage(
          who, campaign, onTheMinute(Date.now() - 4 * HOUR),
        );

        const report = await scheduler.runTick();
        expect(report.released).toBeGreaterThanOrEqual(1);
        // ── AND IT IS COUNTED AS UNVERIFIED — 22 SEPTEMBER 2026 ────────────
        //
        // It still releases, and that is the deliberate choice: the server
        // cannot read a Zepto order page, so withholding the money would punish
        // an honest person to catch an attacker who need only not open the app.
        // What changed is that the payout is no longer indistinguishable from a
        // checked one in the tick's own report. Measured on the owner's own
        // completed Cadbury journey: VISIBILITY_CHECK events on that task, 0 —
        // and nothing anywhere said so.
        expect(report.releasedUnverified).toBeGreaterThanOrEqual(1);

        const task = await theTask(taskId);
        expect(task.state).toBe('REFUNDED');
        expect(task.returned).toBe(false);
        expect(await walletSvc.getUserBalance(who.id)).toBe(14900n);
      }
    });

    it('AND NOT ONE MINUTE BEFORE — an hour after delivery it is still held', async () => {
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await quickCommerce('ZEPTO');
      const arrivedAt = onTheMinute(Date.now() - 1 * HOUR);
      const { taskId } = await holdingFromTheShopsOwnPage(who, campaign, arrivedAt);

      const report = await scheduler.runTick();
      expect(report.released).toBe(0);

      const task = await theTask(taskId);
      expect(task.state).toBe('HOLDING');
      expect(await walletSvc.getUserBalance(who.id)).toBe(0n);
      // AND THE WINDOW WRITTEN ON THE ROW IS THE THREE HOURS, not seven days.
      expect(task.windowEndsAt!.getTime()).toBe(arrivedAt + 3 * HOUR);
    });

    it('while the same delivery on AMAZON is still held after four hours', async () => {
      // The other four shops did not move. Seven days, from the operator's own
      // table, exactly as before this phase.
      //
      // AND THE PAGE SAYS SO ITSELF: an Amazon page prints "Return or replace
      // items", which is the shop telling us nothing went back. Without that
      // line `returned` would be null and the refund would be held for a SECOND
      // reason — and this check would pass even if the hold were three hours.
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await makeCampaign({ category: null });
      const arrivedAt = onTheMinute(Date.now() - 4 * HOUR);
      const { taskId } = await holdingFromTheShopsOwnPage(who, campaign, arrivedAt, {
        product: 'boAt Rockerz 255 Pro+',
        paid: '1,299',
        struck: '2,999',
        mentionsReturns: true,
      });

      const held = await theTask(taskId);
      expect(held.returned).toBe(false);

      const report = await scheduler.runTick();
      expect(report.released).toBe(0);
      const task = await theTask(taskId);
      expect(task.state).toBe('HOLDING');
      expect(task.windowEndsAt!.getTime()).toBe(arrivedAt + 7 * 24 * HOUR);
    });

    it('AND AN OPERATOR WHO SET A WINDOW STILL WINS, on a quick-commerce campaign', async () => {
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await makeCampaign({
        platform: 'ZEPTO',
        title: 'Rate the headband',
        productName: 'Boldfit Strapless Sports Headband',
        category: null,
        productPricePaise: 14900n,
        // The operator typed two days. Nothing about which shop it is may
        // overrule that.
        returnWindowDays: 2,
      });
      const arrivedAt = onTheMinute(Date.now() - 4 * HOUR);
      const { taskId } = await holdingFromTheShopsOwnPage(who, campaign, arrivedAt);

      const report = await scheduler.runTick();
      expect(report.released).toBe(0);
      const task = await theTask(taskId);
      expect(task.state).toBe('HOLDING');
      expect(task.windowEndsAt!.getTime()).toBe(arrivedAt + 2 * 24 * HOUR);
    });

    it('AND A PAGE THAT SAYS IT WENT BACK IS NEVER RELEASED', async () => {
      // THE ONE DIRECTION THE RETURN RULE MUST NEVER RUN. On these three shops a
      // silence means "not sent back"; a page that says cancelled, returned or
      // refunded is never overturned by that, and the refund gate refuses it.
      //
      // A PAGE STATING BOTH AN ARRIVAL AND A CANCELLATION IS NOT ONE ANY SHOP
      // DRAWS, and it is said here rather than implied. It is the only way to
      // put a returned order in front of the refund gate on this road: a real
      // cancelled order prints no arrival at all, so it never reaches the hold
      // and never reaches the gate. The gate is what is being measured.
      const who = await signedIn();
      await ticketsSvc.grantSignup(who.id);
      const campaign = await quickCommerce('ZEPTO');
      const arrivedAt = onTheMinute(Date.now() - 4 * HOUR);
      const { taskId } = await holdingFromTheShopsOwnPage(
        who, campaign, arrivedAt, { cancelled: true },
      );

      const report = await scheduler.runTick();
      expect(report.released).toBe(0);
      const task = await theTask(taskId);
      expect(task.state).toBe('HOLDING');
      expect(task.returned).toBe(true);
      expect(await walletSvc.getUserBalance(who.id)).toBe(0n);
    });
  });
});
