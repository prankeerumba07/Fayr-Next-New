import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EvidenceSubmissionStatus, Prisma } from '@prisma/client';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TaskService } from '../tasks/task.service';
import type { FieldMatch } from './evidence-match.service';
import { evidenceFragmentFor } from './ocr-evidence';
import { QUEUE_STATES } from './dto/list-verifications.query';
import type { ExtractedFields } from './vision-extraction.service';
import type {
  ReviewResultResponse,
  VerificationDetailResponse,
  VerificationQueueItem,
  VerificationQueueResponse,
} from './verification.response';

/** A submission loaded with everything a reviewer/approval needs. */
type SubmissionFull = Prisma.EvidenceSubmissionGetPayload<{
  include: {
    screenshot: { include: { task: { include: { campaign: true } } } };
  };
}>;

/** Extensions in bytes-off the mimetype, for the streamed filename. */
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The staff review of OCR screenshot cases — the mandatory HUMAN gate before any
 * screenshot becomes evidence. SUPPORT reviews (ADMIN via the super-role).
 * Approve funnels a tier-3 `ocr` evidence fragment through the SAME
 * TaskService.applyEvidence pipeline the scraper will use, advancing the task
 * under the normal state-machine rules — no OCR path moves money on its own (the
 * holding period + visibility re-check + FINANCE-gated withdrawal still apply).
 * Every image view and every decision is audited.
 */
@Injectable()
export class StaffVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AdminAuditService,
    private readonly tasks: TaskService,
  ) {}

  /** The review queue — pending cases, oldest first (the panel prioritises by verdict). */
  async listQueue(query: {
    status?: (typeof QUEUE_STATES)[number];
    limit: number;
    offset: number;
  }): Promise<VerificationQueueResponse> {
    const where: Prisma.EvidenceSubmissionWhereInput = {
      status: query.status
        ? query.status
        : { in: QUEUE_STATES as unknown as EvidenceSubmissionStatus[] },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.evidenceSubmission.count({ where }),
      this.prisma.evidenceSubmission.findMany({
        where,
        include: {
          screenshot: { include: { task: { include: { campaign: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
    ]);

    const dupByHash = await this.duplicateCounts(
      rows.map((r) => r.screenshot.sha256),
    );

    const items: VerificationQueueItem[] = rows.map((r) => ({
      id: r.id,
      status: r.status,
      kind: r.screenshot.kind,
      verdict: r.verdict,
      confidence: r.confidence,
      model: r.model,
      costMicroUsd: r.costMicroUsd,
      taskId: r.screenshot.taskId,
      userId: r.screenshot.userId,
      campaignTitle: r.screenshot.task.campaign.title,
      duplicateCount: (dupByHash.get(r.screenshot.sha256) ?? 1) - 1,
      uploadedAt: r.screenshot.uploadedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));

    return { total, limit: query.limit, offset: query.offset, items };
  }

  /** One case in full: extraction, the expected-vs-extracted diff, task/campaign context. */
  async getOne(id: string): Promise<VerificationDetailResponse> {
    const s = await this.load(id);
    const dupByHash = await this.duplicateCounts([s.screenshot.sha256]);
    return this.toDetail(s, (dupByHash.get(s.screenshot.sha256) ?? 1) - 1);
  }

  /**
   * Stream the private screenshot bytes for a reviewer. The ONLY path that ever
   * serves the PII image; audited as SCREENSHOT_VIEW. Returns 404 if the image
   * was purged after retention (the row/hash outlive the bytes).
   */
  async streamImage(
    staffId: string,
    id: string,
  ): Promise<{ buffer: Buffer; mimetype: string; filename: string }> {
    const s = await this.load(id);
    if (s.screenshot.deletedAt !== null) {
      throw new NotFoundException('Screenshot is no longer available');
    }
    const buffer = await this.storage.readPrivate(s.screenshot.storageKey);
    await this.audit.record({
      staffUserId: staffId,
      action: AUDIT_ACTIONS.SCREENSHOT_VIEW,
      targetUserId: s.screenshot.userId,
      metadata: { submissionId: id, taskId: s.screenshot.taskId },
    });
    const ext = EXT[s.screenshot.mimetype] ?? 'bin';
    return {
      buffer,
      mimetype: s.screenshot.mimetype,
      filename: `screenshot-${id}.${ext}`,
    };
  }

  /**
   * Approve: accept the screenshot as evidence. Funnels an `ocr`-sourced fragment
   * through TaskService.applyEvidence (advancing the task), then marks the
   * submission APPROVED. If the task can't take the evidence (wrong state), the
   * apply throws a 409 and the submission is left untouched.
   *
   * `itemPaise` is an optional reviewer-confirmed figure (integer paise) for a
   * PURCHASE whose amount OCR couldn't read — without it the item price stays
   * unknown rather than defaulting to the campaign price.
   */
  async approve(
    staffId: string,
    id: string,
    reason: string | undefined,
    itemPaise?: bigint | null,
    quantity?: number | null,
  ): Promise<ReviewResultResponse> {
    const s = this.reviewable(await this.load(id));

    const fragment = evidenceFragmentFor(
      s.screenshot.kind,
      this.extractionOf(s),
      s.screenshot.task.campaign,
      s.screenshot.uploadedAt,
      {
        staffItemPaise: itemPaise ?? null,
        // The units the reviewer read off the image. This is what unblocks a refund
        // that a line total alone cannot justify.
        staffQuantity: quantity ?? null,
        // Never let OCR downgrade a public-visibility flag a higher tier set.
        reviewAlreadyPublished: s.screenshot.task.reviewPublished === true,
      },
    );
    await this.tasks.applyEvidence(
      s.screenshot.task.userId,
      s.screenshot.taskId,
      fragment,
    );

    return this.finishDecision(staffId, s, 'APPROVED', 'approve', reason);
  }

  /** Reject: no engine effect; the case is closed with a reason. */
  async reject(
    staffId: string,
    id: string,
    reason: string | undefined,
  ): Promise<ReviewResultResponse> {
    const s = this.reviewable(await this.load(id));
    return this.finishDecision(staffId, s, 'REJECTED', 'reject', reason);
  }

  /** Request more: no engine effect; the user can upload another screenshot. */
  async requestMore(
    staffId: string,
    id: string,
    reason: string | undefined,
  ): Promise<ReviewResultResponse> {
    const s = this.reviewable(await this.load(id));
    return this.finishDecision(
      staffId,
      s,
      'NEEDS_MORE',
      'request-more',
      reason,
    );
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async load(id: string): Promise<SubmissionFull> {
    const s = await this.prisma.evidenceSubmission.findUnique({
      where: { id },
      include: {
        screenshot: { include: { task: { include: { campaign: true } } } },
      },
    });
    if (!s) {
      throw new NotFoundException('Verification case not found');
    }
    return s;
  }

  /** Guard: only pending cases can be decided; a re-decision is a 409. */
  private reviewable(s: SubmissionFull): SubmissionFull {
    if (!(QUEUE_STATES as readonly string[]).includes(s.status)) {
      throw new ConflictException(`Case is already ${s.status.toLowerCase()}`);
    }
    return s;
  }

  private async finishDecision(
    staffId: string,
    s: SubmissionFull,
    status: EvidenceSubmissionStatus,
    decision: string,
    reason: string | undefined,
  ): Promise<ReviewResultResponse> {
    const now = new Date();
    const updated = await this.prisma.evidenceSubmission.update({
      where: { id: s.id },
      data: {
        status,
        reviewedByStaffId: staffId,
        reviewReason: reason ?? null,
        reviewedAt: now,
      },
    });
    await this.audit.record({
      staffUserId: staffId,
      action: AUDIT_ACTIONS.EVIDENCE_REVIEW,
      targetUserId: s.screenshot.userId,
      metadata: {
        decision,
        submissionId: s.id,
        taskId: s.screenshot.taskId,
        kind: s.screenshot.kind,
        verdict: s.verdict,
      },
    });
    return {
      id: updated.id,
      status: updated.status,
      reviewedAt: updated.reviewedAt?.toISOString() ?? null,
      reviewReason: updated.reviewReason,
    };
  }

  /** Map sha256 → how many live uploads share it (for the dup fraud signal). */
  private async duplicateCounts(
    hashes: string[],
  ): Promise<Map<string, number>> {
    if (hashes.length === 0) return new Map();
    const groups = await this.prisma.screenshotUpload.groupBy({
      by: ['sha256'],
      where: { sha256: { in: hashes }, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.sha256, g._count._all]));
  }

  private extractionOf(s: SubmissionFull): ExtractedFields | null {
    return s.extraction ? (s.extraction as unknown as ExtractedFields) : null;
  }

  private toDetail(
    s: SubmissionFull,
    duplicateCount: number,
  ): VerificationDetailResponse {
    return {
      id: s.id,
      status: s.status,
      kind: s.screenshot.kind,
      verdict: s.verdict,
      confidence: s.confidence,
      model: s.model,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      costMicroUsd: s.costMicroUsd,
      error: s.error,
      extraction: this.extractionOf(s),
      match: s.match ? (s.match as unknown as FieldMatch[]) : null,
      reviewedByStaffId: s.reviewedByStaffId,
      reviewReason: s.reviewReason,
      reviewedAt: s.reviewedAt?.toISOString() ?? null,
      task: {
        id: s.screenshot.task.id,
        state: s.screenshot.task.state,
        userId: s.screenshot.task.userId,
      },
      campaign: {
        id: s.screenshot.task.campaign.id,
        title: s.screenshot.task.campaign.title,
        productName: s.screenshot.task.campaign.productName,
        productPricePaise:
          s.screenshot.task.campaign.productPricePaise.toString(),
        minRating: s.screenshot.task.campaign.minRating,
      },
      screenshot: {
        id: s.screenshot.id,
        mimetype: s.screenshot.mimetype,
        sizeBytes: s.screenshot.sizeBytes,
        sha256: s.screenshot.sha256,
        duplicateCount,
        uploadedAt: s.screenshot.uploadedAt.toISOString(),
      },
      createdAt: s.createdAt.toISOString(),
    };
  }
}
