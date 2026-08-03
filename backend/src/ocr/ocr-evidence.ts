import type { Evidence } from '../tasks/engine/evidence.types';
import { SOURCES } from '../tasks/engine/states';
import { rupeesToPaise } from './evidence-match.service';
import type { ExtractedFields } from './vision-extraction.service';

/** The campaign facts the fragment falls back to for LABELS (never for money). */
export interface FragmentCampaign {
  productName: string;
  minRating: number | null;
}

/**
 * Approval-time context a reviewer can supply / that the task already carries.
 *   - `staffItemPaise`: a figure the reviewer confirmed off the screenshot when
 *     OCR couldn't read the amount (or to correct a misread). Overrides the OCR
 *     amount when present.
 *   - `reviewAlreadyPublished`: the task's current public-visibility flag, from a
 *     higher-tier source. OCR must never DOWNGRADE it (see the REVIEW branch).
 */
export interface ApprovalContext {
  staffItemPaise?: bigint | null;
  reviewAlreadyPublished?: boolean;
}

function safeDateMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Turn a staff-approved screenshot into an engine Evidence fragment, sourced as
 * the lowest tier (`ocr`). Built from the extracted fields, falling back to the
 * campaign's LABELS (product name) when OCR couldn't read them — but NEVER
 * falling back to the campaign PRICE as a verified figure.
 *
 * The fragment advances the task through the NORMAL pipeline yet is deliberately
 * incapable of releasing money on its own:
 *   - PURCHASE: item price comes from the confirmed staff figure, else the OCR
 *     read, else it stays UNKNOWN (null) — we never silently assert the campaign
 *     price as a verified fact. `returned` is never set, so the refund gate still
 *     blocks on return-status-unknown until a higher-tier source fills it.
 *   - DELIVERY: `at` is the upload time (a safe UPPER bound — can only lengthen
 *     the hold). The engine's authority-aware merge stops this lowest-tier date
 *     from overriding an earlier, higher-tier delivery date.
 *   - REVIEW: records product/rating but sets `published` only to what a
 *     higher-tier source already established (never fabricates true, never
 *     downgrades an existing true). A screenshot can't prove PUBLIC visibility —
 *     the payout signal — so OCR corroborates, it never asserts it.
 */
export function evidenceFragmentFor(
  kind: 'PURCHASE' | 'DELIVERY' | 'REVIEW',
  ex: ExtractedFields | null,
  campaign: FragmentCampaign,
  uploadedAt: Date,
  ctx: ApprovalContext = {},
): Evidence {
  if (kind === 'PURCHASE') {
    let itemPaise: bigint | null = null;
    let amountSource: string = SOURCES.OCR;
    if (ctx.staffItemPaise != null) {
      itemPaise = ctx.staffItemPaise;
      amountSource = 'staff-confirmed';
    } else if (ex?.amount != null) {
      itemPaise = rupeesToPaise(ex.amount);
    }
    return {
      order: {
        id: ex?.orderNumber ?? null,
        date: safeDateMs(ex?.orderDate),
        dateRaw: ex?.orderDate ?? null,
        itemPaise, // null = unknown; refund stays blocked until a real figure lands
        amountSource,
        product: ex?.productName ?? campaign.productName,
        statusText: ex?.deliveryStatus ?? null,
        source: SOURCES.OCR,
      },
    };
  }

  if (kind === 'DELIVERY') {
    return {
      delivery: {
        at: uploadedAt.getTime(),
        raw: ex?.deliveryStatus ?? null,
        source: SOURCES.OCR,
      },
    };
  }

  // REVIEW — never asserts public visibility on its own, never downgrades a
  // higher-tier one that already confirmed it.
  return {
    review: {
      reviewId: null,
      product: ex?.productName ?? campaign.productName,
      rating: ex?.rating ?? null,
      published: ctx.reviewAlreadyPublished === true,
      verified: false,
      reviewDate: safeDateMs(ex?.orderDate),
      reviewDateSource: SOURCES.OCR,
    },
  };
}
