import { NO_READER, orderFeedFor, rankOf, type FeedReader, type Rankable } from './feed-order';

const c = (platform: string, category: string | null): Rankable => ({ platform, category });

const reader: FeedReader = {
  connected: ['AMAZON'],
  categories: ['Home & Kitchen'],
};

describe('rankOf', () => {
  it('puts their shop AND their category first', () => {
    expect(rankOf(c('AMAZON', 'Home & Kitchen'), reader)).toBe(0);
  });

  it('ranks their connected shop above their chosen category', () => {
    // Deliberate: a campaign on a shop they have not connected is a dead end,
    // however well the category fits.
    const theirShop = rankOf(c('AMAZON', 'Electronics'), reader);
    const theirCategory = rankOf(c('FLIPKART', 'Home & Kitchen'), reader);
    expect(theirShop).toBeLessThan(theirCategory);
  });

  it('puts everything else last', () => {
    expect(rankOf(c('FLIPKART', 'Electronics'), reader)).toBe(3);
  });

  it('does not care about case or stray spaces on either side', () => {
    expect(rankOf(c('amazon', ' home & kitchen '), reader)).toBe(0);
  });

  it('treats a campaign with no category as simply not matching one', () => {
    expect(rankOf(c('AMAZON', null), reader)).toBe(1);
    expect(rankOf(c('FLIPKART', null), reader)).toBe(3);
  });

  it('gives every campaign the same rank for a reader we know nothing about', () => {
    expect(rankOf(c('AMAZON', 'Home & Kitchen'), NO_READER)).toBe(3);
    expect(rankOf(c('FLIPKART', null), NO_READER)).toBe(3);
  });
});

describe('orderFeedFor', () => {
  const feed = [
    c('FLIPKART', 'Electronics'),
    c('AMAZON', 'Electronics'),
    c('FLIPKART', 'Home & Kitchen'),
    c('AMAZON', 'Home & Kitchen'),
  ];

  it('sorts best-fit first', () => {
    const out = orderFeedFor(feed, reader);
    expect(out.map((x) => `${x.platform}/${x.category}`)).toEqual([
      'AMAZON/Home & Kitchen',
      'AMAZON/Electronics',
      'FLIPKART/Home & Kitchen',
      'FLIPKART/Electronics',
    ]);
  });

  it('KEEPS the incoming order within one rank, which is rule 3', () => {
    // The caller hands them over newest-first, so a stable sort IS the
    // newest-first tie-break. Nothing else implements it.
    const two = [c('AMAZON', 'A'), c('AMAZON', 'B'), c('AMAZON', 'C')];
    expect(orderFeedFor(two, reader).map((x) => x.category)).toEqual(['A', 'B', 'C']);
  });

  it('NEVER drops a campaign, however badly it fits', () => {
    // The failure this guards against is an empty feed for a new person, which
    // reads as a broken app rather than as a well-targeted one.
    expect(orderFeedFor(feed, NO_READER)).toHaveLength(feed.length);
    expect(orderFeedFor(feed, reader)).toHaveLength(feed.length);
  });

  it('leaves the array it was given alone', () => {
    const original = [...feed];
    orderFeedFor(feed, reader);
    expect(feed).toEqual(original);
  });

  it('survives an empty feed', () => {
    expect(orderFeedFor([], reader)).toEqual([]);
  });
});
