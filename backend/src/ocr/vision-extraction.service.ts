import type Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import {
  ANTHROPIC_CLIENT,
  DEFAULT_RATE,
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_INSTRUCTION,
  type ImageMediaType,
  MODEL_RATES,
} from './ocr.constants';

/** The fields Claude vision pulls out of a screenshot. All nullable but confidence. */
export interface ExtractedFields {
  orderNumber: string | null;
  productName: string | null;
  /** Price paid, in the screenshot's currency main unit (e.g. rupees), or null. */
  amount: number | null;
  currency: string | null;
  /** ISO date (YYYY-MM-DD) if determinable, else null. */
  orderDate: string | null;
  deliveryStatus: string | null;
  rating: number | null;
  marketplace: string | null;
  /** 0–100 model-reported confidence in the extraction. */
  confidence: number;
  notes: string | null;
}

/**
 * The outcome of an extraction attempt. `skipped` = OCR isn't configured (no API
 * key) — the upload still succeeds and the case goes to manual review. `failed` =
 * the API/parse errored. `extracted` carries the fields + token/cost accounting.
 */
export type ExtractionOutcome =
  | {
      status: 'extracted';
      model: string;
      fields: ExtractedFields;
      tokensIn: number;
      tokensOut: number;
      costMicroUsd: number;
      escalated: boolean;
    }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Runs Claude vision over a screenshot and returns the extracted fields. This is
 * TIER-3 supporting evidence — it only reads the image; it never decides whether
 * the proof is valid (a staff member does). Designed to degrade gracefully: with
 * no ANTHROPIC_API_KEY the client is null and every call returns `skipped`, so
 * the rest of the flow (upload + manual review) works with OCR simply switched
 * off. Cheap model by default, escalating to the stronger one on low confidence.
 */
@Injectable()
export class VisionExtractionService {
  private readonly logger = new Logger(VisionExtractionService.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic | null,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Whether OCR is configured (an API key is present). */
  get enabled(): boolean {
    return this.client !== null;
  }

  /** Extractions allowed per UTC day (cost guard); enforced by the caller. */
  get dailyCap(): number {
    return this.config.get('OCR_DAILY_CAP', { infer: true });
  }

  async extract(input: {
    buffer: Buffer;
    mimetype: string;
  }): Promise<ExtractionOutcome> {
    if (!this.client) {
      return { status: 'skipped', reason: 'OCR is not configured' };
    }
    const primary = this.config.get('OCR_MODEL', { infer: true });
    const escalation = this.config.get('OCR_ESCALATION_MODEL', { infer: true });
    const threshold = this.config.get('OCR_CONFIDENCE_ESCALATE', {
      infer: true,
    });

    try {
      const first = await this.runOne(primary, input);
      // Low confidence → re-run on the stronger model and keep its result, but
      // bill the sum of both attempts.
      if (
        first.fields.confidence < threshold &&
        escalation &&
        escalation !== primary
      ) {
        const second = await this.runOne(escalation, input);
        return {
          status: 'extracted',
          model: second.model,
          fields: second.fields,
          tokensIn: first.tokensIn + second.tokensIn,
          tokensOut: first.tokensOut + second.tokensOut,
          costMicroUsd: first.costMicroUsd + second.costMicroUsd,
          escalated: true,
        };
      }
      return {
        status: 'extracted',
        model: first.model,
        fields: first.fields,
        tokensIn: first.tokensIn,
        tokensOut: first.tokensOut,
        costMicroUsd: first.costMicroUsd,
        escalated: false,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OCR extraction failed: ${reason}`);
      return { status: 'failed', reason };
    }
  }

  /** One vision call against a specific model, with cost accounting. */
  private async runOne(
    model: string,
    input: { buffer: Buffer; mimetype: string },
  ): Promise<{
    model: string;
    fields: ExtractedFields;
    tokensIn: number;
    tokensOut: number;
    costMicroUsd: number;
  }> {
    const message = await this.client!.messages.create({
      model,
      max_tokens: 1024,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimetype as ImageMediaType,
                data: input.buffer.toString('base64'),
              },
            },
            { type: 'text', text: EXTRACTION_USER_INSTRUCTION },
          ],
        },
      ],
      // Constrain the reply to our schema (GA structured outputs).
      output_config: {
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const text = message.content.find((b) => b.type === 'text')?.text ?? '';
    const fields = normalizeFields(JSON.parse(text));

    const rate = MODEL_RATES[model] ?? DEFAULT_RATE;
    const tokensIn = message.usage.input_tokens;
    const tokensOut = message.usage.output_tokens;
    const costMicroUsd = tokensIn * rate.input + tokensOut * rate.output;
    return { model, fields, tokensIn, tokensOut, costMicroUsd };
  }
}

/** Coerce the parsed JSON into ExtractedFields, clamping confidence to 0–100. */
function normalizeFields(raw: unknown): ExtractedFields {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const conf = typeof o.confidence === 'number' ? o.confidence : 0;
  return {
    orderNumber: str(o.orderNumber),
    productName: str(o.productName),
    amount: num(o.amount),
    currency: str(o.currency),
    orderDate: str(o.orderDate),
    deliveryStatus: str(o.deliveryStatus),
    rating: num(o.rating),
    marketplace: str(o.marketplace),
    confidence: Math.max(0, Math.min(100, Math.round(conf))),
    notes: str(o.notes),
  };
}
