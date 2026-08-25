import { evidenceFragmentFor } from './ocr-evidence';
import type { ExtractedFields } from './vision-extraction.service';

/**
 * The kind→Evidence mapper is where the "never sole evidence for money" rule
 * lives: every fragment is sourced 'ocr', purchase/delivery never set `returned`
 * or review visibility, an unreadable amount stays UNKNOWN (never silently the
 * campaign price), and a REVIEW fragment never asserts public visibility on its
 * own nor downgrades a higher-tier one. Pure logic, no DB.
 */

const CAMPAIGN = { productName: 'boAt Airdopes 141', minRating: 4 };
const UPLOADED_AT = new Date('2026-07-05T12:00:00Z');

function ex(over: Partial<ExtractedFields> = {}): ExtractedFields {
  return {
    orderNumber: 'ORD-9',
    productName: 'boAt Airdopes 141 TWS',
    amount: 1250,
    currency: 'INR',
    orderDate: '2026-07-02',
    deliveryStatus: 'Delivered',
    rating: 5,
    marketplace: 'Amazon',
    confidence: 88,
    notes: null,
    ...over,
  };
}

describe('evidenceFragmentFor', () => {
  it('PURCHASE → order fragment, sourced ocr, item price from the read amount', () => {
    const e = evidenceFragmentFor('PURCHASE', ex(), CAMPAIGN, UPLOADED_AT);
    expect(e.order?.source).toBe('ocr');
    expect(e.order?.amountSource).toBe('ocr');
    expect(e.order?.itemPaise).toBe(125000n); // ₹1250 → paise
    expect(e.order?.id).toBe('ORD-9');
    expect(e.order?.date).toBe(Date.parse('2026-07-02'));
    // Never asserts return status or review visibility on its own.
    expect(e.returned).toBeUndefined();
    expect(e.review).toBeUndefined();
  });

  it('PURCHASE with NO readable amount leaves itemPaise UNKNOWN (never the campaign price)', () => {
    const e = evidenceFragmentFor(
      'PURCHASE',
      ex({ amount: null }),
      CAMPAIGN,
      UPLOADED_AT,
    );
    expect(e.order?.itemPaise).toBeNull();
    expect(e.order?.amountSource).toBe('ocr');
  });

  it('PURCHASE uses a reviewer-confirmed figure when supplied', () => {
    const e = evidenceFragmentFor(
      'PURCHASE',
      ex({ amount: null }),
      CAMPAIGN,
      UPLOADED_AT,
      { staffItemPaise: 99900n },
    );
    expect(e.order?.itemPaise).toBe(99900n);
    expect(e.order?.amountSource).toBe('staff-confirmed');
  });

  it('a reviewer-confirmed figure OVERRIDES a (mis)read OCR amount', () => {
    const e = evidenceFragmentFor(
      'PURCHASE',
      ex({ amount: 1250 }),
      CAMPAIGN,
      UPLOADED_AT,
      {
        staffItemPaise: 99900n,
      },
    );
    expect(e.order?.itemPaise).toBe(99900n);
    expect(e.order?.amountSource).toBe('staff-confirmed');
  });

  it('DELIVERY → delivery fragment at the (conservative) upload time', () => {
    const e = evidenceFragmentFor('DELIVERY', ex(), CAMPAIGN, UPLOADED_AT);
    expect(e.delivery?.source).toBe('ocr');
    expect(e.delivery?.at).toBe(UPLOADED_AT.getTime());
    expect(e.delivery?.raw).toBe('Delivered');
  });

  it('REVIEW → never asserts public visibility on its own', () => {
    const e = evidenceFragmentFor(
      'REVIEW',
      ex({ rating: 5 }),
      CAMPAIGN,
      UPLOADED_AT,
    );
    expect(e.review?.published).toBe(false); // the whole point
    expect(e.review?.rating).toBe(5);
    expect(e.review?.reviewDateSource).toBe('ocr');
    expect(e.order).toBeUndefined();
    expect(e.delivery).toBeUndefined();
  });

  it('REVIEW never DOWNGRADES a public-visibility flag a higher tier already set', () => {
    const e = evidenceFragmentFor('REVIEW', ex(), CAMPAIGN, UPLOADED_AT, {
      reviewAlreadyPublished: true,
    });
    expect(e.review?.published).toBe(true); // preserved, not downgraded
  });

  it('with no extraction (staff approving off the raw image), price stays unknown, label falls back', () => {
    const e = evidenceFragmentFor('PURCHASE', null, CAMPAIGN, UPLOADED_AT);
    expect(e.order?.itemPaise).toBeNull();
    expect(e.order?.product).toBe('boAt Airdopes 141'); // label fallback is fine
    expect(e.order?.source).toBe('ocr');
  });
});
