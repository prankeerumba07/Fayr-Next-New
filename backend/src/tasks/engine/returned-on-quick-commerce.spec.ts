import { returnedOnThisShop } from './returned-on-quick-commerce';
import { SHOPS_THAT_CANNOT_BE_SENT_BACK } from './return-policy';

/**
 * A DELIVERED QUICK-COMMERCE ORDER IS AN ORDER THAT WILL NOT COME BACK.
 *
 * Measured on the real run of 18 September 2026: a Zepto order page never uses
 * the words return, refund or cancel, so `returned` was null, and
 * refundEligibility refuses null — "return status unknown (no readable order
 * data)". The refund would have been held for ever on a question the shop's own
 * page cannot answer.
 */
describe('whether a delivered order on a shop that cannot be sent back to went back', () => {
  /** The 18 September shape: watched, delivered, and a page that never says. */
  const theRealCase = {
    platform: 'ZEPTO', watched: true, delivered: true, saidOnThePage: null,
  };

  it('THE PAGE SAID NOTHING, AND ON THESE THREE SHOPS THAT MEANS NOT RETURNED', () => {
    for (const platform of SHOPS_THAT_CANNOT_BE_SENT_BACK) {
      expect(returnedOnThisShop({ ...theRealCase, platform })).toBe(false);
    }
    // All three, by the same one list the three hour hold reads. Naming them
    // again here would be a second list to keep in step with the first.
    expect(SHOPS_THAT_CANNOT_BE_SENT_BACK).toEqual(['ZEPTO', 'BLINKIT', 'INSTAMART']);
  });

  it('AND ON EVERY OTHER SHOP NULL GOES ON MEANING NULL', () => {
    // Amazon, Flipkart, Meesho and Myntra all run returns and all print the
    // words. A silence on one of those pages is a page we could not read, not a
    // statement that nothing came back.
    for (const platform of ['AMAZON', 'FLIPKART', 'MEESHO', 'MYNTRA', '', null, undefined]) {
      expect(returnedOnThisShop({ ...theRealCase, platform })).toBeNull();
    }
  });

  it('matched without regard to case, because both spellings reach it', () => {
    // The engine's own createTask defaults to a lower-case platform name while
    // every row out of the database is upper-case.
    for (const platform of ['zepto', 'Zepto', ' blinkit ', 'InstaMart']) {
      expect(returnedOnThisShop({ ...theRealCase, platform })).toBe(false);
    }
  });

  it('A PAGE THAT SAYS IT WENT BACK IS NEVER OVERTURNED', () => {
    // The one direction that would pay for a purchase that came back. It cannot
    // happen: a stated answer is handed straight back, whatever the shop.
    expect(returnedOnThisShop({ ...theRealCase, saidOnThePage: true })).toBe(true);
    expect(returnedOnThisShop({
      platform: 'BLINKIT', watched: true, delivered: true, saidOnThePage: true,
    })).toBe(true);
  });

  it('and a page that already said NOT returned is handed back untouched', () => {
    expect(returnedOnThisShop({ ...theRealCase, saidOnThePage: false })).toBe(false);
    expect(returnedOnThisShop({
      platform: 'AMAZON', watched: false, delivered: false, saidOnThePage: false,
    })).toBe(false);
  });

  it('NOT WATCHED IS NOT ANSWERED — the page has to be the order Fayr saw placed', () => {
    // An order picked off a list and pointed at is not a purchase Fayr watched
    // happen inside its own view, and this rule is not a licence to assume
    // things about somebody else's order history.
    expect(returnedOnThisShop({ ...theRealCase, watched: false })).toBeNull();
  });

  it('NOT DELIVERED IS NOT ANSWERED — a thing that has not arrived cannot stay', () => {
    expect(returnedOnThisShop({ ...theRealCase, delivered: false })).toBeNull();
  });

  it('every one of the four conditions is required, one at a time', () => {
    const off = [
      { platform: 'AMAZON' }, { watched: false }, { delivered: false },
    ];
    for (const one of off) {
      expect(returnedOnThisShop({ ...theRealCase, ...one })).toBeNull();
    }
    // And with none of them off, it answers.
    expect(returnedOnThisShop(theRealCase)).toBe(false);
  });

  it('answers rather than throwing when it is handed nothing at all', () => {
    // A default parameter only fills in undefined, never null. A rule about
    // somebody's refund must not throw because a caller passed nothing.
    expect(returnedOnThisShop(null as unknown as Parameters<typeof returnedOnThisShop>[0]))
      .toBeNull();
    expect(returnedOnThisShop({} as Parameters<typeof returnedOnThisShop>[0])).toBeNull();
  });
});
