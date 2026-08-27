import {
  LIVE_CHECK_TRUSTED_DAYS,
  LIVE_STATES,
  countByState,
  isLiveState,
  offerAvailability,
  plainStateSentence,
} from './live-page.rules';
import { checkPlainLanguage } from '../assistant/plain-language';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const daysAgo = (n: number): Date =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const availability = (
  over: Partial<Parameters<typeof offerAvailability>[0]> = {},
) =>
  offerAvailability({
    seatsLeft: null,
    liveState: null,
    liveCheckedAt: null,
    now: NOW,
    ...over,
  });

/**
 * WHEN AN OFFER IS SHOWN GREYED OUT, AND WHAT IT SAYS.
 *
 * Two completely different things can make an offer unusable, and the app has to
 * say which. Its places can all be taken, which we know from our own records. Or
 * the shop's page can have stopped working, which we only know because somebody
 * opened it this morning.
 *
 * The one thing this must never do is grey out a working offer. So a check that
 * FAILED tells us nothing and greys out nothing, and a check from last week is
 * not trusted — a shop that was out of stock on Monday is very often back by
 * Friday, and an offer hidden on week-old evidence is money nobody earns.
 */
describe('offerAvailability', () => {
  describe('when there is nothing wrong', () => {
    it('says nothing at all', () => {
      const out = availability({
        seatsLeft: 5,
        liveState: 'opened',
        liveCheckedAt: NOW,
      });
      expect(out.greyedOut).toBe(false);
      expect(out.label).toBeNull();
      expect(out.reason).toBeNull();
    });

    it('says nothing for an offer with no limit and no check', () => {
      expect(availability().greyedOut).toBe(false);
    });
  });

  describe('when the places are all taken', () => {
    it('greys it out and says so, in words', () => {
      const out = availability({ seatsLeft: 0 });
      expect(out.greyedOut).toBe(true);
      expect(out.reason).toBe('seats');
      expect(out.label).toMatch(/taken/i);
      expect(out.label).toMatch(/come back/i);
    });

    it('knows this without anybody opening a page', () => {
      // Our own records are enough for this half, so it works today.
      const out = availability({
        seatsLeft: 0,
        liveState: null,
        liveCheckedAt: null,
      });
      expect(out.greyedOut).toBe(true);
    });

    it('takes priority over a page problem, because it is the more certain one', () => {
      const out = availability({
        seatsLeft: 0,
        liveState: 'sold-out',
        liveCheckedAt: NOW,
      });
      expect(out.reason).toBe('seats');
    });
  });

  describe('when the shop page has stopped working', () => {
    it('greys out an offer whose page says it has ended', () => {
      const out = availability({ liveState: 'expired', liveCheckedAt: NOW });
      expect(out.greyedOut).toBe(true);
      expect(out.reason).toBe('page');
      expect(out.label).toMatch(/ended/i);
      expect(out.label).toMatch(/come back/i);
    });

    it('greys out one the shop has run out of', () => {
      const out = availability({ liveState: 'sold-out', liveCheckedAt: NOW });
      expect(out.greyedOut).toBe(true);
      expect(out.label).toMatch(/run out/i);
    });

    it('greys out one whose page will not open for a shopper', () => {
      const out = availability({
        liveState: 'unavailable',
        liveCheckedAt: NOW,
      });
      expect(out.greyedOut).toBe(true);
    });

    it('NEVER greys one out because OUR OWN check failed', () => {
      // "I could not open it" is a fact about us, not about the offer. Hiding a
      // working offer on that basis is money nobody earns and nobody notices.
      const out = availability({
        liveState: 'could-not-open',
        liveCheckedAt: NOW,
      });
      expect(out.greyedOut).toBe(false);
      expect(out.label).toBeNull();
    });

    it('never greys one out for having no page to open', () => {
      const out = availability({ liveState: 'no-link', liveCheckedAt: NOW });
      expect(out.greyedOut).toBe(false);
    });

    it('stops trusting a check once it is old', () => {
      const fresh = availability({
        liveState: 'sold-out',
        liveCheckedAt: daysAgo(LIVE_CHECK_TRUSTED_DAYS - 1),
      });
      const stale = availability({
        liveState: 'sold-out',
        liveCheckedAt: daysAgo(LIVE_CHECK_TRUSTED_DAYS + 1),
      });
      expect(fresh.greyedOut).toBe(true);
      // A shop out of stock on Monday is often back by Friday.
      expect(stale.greyedOut).toBe(false);
    });

    it('ignores a state with no date on it', () => {
      expect(
        availability({ liveState: 'sold-out', liveCheckedAt: null }).greyedOut,
      ).toBe(false);
    });

    it('ignores a state it has never heard of', () => {
      expect(
        availability({ liveState: 'who-knows', liveCheckedAt: NOW }).greyedOut,
      ).toBe(false);
    });
  });

  describe('what it can be handed', () => {
    it('survives every shape of nonsense', () => {
      const junk = [
        { seatsLeft: -1 },
        { seatsLeft: NaN },
        { liveState: '' },
        { liveState: null, liveCheckedAt: NOW },
        { liveCheckedAt: new Date('not a date') },
      ];
      for (const over of junk) {
        const out = availability(over as never);
        expect(typeof out.greyedOut).toBe('boolean');
        expect(out.label === null || typeof out.label === 'string').toBe(true);
        expect(JSON.stringify(out)).not.toContain('NaN');
      }
    });
  });

  describe('every label a person could read', () => {
    it('reads plainly, by the same rule the answers obey', () => {
      const labels = [
        availability({ seatsLeft: 0 }).label,
        availability({ liveState: 'expired', liveCheckedAt: NOW }).label,
        availability({ liveState: 'sold-out', liveCheckedAt: NOW }).label,
        availability({ liveState: 'unavailable', liveCheckedAt: NOW }).label,
      ];
      for (const label of labels) {
        expect(label).toBeTruthy();
        const check = checkPlainLanguage(label!, 'en');
        if (!check.ok) {
          throw new Error(
            `"${label}" breaks the plain-language rule: ` +
              check.problems.map((p) => p.detail).join(' | '),
          );
        }
      }
    });

    it('always leaves the door open, because a shop restocks', () => {
      for (const state of ['expired', 'sold-out', 'unavailable'] as const) {
        expect(
          availability({ liveState: state, liveCheckedAt: NOW }).label,
        ).toMatch(/come back/i);
      }
      expect(availability({ seatsLeft: 0 }).label).toMatch(/come back/i);
    });
  });
});

describe('plainStateSentence', () => {
  it('has words for every state a check can end in', () => {
    for (const state of LIVE_STATES) {
      const sentence = plainStateSentence(state);
      expect(sentence.length).toBeGreaterThan(10);
      expect(sentence).not.toMatch(/-|_/);
      expect(checkPlainLanguage(sentence, 'en').ok).toBe(true);
    }
  });

  it('does not invent words for a state it has never seen', () => {
    expect(plainStateSentence('nonsense')).toMatch(/not know|unknown|cannot/i);
  });
});

describe('isLiveState', () => {
  it('knows its own states and nothing else', () => {
    for (const state of LIVE_STATES) expect(isLiveState(state)).toBe(true);
    for (const junk of ['', 'OPENED', 'who-knows', null, 42]) {
      expect(isLiveState(junk)).toBe(false);
    }
  });
});

describe('countByState', () => {
  it('counts every state, including the ones with none', () => {
    const counts = countByState([
      { state: 'opened' },
      { state: 'opened' },
      { state: 'sold-out' },
      { state: 'no-link' },
    ]);
    expect(counts.opened).toBe(2);
    expect(counts['sold-out']).toBe(1);
    expect(counts['no-link']).toBe(1);
    expect(counts.expired).toBe(0);
    // Every state present as a number, so a screen never renders nothing.
    for (const state of LIVE_STATES)
      expect(typeof counts[state]).toBe('number');
  });

  it('counts an empty list as all zeros', () => {
    const counts = countByState([]);
    for (const state of LIVE_STATES) expect(counts[state]).toBe(0);
  });

  it('ignores a state it does not know rather than inventing a bucket', () => {
    const counts = countByState([{ state: 'who-knows' }, { state: 'opened' }]);
    expect(counts.opened).toBe(1);
    expect(Object.keys(counts).sort()).toEqual([...LIVE_STATES].sort());
  });
});
