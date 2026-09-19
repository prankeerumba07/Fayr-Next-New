import {
  WATCHED_ORDER_KEY_SHAPE,
  carriesOnlyTheWatchedKey,
  isAWatchedOrderKey,
  theWatchedKeyToKeep,
} from './watched-order';

/** The key off the owner's own purchase, 18 September 2026. */
const THE_REAL_KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';

describe('the order Fayr watched being placed: the rules', () => {
  describe('what a key may look like', () => {
    it('ACCEPTS THE KEY OFF THE OWNER’S REAL CONFIRMATION ADDRESS', () => {
      expect(isAWatchedOrderKey(THE_REAL_KEY)).toBe(true);
    });

    it('accepts letters, digits, dot, underscore and dash, and nothing else', () => {
      expect(isAWatchedOrderKey('ABC-123_x.y')).toBe(true);
      for (const bad of ['a/b', 'a?b', 'a b', 'a#b', 'a&b', '../x', '', 'x'.repeat(121)]) {
        expect(isAWatchedOrderKey(bad)).toBe(false);
      }
    });

    it('is the same class of characters an address part may hold', () => {
      // theOrderPage.js on the phone refuses /^[A-Za-z0-9._-]+$/ failures before
      // putting a key in a URL. This is that rule with a length on it, so the two
      // ends cannot disagree about what may be opened.
      expect(WATCHED_ORDER_KEY_SHAPE.source).toBe('^[A-Za-z0-9._-]{1,120}$');
    });

    it('refuses anything that is not a string', () => {
      for (const junk of [null, undefined, 7, {}, [], true]) {
        expect(isAWatchedOrderKey(junk)).toBe(false);
      }
    });
  });

  describe('a body that is only the key', () => {
    it('IS ONLY THE KEY when nothing the engine reads is carried', () => {
      expect(carriesOnlyTheWatchedKey({ key: 'watched-order:x', watchedOrderKey: THE_REAL_KEY }))
        .toBe(true);
    });

    it('is NOT only the key when an order, a delivery, a review, a blocker or a return rides along', () => {
      for (const extra of [
        { order: { id: 'o1', source: 'order-history' } },
        { delivery: { at: 1, source: 'order-history' } },
        { review: { published: false } },
        { blocker: 'order_unreadable' },
        { returned: false },
        { reason: 'x' },
        { probe: { a: 1 } },
      ]) {
        expect(carriesOnlyTheWatchedKey({ watchedOrderKey: THE_REAL_KEY, ...extra })).toBe(false);
      }
    });

    it('and absent and null both read as "not carried"', () => {
      expect(carriesOnlyTheWatchedKey({
        watchedOrderKey: THE_REAL_KEY, order: null, delivery: undefined, review: null,
      })).toBe(true);
    });

    it('is never "only the key" without a valid key', () => {
      expect(carriesOnlyTheWatchedKey({})).toBe(false);
      expect(carriesOnlyTheWatchedKey({ watchedOrderKey: 'a/b' })).toBe(false);
      expect(carriesOnlyTheWatchedKey(null)).toBe(false);
      expect(carriesOnlyTheWatchedKey(undefined)).toBe(false);
    });
  });

  describe('which key a task keeps', () => {
    it('THE FIRST WINS, and a second, different one is ignored', () => {
      expect(theWatchedKeyToKeep(THE_REAL_KEY, 'another-key')).toBe(THE_REAL_KEY);
    });

    it('the same key twice is one fact', () => {
      expect(theWatchedKeyToKeep(THE_REAL_KEY, THE_REAL_KEY)).toBe(THE_REAL_KEY);
    });

    it('and a task with none takes the one that arrived', () => {
      expect(theWatchedKeyToKeep(null, THE_REAL_KEY)).toBe(THE_REAL_KEY);
      expect(theWatchedKeyToKeep(undefined, THE_REAL_KEY)).toBe(THE_REAL_KEY);
      expect(theWatchedKeyToKeep('', THE_REAL_KEY)).toBe(THE_REAL_KEY);
    });
  });
});
