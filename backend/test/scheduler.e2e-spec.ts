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
