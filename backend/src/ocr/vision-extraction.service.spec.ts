import type Anthropic from '@anthropic-ai/sdk';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { VisionExtractionService } from './vision-extraction.service';

/**
 * Unit test for the vision extraction service with a MOCKED Anthropic client — no
 * network, no API key. Proves the graceful-degradation design (no client →
 * skipped), the cost accounting, the low-confidence escalation to the stronger
 * model, and failure handling. Real extraction switches on the moment a live
 * client (ANTHROPIC_API_KEY) is present; nothing here needs one.
 */

const config = {
  get: (key: string) =>
    (
      ({
        OCR_MODEL: 'claude-haiku-4-5',
        OCR_ESCALATION_MODEL: 'claude-sonnet-5',
        OCR_CONFIDENCE_ESCALATE: 70,
        OCR_DAILY_CAP: 500,
      }) as Record<string, unknown>
    )[key],
} as unknown as ConfigService<Env, true>;

function fakeMessage(
  confidence: number,
  usage: { input_tokens: number; output_tokens: number },
) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          orderNumber: 'ORD-123',
          productName: 'boAt Airdopes 141',
          amount: 1299,
          currency: 'INR',
          orderDate: '2026-07-01',
          deliveryStatus: 'Delivered',
          rating: null,
          marketplace: 'Amazon',
          confidence,
          notes: null,
        }),
      },
    ],
    usage,
  };
}

const input = { buffer: Buffer.from('img'), mimetype: 'image/png' };

describe('VisionExtractionService', () => {
  it('skips gracefully when no client is configured (no API key)', async () => {
    const svc = new VisionExtractionService(null, config);
    expect(svc.enabled).toBe(false);
    expect(svc.dailyCap).toBe(500);
    const out = await svc.extract(input);
    expect(out.status).toBe('skipped');
  });

  it('extracts on the cheap model and accounts cost (Haiku $1/$5 per MTok)', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(
        fakeMessage(90, { input_tokens: 2000, output_tokens: 300 }),
      );
    const client = { messages: { create } } as unknown as Anthropic;
    const svc = new VisionExtractionService(client, config);

    const out = await svc.extract(input);
    expect(out.status).toBe('extracted');
    if (out.status !== 'extracted') return;
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.escalated).toBe(false);
    expect(out.fields.productName).toBe('boAt Airdopes 141');
    // 2000*1 (input) + 300*5 (output) = 3500 micro-USD ($0.0035)
    expect(out.costMicroUsd).toBe(3500);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('escalates to the stronger model on low confidence, summing cost', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(
        fakeMessage(40, { input_tokens: 2000, output_tokens: 300 }),
      )
      .mockResolvedValueOnce(
        fakeMessage(88, { input_tokens: 2500, output_tokens: 320 }),
      );
    const client = { messages: { create } } as unknown as Anthropic;
    const svc = new VisionExtractionService(client, config);

    const out = await svc.extract(input);
    expect(out.status).toBe('extracted');
    if (out.status !== 'extracted') return;
    expect(out.escalated).toBe(true);
    expect(out.model).toBe('claude-sonnet-5');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].model).toBe('claude-sonnet-5');
    // Haiku 3500 + Sonnet (2500*3 + 320*15 = 12300) = 15800
    expect(out.costMicroUsd).toBe(15800);
    expect(out.tokensIn).toBe(4500);
  });

  it('returns a failed outcome when the API throws', async () => {
    const create = jest.fn().mockRejectedValue(new Error('boom'));
    const client = { messages: { create } } as unknown as Anthropic;
    const svc = new VisionExtractionService(client, config);

    const out = await svc.extract(input);
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.reason).toContain('boom');
  });
});
