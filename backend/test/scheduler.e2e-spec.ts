import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Campaign, Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
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
  const checker = new FakeChecker();

  let seq = 0;
  const newMobile = (): string =>
    `+9193${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    return user.id;
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
    const t = await taskSvc.claim(userId, campaign.id);
    await taskSvc.submitEvidence(
      userId,
      t.id,
      ev({
        order: { id: 'o1', itemPaise: '129900', source: 'order-details' },
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
    await app.init();
    prisma = app.get(PrismaService);
    scheduler = app.get(SchedulerService);
    taskSvc = app.get(TaskService);
    ticketsSvc = app.get(TicketService);
    walletSvc = app.get(WalletService);

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
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users","campaigns","tasks","task_events","visibility_checks","ticket_entries","wallet_accounts","wallet_entries","ledger_transactions" RESTART IDENTITY CASCADE',
    );
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
      const t = await taskSvc.claim(userId, campaign.id);
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
});
