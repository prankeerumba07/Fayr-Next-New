import { checkPlainLanguage } from '../../assistant/plain-language';
import { EVERY_PLATFORM_NAME } from '../../common/platform-name';
import { theHold } from './shop-visit';
import {
  EVERY_MESSAGE_KEY,
  buildMessage,
  everyMessageSentence,
  messageFor,
} from './journey-message';

const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 8, 8, 6, 0); // 11:30 am in India
const HOLD = theHold(NOW);

const base = {
  wentToShopAt: NOW,
  shopHoldEndsAt: HOLD.endsAt,
  shopName: 'Amazon',
  now: NOW,
};

describe('one message, two lengths', () => {
  it('THE SHORT FORM IS THE LONG FORM OWN OPENING, for every message', () => {
    // THE OWNER'S RULE MADE CHECKABLE. Not "they say similar things" but "one is
    // literally the beginning of the other", which is the only version of the
    // rule that a screen cannot drift away from.
    for (const key of EVERY_MESSAGE_KEY) {
      const m = buildMessage({
        key, shopName: 'Amazon', holdEndsAt: HOLD.endsAt, now: NOW,
      });
      expect(m.long.startsWith(m.short)).toBe(true);
      expect(m.short.length).toBeGreaterThan(0);
    }
  });

  it('and the short form is never the whole long form, or there are not two lengths', () => {
    for (const key of EVERY_MESSAGE_KEY) {
      const m = buildMessage({
        key, shopName: 'Amazon', holdEndsAt: HOLD.endsAt, now: NOW,
      });
      expect(m.long.length).toBeGreaterThan(m.short.length);
    }
  });

  it('there are four messages and no others', () => {
    expect([...EVERY_MESSAGE_KEY]).toEqual([
      'wentToShop', 'twoHoursRanOut', 'couldNotFindOrder', 'foundYourOrder',
    ]);
  });

  it('every sentence passes Fayr own plain language rule', () => {
    for (const sentence of everyMessageSentence()) {
      const verdict = checkPlainLanguage(sentence, 'en');
      expect(verdict.problems.map((p) => `${sentence} :: ${p}`)).toEqual([]);
      expect(verdict.ok).toBe(true);
    }
  });

  it('and for every shop name the app knows, not only Amazon', () => {
    for (const name of Object.values(EVERY_PLATFORM_NAME)) {
      for (const sentence of everyMessageSentence(name)) {
        expect(checkPlainLanguage(sentence, 'en').ok).toBe(true);
      }
    }
  });
});

describe('which message a task has', () => {
  it('A TASK NOBODY TOOK TO THE SHOP HAS NO MESSAGE AT ALL', () => {
    // Null is a real answer. Inventing one would put a sentence on the bar with
    // nothing behind it.
    expect(messageFor({ ...base, wentToShopAt: null })).toBeNull();
  });

  it('after the tap it says they went, and names the shop', () => {
    const m = messageFor(base);
    expect(m?.key).toBe('wentToShop');
    expect(m?.short).toBe('You went to Amazon. Tell us when you have bought it.');
  });

  it('and the long form carries the real clock time, not a placeholder', () => {
    const m = messageFor(base);
    expect(m?.long).toContain('Your place is held until 1:30 pm today.');
    expect(m?.long).not.toContain('{');
  });

  it('past the two hours it says so, and does not blame them', () => {
    const m = messageFor({ ...base, now: HOLD.endsAt + MINUTE });
    expect(m?.key).toBe('twoHoursRanOut');
    expect(m?.short).toBe('Your two hours have run out.');
    expect(m?.long).toContain('You did nothing wrong');
    // NO INSTRUCTION TO HURRY once nothing can be paid: that sentence would no
    // longer be true.
    expect(m?.long).not.toContain('Tell us when you have bought it');
  });

  it('at two hours exactly it has NOT run out, matching the clock rule', () => {
    expect(messageFor({ ...base, now: HOLD.endsAt })?.key).toBe('wentToShop');
  });

  it('a look that found nothing says so', () => {
    const m = messageFor({ ...base, lookedAndFoundNothing: true });
    expect(m?.key).toBe('couldNotFindOrder');
    expect(m?.short).toBe('We could not find your order.');
    expect(m?.long).toContain('Open Amazon');
  });

  it('A FOUND ORDER BEATS A RUNNING CLOCK, and beats one that ran out', () => {
    // Somebody whose order we already matched should be asked about it, not told
    // to hurry, and certainly not told they are too late.
    const running = messageFor({ ...base, orderWaitingToBeConfirmed: true });
    expect(running?.key).toBe('foundYourOrder');
    const expired = messageFor({
      ...base, orderWaitingToBeConfirmed: true, now: HOLD.endsAt + MINUTE,
    });
    expect(expired?.key).toBe('foundYourOrder');
  });

  it('and the clock running out beats a look that found nothing', () => {
    const m = messageFor({
      ...base, lookedAndFoundNothing: true, now: HOLD.endsAt + MINUTE,
    });
    expect(m?.key).toBe('twoHoursRanOut');
  });

  it('a tap with no recorded hold still gets a message, without a time in it', () => {
    // shopHoldEndsAt could be absent on a row written before the hold existed.
    // The message must still read correctly rather than printing an empty gap.
    const m = messageFor({ ...base, shopHoldEndsAt: null });
    expect(m?.key).toBe('wentToShop');
    expect(m?.long).not.toContain('held until');
    expect(m?.long.startsWith(m.short)).toBe(true);
  });

  it('every minute of the hold and an hour past it yields exactly one message', () => {
    // WALKED, not sampled: a priority order with a gap in it would leave some
    // minute of the journey with no message at all.
    let went = 0;
    let ranOut = 0;
    for (let m = 0; m <= 180; m += 1) {
      const msg = messageFor({ ...base, now: NOW + m * MINUTE });
      expect(msg).not.toBeNull();
      if (msg?.key === 'wentToShop') went += 1;
      else if (msg?.key === 'twoHoursRanOut') ranOut += 1;
      else throw new Error(`unexpected message at minute ${m}: ${msg?.key}`);
    }
    expect(went).toBe(121);
    expect(ranOut).toBe(60);
  });
});
