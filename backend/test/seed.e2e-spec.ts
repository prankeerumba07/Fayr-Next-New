import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskService } from '../src/tasks/task.service';
import { TicketService } from '../src/tickets/ticket.service';
import { WalletService } from '../src/wallet/wallet.service';
import { WithdrawalService } from '../src/withdrawals/withdrawal.service';
import { SupportQuestionService } from '../src/support/support-question.service';
import { StaffVerificationService } from '../src/ocr/staff-verification.service';
import { ReportService } from '../src/reports/report.service';
import {
  seedDemo,
  DEMO_MOBILE_DEFAULT,
  DEMO_PAYOUT_UTR,
  RESERVED_FOR_LIVE_CLAIM,
  assertCandidatesNotReserved,
} from '../prisma/demo-seed';
import { TICKETS } from '../src/tickets/ticket.constants';
import { resetDatabase } from './reset-db';

/**
 * WHAT THE SEED HAS TO GUARANTEE, WRITTEN DOWN.
 *
 * The seed used to create four Amazon campaigns and nothing else: no users, no
 * tasks, no claims, no withdrawals. Every one of the nine staff-panel tabs was
 * therefore empty on a fresh database, and so were MyProducts, Earnings and the
 * wallet. An empty queue does not read as "no work today" to someone seeing the
 * product cold — it reads as "not built".
 *
 * So this file is a checklist with teeth, one assertion per tab, and the tabs are
 * named as the panel names them (admin-panel/index.html NAV_GROUPS) so a tab
 * added there without seed data is a failing test rather than a blank screen in
 * front of an audience.
 *
 * The second thing it pins is HOW the states were reached. Every task here is
 * driven through the real engine — claim, evidence, reviewed, start-hold,
 * release — because a row with state='REFUNDED' written by hand proves nothing
 * about the product. The assertions below check the by-products a hand-written
 * row would not have: a state history, balanced ledger entries, and a ticket
 * balance that only the real rules could have produced.
 */
describe('Demo seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TaskService;
  let tickets: TicketService;
  let wallet: WalletService;
  let withdrawals: WithdrawalService;
  let questions: SupportQuestionService;
  let verifications: StaffVerificationService;
  let reports: ReportService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    tasks = app.get(TaskService);
    tickets = app.get(TicketService);
    wallet = app.get(WalletService);
    withdrawals = app.get(WithdrawalService);
    questions = app.get(SupportQuestionService);
    verifications = app.get(StaffVerificationService);
    reports = app.get(ReportService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Seed e2e aborted: connected to non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ── the nine tabs ─────────────────────────────────────────────────────────
  describe('every staff-panel tab has something in it', () => {
    beforeEach(async () => {
      await seedDemo(app, { quiet: true });
    });

    it('Queues → Withdrawals: a request is waiting for FINANCE', async () => {
      const pending = await withdrawals.listAll('REQUESTED');
      expect(pending.length).toBeGreaterThanOrEqual(1);
    });

    it('Queues → Questions: an unanswered question is waiting for SUPPORT', async () => {
      const open = await questions.listAll();
      expect(open.filter((q) => q.status !== 'CLOSED').length).toBeGreaterThanOrEqual(1);
    });

    it('Queues → Screenshots: pending cases are waiting for review', async () => {
      const queue = await verifications.listQueue({ limit: 50, offset: 0 });
      // "A couple" — one is a queue you cannot demonstrate sorting or a
      // duplicate-hash signal on.
      expect(queue.total).toBeGreaterThanOrEqual(2);
    });

    it('Queues → Unit counts: a refund is held on a count nobody has confirmed', async () => {
      const awaiting = await tasks.listAwaitingAmount();
      expect(awaiting.total).toBeGreaterThanOrEqual(1);
      // The queue only means something if the reason is real. A held task with no
      // explanation is a dead end for the person who has to clear it.
      expect(awaiting.items[0].heldReason).toBeTruthy();
      expect(awaiting.items[0].heldExplanation).toBeTruthy();
    });

    it('Queues → Review checks: a review needs eyes on the product page', async () => {
      const awaiting = await tasks.listAwaitingReviewCheck();
      expect(awaiting.total).toBeGreaterThanOrEqual(1);
      const item = awaiting.items[0];
      expect(item.confirmedVisible).toBe(false);
      // The star has to be on file already — that is the entry condition for the
      // queue, and a seeded item that skips it would be testing nothing.
      expect(item.rating).not.toBeNull();
      expect(item.whyNoMachineCheck).toBeTruthy();
    });

    it('Catalogue → Campaigns: offers on Amazon, Flipkart, Meesho and one quick-commerce platform', async () => {
      const rows = await prisma.campaign.groupBy({
        by: ['platform'],
        _count: { _all: true },
      });
      const platforms = rows.map((r) => r.platform);
      expect(platforms).toContain('AMAZON');
      expect(platforms).toContain('FLIPKART');
      expect(platforms).toContain('MEESHO');
      // At least one quick-commerce platform. The captured catalogue happens to
      // carry all three, which is more than the demo needs and not worth
      // deleting — the demo simply does not open on them, as the weakest
      // evidence tier.
      const quick = platforms.filter((p) =>
        ['BLINKIT', 'ZEPTO', 'INSTAMART'].includes(p),
      );
      expect(quick.length).toBeGreaterThanOrEqual(1);
      // Myntra is dormant and stays that way — no campaign, by decision.
      expect(platforms).not.toContain('MYNTRA');

      // A campaign that is NOT live must survive, or the feed's status filter is
      // demonstrating nothing. The captured ones are ENDED rather than PAUSED —
      // either answers the question the filter asks.
      const notLive = await prisma.campaign.count({
        where: { status: { not: 'ACTIVE' } },
      });
      expect(notLive).toBeGreaterThanOrEqual(1);
    });

    it('Catalogue → Staff: one account per role, so every tab can be shown signed in as its real owner', async () => {
      const staff = await prisma.staffUser.findMany();
      const roles = staff.map((s) => s.role);
      for (const role of ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'] as const) {
        expect(roles).toContain(role);
      }
      // A password must never be recoverable from the row, seed or not.
      for (const s of staff) {
        expect(s.passwordHash).toMatch(/^\$argon2/);
      }
    });

    it('Insight → Reports: the funnel has real numbers in it, not zeroes', async () => {
      const activity = await reports.activity({});
      expect(activity.funnel.claimed).toBeGreaterThanOrEqual(4);
      expect(activity.funnel.refunded).toBeGreaterThanOrEqual(1);

      const payouts = await reports.payouts({});
      expect(BigInt(payouts.refundsCreditedPaise)).toBeGreaterThan(0n);
      expect(BigInt(payouts.paidOutPaise)).toBeGreaterThan(0n);

      const campaigns = await reports.campaignPerformance({});
      expect(campaigns.totals.claims).toBeGreaterThanOrEqual(4);

      const users = await reports.userGrowth({});
      expect(users.cumulativeUsers).toBeGreaterThanOrEqual(2);
    });

    it('Insight → Find a user: there are users to find', async () => {
      expect(await prisma.user.count()).toBeGreaterThanOrEqual(2);
    });
  });

  // ── the device app ────────────────────────────────────────────────────────
  describe('the demo user has walked every state TaskScreen renders', () => {
    let userId: string;

    beforeEach(async () => {
      await seedDemo(app, { quiet: true });
      const user = await prisma.user.findUniqueOrThrow({
        where: { mobile: DEMO_MOBILE_DEFAULT },
      });
      userId = user.id;
    });

    it('shows a product in each of the four states, so MyProducts is never one row', async () => {
      const list = await tasks.listForUser(userId);
      const states = list.map((t) => t.state);
      // The four TaskScreen renders: claimed-not-yet-bought, bought-awaiting-
      // review, review-submitted-and-holding, refunded.
      expect(states).toContain('CLAIMED');
      expect(states).toContain('DELIVERED');
      expect(states).toContain('HOLDING');
      expect(states).toContain('REFUNDED');
    });

    it('reached those states through real transitions, not by writing the column', async () => {
      const list = await tasks.listForUser(userId);
      const refunded = list.find((t) => t.state === 'REFUNDED');
      expect(refunded).toBeDefined();

      // A hand-written row has no journey behind it. These are the by-products
      // only the engine leaves: the recorded transitions, and an order the task
      // is actually anchored to.
      const events = await prisma.taskEvent.count({
        where: { taskId: refunded!.id },
      });
      expect(events).toBeGreaterThanOrEqual(4);
      const row = await prisma.task.findUniqueOrThrow({
        where: { id: refunded!.id },
      });
      expect(row.orderId).toBeTruthy();
      expect(row.deliveredAt).not.toBeNull();
    });

    it('has money in the wallet AND money already paid out, so Earnings is not all zeroes', async () => {
      // A balance of zero is a legitimate state and an unreadable demo: the
      // withdraw button has nothing to act on. A partial withdrawal gives both a
      // real payout history and a live balance.
      const balance = await wallet.getUserBalance(userId);
      expect(balance).toBeGreaterThan(0n);

      const paid = await prisma.withdrawal.findMany({
        where: { userId, status: 'PAID' },
      });
      expect(paid.length).toBeGreaterThanOrEqual(1);
      // Marked paid means an external reference was recorded — without it the row
      // says money left and cannot say where it went.
      expect(paid[0].utr).toBeTruthy();
    });

    it('every refund is a BALANCED double-entry, because that is the whole promise', async () => {
      const legs = await prisma.walletEntry.groupBy({
        by: ['transactionId'],
        _sum: { amountPaise: true },
      });
      expect(legs.length).toBeGreaterThan(0);
      for (const leg of legs) {
        expect(leg._sum.amountPaise).toBe(0n);
      }
    });

    it('is left with exactly enough tickets for ONE live claim on the day', async () => {
      // The demo claims an offer live. A seeded account spent down to zero cannot,
      // and topping it up by hand would hide the ticket rules the demo is meant to
      // show. 5 is one claim: earned back through a completed withdrawal, not
      // granted.
      const balance = await tickets.getBalance(userId);
      expect(balance).toBeGreaterThanOrEqual(5);
      // And not a suspicious pile — that would mean someone granted tickets
      // outside the rules.
      expect(balance).toBeLessThan(15);
    });
  });

  // ── the properties that keep it safe to re-run ────────────────────────────
  describe('idempotent, and honest about the clock', () => {
    it('running it twice changes nothing', async () => {
      await seedDemo(app, { quiet: true });
      const first = await counts();

      await seedDemo(app, { quiet: true });
      const second = await counts();

      expect(second).toEqual(first);
    });

    it('leaves an unbought claim with a WEEK to run, not merely an unexpired one', async () => {
      await seedDemo(app, { quiet: true });
      // The bug this pins, found by reading a seeded database rather than by
      // reasoning: a claim backdated one day had a deadline seven days after
      // SEEDING, and a demo is not run on the day the database is built. Seeded on
      // 25 August it lapsed on the 31st, so a demo on 1 September would have found
      // the sweep had expired it overnight and one of the four states was simply
      // gone.
      //
      // "Not yet expired" is therefore the wrong assertion — it passes the day it
      // is written and fails the day it matters. What has to hold is that there is
      // real time left.
      const open = await prisma.task.findMany({
        where: { state: 'CLAIMED', closedAt: null },
      });
      expect(open.length).toBeGreaterThanOrEqual(1);
      const SIX_DAYS = 6 * 86_400_000;
      for (const t of open) {
        expect(t.claimExpiresAt).not.toBeNull();
        expect(t.claimExpiresAt!.getTime() - Date.now()).toBeGreaterThan(SIX_DAYS);
      }
    });

    it('tops up a nearly-lapsed claim, the way a week-old database arrives on demo morning', async () => {
      await seedDemo(app, { quiet: true });
      const claimed = await prisma.task.findFirstOrThrow({
        where: { state: 'CLAIMED', closedAt: null },
      });
      await prisma.task.update({
        where: { id: claimed.id },
        data: { claimExpiresAt: new Date(Date.now() + 3_600_000) },
      });

      await seedDemo(app, { quiet: true });

      const after = await prisma.task.findUniqueOrThrow({
        where: { id: claimed.id },
      });
      expect(after.state).toBe('CLAIMED');
      expect(after.claimExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
        6 * 86_400_000,
      );
    });

    it('restores the unbought claim on a SPARE offer once the old one has expired', async () => {
      // The failure this pins is the one a retry could not fix: after the sweep
      // expires the claim, the one-purchase-per-campaign rule refuses a second
      // claim on that campaign, and a seed that only looked for "a task on this
      // campaign" would find the dead one and move on — leaving the demo three
      // states out of four with nothing to say why.
      await seedDemo(app, { quiet: true });
      const claimed = await prisma.task.findFirstOrThrow({
        where: { state: 'CLAIMED', closedAt: null },
      });
      await prisma.task.update({
        where: { id: claimed.id },
        data: { claimExpiresAt: new Date(Date.now() - 86_400_000) },
      });
      const { expired } = await tasks.sweepExpiredClaims();
      expect(expired).toBe(1);
      // There is no EXPIRED state — the enum has none. An expired claim keeps
      // state CLAIMED and is marked closed, which is exactly why the seed has to
      // filter on closedAt and not on the state alone.
      const dead = await prisma.task.findUniqueOrThrow({
        where: { id: claimed.id },
      });
      expect(dead.closedAt).not.toBeNull();
      expect(dead.closeReason).toBe('expired');

      await seedDemo(app, { quiet: true });

      // A DIFFERENT task, live, with a full window.
      const live = await prisma.task.findFirstOrThrow({
        where: { state: 'CLAIMED', closedAt: null },
      });
      expect(live.id).not.toBe(claimed.id);
      expect(live.claimExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
        6 * 86_400_000,
      );

      // And the tickets balance out by the real rules: expiry returns 5, the
      // replacement claim spends 5. Nothing was granted by hand.
      const user = await prisma.user.findUniqueOrThrow({
        where: { mobile: DEMO_MOBILE_DEFAULT },
      });
      expect(await tickets.getBalance(user.id)).toBeGreaterThanOrEqual(5);
    });

    it('never pre-claims the offer the demo claims LIVE', async () => {
      // THE CONSTRAINT THAT MADE THIS A GUARD RATHER THAN A COMMENT.
      //
      // One purchase per user per campaign is enforced at claim time. So if the
      // seed ever takes a seat on the offer the run-sheet walks through, that
      // live claim — the single most-watched moment of the demo — fails in front
      // of the audience with "you have already claimed this".
      //
      // On the real demo account this is not hypothetical. It already has a task
      // on every other candidate offer, leaving exactly TWO it has never touched,
      // and one of those two IS the demo's offer. The fall-back "claim the first
      // spare this account has never touched" would have walked into it.
      await seedDemo(app, { quiet: true });
      const reserved = await prisma.campaign.findFirstOrThrow({
        where: { title: { contains: RESERVED_FOR_LIVE_CLAIM } },
      });
      const taken = await prisma.task.count({ where: { campaignId: reserved.id } });
      expect(taken).toBe(0);

      // The end state above is necessary but WEAK on its own: it would pass with
      // no guard at all, simply because today's candidate list does not name the
      // reserved offer. What has to hold is that ADDING it is refused — that is
      // the mistake a future edit actually makes.
      expect(() =>
        assertCandidatesNotReserved(['Lukzer Garment Rack', 'Spin Your Storage']),
      ).toThrow(/claims\s+LIVE|already claimed/i);
      // A partial name must be caught too — nobody types the full title.
      expect(() => assertCandidatesNotReserved(['Spin Your'])).toThrow();
      // And an ordinary list must pass, or the guard is just a wall.
      expect(() =>
        assertCandidatesNotReserved(['Lukzer Garment Rack', 'Rate a Cotton Kurta Set']),
      ).not.toThrow();
    });

    it('backfills the unbought claim on an account that already has history', async () => {
      // The real account's shape: twelve tasks, one on every candidate offer, and
      // all four of its own CLAIMED tasks long since expired and closed. It has
      // three of the four states organically and is missing exactly one — a live
      // claim nobody has bought yet — while every obvious candidate is used up.
      await seedDemo(app, { quiet: true });
      const user = await prisma.user.findUniqueOrThrow({
        where: { mobile: DEMO_MOBILE_DEFAULT },
      });

      // Close every live claim, the way an account whose claims all lapsed looks.
      await prisma.task.updateMany({
        where: { userId: user.id, state: 'CLAIMED' },
        data: { closedAt: new Date(), closeReason: 'expired' },
      });
      const before = await prisma.task.count({ where: { userId: user.id } });

      await seedDemo(app, { quiet: true });

      const live = await prisma.task.findFirst({
        where: { userId: user.id, state: 'CLAIMED', closedAt: null },
      });
      expect(live).not.toBeNull();
      expect(live!.claimExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
        6 * 86_400_000,
      );
      // EXACTLY one task added — the missing state, and nothing else.
      expect(await prisma.task.count({ where: { userId: user.id } })).toBe(before + 1);
      // And still not the offer the demo needs live.
      const reserved = await prisma.campaign.findFirstOrThrow({
        where: { title: { contains: RESERVED_FOR_LIVE_CLAIM } },
      });
      expect(live!.campaignId).not.toBe(reserved.id);
    });

    it('rebuilds every state on a real account that is out of tickets and has already been paid once', async () => {
      // THE SHAPE OF THE ACTUAL DEMO ACCOUNT, once its real number was known —
      // and it broke the seed in two places at once, neither of which any
      // existing test could see, because every test started from a fresh user.
      //
      //   1. TICKETS. Its signup grant was spent long ago on claims whose tasks
      //      no longer exist, leaving a balance of zero. grantSignup is
      //      idempotent per user FOR LIFE, so the seed's very first claim had
      //      nothing to spend and the whole run died on it.
      //   2. THE PAYOUT GUARD. It already carried a PAID withdrawal from an
      //      earlier, unrelated payout. The guard asked "has this ACCOUNT ever
      //      been paid?" when the question it meant was "has the SEED's payout
      //      happened?" — so it skipped its own, and with it the +10 completion
      //      grant that funds the last three journeys.
      //
      // Reproduced by seeding once, then removing what a database reset removed:
      // the tasks. The tickets stay spent and the PAID withdrawal stays on file,
      // which is exactly the state that was found.
      await seedDemo(app, { quiet: true });
      const user = await prisma.user.findUniqueOrThrow({
        where: { mobile: DEMO_MOBILE_DEFAULT },
      });
      const panBefore = user.pan;
      const methodsBefore = await prisma.payoutMethod.count({
        where: { userId: user.id },
      });

      await prisma.taskEvent.deleteMany({ where: { task: { userId: user.id } } });
      await prisma.task.deleteMany({ where: { userId: user.id } });
      // The payout it already had was NOT the seed's — it was a real one, weeks
      // earlier, with a real bank reference. Re-stamping the reference is what
      // makes this fixture the account that was actually found rather than a
      // second run of the seed against itself.
      await prisma.withdrawal.updateMany({
        where: { userId: user.id, status: 'PAID' },
        data: { utr: '7876436794906727' },
      });
      const spare = await tickets.getBalance(user.id);
      if (spare > 0) {
        await tickets.adjust(user.id, -spare, `test:spent:${user.id}`);
      }
      expect(await tickets.getBalance(user.id)).toBe(0);
      expect(
        await prisma.withdrawal.count({
          where: { userId: user.id, status: 'PAID' },
        }),
      ).toBeGreaterThan(0);

      await seedDemo(app, { quiet: true });

      // All four states back, through the real engine.
      const states = (
        await prisma.task.findMany({ where: { userId: user.id } })
      )
        .map((t) => t.state)
        .sort();
      expect(states).toEqual(['CLAIMED', 'DELIVERED', 'HOLDING', 'REFUNDED']);

      // And enough left to make the live claim the demo depends on.
      expect(await tickets.getBalance(user.id)).toBeGreaterThanOrEqual(
        TICKETS.DEFAULT_CLAIM_COST,
      );

      // The top-up is ONE append-only correction to the signup baseline, not a
      // hand-set balance and not an open tap.
      const corrections = await prisma.ticketEntry.findMany({
        where: { userId: user.id, reason: 'ADJUSTMENT', delta: { gt: 0 } },
      });
      expect(corrections).toHaveLength(1);
      expect(corrections[0].delta).toBe(TICKETS.SIGNUP_GRANT);

      // The seed's own payout happened this time, and is identifiable as its own.
      expect(
        await prisma.withdrawal.count({
          where: { userId: user.id, status: 'PAID', utr: DEMO_PAYOUT_UTR },
        }),
      ).toBe(1);

      // AND NOTHING ELSE ON THE ACCOUNT WAS TOUCHED. The PAN is anchored for
      // life by the fraud rules; a seed that rewrote it would be destroying real
      // identity data to make a demo tidy.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.pan).toBe(panBefore);
      expect(await prisma.payoutMethod.count({ where: { userId: user.id } })).toBe(
        methodsBefore,
      );
    });

    it('does not top up an account that already has its signup grant', async () => {
      // The top-up must be a repair, not a routine. A fresh account has 15, which
      // is exactly what the documented arithmetic needs, so nothing is added —
      // and the ticket economy the demo explains is the one actually running.
      await seedDemo(app, { quiet: true });
      const user = await prisma.user.findUniqueOrThrow({
        where: { mobile: DEMO_MOBILE_DEFAULT },
      });
      expect(
        await prisma.ticketEntry.count({
          where: { userId: user.id, reason: 'ADJUSTMENT' },
        }),
      ).toBe(0);
      // Ends on exactly one claim's worth, funded only by the real rules.
      expect(await tickets.getBalance(user.id)).toBe(TICKETS.DEFAULT_CLAIM_COST);
    });

    it('says what it FOUND when it skips, not what it assumes', async () => {
      // The skip is keyed on (user, campaign) and not on state, so on an account
      // with history it fires for an offer that merely has a task on it. Reporting
      // only the journey's label read as "that state is already present" — which
      // on the real demo account was wrong for three of four, where what existed
      // were expired, closed claims. Someone reading a seed that misdescribes its
      // own skips stops checking it.
      await seedDemo(app, { quiet: true });
      const second = await seedDemo(app, { quiet: true });
      expect(second.skipped.length).toBeGreaterThan(0);
      for (const line of second.skipped) {
        expect(line).toMatch(/offer already has a task \((CLAIMED|PURCHASED|DELIVERED|REVIEWED|HOLDING|REFUNDED)(, closed)?\)/);
      }
    });

    it('refuses to run against a database that is not a dev or test one', async () => {
      // The guard the old seed did not have. It writes users, tasks and ledger
      // entries now, and pointing it at anything real would be unrecoverable.
      await expect(
        seedDemo(app, { quiet: true, databaseNameOverride: 'fayr_prod' }),
      ).rejects.toThrow(/dev|test/i);
    });

    async function counts(): Promise<Record<string, number>> {
      return {
        users: await prisma.user.count(),
        staff: await prisma.staffUser.count(),
        campaigns: await prisma.campaign.count(),
        tasks: await prisma.task.count(),
        withdrawals: await prisma.withdrawal.count(),
        questions: await prisma.supportQuestion.count(),
        screenshots: await prisma.screenshotUpload.count(),
        submissions: await prisma.evidenceSubmission.count(),
        walletEntries: await prisma.walletEntry.count(),
        ticketEntries: await prisma.ticketEntry.count(),
        payoutMethods: await prisma.payoutMethod.count(),
      };
    }
  });
});
