import { Injectable } from '@nestjs/common';
import {
  AMOUNT_ABS_TOLERANCE_PAISE,
  AMOUNT_PCT_TOLERANCE,
  NAME_MATCH_THRESHOLD,
} from './ocr.constants';
import type { ExtractedFields } from './vision-extraction.service';

/**
 * Screenshot kind — which stage the user is proving. Kept as a plain union so the
 * matcher stays a pure module (no Prisma import); it lines up 1:1 with the
 * ScreenshotKind enum in the schema.
 */
export type ScreenshotKind = 'PURCHASE' | 'DELIVERY' | 'REVIEW';

/** The overall verdict — mirrors the EvidenceVerdict enum in the schema. */
export type EvidenceVerdict = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';

/**
 * What the campaign/task expects, distilled to the fields the matcher compares.
 * `productPricePaise` is the campaign's expected price (integer paise); `claimedAt`
 * is when the user claimed the task (a genuine order is placed on/after it).
 */
export interface MatchExpectation {
  kind: ScreenshotKind;
  productName: string;
  productPricePaise: bigint;
  minRating: number | null;
  claimedAt: Date;
}

/** One field's verdict, shown to staff as an expected-vs-extracted diff row. */
export interface FieldMatch {
  field: 'product' | 'amount' | 'orderDate' | 'delivery' | 'rating';
  expected: string | null;
  extracted: string | null;
  /** true = matched, false = mismatched, null = couldn't compare (unverifiable). */
  matched: boolean | null;
  note: string;
}

export interface MatchResult {
  fields: FieldMatch[];
  verdict: EvidenceVerdict;
  /**
   * 0–100 blend of the model's extraction confidence with how strongly the KEY
   * fields agreed — null when nothing key could be compared (UNKNOWN). A shaky
   * read (low model confidence) or partial agreement pulls this down even on a
   * "MATCH", which is exactly the signal staff need. Never a green light on its
   * own — a staff member still decides.
   */
  confidence: number | null;
}

/** Which extracted fields drive the verdict for each kind of proof. */
const KEY_FIELDS: Record<ScreenshotKind, ReadonlyArray<FieldMatch['field']>> = {
  PURCHASE: ['product', 'amount'],
  DELIVERY: ['delivery'],
  REVIEW: ['product', 'rating'],
};

const ONE_DAY_MS = 86_400_000;

/**
 * Compares the fields Claude vision pulled off a screenshot against what the
 * campaign/task expects, producing a per-field diff, an overall verdict, and a
 * blended confidence. TIER-3 SUPPORTING logic only: it never accepts evidence or
 * moves a task — it hands staff a structured "do the details match?" so a human
 * can decide fast. Pure and dependency-free; the amount tolerance and name
 * threshold are mirrored from the scraper (see ocr.constants).
 */
@Injectable()
export class EvidenceMatchService {
  match(fields: ExtractedFields, exp: MatchExpectation): MatchResult {
    const rows: FieldMatch[] = [];

    rows.push(this.matchProduct(exp.productName, fields.productName));
    rows.push(this.matchAmount(exp.productPricePaise, fields.amount));
    rows.push(this.matchOrderDate(exp.claimedAt, fields.orderDate));

    // Delivery is a key field for DELIVERY proof; otherwise only shown when the
    // screenshot happens to carry a status (informative, not verdict-driving).
    if (exp.kind === 'DELIVERY' || fields.deliveryStatus != null) {
      rows.push(this.matchDelivery(fields.deliveryStatus));
    }
    // Rating matters for REVIEW proof, or whenever a minimum is set / one was read.
    if (
      exp.kind === 'REVIEW' ||
      exp.minRating != null ||
      fields.rating != null
    ) {
      rows.push(this.matchRating(exp.minRating, fields.rating));
    }

    const keySet = new Set(KEY_FIELDS[exp.kind]);
    const evaluated = rows.filter(
      (r) => keySet.has(r.field) && r.matched !== null,
    );

    let verdict: EvidenceVerdict;
    let confidence: number | null;
    if (evaluated.length === 0) {
      // Nothing key was legible/comparable — staff eyeball the raw screenshot.
      verdict = 'UNKNOWN';
      confidence = null;
    } else {
      const matched = evaluated.filter((r) => r.matched === true).length;
      const ratio = matched / evaluated.length;
      verdict = ratio === 1 ? 'MATCH' : ratio === 0 ? 'MISMATCH' : 'PARTIAL';
      // Blend: model confidence scaled by key-field agreement. A clean MISMATCH
      // lands at 0 (it does not corroborate the claim); staff read the verdict.
      confidence = Math.round(clampConfidence(fields.confidence) * ratio);
    }

    return { fields: rows, verdict, confidence };
  }

  private matchProduct(expected: string, extracted: string | null): FieldMatch {
    if (extracted == null) {
      return unverifiable('product', expected, null, 'no product name read');
    }
    const score = productScore(expected, extracted);
    const matched = score >= NAME_MATCH_THRESHOLD;
    return {
      field: 'product',
      expected,
      extracted,
      matched,
      note: `name overlap ${score.toFixed(2)} (≥ ${NAME_MATCH_THRESHOLD} matches)`,
    };
  }

  private matchAmount(
    expectedPaise: bigint,
    extractedRupees: number | null,
  ): FieldMatch {
    const expectedStr = formatPaise(expectedPaise);
    if (extractedRupees == null) {
      return unverifiable('amount', expectedStr, null, 'no amount read');
    }
    const paidPaise = rupeesToPaise(extractedRupees);
    if (paidPaise == null) {
      return unverifiable(
        'amount',
        expectedStr,
        String(extractedRupees),
        'amount not a usable number',
      );
    }
    // Band = max(absolute floor, percentage of expected) — mirrors src/verify.js.
    const pct = BigInt(
      Math.round(Number(expectedPaise) * AMOUNT_PCT_TOLERANCE),
    );
    const tolerance =
      pct > AMOUNT_ABS_TOLERANCE_PAISE ? pct : AMOUNT_ABS_TOLERANCE_PAISE;
    const diff =
      paidPaise > expectedPaise
        ? paidPaise - expectedPaise
        : expectedPaise - paidPaise;
    const matched = diff <= tolerance;
    return {
      field: 'amount',
      expected: expectedStr,
      extracted: formatPaise(paidPaise),
      matched,
      note: matched
        ? `within ₹${formatPaise(tolerance)} band (paid off by ₹${formatPaise(diff)})`
        : `off by ₹${formatPaise(diff)}, band is ₹${formatPaise(tolerance)}`,
    };
  }

  private matchOrderDate(
    claimedAt: Date,
    orderDate: string | null,
  ): FieldMatch {
    const claimStr = claimedAt.toISOString().slice(0, 10);
    if (orderDate == null) {
      return unverifiable(
        'orderDate',
        `on/after ${claimStr}`,
        null,
        'no date read',
      );
    }
    const orderMs = Date.parse(orderDate);
    if (Number.isNaN(orderMs)) {
      return unverifiable(
        'orderDate',
        `on/after ${claimStr}`,
        orderDate,
        'date not parseable',
      );
    }
    // A genuine order is placed AFTER the task is claimed. Compare by day, with a
    // 1-day grace so a same-day purchase in another timezone isn't false-flagged.
    const claimDayMs = Date.parse(claimStr);
    const matched = orderMs >= claimDayMs - ONE_DAY_MS;
    return {
      field: 'orderDate',
      expected: `on/after ${claimStr}`,
      extracted: orderDate,
      matched,
      note: matched
        ? 'ordered on/after the claim'
        : 'order predates the claim — suspicious',
    };
  }

  private matchDelivery(status: string | null): FieldMatch {
    if (status == null) {
      return unverifiable(
        'delivery',
        'Delivered',
        null,
        'no delivery status read',
      );
    }
    // Require the word "delivered"; "Out for delivery" / "Not delivered" don't count.
    const matched =
      /\bdelivered\b/i.test(status) && !/\bnot\s+delivered\b/i.test(status);
    return {
      field: 'delivery',
      expected: 'Delivered',
      extracted: status,
      matched,
      note: matched ? 'shows delivered' : 'not a delivered status',
    };
  }

  private matchRating(
    minRating: number | null,
    rating: number | null,
  ): FieldMatch {
    const expected = minRating != null ? `≥ ${minRating}★` : 'any rating';
    if (rating == null) {
      return unverifiable('rating', expected, null, 'no rating read');
    }
    const extracted = `${rating}★`;
    if (minRating == null) {
      return {
        field: 'rating',
        expected,
        extracted,
        matched: true,
        note: 'rating visible; no campaign minimum set',
      };
    }
    const matched = rating >= minRating;
    return {
      field: 'rating',
      expected,
      extracted,
      matched,
      note: matched
        ? `meets the ${minRating}★ minimum`
        : `below the ${minRating}★ minimum`,
    };
  }
}

function unverifiable(
  field: FieldMatch['field'],
  expected: string | null,
  extracted: string | null,
  note: string,
): FieldMatch {
  return { field, expected, extracted, matched: null, note };
}

/** 0..1 token-overlap of expected product tokens found in the candidate name.
 *  Ported verbatim from src/verify.js productScore — keep the two in step. */
export function productScore(expected: string, candidate: string): number {
  const e = norm(expected);
  const c = norm(candidate);
  if (!e || !c) return 0;
  if (c.includes(e) || e.includes(c)) return 1;
  const toks = e.split(' ').filter((w) => w.length > 2);
  if (!toks.length) return 0;
  const hits = toks.filter((w) => c.includes(w)).length;
  return hits / toks.length;
}

function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Rupees (a display number off a screenshot, ≤ 2 decimals) → integer paise.
 * ROUNDS rather than truncating: `4.35 * 100 === 434.9999…` would truncate a
 * paise short (see src/money.js), so we round to the nearest paise. Rejects
 * non-finite or negative input.
 */
export function rupeesToPaise(rupees: number): bigint | null {
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return BigInt(Math.round(rupees * 100));
}

/** Integer paise → a plain "1326.00" rupee string (display only). */
function formatPaise(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

function clampConfidence(c: number): number {
  if (!Number.isFinite(c)) return 0;
  return Math.max(0, Math.min(100, Math.round(c)));
}
