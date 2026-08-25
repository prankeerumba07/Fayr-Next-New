import {
  EvidenceMatchService,
  type MatchExpectation,
} from './evidence-match.service';
import type { ExtractedFields } from './vision-extraction.service';

/**
 * Unit test for the matching layer — pure logic, no network/API key. Proves the
 * amount tolerance is a BAND (mirrored from the scraper: max ₹2 / 5%) so COD
 * fees / rounding / coupon drift on genuine screenshots don't false-MISMATCH,
 * that name/date/delivery/rating map to sensible verdicts, and that the blended
 * confidence reflects both the model's read and how strongly the key fields
 * agreed. Nothing here accepts evidence or moves a task — a staff member decides.
 */

const svc = new EvidenceMatchService();

const CLAIMED_AT = new Date('2026-07-01T09:00:00Z');

function fields(over: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    orderNumber: 'ORD-1',
    productName: 'boAt Airdopes 141 Bluetooth Earbuds',
    amount: 1299,
    currency: 'INR',
    orderDate: '2026-07-02',
    deliveryStatus: 'Delivered',
    rating: 5,
    marketplace: 'Amazon',
    confidence: 90,
    notes: null,
    ...over,
  };
}

function expectation(over: Partial<MatchExpectation> = {}): MatchExpectation {
  return {
    kind: 'PURCHASE',
    productName: 'boAt Airdopes 141',
    productPricePaise: 129900n, // ₹1299.00
    minRating: null,
    claimedAt: CLAIMED_AT,
    ...over,
  };
}

describe('EvidenceMatchService', () => {
  it('MATCHes a clean purchase and carries the model confidence', () => {
    const r = svc.match(fields(), expectation());
    expect(r.verdict).toBe('MATCH');
    expect(r.confidence).toBe(90); // full key agreement → model confidence
    const product = r.fields.find((f) => f.field === 'product');
    const amount = r.fields.find((f) => f.field === 'amount');
    expect(product?.matched).toBe(true);
    expect(amount?.matched).toBe(true);
  });

  it('tolerates a small COD/rounding drift within the band', () => {
    // ₹1299 expected, paid ₹1330 → off by ₹31; 5% band = ₹64.95 → still a match.
    const r = svc.match(fields({ amount: 1330 }), expectation());
    const amount = r.fields.find((f) => f.field === 'amount');
    expect(amount?.matched).toBe(true);
    expect(r.verdict).toBe('MATCH');
  });

  it('uses the ₹2 absolute floor on cheap items', () => {
    // ₹40 expected; 5% = ₹2 exactly, floor is ₹2 → paid ₹41 (off ₹1) matches,
    // paid ₹45 (off ₹5) does not.
    const exp = expectation({ productPricePaise: 4000n });
    expect(
      svc
        .match(fields({ amount: 41 }), exp)
        .fields.find((f) => f.field === 'amount')?.matched,
    ).toBe(true);
    expect(
      svc
        .match(fields({ amount: 45 }), exp)
        .fields.find((f) => f.field === 'amount')?.matched,
    ).toBe(false);
  });

  it('flags a genuinely different price as a mismatch → PARTIAL with confidence pulled down', () => {
    // ₹1299 expected, paid ₹999 → well outside the band. Name still matches.
    const r = svc.match(fields({ amount: 999 }), expectation());
    const amount = r.fields.find((f) => f.field === 'amount');
    expect(amount?.matched).toBe(false);
    expect(r.verdict).toBe('PARTIAL'); // product matched, amount didn't
    expect(r.confidence).toBe(45); // 90 * (1 of 2 key fields matched)
  });

  it('MISMATCHes when every key field disagrees', () => {
    const r = svc.match(
      fields({ productName: 'Samsung Galaxy Buds', amount: 4999 }),
      expectation(),
    );
    expect(r.verdict).toBe('MISMATCH');
    expect(r.confidence).toBe(0);
  });

  it('flags an order placed before the task was claimed', () => {
    const r = svc.match(fields({ orderDate: '2026-06-20' }), expectation());
    const date = r.fields.find((f) => f.field === 'orderDate');
    expect(date?.matched).toBe(false);
  });

  it('checks rating against the campaign minimum for a REVIEW', () => {
    const exp = expectation({ kind: 'REVIEW', minRating: 4 });
    expect(svc.match(fields({ rating: 5 }), exp).verdict).toBe('MATCH');
    const low = svc.match(fields({ rating: 3 }), exp);
    expect(low.fields.find((f) => f.field === 'rating')?.matched).toBe(false);
    expect(low.verdict).toBe('PARTIAL'); // product ok, rating below min
  });

  it('reads "Out for delivery" as NOT delivered for a DELIVERY proof', () => {
    const exp = expectation({ kind: 'DELIVERY' });
    expect(
      svc.match(fields({ deliveryStatus: 'Delivered' }), exp).verdict,
    ).toBe('MATCH');
    expect(
      svc.match(fields({ deliveryStatus: 'Out for delivery' }), exp).verdict,
    ).toBe('MISMATCH');
  });

  it('returns UNKNOWN (null confidence) when nothing key could be read', () => {
    const r = svc.match(
      fields({ productName: null, amount: null, confidence: 10 }),
      expectation(),
    );
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.confidence).toBeNull();
  });
});
