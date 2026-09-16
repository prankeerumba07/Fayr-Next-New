import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { dayFromText } from './order-comparison';
import { matchReviewToCampaign } from './review-comparison';
import { parseReviewText } from './review-text';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8');

/** The owner's own review of the campaign's product, read 16 September 2026. */
const GARMENT_RACK = fixture('amazon-review-garment-rack.txt');
/** His review of something else entirely, on the same account. */
const NIKE = fixture('amazon-review-nike-shoes.txt');

const read = (t: string | null | undefined) => parseReviewText(t, dayFromText);

const RACK_CAMPAIGN = {
  productName: 'Lukzer Heavy-Duty Metal Garment Rack with Bottom Storage Shelf & 4 Side Hooks',
};

describe('reading one review page', () => {
  it('reads every field off the owner’s real page', () => {
    const r = read(GARMENT_RACK);
    expect(r.reviewer).toBe('prakash tamang');
    expect(r.title).toBe('Sturdy, Space Saving and Worth the Price.');
    expect(r.rating).toBe(5);
    expect(r.reviewDay).toBe('2026-06-13');
    expect(r.verifiedPurchase).toBe(true);
    expect(r.product).toContain('Lukzer');
    expect(r.body).toContain('Good quality garment rack for the price');
  });

  it('THE REVIEWER’S STAR, NEVER THE PRODUCT’S AVERAGE', () => {
    // The page states two "out of 5 stars" lines and they mean opposite things:
    // this person's 5, and the product's 3.8 across 4,607 strangers. Reading the
    // second would put a shop's average on a person's record.
    const r = read(GARMENT_RACK);
    expect(r.rating).toBe(5);
    expect(GARMENT_RACK).toContain('3.8 out of 5 stars');
  });

  it('the shop’s own words about the item are not read as the review', () => {
    // "Colour: WhiteSet name: Single Rod (MGS-001)" sits between the date and the
    // review. It is the shop describing what was bought, not anything written.
    const r = read(GARMENT_RACK);
    expect(r.body).not.toContain('Single Rod');
    expect(r.body).not.toContain('Colour');
  });

  it('and the buttons under it are not read as the review either', () => {
    const r = read(GARMENT_RACK);
    expect(r.body).not.toContain('found this helpful');
    expect(r.body).not.toContain('Report');
    expect(r.body?.endsWith('Highly satisfied with the purchase.')).toBe(true);
  });

  it('reads a second real review on the same account', () => {
    const r = read(NIKE);
    expect(r.title).toBe('Perfect fit and very comfortable.');
    expect(r.reviewDay).toBe('2026-07-20');
    expect(r.product).toBe('Nike Mens Promina Extra Wide Training Shoes');
    expect(r.verifiedPurchase).toBe(true);
  });

  it('answers nothing at all for a page that is not a review', () => {
    // A shop's home page, a sign-in wall, an empty frame. Every field absent —
    // never a zero star and never an empty title, which would both read as facts.
    for (const notAReview of ['', '   ', 'Hello, prakash\nYour Orders\nBuy Again']) {
      const r = read(notAReview);
      expect(r.product).toBeNull();
      expect(r.rating).toBeNull();
      expect(r.reviewDay).toBeNull();
      expect(r.verifiedPurchase).toBe(false);
    }
  });

  it('a page with no Verified Purchase mark says false, not true', () => {
    const without = GARMENT_RACK.replace('Verified Purchase\n', '');
    expect(read(without).verifiedPurchase).toBe(false);
    // And the rest of the page still reads, because the mark is not a gate.
    expect(read(without).product).toContain('Lukzer');
  });
});

describe('is this review the one the offer is for', () => {
  it('MATCHES the owner’s review against the campaign’s own product', () => {
    // Amazon writes "Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage
    // Shelf & 4 Side Hooks | Freestanding..." and the campaign says
    // "Lukzer Heavy-Duty Metal Garment Rack with Bottom Storage Shelf & 4 Side
    // Hooks". The punctuation differs and the shop's title is far longer.
    expect(matchReviewToCampaign(read(GARMENT_RACK), RACK_CAMPAIGN))
      .toEqual({ matches: true, reason: 'matched' });
  });

  it('REFUSES A REAL REVIEW OF SOMETHING ELSE, which is the whole point', () => {
    // The same person, the same account, a genuine verified review — of shoes.
    // Pasting this against the garment rack offer must not pay anybody.
    expect(matchReviewToCampaign(read(NIKE), RACK_CAMPAIGN))
      .toEqual({ matches: false, reason: 'product_name_not_found' });
  });

  it('tells "we could not read it" apart from "it is the wrong product"', () => {
    // One is a read that did not work; the other is a review of something else,
    // and only the second is the person's doing.
    expect(matchReviewToCampaign(read(''), RACK_CAMPAIGN).reason)
      .toBe('no_product_read');
    expect(matchReviewToCampaign(read(GARMENT_RACK), { productName: null }).reason)
      .toBe('no_campaign_product');
  });

  it('A ONE STAR REVIEW MATCHES EXACTLY AS A FIVE STAR ONE DOES', () => {
    // Fayr pays for an honest review and has no opinion about what it says. A
    // rule here about the star would be exactly that opinion, and this is the
    // check that fails if anybody ever adds one.
    const harsh = GARMENT_RACK
      .replace('5 out of 5 stars', '1 out of 5 stars')
      .replace(
        'Good quality garment rack for the price.',
        'Poor quality. It wobbled and one hook snapped in a week.',
      );
    const r = read(harsh);
    expect(r.rating).toBe(1);
    expect(matchReviewToCampaign(r, RACK_CAMPAIGN).matches).toBe(true);
  });

  it('and an unverified review still matches, because that is not this question', () => {
    // The mark is reported so a person looking at a held task can see it. It is
    // not a condition here, and the refund gate is where any such rule belongs.
    const r = read(GARMENT_RACK.replace('Verified Purchase\n', ''));
    expect(r.verifiedPurchase).toBe(false);
    expect(matchReviewToCampaign(r, RACK_CAMPAIGN).matches).toBe(true);
  });
});
