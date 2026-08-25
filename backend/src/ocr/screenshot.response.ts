import type { EvidenceSubmissionStatus, ScreenshotKind } from '@prisma/client';

/**
 * What the USER sees for one of their screenshots. Deliberately minimal: it
 * confirms receipt, a coarse status, and — ONLY when a staff member rejected it
 * or asked for more — the plain-language reason so the user knows what to fix or
 * re-upload. It never exposes the match verdict, per-field diff, or confidence:
 * those are staff-only (telling a user WHICH field mismatched would hand a forger
 * a feedback loop), and OCR is supporting-only anyway.
 */
export interface ScreenshotUploadResponse {
  id: string; // the EvidenceSubmission id (a client can reference it later)
  taskId: string;
  kind: ScreenshotKind;
  /** Coarse, user-safe status — internal EXTRACTED/FAILED/UPLOADED all read as pending. */
  status: 'pending_review' | 'approved' | 'rejected' | 'needs_more';
  /** Staff's plain-language reason — present ONLY for rejected / needs_more, else null. */
  reviewReason: string | null;
  reviewedAt: string | null; // ISO, when a staff member decided; null while pending
  uploadedAt: string; // ISO
}

/** Collapse the internal submission status to the coarse user-facing one. */
export function toUserStatus(
  status: EvidenceSubmissionStatus,
): ScreenshotUploadResponse['status'] {
  switch (status) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'NEEDS_MORE':
      return 'needs_more';
    // UPLOADED, EXTRACTING, EXTRACTED, FAILED — all still awaiting a human.
    default:
      return 'pending_review';
  }
}

/** The fields the user-facing mapper reads off a submission + its screenshot. */
export interface UserScreenshotSource {
  id: string;
  status: EvidenceSubmissionStatus;
  reviewReason: string | null;
  reviewedAt: Date | null;
  screenshot: { taskId: string; kind: ScreenshotKind; uploadedAt: Date };
}

/**
 * Map a submission to the user-facing shape. The staff reason is surfaced ONLY
 * for the two actionable outcomes (rejected / needs_more) — never for approved
 * or pending — so the user learns what to change without ever seeing the
 * match internals.
 */
export function toUserScreenshot(
  s: UserScreenshotSource,
): ScreenshotUploadResponse {
  const status = toUserStatus(s.status);
  const showReason = status === 'rejected' || status === 'needs_more';
  return {
    id: s.id,
    taskId: s.screenshot.taskId,
    kind: s.screenshot.kind,
    status,
    reviewReason: showReason ? (s.reviewReason ?? null) : null,
    reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    uploadedAt: s.screenshot.uploadedAt.toISOString(),
  };
}
