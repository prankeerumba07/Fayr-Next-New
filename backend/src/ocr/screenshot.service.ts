import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, ScreenshotKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  EvidenceMatchService,
  type MatchExpectation,
} from './evidence-match.service';
import { MAX_SCREENSHOTS_PER_TASK, SCREENSHOT_SUBDIR } from './ocr.constants';
import {
  toUserScreenshot,
  toUserStatus,
  type ScreenshotUploadResponse,
} from './screenshot.response';
import { VisionExtractionService } from './vision-extraction.service';

/**
 * The subset of a multer file we read. Declared locally so the backend needs no
 * @types/multer dependency; FileInterceptor's memory storage populates `buffer`.
 */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** A task loaded with the campaign fields the matcher needs. */
type TaskWithCampaign = Prisma.TaskGetPayload<{ include: { campaign: true } }>;

/**
 * Handles a user uploading a verification screenshot: store the bytes PRIVATELY,
 * record the upload + a pending evidence submission, then (when OCR is
 * configured and under the daily cap) run vision extraction + matching so staff
 * get a pre-filled "do the details match?" case.
 *
 * SUPPORTING EVIDENCE ONLY. This never advances the task or moves money — it just
 * files a case for a staff member to approve (O.6). Extraction is best-effort:
 * no API key, over the daily cap, or a vision error all leave the upload stored
 * and awaiting manual review — a genuine user's proof is never lost to our OCR
 * being off or capped. The ScreenshotUpload + EvidenceSubmission rows ARE the
 * audit trail for the upload + extraction (who/what/when/model/tokens/cost);
 * staff views + decisions are audited separately against AdminAuditLog (O.6).
 */
@Injectable()
export class ScreenshotVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly vision: VisionExtractionService,
    private readonly matcher: EvidenceMatchService,
  ) {}

  async uploadForUser(
    userId: string,
    taskId: string,
    kind: ScreenshotKind,
    file: UploadedImage,
  ): Promise<ScreenshotUploadResponse> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    // A task that isn't the caller's reads as 404 — never leak its existence.
    if (!task || task.userId !== userId) {
      throw new NotFoundException('Task not found');
    }
    if (task.closedAt !== null) {
      throw new ConflictException('Task is closed');
    }

    const live = await this.prisma.screenshotUpload.count({
      where: { taskId, deletedAt: null },
    });
    if (live >= MAX_SCREENSHOTS_PER_TASK) {
      throw new ConflictException('Too many screenshots for this task');
    }

    // The API media types are a subset of what browsers report; normalise the
    // one alias so the stored + vision media type is always canonical.
    const mimetype =
      file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;

    const stored = await this.storage.savePrivate({
      buffer: file.buffer,
      mimetype,
      subdir: SCREENSHOT_SUBDIR,
    });

    // Durable record first: the upload + a pending submission, atomically.
    const upload = await this.prisma.screenshotUpload.create({
      data: {
        taskId,
        userId,
        kind,
        storageKey: stored.key,
        mimetype,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        submission: { create: {} }, // status defaults to UPLOADED
      },
      include: { submission: true },
    });
    let status = upload.submission!.status;
    const submissionId = upload.submission!.id;

    // Extraction is a cost-bearing side effect — only when configured AND under
    // the day's cap. Otherwise the case stands, pending manual review.
    if (this.vision.enabled && (await this.underDailyCap())) {
      status = await this.runExtraction(submissionId, {
        buffer: file.buffer,
        mimetype,
        task,
        kind,
      });
    }

    return {
      id: submissionId,
      taskId,
      kind,
      status: toUserStatus(status),
      // A fresh upload is always pending — no staff decision yet.
      reviewReason: null,
      reviewedAt: null,
      uploadedAt: upload.uploadedAt.toISOString(),
    };
  }

  /**
   * The caller's own screenshots for a task, newest first — status + (for
   * rejected / needs_more) the staff reason, so the app can tell the user what to
   * fix or re-upload. Never exposes the verdict / confidence / match diff.
   */
  async listForUser(
    userId: string,
    taskId: string,
  ): Promise<ScreenshotUploadResponse[]> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.userId !== userId) {
      throw new NotFoundException('Task not found');
    }
    const subs = await this.prisma.evidenceSubmission.findMany({
      where: { screenshot: { taskId, userId } },
      include: { screenshot: true },
      orderBy: { createdAt: 'desc' },
    });
    return subs.map(toUserScreenshot);
  }

  /** True while today's extraction count is below the configured cap. */
  private async underDailyCap(): Promise<boolean> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const used = await this.prisma.evidenceSubmission.count({
      where: { model: { not: null }, createdAt: { gte: start } },
    });
    return used < this.vision.dailyCap;
  }

  /**
   * Run vision extraction + matching for one submission and persist the result.
   * Returns the resulting status. Never throws — a vision/parse failure is
   * recorded as FAILED so staff can still eyeball the raw screenshot.
   */
  private async runExtraction(
    submissionId: string,
    ctx: {
      buffer: Buffer;
      mimetype: string;
      task: TaskWithCampaign;
      kind: ScreenshotKind;
    },
  ): Promise<'EXTRACTED' | 'FAILED' | 'UPLOADED'> {
    const outcome = await this.vision.extract({
      buffer: ctx.buffer,
      mimetype: ctx.mimetype,
    });

    if (outcome.status === 'extracted') {
      const result = this.matcher.match(
        outcome.fields,
        this.expectationOf(ctx.task, ctx.kind),
      );
      await this.prisma.evidenceSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'EXTRACTED',
          model: outcome.model,
          extraction: outcome.fields as unknown as Prisma.InputJsonValue,
          tokensIn: outcome.tokensIn,
          tokensOut: outcome.tokensOut,
          costMicroUsd: outcome.costMicroUsd,
          match: result.fields as unknown as Prisma.InputJsonValue,
          verdict: result.verdict,
          confidence: result.confidence,
        },
      });
      return 'EXTRACTED';
    }

    if (outcome.status === 'failed') {
      await this.prisma.evidenceSubmission.update({
        where: { id: submissionId },
        data: { status: 'FAILED', error: outcome.reason },
      });
      return 'FAILED';
    }

    // skipped — OCR turned off between the enabled() check and here; leave the
    // case pending with a note.
    await this.prisma.evidenceSubmission.update({
      where: { id: submissionId },
      data: { error: outcome.reason },
    });
    return 'UPLOADED';
  }

  private expectationOf(
    task: TaskWithCampaign,
    kind: ScreenshotKind,
  ): MatchExpectation {
    return {
      kind,
      productName: task.campaign.productName,
      productPricePaise: task.campaign.productPricePaise,
      minRating: task.campaign.minRating,
      claimedAt: task.createdAt,
    };
  }
}
