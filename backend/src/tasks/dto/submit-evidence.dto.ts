import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  Evidence,
  ItemIdReason,
  ItemIdSource,
  QuantityReason,
  QuantitySource,
} from '../engine/evidence.types';
import {
  ITEM_ID_REASONS,
  ITEM_ID_SOURCES,
  QUANTITY_REASONS,
  QUANTITY_SOURCES,
} from '../engine/evidence.types';
import {
  ATTESTED_SOURCES,
  BLOCKERS,
  type BlockerName,
  type SourceName,
} from '../engine/states';
import { WATCHED_ORDER_KEY_SHAPE } from '../engine/watched-order';

const BLOCKER_VALUES = Object.values(BLOCKERS);
/**
 * Sources a USER may claim on submitted evidence: the ATTESTED ones only — what a
 * machine read off the marketplace itself (a DKIM-signed email, or the scraper
 * reading the account's own pages on-device).
 *
 * Every ASSERTED source is refused here. Three of them — `manual`, `invoice`,
 * `ocr` — are values the user chose: anyone can type "I paid ₹5,000", and a
 * doctored screenshot or PDF extracts perfectly cleanly. They are minted ONLY by
 * the staff verification approve action, so refusing them here is what makes the
 * human gate mandatory rather than merely conventional. The fourth,
 * `staff-confirmed-visible`, is refused for a sharper reason: it OUTRANKS the
 * device's own reads on the visibility verdict, so a client able to claim it
 * could pin `published: true` where nothing could correct it.
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
  /**
   * WHO established `published`, from the ATTESTED list only.
   *
   * `staff-confirmed-visible` is deliberately not accepted here: it is asserted,
   * so the allow-list excludes it, and it can be minted only by the staff
   * eyes-on-page action. Without that exclusion a client could claim the tier
   * that outranks its own reads and pin `published: true` beyond the reach of the
   * device's own honest answer.
   *
   * Omitted means "nobody established it" — the ordinary Meesho answer, and the
   * gap the staff action is allowed to fill.
   */
  @IsOptional() @IsIn(SOURCE_VALUES) publishedSource?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
  /**
   * The review's own words, for the staff review-check queue. Bounded well above
   * the device's own cap so a legitimate snippet is never rejected, and well
   * below anything that would bloat the row — a client sending more than this is
   * malformed, not verbose.
   */
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) mediaCount?: number;
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
  /**
   * WHICH LINE of the order. Bounded in length because it is a marketplace code,
   * not prose, and it lands in an indexed column the refund gate queries.
   */
  @IsOptional() @IsString() @MaxLength(120) itemId?: string;
  /** From a closed list — a free-text source would be an invented authority. */
  @IsOptional() @IsIn(ITEM_ID_SOURCES) itemIdSource?: ItemIdSource;
  /** Why no line id was read, also from a closed list. */
  @IsOptional() @IsIn(ITEM_ID_REASONS) itemIdReason?: ItemIdReason;
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
   * See EvidenceOrder.matchedPricePaise: it is shown and never computed with.
   * Accepted from the wire on exactly those terms — no gate, no window and no
   * refund basis reads it, so the worst a wrong value can do is print a wrong
   * figure beside a product's name, where a person can see it is wrong.
   */
  @IsOptional() @Matches(PAISE) matchedPricePaise?: string;
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

  /**
   * WHY THE PRICE DIFFERED FROM THE OFFER'S — AND THE SERVER'S WORD ONLY.
   *
   * ── A VALIDATOR THAT ACCEPTS NOTHING, WHICH IS THE POINT ─────────────────
   *
   * `@Equals(undefined)` passes when the field is absent and fails when it is
   * there, whatever it says. So the server may set this shape in TypeScript —
   * chooseMine builds it and hands it straight to submitEvidence, never through
   * the pipe — and no request body can, because any body carrying one is a 400
   * before it reaches a line of code.
   *
   * ── AND NOT BY LEAVING THE DECORATOR OFF, WHICH WAS TRIED ────────────────
   *
   * MEASURED, 19 SEPTEMBER 2026. An undecorated property looks like it would do
   * the same job: the pipe runs `whitelist: true, forbidNonWhitelisted: true`
   * and builds the whitelist from the decorators, so an undeclared field is
   * refused. What actually happened is that class-transformer materialises every
   * DECLARED property on the instance — as `undefined` — and forbidNonWhitelisted
   * then refused the whole body for carrying a property it had no metadata for.
   * EVERY evidence submission with an order in it started answering 400. The
   * staff quantity suite caught it, twenty-nine tests at once.
   *
   * CHANGING THIS LINE CHANGES WHO MAY SET IT. There is a named check that pins
   * the decorator, and an end-to-end test that posts one and expects a 400.
   */
  @Equals(undefined, {
    message: 'priceGapReason is worked out by Fayr and cannot be sent',
  })
  priceGapReason?: string;
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
  /**
   * See EvidenceDelivery.returnWindowEndsAt. Accepted from the wire because it
   * can only ever LENGTHEN a hold: windowEnd takes the later of this and the
   * operator's policy table, so there is no value of it that pays sooner.
   */
  @IsOptional() @IsInt() returnWindowEndsAt?: number;
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

  /**
   * THE KEY IN THE ADDRESS OF THE ORDER THE PHONE WATCHED BEING PLACED.
   *
   * MEASURED 18 SEPTEMBER 2026: /order/status/<uuid> appeared inside Fayr one
   * second after the owner paid. This is that uuid, sent ONCE through this same
   * untrusted route, so the phone can open that one page later instead of the
   * shop's list. It is a place to look and not a fact about money: no gate reads
   * it, and it is never written into `order.id`, which is the order NUMBER the
   * duplicate-order gate compares. See engine/watched-order.ts.
   *
   * BOUNDED TO WHAT MAY BE PART OF AN ADDRESS, because that is where it ends up.
   */
  @IsOptional() @IsString() @Matches(WATCHED_ORDER_KEY_SHAPE) watchedOrderKey?: string;
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
          publishedSource:
            (dto.review.publishedSource as SourceName | undefined) ?? null,
          title: dto.review.title ?? null,
          text: dto.review.text ?? null,
          mediaCount: dto.review.mediaCount ?? null,
          verified: dto.review.verified,
          reviewDate: dto.review.reviewDate ?? null,
          reviewDateSource: dto.review.reviewDateSource ?? null,
          permalink: dto.review.permalink ?? null,
        }
      : null,
    order: dto.order
      ? {
          id: dto.order.id ?? null,
          itemId: dto.order.itemId ?? null,
          itemIdSource: dto.order.itemIdSource ?? null,
          itemIdReason: dto.order.itemIdReason ?? null,
          date: dto.order.date ?? null,
          dateRaw: dto.order.dateRaw ?? null,
          itemPaise: toBig(dto.order.itemPaise),
          unitPricePaise: toBig(dto.order.unitPricePaise),
          lineTotalPaise: toBig(dto.order.lineTotalPaise),
          orderTotalPaise: toBig(dto.order.orderTotalPaise),
          mrpPaise: toBig(dto.order.mrpPaise),
          matchedPricePaise: toBig(dto.order.matchedPricePaise),
          quantity: dto.order.quantity ?? null,
          quantitySource: dto.order.quantitySource ?? null,
          quantityReason: dto.order.quantityReason ?? null,
          quantityObserved: dto.order.quantityObserved ?? null,
          amountSource: dto.order.amountSource ?? null,
          priceGapReason: dto.order.priceGapReason ?? null,
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
          returnWindowEndsAt: dto.delivery.returnWindowEndsAt ?? null,
          source: dto.delivery.source as SourceName,
        }
      : null,
    returned: dto.returned,
    probe: dto.probe ?? null,
  };
}
