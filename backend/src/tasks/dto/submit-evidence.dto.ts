import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import type { Evidence } from '../engine/evidence.types';
import {
  BLOCKERS,
  SOURCES,
  type BlockerName,
  type SourceName,
} from '../engine/states';

const BLOCKER_VALUES = Object.values(BLOCKERS);
/**
 * Sources a USER may claim on submitted evidence — every source EXCEPT `ocr`.
 * `ocr` is the lowest tier and is minted only by the staff verification approve
 * action (a screenshot a staff member has reviewed); letting a user self-declare
 * `source: 'ocr'` here would smuggle a fragment past that mandatory human gate.
 */
const SOURCE_VALUES = Object.values(SOURCES).filter((s) => s !== SOURCES.OCR);
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

class EvidenceOrderDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsInt() date?: number; // epoch ms
  @IsOptional() @IsString() dateRaw?: string;
  @IsOptional() @Matches(PAISE) itemPaise?: string;
  @IsOptional() @Matches(PAISE) orderTotalPaise?: string;
  @IsOptional() @Matches(PAISE) mrpPaise?: string;
  @IsOptional() @IsString() amountSource?: string;
  @IsOptional() @IsBoolean() itemAmountAmbiguous?: boolean;
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
          orderTotalPaise: toBig(dto.order.orderTotalPaise),
          mrpPaise: toBig(dto.order.mrpPaise),
          amountSource: dto.order.amountSource ?? null,
          itemAmountAmbiguous: dto.order.itemAmountAmbiguous,
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
