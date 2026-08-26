import {
  checkCampaign,
  SEVERITY_ORDER,
  type CampaignFacts,
} from './campaign-health.rules';

/**
 * THE DAILY CHECK ON EVERY LIVE OFFER.
 *
 * What this is for: an offer that is wrong is wrong on a phone, in public, for as
 * long as nobody looks. Nobody looks every day. So something has to.
 *
 * Two rules govern the whole file, and both are about trust rather than coverage:
 *
 *   1. EVERY FINDING NAMES A CONSEQUENCE. "Category is empty" is not a finding;
 *      "the category is empty, so this offer uses the 7-day default window
 *      instead of the one its category would give it" is. A list of technically
 *      true remarks is what teaches a team to close the tab.
 *   2. WHAT CANNOT BE CHECKED IS SAID, NOT GUESSED. Whether the picture actually
 *      shows the product, and whether the price still matches the marketplace,
 *      cannot be established from anything Fayr holds. Those come back as
 *      "unchecked" with the reason — never as a pass.
 */
const BASE: CampaignFacts = {
  id: 'c1',
  title: 'Bloom Big, Get 90% Back - Chrysanthemum Flower Pot',
  productName: 'Nostrae Chrysanthemum Artificial Flower Pot',
  platform: 'BLINKIT',
  status: 'ACTIVE',
  category: 'Electronics', // a category the return-window table knows
  productPricePaise: 59900n,
  payoutPercent: 90,
  payoutCapPaise: null,
  returnWindowDays: null,
  totalSlots: 30,
  claimedCount: 2,
  terms: 'Buy within 7 days.\nWrite an honest review.',
  productUrl: null,
  imageUrl: '/uploads/campaigns/db2bdac1.png',
  image: { kind: 'local-file', exists: true, looksLikeImage: true, sharedWith: [] },
  chargedSamples: [],
};

const codes = (f: CampaignFacts): string[] =>
  checkCampaign(f).map((x) => x.code).sort();
const find = (f: CampaignFacts, code: string) =>
  checkCampaign(f).find((x) => x.code === code);

describe('checkCampaign', () => {
  describe('a healthy offer', () => {
    it('reports only what it could not check, and says why', () => {
      const found = checkCampaign(BASE);
      // Nothing is WRONG with this offer, so nothing is claimed to be.
      expect(found.filter((f) => f.severity !== 'unchecked')).toEqual([]);
      // But two things about it genuinely cannot be established, and staying
      // silent about those would read as "we checked, it's fine".
      expect(found.map((f) => f.code).sort()).toEqual([
        'picture-not-verified',
        'price-not-verified',
      ]);
      for (const f of found) {
        expect(f.detail).toBeTruthy();
        expect(f.severity).toBe('unchecked');
      }
    });

    it('says the product link is what is missing, not the picture', () => {
      // The honest reason: with no address for the product page there is nothing
      // to compare the picture against. Naming the cause is what makes the note
      // actionable instead of a shrug.
      expect(find(BASE, 'picture-not-verified')!.detail).toMatch(/product link|product page/i);
    });

    it('gives the price note the reason that actually applies', () => {
      // Two different reasons the price is unverified, and saying both when only
      // one is true is how a report stops being trusted. Without a product link
      // there is nowhere to read a price from; with a link but no orders, the
      // reason is simply that nobody has bought yet.
      const noLink = find(BASE, 'price-not-verified')!.detail;
      expect(noLink).toMatch(/product link/i);

      const withLink = find(
        { ...BASE, productUrl: 'https://example.com/p/1' },
        'price-not-verified',
      )!.detail;
      expect(withLink).toMatch(/nobody has bought|no order/i);
      expect(withLink).not.toMatch(/product link/i);
    });
  });

  describe('the picture', () => {
    it('flags an offer with no picture at all, and says what users see instead', () => {
      const f = find({ ...BASE, imageUrl: null, image: { kind: 'none' } }, 'picture-missing');
      expect(f).toBeTruthy();
      expect(f!.severity).toBe('blocking');
      expect(f!.detail).toMatch(/placeholder|pattern|no picture/i);
    });

    it('treats a blank string as no picture — it is the same thing to a user', () => {
      expect(codes({ ...BASE, imageUrl: '   ', image: { kind: 'none' } })).toContain(
        'picture-missing',
      );
    });

    it('flags a picture whose file is not on the server', () => {
      const f = find(
        { ...BASE, image: { kind: 'local-file', exists: false, looksLikeImage: false, sharedWith: [] } },
        'picture-file-missing',
      );
      expect(f!.severity).toBe('blocking');
      expect(f!.detail).toMatch(/db2bdac1/); // names the file, so it can be found
    });

    it('flags a file that is on the server but is not an image', () => {
      const f = find(
        { ...BASE, image: { kind: 'local-file', exists: true, looksLikeImage: false, sharedWith: [] } },
        'picture-not-an-image',
      );
      expect(f!.severity).toBe('blocking');
    });

    it('flags two live offers showing the same picture, and names the other one', () => {
      const f = find(
        {
          ...BASE,
          image: {
            kind: 'local-file', exists: true, looksLikeImage: true,
            sharedWith: ['Step Up in Style - Modrix Heels, 90% Back'],
          },
        },
        'picture-shared',
      );
      expect(f!.severity).toBe('attention');
      expect(f!.detail).toContain('Step Up in Style');
    });

    it('does not call a shared picture a duplicate when the other offer is the same one', () => {
      // sharedWith excludes self. An offer is not a duplicate of itself, and a
      // finding that fires on every row is a finding nobody reads.
      expect(codes(BASE)).not.toContain('picture-shared');
    });

    it('says a remotely-hosted picture was not fetched, rather than passing it', () => {
      const f = find(
        { ...BASE, imageUrl: 'https://cdn.example.com/pot.jpg', image: { kind: 'remote' } },
        'picture-not-fetched',
      );
      expect(f!.severity).toBe('unchecked');
      expect(f!.detail).toMatch(/not fetch|did not fetch|outside/i);
    });
  });

  describe('the money on the offer', () => {
    it('flags a zero cap, because it pays nothing at all', () => {
      // The trap this rule exists for: a cap field left at 0 reads as a real
      // ceiling of zero, so the refund computes to ₹0.00 and the offer looks
      // normal on every screen. Only "" means no limit.
      const f = find({ ...BASE, payoutCapPaise: 0n }, 'cap-is-zero');
      expect(f!.severity).toBe('blocking');
      expect(f!.detail).toMatch(/₹0/);
    });

    it('does NOT flag an absent cap — that is how "no limit" is stored', () => {
      expect(codes({ ...BASE, payoutCapPaise: null })).not.toContain('cap-is-zero');
    });

    it('flags a cap that makes the advertised percentage impossible', () => {
      // 90% of ₹599 is ₹539.10. A ₹200 ceiling means the headline is never paid.
      const f = find({ ...BASE, payoutCapPaise: 20000n }, 'cap-below-headline');
      expect(f!.severity).toBe('attention');
      expect(f!.detail).toMatch(/539\.10/);
      expect(f!.detail).toMatch(/200\.00/);
    });

    it('leaves a cap that never binds alone', () => {
      expect(codes({ ...BASE, payoutCapPaise: 100000n })).not.toContain('cap-below-headline');
      expect(codes({ ...BASE, payoutCapPaise: 53910n })).not.toContain('cap-below-headline');
    });

    it('flags a percentage outside 1–100', () => {
      for (const pct of [0, -5, 101, 1000]) {
        expect(codes({ ...BASE, payoutPercent: pct })).toContain('percent-out-of-range');
      }
      expect(codes({ ...BASE, payoutPercent: 100 })).not.toContain('percent-out-of-range');
      expect(codes({ ...BASE, payoutPercent: 1 })).not.toContain('percent-out-of-range');
    });

    it('flags a missing or zero price', () => {
      for (const price of [0n, -1n]) {
        const f = find({ ...BASE, productPricePaise: price }, 'price-missing');
        expect(f!.severity).toBe('blocking');
      }
    });

    it('flags a headline percentage that disagrees with the one that pays', () => {
      // THE ONE-NUMBER-TWO-ROUTES CHECK, applied to copy. The title is written by
      // hand and the payout comes from a field; when they drift the offer
      // advertises one number and pays another, and the user is right to be
      // annoyed.
      const f = find(
        { ...BASE, title: 'Bloom Big, Get 85% Back - Chrysanthemum Flower Pot' },
        'headline-percent-mismatch',
      );
      expect(f!.severity).toBe('blocking');
      expect(f!.detail).toMatch(/85/);
      expect(f!.detail).toMatch(/90/);
    });

    it('reads the headline percentage in the forms people actually write', () => {
      for (const title of ['Get 85% Back', 'get 85 % back now', '85% refund on this', 'Save 85%']) {
        expect(codes({ ...BASE, title })).toContain('headline-percent-mismatch');
      }
    });

    it('says nothing when the title carries no percentage', () => {
      for (const title of ['A Prestige 1600W induction cooktop', 'Dollar Bigboss Men Vest']) {
        expect(codes({ ...BASE, title })).not.toContain('headline-percent-mismatch');
      }
    });

    it('does not read a price or a model number as a percentage', () => {
      // "1600W" and "₹599" must not be mistaken for a payout percentage, or the
      // check cries wolf on half the catalogue.
      for (const title of ['Prestige 1600W cooktop', 'Only ₹599 today', '5-Layer Rack, 90% Back']) {
        const hits = codes({ ...BASE, title });
        if (title.includes('90%')) expect(hits).not.toContain('headline-percent-mismatch');
        else expect(hits).not.toContain('headline-percent-mismatch');
      }
    });

    it('flags a listed price that real orders disagree with', () => {
      // Uses the SAME comparison the refund gate uses, so the check cannot
      // disagree with the payout. Two of three orders paid ₹399 against a listed
      // ₹599 — the offer is stale, and every claim on it is quoting a wrong
      // maximum.
      const f = find(
        { ...BASE, chargedSamples: [39900n, 39900n, 59900n] },
        'price-disagrees-with-orders',
      );
      expect(f!.severity).toBe('attention');
      expect(f!.detail).toMatch(/2 of 3|two of three/i);
    });

    it('does not flag a single order out of line on its own', () => {
      // One person using a coupon is not a wrong offer. The rule needs a majority
      // before it says the offer is wrong, or it fires on every discount.
      expect(codes({ ...BASE, chargedSamples: [39900n, 59900n, 59900n] }))
        .not.toContain('price-disagrees-with-orders');
    });

    it('says the price is unverified when there are no orders to learn from', () => {
      expect(codes({ ...BASE, chargedSamples: [] })).toContain('price-not-verified');
      // ...and stops saying it once real orders back the figure up.
      expect(codes({ ...BASE, chargedSamples: [59900n, 59900n] }))
        .not.toContain('price-not-verified');
    });
  });

  describe('seats', () => {
    it('flags an offer that is full but still on the feed', () => {
      const f = find({ ...BASE, totalSlots: 30, claimedCount: 30 }, 'full-but-still-live');
      expect(f!.severity).toBe('blocking');
      expect(f!.detail).toMatch(/30/);
    });

    it('flags it when claims have gone past the limit', () => {
      expect(codes({ ...BASE, totalSlots: 30, claimedCount: 31 })).toContain('full-but-still-live');
    });

    it('leaves an unlimited offer alone however many have joined', () => {
      expect(codes({ ...BASE, totalSlots: null, claimedCount: 9999 }))
        .not.toContain('full-but-still-live');
    });

    it('flags a seat limit of zero or less — the offer can never be claimed', () => {
      for (const slots of [0, -3]) {
        const f = find({ ...BASE, totalSlots: slots, claimedCount: 0 }, 'no-seats-at-all');
        expect(f!.severity).toBe('blocking');
      }
    });
  });

  describe('what the offer says', () => {
    it('flags missing terms, and says which screen is blank', () => {
      const f = find({ ...BASE, terms: null }, 'terms-missing');
      expect(f!.severity).toBe('attention');
      expect(f!.detail).toMatch(/terms/i);
      expect(codes({ ...BASE, terms: '   ' })).toContain('terms-missing');
    });

    it('flags a fallback return window, whichever way it happened', () => {
      // ONE FINDING, TWO CAUSES. An empty category and a category the table does
      // not recognise produce the same consequence — refunds held for the default
      // seven days rather than the window this product should have — so they are
      // one finding whose detail says which it was. Two codes meant the same
      // problem was reported twice under different names and neither looked
      // widespread on its own.
      const empty = find({ ...BASE, category: null }, 'return-window-is-the-default');
      expect(empty!.severity).toBe('attention');
      expect(empty!.detail).toMatch(/no category/i);
      expect(empty!.detail).toMatch(/7 day/i);

      // 'Home/Decor' is a real category from the live catalogue, not an invented
      // one, and nothing in the table matches it.
      const unknown = find({ ...BASE, category: 'Home/Decor' }, 'return-window-is-the-default');
      expect(unknown!.detail).toMatch(/Home\/Decor/);
      expect(unknown!.detail).toMatch(/7 day/i);
    });

    it('says nothing when the category IS a rule, or the campaign sets its own', () => {
      expect(codes({ ...BASE, category: 'Electronics' })).not.toContain('return-window-is-the-default');
      expect(codes({ ...BASE, category: 'apparel' })).not.toContain('return-window-is-the-default');
      // An explicit window on the offer wins over the table, so there is no
      // fallback to report.
      expect(codes({ ...BASE, returnWindowDays: 10, category: null }))
        .not.toContain('return-window-is-the-default');
    });
  });

  describe('wording for a group of offers', () => {
    // A finding that lands on most of the catalogue gets shown once with a count
    // rather than repeated. When that happens the heading is read by someone
    // looking at a LIST, so "This offer has no category" is wrong — it is ten
    // offers. Any finding that can plausibly be grouped therefore carries a second
    // wording written for many, and the ones that cannot are single by nature.
    const GROUPABLE = [
      'return-window-is-the-default',
      'picture-not-verified',
      'price-not-verified',
    ];

    it('gives every groupable finding a wording written for many offers', () => {
      const all = [
        ...checkCampaign({ ...BASE, category: null }),
        ...checkCampaign(BASE),
      ];
      for (const code of GROUPABLE) {
        const f = all.find((x) => x.code === code);
        expect(f).toBeTruthy();
        expect(f!.group).toBeTruthy();
        expect(f!.group!.title.length).toBeGreaterThan(4);
        expect(f!.group!.detail.length).toBeGreaterThan(20);
      }
    });

    it('never says "this offer" in a wording meant for a list of them', () => {
      const all = [
        ...checkCampaign({ ...BASE, category: null }),
        ...checkCampaign(BASE),
      ];
      for (const f of all) {
        if (!f.group) continue;
        expect(f.group.title).not.toMatch(/this offer/i);
        expect(f.group.detail).not.toMatch(/this offer/i);
      }
    });

    it('keeps one offer\'s own figures out of a heading about many', () => {
      // The price note names the offer's own price, which is right for one offer
      // and wrong as a heading over nine of them.
      const one = checkCampaign(BASE).find((f) => f.code === 'price-not-verified')!;
      expect(one.detail).toMatch(/₹599\.00/);
      expect(one.group!.detail).not.toMatch(/₹599\.00/);
    });
  });

  describe('the shape of a finding', () => {
    it('gives every finding a code, a severity, a plain title and a detail', () => {
      const found = checkCampaign({
        ...BASE,
        imageUrl: null, image: { kind: 'none' },
        payoutCapPaise: 0n, terms: null, totalSlots: 0,
      });
      expect(found.length).toBeGreaterThan(3);
      for (const f of found) {
        expect(f.code).toMatch(/^[a-z-]+$/);
        expect(SEVERITY_ORDER).toContain(f.severity);
        expect(f.title.length).toBeGreaterThan(4);
        expect(f.detail.length).toBeGreaterThan(20);
        // Plain words: a finding is read by whoever owns the offer, not by the
        // person who wrote the rule.
        expect(f.title).not.toMatch(/null|undefined|paise|BigInt/);
        expect(f.detail).not.toMatch(/undefined|NaN|\bnull\b/);
      }
    });

    it('returns the worst first, so a long list still reads top-down', () => {
      const found = checkCampaign({
        ...BASE,
        terms: null, // attention
        imageUrl: null, image: { kind: 'none' }, // blocking
      });
      const ranks = found.map((f) => SEVERITY_ORDER.indexOf(f.severity));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });

    it('is a pure function — the same offer gives the same answer', () => {
      expect(checkCampaign(BASE)).toEqual(checkCampaign(BASE));
    });
  });
});
