import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * How many images one tick will delete. A cap so a backlog (a period shortened
 * from 365 to 90, say) can't turn one maintenance tick into thousands of unlinks
 * while it holds the advisory lock. What it did NOT get to is counted and logged —
 * a silent cap reads as "everything is purged" when it is not.
 */
export const PURGE_BATCH_LIMIT = 500;

const DAY_MS = 86_400_000;

/** What one purge pass did. Returned so the scheduler can log it. */
export interface PurgeReport {
  /** Images whose bytes are gone and whose row is now stamped. */
  purged: number;
  bytesFreed: number;
  /** Files that could not be deleted; their rows are untouched and retry next tick. */
  failed: number;
  /** Still expired after this tick's cap. 0 when the backlog is clear. */
  remaining: number;
  /** The oldest upload this pass deleted, so the log states the real reach. */
  oldestPurgedAt: string | null;
}

/**
 * Screenshot retention.
 *
 * A verification screenshot is a user's private PII — an order page with their
 * name, address and what they bought on it. Everything about how they were
 * *held* was right (a private path outside the public space, an RBAC-checked
 * stream, every view audited) and the one thing missing was the end: they were
 * kept forever. `deletePrivate` was written, documented as the retention purge,
 * and called from nowhere.
 *
 * THE INVARIANT: the bytes go, the record stays. The row keeps its sha256, so
 * "this exact image has been submitted before" is still answerable years later,
 * and the OCR case keeps its extraction and its staff decision, so a payout
 * remains explainable after the picture behind it is gone. Deleting the row
 * instead would delete the fraud history along with the PII, which is the
 * opposite trade.
 */
@Injectable()
export class ScreenshotRetentionService {
  private readonly logger = new Logger(ScreenshotRetentionService.name);
  private readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.retentionDays = config.get('SCREENSHOT_RETENTION_DAYS', {
      infer: true,
    });
  }

  /** Uploads strictly older than this are expired. */
  cutoff(now: Date): Date {
    return new Date(now.getTime() - this.retentionDays * DAY_MS);
  }

  /**
   * Delete the bytes of every expired screenshot, keeping the row and the hash.
   *
   * Bytes FIRST, then the stamp. If the unlink fails, the row still says the image
   * is held — which is true, it is still on disk — and the next tick tries again.
   * Stamping first would mark it purged and leave the PII sitting there with
   * nothing ever looking at it again. `deletePrivate` is idempotent on a missing
   * file, so a crash between the two heals on the next tick.
   */
  async purgeExpired(now: Date = new Date()): Promise<PurgeReport> {
    const cutoff = this.cutoff(now);
    const expired = await this.prisma.screenshotUpload.findMany({
      where: { deletedAt: null, uploadedAt: { lt: cutoff } },
      select: { id: true, storageKey: true, sizeBytes: true, uploadedAt: true },
      orderBy: { uploadedAt: 'asc' }, // oldest first — the most overdue go first
      take: PURGE_BATCH_LIMIT,
    });

    const report: PurgeReport = {
      purged: 0,
      bytesFreed: 0,
      failed: 0,
      remaining: 0,
      oldestPurgedAt: null,
    };
    if (expired.length === 0) {
      this.logger.debug(
        `retention: no screenshots older than ${this.retentionDays} days`,
      );
      return report;
    }

    let oldest: Date | null = null;
    for (const shot of expired) {
      try {
        await this.storage.deletePrivate(shot.storageKey);
      } catch (err) {
        // One unreadable file must not stop the rest of the purge.
        report.failed++;
        this.logger.warn(
          `retention: could not delete ${shot.storageKey} (${errMsg(err)}); will retry next tick`,
        );
        continue;
      }
      await this.prisma.screenshotUpload.update({
        where: { id: shot.id },
        data: { deletedAt: now },
      });
      report.purged++;
      report.bytesFreed += shot.sizeBytes;
      if (!oldest || shot.uploadedAt < oldest) oldest = shot.uploadedAt;
    }
    report.oldestPurgedAt = oldest ? oldest.toISOString() : null;

    if (expired.length === PURGE_BATCH_LIMIT) {
      const stillExpired = await this.prisma.screenshotUpload.count({
        where: { deletedAt: null, uploadedAt: { lt: cutoff } },
      });
      report.remaining = Math.max(0, stillExpired - report.purged);
    }

    // Said out loud, every time it does something: a retention job whose output
    // nobody can see is a retention job nobody can trust.
    this.logger.log(
      `retention: purged ${report.purged} screenshot(s) older than ${this.retentionDays} days` +
        ` (${mb(report.bytesFreed)}, oldest uploaded ${report.oldestPurgedAt ?? 'n/a'});` +
        ` hashes and cases kept${report.failed ? `; ${report.failed} failed` : ''}` +
        `${report.remaining ? `; ${report.remaining} still expired, next tick continues` : ''}`,
    );
    return report;
  }
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
