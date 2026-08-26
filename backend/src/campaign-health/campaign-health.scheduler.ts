import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignHealthService } from './campaign-health.service';

const JOB = 'fayr-campaign-check';
/** Its own advisory-lock key, so it never queues behind the maintenance tick. */
const LOCK_KEY = 748_291_046;
const TIMEOUT_MS = 120_000;

/**
 * ONCE A NIGHT, EVERY LIVE OFFER.
 *
 * The check itself is a plain read and could run on demand only — Front-end
 * operations can press the button any time. What the nightly run adds is the thing
 * a button cannot: a record that somebody looked, on a day when nobody did. That
 * is what makes "new since last night" a real sentence rather than a diff against
 * whenever the tab happened to be open.
 *
 * Multi-instance-safe the same way the maintenance tick is: a Postgres advisory
 * lock, transaction-scoped, so a second replica skips rather than duplicating the
 * run. Never auto-runs under test — the e2e drives the service directly.
 */
@Injectable()
export class CampaignHealthScheduler implements OnModuleInit {
  private readonly logger = new Logger(CampaignHealthScheduler.name);
  private readonly cronExpr: string;
  private readonly enabled: boolean;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: CampaignHealthService,
    private readonly registry: SchedulerRegistry,
    config: ConfigService<Env, true>,
  ) {
    this.cronExpr = config.get('CAMPAIGN_CHECK_CRON', { infer: true });
    this.enabled =
      config.get('CAMPAIGN_CHECK_ENABLED', { infer: true })
      && process.env.NODE_ENV !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('daily offer check disabled');
      return;
    }
    const job = new CronJob(this.cronExpr, () => {
      void this.handleCron();
    });
    this.registry.addCronJob(JOB, job);
    job.start();
    this.logger.log(`daily offer check started (cron: ${this.cronExpr})`);
  }

  async handleCron(): Promise<void> {
    if (this.running) {
      this.logger.warn('previous offer check still running; skipping');
      return;
    }
    this.running = true;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${LOCK_KEY}::bigint) AS locked`;
          if (!rows[0]?.locked) {
            this.logger.debug('another instance holds the check lock; skipped');
            return;
          }
          await this.health.runAndRecord('SCHEDULED');
        },
        { timeout: TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (err) {
      this.logger.error(
        `daily offer check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
