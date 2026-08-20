import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  Evidence,
  QuantityReason,
  QuantitySource,
} from '../engine/evidence.types';
import {
  QUANTITY_REASONS,
  QUANTITY_SOURCES,
} from '../engine/evidence.types';
import {
  ATTESTED_SOURCES,
  BLOCKERS,
  type BlockerName,
  type SourceName,
} from '../engine/states';

const BLOCKER_VALUES = Object.values(BLOCKERS);
/**
 * Sources a USER may claim on submitted evidence: the ATTESTED ones only — what a
 * machine read off the marketplace itself (a DKIM-signed email, or the scraper
 * reading the account's own pages on-device).
 *
 * Every ASSERTED source — `manual`, `invoice`, `ocr` — is refused here, because
 * all three are values the user chose: anyone can type "I paid ₹5,000", and a
 * doctored screenshot or PDF extracts perfectly cleanly. They are minted ONLY by
 * the staff verification approve action, so refusing them here is what makes the
 * human gate mandatory rather than merely conventional.
 *
 * This used to allow-list everything except `ocr`, which left `manual` (a source
 * that already existed) fully user-submittable — and, before the authority
 * ranking was tiered, able to overwrite genuine scraped order data outright.
 */
const SOURCE_VALUES: readonly string[] = ATTESTED_SOURCES;
/** Integer paise as a decimal string — money crosses the wire as a string. */
const PAISE = /^\d+$/;

class EvidenceReviewDto {
  @IsOptional() @IsString() reviewId?: string;
  @IsOptional() @IsString() asin?: string;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsInt() rating?: number;
  @IsBoolean() published!: boolean;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsInt() reviewDate?: number; // epoch ms
  @IsOptional() @IsString() reviewDateSource?: string;
  @IsOptional() @IsString() permalink?: string;
}

/**
 * How the order was matched to the campaign. Carried through to the refund gate:
 * an `ambiguous` or amount-rejected match cannot be released without an explicit
 * user confirmation. Bounds are deliberate — score is a ratio, and a candidate
 * count is a small integer, so anything outside those is a malformed client.
 */
class EvidenceOrderMatchDto {
  @IsOptional() @IsNumber() @Min(0) @Max(1) score?: number;
  @IsOptional() @IsBoolean() amountOk?: boolean;
  @IsOptional() @IsBoolean() ambiguous?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(10000) candidateCount?: number;
}

class EvidenceOrderDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsInt() date?: number; // epoch ms
  @IsOptional() @IsString() dateRaw?: string;
  /** @deprecated Ambiguous by history; read as a LINE TOTAL. Prefer the two below. */
  @IsOptional() @Matches(PAISE) itemPaise?: string;
  /** What ONE unit cost. When present the quantity does not matter. */
  @IsOptional() @Matches(PAISE) unitPricePaise?: string;
  /** What the whole line cost. Needs a quantity before it can pay anything. */
  @IsOptional() @Matches(PAISE) lineTotalPaise?: string;
  @IsOptional() @Matches(PAISE) orderTotalPaise?: string;
  @IsOptional() @Matches(PAISE) mrpPaise?: string;
  /**
   * Units on this line. Absent means UNKNOWN, which is never read as 1 — a line
   * total with an unknown quantity cannot pay out (see charged-amount.ts).
   * Bounded so a misread field cannot become an absurd divisor.
   */
  @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number;
  /**
   * Provenance for the quantity, from a closed list — a free-text field here
   * would let a client invent an authority it does not have.
   */
  @IsOptional() @IsIn(QUANTITY_SOURCES) quantitySource?: QuantitySource;
  /** Why no quantity was read, also from a closed list. */
  @IsOptional() @IsIn(QUANTITY_REASONS) quantityReason?: QuantityReason;
  /**
   * A count that was read but must not be computed with — see
   * EvidenceOrder.quantityObserved. Accepting it is safe precisely because
   * nothing in the refund path reads it.
   */
  @IsOptional() @IsInt() @Min(1) @Max(100) quantityObserved?: number;
  @IsOptional() @IsString() amountSource?: string;
  @IsOptional() @IsBoolean() itemAmountAmbiguous?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => EvidenceOrderMatchDto)
  match?: EvidenceOrderMatchDto;
  @IsOptional() @IsString() product?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() statusText?: string;
  @IsIn(SOURCE_VALUES) source!: string;
}

class EvidenceDeliveryDto {
  @IsInt() at!: number; // epoch ms
  @IsOptional() @IsString() raw?: string;
  @IsIn(SOURCE_VALUES) source!: string;
}

/**
 * The normalized EVIDENCE object the on-device layer submits (the output of
 * src/taskflow.js `readEvidence`). The backend validates it, converts money
 * strings → bigint, and applies it through the ported transition(). Omit
 * `returned` for "unknown"; send it only when the order's return status is known.
 */
export class SubmitEvidenceDto {
  /**
   * Idempotency key for this evidence event. Re-posting the SAME key is a no-op
   * (the engine records applied keys per task), so a re-run of an unchanged
   * check never double-advances. The on-device sync layer derives a key that is
   * a SUPERSET of the order id — it also encodes whether delivery/returned/
   * review-published are present — so a purchase-only check and a later
   * purchase+delivery check on the same order get DISTINCT keys and both apply,
   * while an identical re-fetch collapses to one. Constrained to a safe charset.
   */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9:._-]{1,200}$/) key?: string;

  @IsOptional() @IsIn(BLOCKER_VALUES) blocker?: string;
  @IsOptional() @IsString() reason?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EvidenceReviewDto)
  review?: EvidenceReviewDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EvidenceOrderDto)
  order?: EvidenceOrderDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => EvidenceDeliveryDto)
  delivery?: EvidenceDeliveryDto;

  @IsOptional() @IsBoolean() returned?: boolean;

  @IsOptional() @IsObject() probe?: Record<string, unknown>;
}

const toBig = (v: string | undefined): bigint | null =>
  v != null ? BigInt(v) : null;

/** Convert the validated DTO into the engine's Evidence (money → bigint). */
export function evidenceFromDto(dto: SubmitEvidenceDto): Evidence {
  return {
    blocker: (dto.blocker as BlockerName | undefined) ?? null,
    reason: dto.reason ?? null,
    review: dto.review
      ? {
          reviewId: dto.review.reviewId ?? null,
          asin: dto.review.asin ?? null,
          product: dto.review.product ?? null,
          rating: dto.review.rating ?? null,
          published: dto.review.published,
          verified: dto.review.verified,
          reviewDate: dto.review.reviewDate ?? null,
          reviewDateSource: dto.review.reviewDateSource ?? null,
          permalink: dto.review.permalink ?? null,
        }
      : null,
    order: dto.order
      ? {
          id: dto.order.id ?? null,
          date: dto.order.date ?? null,
          dateRaw: dto.order.dateRaw ?? null,
          itemPaise: toBig(dto.order.itemPaise),
          unitPricePaise: toBig(dto.order.unitPricePaise),
          lineTotalPaise: toBig(dto.order.lineTotalPaise),
          orderTotalPaise: toBig(dto.order.orderTotalPaise),
          mrpPaise: toBig(dto.order.mrpPaise),
          quantity: dto.order.quantity ?? null,
          quantitySource: dto.order.quantitySource ?? null,
          quantityReason: dto.order.quantityReason ?? null,
          quantityObserved: dto.order.quantityObserved ?? null,
          amountSource: dto.order.amountSource ?? null,
          itemAmountAmbiguous: dto.order.itemAmountAmbiguous,
          match: dto.order.match
            ? {
                score: dto.order.match.score ?? null,
                amountOk: dto.order.match.amountOk ?? null,
                ambiguous: dto.order.match.ambiguous === true,
                candidateCount: dto.order.match.candidateCount ?? null,
              }
            : null,
          product: dto.order.product ?? null,
          image: dto.order.image ?? null,
          statusText: dto.order.statusText ?? null,
          source: dto.order.source as SourceName,
        }
      : null,
    delivery: dto.delivery
      ? {
          at: dto.delivery.at,
          raw: dto.delivery.raw ?? null,
          source: dto.delivery.source as SourceName,
        }
      : null,
    returned: dto.returned,
    probe: dto.probe ?? null,
  };
}
