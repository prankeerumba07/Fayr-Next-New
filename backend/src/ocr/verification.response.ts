import type {
  EvidenceSubmissionStatus,
  EvidenceVerdict,
  ScreenshotKind,
} from '@prisma/client';
import type { FieldMatch } from './evidence-match.service';
import type { ExtractedFields } from './vision-extraction.service';

/**
 * One row in the staff review queue — enough to triage without opening the case.
 * `duplicateCount` is the fraud signal: how many OTHER live uploads share this
 * screenshot's exact bytes (same sha256) — a reused image across users/tasks.
 */
export interface VerificationQueueItem {
  id: string; // EvidenceSubmission id
  status: EvidenceSubmissionStatus;
  kind: ScreenshotKind;
  verdict: EvidenceVerdict | null;
  confidence: number | null;
  model: string | null;
  costMicroUsd: number | null;
  taskId: string;
  userId: string;
  campaignTitle: string;
  duplicateCount: number;
  uploadedAt: string;
  createdAt: string;
}

export interface VerificationQueueResponse {
  total: number;
  limit: number;
  offset: number;
  items: VerificationQueueItem[];
}

/** The full case a reviewer sees: extraction, the expected-vs-extracted diff, context. */
export interface VerificationDetailResponse {
  id: string;
  status: EvidenceSubmissionStatus;
  kind: ScreenshotKind;
  verdict: EvidenceVerdict | null;
  confidence: number | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costMicroUsd: number | null;
  error: string | null;
  /** The raw fields Claude vision read (null if extraction didn't run/failed). */
  extraction: ExtractedFields | null;
  /** Per-field expected-vs-extracted diff (null until extraction+match ran). */
  match: FieldMatch[] | null;
  reviewedByStaffId: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  task: {
    id: string;
    state: string;
    userId: string;
  };
  campaign: {
    id: string;
    title: string;
    productName: string;
    productPricePaise: string; // paise as a decimal string (money on the wire)
    minRating: number | null;
  };
  screenshot: {
    id: string;
    mimetype: string;
    sizeBytes: number;
    sha256: string;
    duplicateCount: number;
    uploadedAt: string;
  };
  createdAt: string;
}

/** The result of an approve/reject/request-more action. */
export interface ReviewResultResponse {
  id: string;
  status: EvidenceSubmissionStatus;
  reviewedAt: string | null;
  reviewReason: string | null;
}
