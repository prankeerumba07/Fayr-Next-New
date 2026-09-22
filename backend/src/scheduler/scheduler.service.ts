import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Env } from '../config/env.validation';
import { ScreenshotRetentionService } from '../ocr/screenshot-retention.service';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from '../tasks/task.service';
import { cannotBeSentBack } from '../tasks/engine/return-policy';
import {
  REVIEW_VISIBILITY_CHECKER,
  type ReviewVisibilityChecker,
} from './review-visibility.checker';

const MAINTENANCE_JOB = 'fayr-maintenance';
/** Fixed key for the maintenance advisory lock (any app-chosen bigint). */
const MAINTENANCE_LOCK_KEY = 748_291_045;
/** Generous ceiling for one tick, since the advisory lock is held for its duration. */
const TICK_TIMEOUT_MS = 120_000;

export interface TickReport {
  expired: number;
  /** Tasks the shop said went back, closed and their tickets handed back. */
  letGo: number;
  /**
   * Of `released`, how many went out with NO re-check of the review, because the
   * shop publishes none that a server can read. Counted separately so that
   * "released" is never mistaken for "checked and released". See the branch in
   * runTick and the note above it.
   */
  releasedUnverified: number;
  rechecked: number;
  regressed: number;
  released: number;
  /** Private screenshots whose bytes were deleted after the retention period. */
  purged: number;
}

/**
 * The maintenance scheduler (step 1.6).
 *
 * One cron tick per interval does four things, in this order: expire
 * unpurchased claims (returning tickets), RE-CHECK review visibility for every
 * HOLDING task (the loophole-3 clawback — a review deleted mid-hold regresses the
 * task so it can't refund), AUTO-RELEASE any refund whose window has now elapsed
 * while still published, and DELETE the bytes of private screenshots past their
 * retention period (keeping the row + hash, so the duplicate-image fraud signal
 * outlives the image).
 *
 * Multi-instance-safe: the whole tick runs inside a Postgres advisory lock
 * (pg_try_advisory_xact_lock), so on a fleet of replicas exactly one runs each
 * tick and the rest skip. Each per-task effect still runs in its own transaction
 * (via TaskService), so one bad task can't roll back the others.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly enabled: boolean;
  private readonly cronExpr: string;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TaskService,
    @Inject(REVIEW_VISIBILITY_CHECKER)
    private readonly checker: ReviewVisibilityChecker,
    private readonly retention: ScreenshotRetentionService,
    private readonly registry: SchedulerRegistry,
    config: ConfigService<Env, true>,
  ) {
    this.cronExpr = config.get('SCHEDULER_CRON', { infer: true });
    // Never auto-run under test: the e2e drives the tick + lock directly.
    this.enabled =
      config.get('SCHEDULER_ENABLED', { infer: true }) &&
      process.env.NODE_ENV !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('maintenance scheduler disabled');
      return;
    }
    const job = new CronJob(this.cronExpr, () => {
      void this.handleCron();
    });
    this.registry.addCronJob(MAINTENANCE_JOB, job);
    job.start();
    this.logger.log(`maintenance scheduler started (cron: ${this.cronExpr})`);
  }

  /** The cron entrypoint: run the tick under the advisory lock, once at a time. */
  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('previous maintenance tick still running; skipping');
      return;
    }
    this.running = true;
    try {
      const outcome = await this.withAdvisoryLock(MAINTENANCE_LOCK_KEY, () =>
        this.runTick(),
      );
      if (outcome.ran) {
        this.logger.log(`maintenance tick ${JSON.stringify(outcome.result)}`);
      } else {
        this.logger.debug(
          'another instance holds the maintenance lock; skipped',
        );
      }
    } catch (err) {
      this.logger.error(`maintenance tick failed: ${errMsg(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Run `fn` only if this instance wins the Postgres advisory lock for `key`.
   * The lock is transaction-scoped, so it releases automatically when the tick
   * finishes or the connection dies — no lease to expire, no cleanup on crash.
   */
  async withAdvisoryLock<T>(
    key: number,
    fn: () => Promise<T>,
  ): Promise<{ ran: boolean; result?: T }> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${key}::bigint) AS locked`;
        if (!rows[0]?.locked) return { ran: false };
        const result = await fn();
        return { ran: true, result };
      },
      { timeout: TICK_TIMEOUT_MS, maxWait: 10_000 },
    );
  }

  /**
   * One maintenance pass. Directly callable (the e2e drives it); the cron path
   * wraps it in the advisory lock. Every per-task effect is its own transaction.
   */
  async runTick(now: number = Date.now()): Promise<TickReport> {
    const report: TickReport = {
      expired: 0,
      letGo: 0,
      releasedUnverified: 0,
      rechecked: 0,
      regressed: 0,
      released: 0,
      purged: 0,
    };

    report.expired = (
      await this.tasks.sweepExpiredClaims(new Date(now))
    ).expired;

    // ── AND EVERY ORDER THE SHOP SENT BACK, LET GO ─────────────────────────
    //
    // NEXT TO THE EXPIRY SWEEP BECAUSE IT IS THE SAME KIND OF WORK: a claim that
    // cannot go anywhere, freed on a timer rather than waiting for somebody to
    // open the app. The difference is that an expired claim has a person who
    // might come back, and a cancelled order has nobody — which is why the
    // evidence path alone was never going to be enough. See
    // TaskService.sweepOrdersThatWentBack for the owner's own stuck row.
    //
    // BEFORE THE HOLDING RE-CHECKS, so a returned order is let go in the same
    // tick it is noticed rather than the next one. It cannot interfere with them:
    // a HOLDING task with `returned` true already fails refundEligibility, so
    // nothing this closes was ever going to be released below.
    report.letGo = (
      await this.tasks.sweepOrdersThatWentBack(new Date(now))
    ).letGo;

    const holding = await this.tasks.holdingTasksForRecheck();
    for (const task of holding) {
      // ── THE SHOP WITH NO PUBLIC REVIEW, SAID OUT LOUD — 22 SEPTEMBER 2026 ──
      //
      // THE DEFECT THIS REPLACES. This loop used to be `if (task.permalink)
      // { ...re-check... }` with autoRelease OUTSIDE it. Quick commerce publishes
      // no permalink, so every Zepto, Blinkit and Instamart task fell straight
      // past the re-check into the payout. Measured on the owner's own completed
      // Cadbury journey, 22 September: VISIBILITY_CHECK events on that task, 0.
      // Not "ran and passed" — never ran. CLAUDE.md calls this check the direct
      // countermeasure to loophole 3 and says do not weaken or shortcut it; on
      // three of the seven shops it was simply absent.
      //
      // AND THE HONEST FIX IS NOT A GATE. The server CANNOT read a Zepto order
      // page: it sits behind the buyer's own session, on their device. There is
      // no push, no background fetch and no server-to-device channel anywhere in
      // this repo, so "hold the money until the device looks" has no way to ask —
      // it would silently become "hold until they next open Fayr for their own
      // reasons", which withholds an honest person's money to catch an attacker
      // who need only not open the app. That is a worse failure, not a safer one.
      //
      // SO THE BRANCH IS MADE EXPLICIT AND THE RELEASE IS RECORDED AS UNVERIFIED.
      // It buys no fraud resistance by itself and is not pretended to. What it
      // buys is that the number is visible: a quick-commerce payout is now
      // counted separately from a checked one, in the tick's own report, so
      // nobody reads "released: 12" again and assumes twelve reviews were
      // re-checked. The catch itself lives where it can actually work — on the
      // device's own next look, and after payout. See the note in
      // ratedFromALaterLook.
      if (!task.permalink && cannotBeSentBack(task.platform)) {
        const released = await this.tasks.autoRelease(task.id, now);
        if (released) {
          report.released++;
          report.releasedUnverified++;
        }
        continue;
      }

      // Re-check public visibility first, so a review that just vanished is
      // caught BEFORE we'd otherwise release its refund.
      if (task.permalink) {
        let published: boolean;
        try {
          published = await this.checker.isPublished(task.permalink);
        } catch (err) {
          // A transient failure is NOT "not visible" — skip and retry next tick.
          this.logger.warn(
            `visibility check failed for task ${task.id}: ${errMsg(err)}`,
          );
          continue;
        }
        const after = await this.tasks.recordVisibilityCheck(
          task.id,
          published,
          'scheduler',
        );
        report.rechecked++;
        if (after.state !== 'HOLDING') {
          report.regressed++;
          continue; // review gone → regressed to REVIEWED, do not release
        }
      }

      const released = await this.tasks.autoRelease(task.id, now);
      if (released) report.released++;
    }

    // LAST, and deliberately not gated on anything above: retention is a promise
    // to the user about their own photographs, and it must not be skipped because
    // a task loop had a bad day. Its own logging is inside the service.
    report.purged = (await this.retention.purgeExpired(new Date(now))).purged;

    return report;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
