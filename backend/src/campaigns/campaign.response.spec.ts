import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Campaign } from '@prisma/client';
import { toCampaignResponse } from './campaign.response';

/**
 * Pure unit test for the campaign response mapper — the one place BigInt paise
 * crosses into JSON. It must emit decimal STRINGS for money (JSON has no BigInt)
 * and ISO strings for dates.
 */
/** The operator's claim window, passed in rather than known here. */
const CLAIM_WINDOW = 7;

const baseCampaign: Campaign = {
  id: 'c1',
  platform: 'AMAZON',
  status: 'ACTIVE',
  title: 'Review the boAt Rockerz',
  productName: 'boAt Rockerz 255 Pro+',
  category: 'electronics',
  terms: null,
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
    const res = toCampaignResponse(
      {
        ...baseCampaign,
        productPricePaise: 129900n,
        payoutCapPaise: 60000n,
      },
      CLAIM_WINDOW,
    );
    expect(res.productPricePaise).toBe('129900');
    expect(res.payoutCapPaise).toBe('60000');
    expect(typeof res.productPricePaise).toBe('string');
  });

  it('keeps a null payout cap as null (not the string "null")', () => {
    const res = toCampaignResponse(baseCampaign, CLAIM_WINDOW);
    expect(res.payoutCapPaise).toBeNull();
  });

  it('emits ISO date strings', () => {
    const res = toCampaignResponse(baseCampaign, CLAIM_WINDOW);
    expect(res.createdAt).toBe('2026-07-01T10:00:00.000Z');
    expect(res.updatedAt).toBe('2026-07-02T11:30:00.000Z');
  });

  it('passes through the scalar fields unchanged', () => {
    const res = toCampaignResponse(baseCampaign, CLAIM_WINDOW);
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

  it('passes campaign terms through, and keeps a missing one null', () => {
    expect(toCampaignResponse(baseCampaign, CLAIM_WINDOW).terms).toBeNull();
    expect(
      toCampaignResponse(
        { ...baseCampaign, terms: 'One entry per user.' },
        CLAIM_WINDOW,
      )
        .terms,
    ).toBe('One entry per user.');
  });

  it('produces an object with no BigInt values (JSON-safe)', () => {
    const res = toCampaignResponse(
      { ...baseCampaign, payoutCapPaise: 60000n },
      CLAIM_WINDOW,
    );
    // JSON.stringify throws on a stray BigInt — this asserts we left none.
    expect(() => JSON.stringify(res)).not.toThrow();
  });
});

describe('the claim window on a campaign', () => {
  it('carries how long the buyer has, because the screen cannot know it', () => {
    // The design's confirmation screen states a deadline BEFORE the claim exists
    // ("buy the product within N of joining"). Until now the client had no way to
    // know N: claimExpiresAt only appears on a task, which is to say only AFTER
    // the user has already committed 5 tickets. So the screen either stayed silent
    // about the deadline or invented one.
    expect(toCampaignResponse(baseCampaign, 7).claimWindowDays).toBe(7);
    expect(toCampaignResponse(baseCampaign, 2).claimWindowDays).toBe(2);
  });

  it('is never handed to .map bare — that would pass the array INDEX', () => {
    // Found by making the parameter required: `rows.map(toCampaignResponse)` still
    // COMPILES, because Array.map calls back with (item, index, array). The first
    // campaign would report a 0-day claim window, the second 1 day, and nothing
    // would fail. Every call site names its argument explicitly.
    const dir = __dirname;
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
    // Comments stripped first: both call sites carry a comment explaining the
    // trap by NAMING the bare form, and matching the prose would teach whoever
    // hits this to delete the warning rather than the bug.
    const offenders = files.filter((f) => {
      const code = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return /\.map\(\s*toCampaignResponse\s*\)/.test(code);
    });
    expect(offenders).toEqual([]);
    // And the shape of the trap, proven rather than asserted: mapping bare would
    // hand over an index.
    const asMapper = [baseCampaign, baseCampaign].map((c, i) =>
      toCampaignResponse(c, i),
    );
    expect(asMapper[0].claimWindowDays).toBe(0);
    expect(asMapper[1].claimWindowDays).toBe(1);
  });

  it('is passed IN, never defaulted here', () => {
    // The window is one operator setting (CLAIM_TTL_DAYS) and the claim itself
    // computes claimExpiresAt from it. A fallback in this mapper would be a second
    // number claiming to be the same policy — and the two would drift silently the
    // first time the setting changed. Required parameter, no default: the type
    // system refuses a call site that does not supply it.
    const src = readFileSync(join(__dirname, 'campaign.response.ts'), 'utf8');
    expect(src).toMatch(/claimWindowDays:\s*number\b/);
    expect(src).not.toMatch(/claimWindowDays\s*[:=][^;\n]*\?\?/);
    expect(src).not.toMatch(/claimWindowDays\s*=\s*\d/);
  });
});
