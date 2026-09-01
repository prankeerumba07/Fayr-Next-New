import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Campaign } from '@prisma/client';
import { toCampaignResponse } from './campaign.response';

/**
 * Pure unit test for the campaign response mapper — the one place BigInt paise
 * crosses into JSON. It must emit decimal STRINGS for money (JSON has no BigInt)
 * and ISO strings for dates.
 */
/**
 * Everything the mapper cannot read off the row, passed in rather than known
 * here. An OBJECT, which is what makes the bare-.map trap a compile error — see
 * the test at the bottom.
 */
const CTX = { claimWindowMinutes: 30, claimedCount: 0 };

const baseCampaign: Campaign = {
  id: 'c1',
  platform: 'AMAZON',
  status: 'ACTIVE',
  title: 'Review the boAt Rockerz',
  productName: 'boAt Rockerz 255 Pro+',
  category: 'electronics',
  terms: null,
  liveState: null,
  liveCheckedAt: null,
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
      CTX,
    );
    expect(res.productPricePaise).toBe('129900');
    expect(res.payoutCapPaise).toBe('60000');
    expect(typeof res.productPricePaise).toBe('string');
  });

  it('keeps a null payout cap as null (not the string "null")', () => {
    const res = toCampaignResponse(baseCampaign, CTX);
    expect(res.payoutCapPaise).toBeNull();
  });

  it('emits ISO date strings', () => {
    const res = toCampaignResponse(baseCampaign, CTX);
    expect(res.createdAt).toBe('2026-07-01T10:00:00.000Z');
    expect(res.updatedAt).toBe('2026-07-02T11:30:00.000Z');
  });

  it('passes through the scalar fields unchanged', () => {
    const res = toCampaignResponse(baseCampaign, CTX);
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
    expect(toCampaignResponse(baseCampaign, CTX).terms).toBeNull();
    expect(
      toCampaignResponse(
        { ...baseCampaign, terms: 'One entry per user.' },
        CTX,
      )
        .terms,
    ).toBe('One entry per user.');
  });

  it('produces an object with no BigInt values (JSON-safe)', () => {
    const res = toCampaignResponse(
      { ...baseCampaign, payoutCapPaise: 60000n },
      CTX,
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
    // MINUTES since 1 September 2026: the owner asked for a thirty minute slot,
    // and the old setting could only say whole days.
    expect(
      toCampaignResponse(baseCampaign, {
        claimWindowMinutes: 30,
        claimedCount: 0,
      }).claimWindowMinutes,
    ).toBe(30);
    expect(
      toCampaignResponse(baseCampaign, {
        claimWindowMinutes: 120,
        claimedCount: 0,
      }).claimWindowMinutes,
    ).toBe(120);
  });

  it('CANNOT be handed to .map bare any more — the compiler refuses it', () => {
    // THE EIGHTH INSTANCE OF ONE-NUMBER-TWO-ROUTES, now closed structurally.
    //
    // When the context was a second positional NUMBER, `rows.map(toCampaignResponse)`
    // compiled: Array.map calls back with (item, index, array), so the first
    // campaign reported a 0-day claim deadline and the second 1 day, and nothing
    // failed. A source-grep test used to stand guard over that — which meant the
    // guard, not the compiler, was the only thing between the bug and a screen.
    //
    // The context is an object now, so an index is not assignable and the bare
    // form is a TYPE ERROR. @ts-expect-error is the assertion: if the bare form
    // ever type-checks again, this line becomes an unused-suppression error and
    // the build fails. It is checked by the compiler on every run, which a grep
    // never was.
    const rows = [baseCampaign, baseCampaign];
    // @ts-expect-error passing the mapper bare would supply the array index
    const bare = () => rows.map(toCampaignResponse);
    expect(typeof bare).toBe('function');
  });

  describe('seats', () => {
    it('reports the count it was given, not one it worked out', () => {
      const res = toCampaignResponse(baseCampaign, {
        claimWindowMinutes: 30,
        claimedCount: 1240,
      });
      expect(res.claimedCount).toBe(1240);
      // 50 slots, 1240 claimed — an operator lowered the count after the fact.
      // Never negative on a screen.
      expect(res.seatsLeft).toBe(0);
    });

    it('leaves the "0 joined" decision to the app by reporting a real zero', () => {
      // The design shows "1,240 joined" and never "0 joined", which reads as an
      // empty room rather than a new offer. The mapper's job is to state the fact;
      // suppressing it is the screen's job, the same as every other absent figure.
      const res = toCampaignResponse(baseCampaign, {
        claimWindowMinutes: 30,
        claimedCount: 0,
      });
      expect(res.claimedCount).toBe(0);
      expect(res.seatsLeft).toBe(50);
    });

    it('says nothing about seats when the campaign has no limit', () => {
      const res = toCampaignResponse(
        { ...baseCampaign, totalSlots: null },
        { claimWindowMinutes: 30, claimedCount: 300 },
      );
      expect(res.seatsLeft).toBeNull();
      // The joined count is still a fact worth having.
      expect(res.claimedCount).toBe(300);
    });

    it('computes seatsLeft through seats.ts, never by subtracting here', () => {
      // The defect avoided: `c.totalSlots - claimedCount` in this file would be a
      // second definition of a remaining seat, and the claim gate would refuse
      // seats the feed was still offering.
      const src = readFileSync(join(__dirname, 'campaign.response.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src).toMatch(/seatsLeft\(c\.totalSlots,\s*ctx\.claimedCount\)/);
      expect(src).not.toMatch(/totalSlots\s*-\s*/);
      expect(src).toMatch(/from '\.\/seats'/);
    });
  });

  it('is passed IN, never defaulted here', () => {
    // The window is one operator setting (CLAIM_TTL_MINUTES) and the claim itself
    // computes claimExpiresAt from it. A fallback in this mapper would be a second
    // number claiming to be the same policy — and the two would drift silently the
    // first time the setting changed. Required parameter, no default: the type
    // system refuses a call site that does not supply it.
    const src = readFileSync(join(__dirname, 'campaign.response.ts'), 'utf8');
    for (const field of ['claimWindowMinutes', 'claimedCount']) {
      // Declared, and never given a fallback. A default for either would be a
      // second number claiming to be the same thing: the operator's CLAIM_TTL_MINUTES
      // that the claim itself uses, and a live count of tasks.
      expect(src).toMatch(new RegExp(`${field}:\\s*number\\b`));
      expect(src).not.toMatch(new RegExp(`${field}\\s*[:=][^;\\n]*\\?\\?`));
      expect(src).not.toMatch(new RegExp(`${field}\\s*=\\s*\\d`));
    }
  });
});
