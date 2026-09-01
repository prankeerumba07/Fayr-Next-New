import type { EvidenceSubmissionStatus, ScreenshotKind } from '@prisma/client';
import {
  compareToOwnOrder,
  type ExtractedForComparison,
  type OwnOrderForComparison,
  type UserFieldRow,
} from './order-comparison';

/**
 * What the USER sees for one of their screenshots. It confirms receipt, a coarse
 * status, and — ONLY when a staff member rejected it or asked for more — the
 * plain-language reason so the user knows what to fix or re-upload.
 *
 * IT STILL NEVER EXPOSES THE STAFF MATCH. The verdict, the confidence and
 * EvidenceMatchService's per-field notes are staff-only, because that comparison is
 * against the CAMPAIGN and its notes print Fayr's own tolerances out loud — telling
 * the person being checked which field failed against which band would hand a
 * forger a feedback loop.
 *
 * WHAT IT DOES NOW EXPOSE, ADDED 1 SEPTEMBER 2026 on the owner's instruction, is a
 * different comparison: the user's own screenshot against the user's own order,
 * field by field, exactly, with both values shown. Both sides are the person's own
 * data and there is no tolerance in it, so it leaks nothing about how Fayr judges
 * evidence. See src/ocr/order-comparison.ts, which explains at length why the two
 * comparisons are separate and must stay separate.
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
  /**
   * The user's own screenshot against the user's own order, field by field.
   *
   * Null until there is something to compare — a fresh upload has not been read
   * yet, and a screenshot of something other than an order has no order to compare
   * to. Never an empty array standing in for "nothing to say".
   */
  details: UserFieldRow[] | null;
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
  /** What Claude read off the image. Null until extraction has run. */
  extraction?: unknown;
  screenshot: { taskId: string; kind: ScreenshotKind; uploadedAt: Date };
}

/** The user's own order and their shop's name, for the field-by-field rows. */
export interface UserOrderContext {
  order: OwnOrderForComparison | null;
  platformName: string | null;
}

/**
 * The rows for one submission, or null when there is nothing honest to show.
 *
 * Only for a screenshot of an ORDER: a review screenshot has no order number and
 * no amount on it, so five rows of "we do not have this" would read as a failure
 * rather than as the wrong question. And only once the image has been read.
 */
function detailsFor(
  s: UserScreenshotSource,
  context: UserOrderContext | null,
): UserFieldRow[] | null {
  if (s.screenshot.kind !== 'PURCHASE') return null;
  const extraction = s.extraction && typeof s.extraction === 'object'
    ? (s.extraction as ExtractedForComparison)
    : null;
  if (extraction == null) return null;
  return compareToOwnOrder(
    extraction,
    context ? context.order : null,
    context ? context.platformName : null,
  );
}

/**
 * Map a submission to the user-facing shape. The staff reason is surfaced ONLY
 * for the two actionable outcomes (rejected / needs_more) — never for approved
 * or pending — so the user learns what to change without ever seeing the
 * match internals.
 */
export function toUserScreenshot(
  s: UserScreenshotSource,
  context: UserOrderContext | null = null,
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
    details: detailsFor(s, context),
  };
}
