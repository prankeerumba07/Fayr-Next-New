import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { TaskService } from '../tasks/task.service';
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
  rechecked: number;
  regressed: number;
  released: number;
}

/**
 * The maintenance scheduler (step 1.6).
 *
 * One cron tick per interval does three things, in this order: expire
 * unpurchased claims (returning tickets), RE-CHECK review visibility for every
 * HOLDING task (the loophole-3 clawback — a review deleted mid-hold regresses the
 * task so it can't refund), then AUTO-RELEASE any refund whose window has now
 * elapsed while still published.
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
      rechecked: 0,
      regressed: 0,
      released: 0,
    };

    report.expired = (
      await this.tasks.sweepExpiredClaims(new Date(now))
    ).expired;

    const holding = await this.tasks.holdingTasksForRecheck();
    for (const task of holding) {
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

    return report;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
