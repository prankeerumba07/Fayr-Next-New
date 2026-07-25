import type { Campaign } from '@prisma/client';
import { toCampaignResponse } from './campaign.response';

/**
 * Pure unit test for the campaign response mapper — the one place BigInt paise
 * crosses into JSON. It must emit decimal STRINGS for money (JSON has no BigInt)
 * and ISO strings for dates.
 */
const baseCampaign: Campaign = {
  id: 'c1',
  platform: 'AMAZON',
  status: 'ACTIVE',
  title: 'Review the boAt Rockerz',
  productName: 'boAt Rockerz 255 Pro+',
  category: 'electronics',
  productPricePaise: 129900n,
  payoutPercent: 100,
  payoutCapPaise: null,
  ticketCost: 5,
  returnWindowDays: null,
  minRating: 4,
  totalSlots: 50,
  asin: 'B08TV2P5QL',
  productUrl: 'https://www.amazon.in/dp/B08TV2P5QL',
  imageUrl: null,
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-07-02T11:30:00.000Z'),
};

describe('toCampaignResponse', () => {
  it('serializes BigInt paise as decimal strings', () => {
    const res = toCampaignResponse({
      ...baseCampaign,
      productPricePaise: 129900n,
      payoutCapPaise: 60000n,
    });
    expect(res.productPricePaise).toBe('129900');
    expect(res.payoutCapPaise).toBe('60000');
    expect(typeof res.productPricePaise).toBe('string');
  });

  it('keeps a null payout cap as null (not the string "null")', () => {
    const res = toCampaignResponse(baseCampaign);
    expect(res.payoutCapPaise).toBeNull();
  });

  it('emits ISO date strings', () => {
    const res = toCampaignResponse(baseCampaign);
    expect(res.createdAt).toBe('2026-07-01T10:00:00.000Z');
    expect(res.updatedAt).toBe('2026-07-02T11:30:00.000Z');
  });

  it('passes through the scalar fields unchanged', () => {
    const res = toCampaignResponse(baseCampaign);
    expect(res).toMatchObject({
      id: 'c1',
      platform: 'AMAZON',
      status: 'ACTIVE',
      category: 'electronics',
      payoutPercent: 100,
      ticketCost: 5,
      minRating: 4,
      totalSlots: 50,
      asin: 'B08TV2P5QL',
    });
  });

  it('produces an object with no BigInt values (JSON-safe)', () => {
    const res = toCampaignResponse({ ...baseCampaign, payoutCapPaise: 60000n });
    // JSON.stringify throws on a stray BigInt — this asserts we left none.
    expect(() => JSON.stringify(res)).not.toThrow();
  });
});
