import { checkPlainLanguage } from '../assistant/plain-language';
import {
  OPEN_HOURS_BY_DEFAULT,
  hourInWords,
  isOpenInIndia,
  openHoursFrom,
  outsideHoursWords,
  whenItWasSent,
} from './when-words';

/**
 * WHEN SOMETHING WAS SAID, AND WHEN FAYR IS OPEN, WALKED.
 *
 * Same shape as chat/how-it-talks.spec.ts: every sentence goes through the real
 * plain-language check, in its own language, so a wording added later cannot
 * reach a phone without this having read it.
 *
 * EVERY MOMENT HERE IS WRITTEN AS A UNIVERSAL TIME AND CHECKED AS INDIA'S. India
 * is five and a half hours ahead, so the interesting cases are the ones that fall
 * on a different day or a different part of the day in the two places, and those
 * are the ones written down below.
 */
const LANGUAGES = ['en', 'hi', 'hi-en'] as const;

/** Half past nine in the morning in India is four in the morning universal. */
const HALF_NINE_IST = new Date('2026-09-05T04:05:00.000Z');
/** Twenty past three in the afternoon in India. */
const TWENTY_PAST_THREE_IST = new Date('2026-09-05T09:50:00.000Z');

describe('when something was said', () => {
  function everythingItSays(): [string, string, string][] {
    const out: [string, string, string][] = [];
    const say = (what: string, language: string, text: string): void => {
      out.push([what, language, text]);
    };
    const now = new Date('2026-09-05T09:50:00.000Z');
    for (const language of LANGUAGES) {
      say('today', language, whenItWasSent(TWENTY_PAST_THREE_IST, now, language));
      say('this morning', language, whenItWasSent(HALF_NINE_IST, now, language));
      say('yesterday', language,
        whenItWasSent(new Date('2026-09-04T09:50:00.000Z'), now, language));
      say('older', language,
        whenItWasSent(new Date('2026-08-26T09:50:00.000Z'), now, language));
      say('in the evening', language,
        whenItWasSent(new Date('2026-09-05T14:30:00.000Z'), now, language));
      say('outside our hours', language,
        outsideHoursWords(OPEN_HOURS_BY_DEFAULT, language));
      for (const hour of [0, 9, 12, 13, 17, 18, 23]) {
        say(`the hour ${hour}`, language, hourInWords(hour, language));
      }
    }
    return out;
  }

  it('says something for every case, in every language', () => {
    // Five kinds of stamp, the hours sentence, and seven hours, in three languages.
    expect(everythingItSays()).toHaveLength((5 + 1 + 7) * 3);
  });

  it('reads plainly, every piece, in its own language', () => {
    const bad: string[] = [];
    for (const [what, language, text] of everythingItSays()) {
      const result = checkPlainLanguage(text, language);
      if (!result.ok) {
        bad.push(`${what} (${language}): ${result.problems.map((p) => p.detail).join(' ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no long dash anywhere', () => {
    for (const [what, , text] of everythingItSays()) {
      expect({ what, hasALongDash: /--|—|–/.test(text) }).toEqual({
        what,
        hasALongDash: false,
      });
    }
  });

  describe('the words themselves', () => {
    const now = new Date('2026-09-05T09:50:00.000Z');

    it('names today and the part of the day', () => {
      expect(whenItWasSent(TWENTY_PAST_THREE_IST, now)).toBe(
        'Today at 3:20 in the afternoon',
      );
    });

    it('names this morning', () => {
      expect(whenItWasSent(HALF_NINE_IST, now)).toBe('Today at 9:35 in the morning');
    });

    it('names yesterday', () => {
      expect(whenItWasSent(new Date('2026-09-04T03:35:00.000Z'), now)).toBe(
        'Yesterday at 9:05 in the morning',
      );
    });

    it('gives the day and the month for anything older, and never the year', () => {
      const said = whenItWasSent(new Date('2026-08-26T09:50:00.000Z'), now);
      expect(said).toBe('26 August at 3:20 in the afternoon');
      expect(said).not.toContain('2026');
    });

    it('counts the day by India, not by the server', () => {
      // Half past eight in the evening universal is two in the morning in India,
      // the NEXT day. A server counting its own days would say yesterday.
      const lateHere = new Date('2026-09-04T20:30:00.000Z');
      const now2 = new Date('2026-09-05T04:00:00.000Z');
      expect(whenItWasSent(lateHere, now2)).toBe('Today at 2:00 in the morning');
    });

    it('calls midnight and noon twelve, not nought', () => {
      // Half past six in the evening universal is midnight in India.
      expect(whenItWasSent(new Date('2026-09-04T18:30:00.000Z'), new Date('2026-09-05T04:00:00.000Z')))
        .toBe('Today at 12:00 in the morning');
      expect(whenItWasSent(new Date('2026-09-05T06:30:00.000Z'), new Date('2026-09-05T09:00:00.000Z')))
        .toBe('Today at 12:00 in the afternoon');
    });

    it('always shows two figures for the minutes', () => {
      const said = whenItWasSent(new Date('2026-09-05T04:01:00.000Z'), new Date('2026-09-05T09:00:00.000Z'));
      expect(said).toBe('Today at 9:31 in the morning');
      expect(said).not.toContain(':1 ');
    });

    it('never shows a bare stored moment', () => {
      for (const [, , text] of everythingItSays()) {
        // The shape of a stored moment: a full date, and the letters that join
        // its day to its time and mark it as universal.
        expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(text).not.toMatch(/\d[TZ]/);
        expect(text).not.toMatch(/:\d{2}:\d{2}/);
      }
    });
  });
});

describe('Fayr’s hours', () => {
  it('are nine in the morning to six in the evening when nothing is set', () => {
    expect(OPEN_HOURS_BY_DEFAULT).toEqual({ fromHour: 9, toHour: 18 });
    for (const nothing of [undefined, null, '', '   ']) {
      expect(openHoursFrom(nothing)).toEqual(OPEN_HOURS_BY_DEFAULT);
    }
  });

  it('come from the one setting when it is set', () => {
    expect(openHoursFrom('10-17')).toEqual({ fromHour: 10, toHour: 17 });
    expect(openHoursFrom(' 8-20 ')).toEqual({ fromHour: 8, toHour: 20 });
    expect(openHoursFrom('0-23')).toEqual({ fromHour: 0, toHour: 23 });
  });

  describe('anything unusable falls back rather than stopping the chat', () => {
    // A mistyped opening time must never be the reason somebody cannot get an
    // answer. The env schema refuses these at boot; this is the forgiving gate.
    const unusable = [
      ['words', 'nine to six'],
      ['one hour only', '9'],
      ['three hours', '9-12-18'],
      ['an hour that is not one', '9-25'],
      ['a negative hour', '-1-18'],
      ['shutting before we open', '18-9'],
      ['open and shut at once', '9-9'],
      ['spaces inside', '9 - 18'],
      ['a colon', '9:00-18:00'],
      ['not text at all', 42],
    ] as const;
    for (const [what, value] of unusable) {
      it(`${what} gives the hours we have always had`, () => {
        expect(openHoursFrom(value as never)).toEqual(OPEN_HOURS_BY_DEFAULT);
      });
    }
  });

  it('know when we are open, counted in India', () => {
    const hours = OPEN_HOURS_BY_DEFAULT;
    // Half past three in the morning universal is nine in the morning in India.
    expect(isOpenInIndia(new Date('2026-09-05T03:30:00.000Z'), hours)).toBe(true);
    // Four in the morning universal is half past nine in India.
    expect(isOpenInIndia(new Date('2026-09-05T04:00:00.000Z'), hours)).toBe(true);
    // Twelve twenty nine universal is five fifty nine in India. Still open.
    expect(isOpenInIndia(new Date('2026-09-05T12:29:00.000Z'), hours)).toBe(true);
    // Half past twelve universal is six exactly in India. Shut.
    expect(isOpenInIndia(new Date('2026-09-05T12:30:00.000Z'), hours)).toBe(false);
    // Three in the morning universal is half past eight in India. Not yet open.
    expect(isOpenInIndia(new Date('2026-09-05T03:00:00.000Z'), hours)).toBe(false);
    // Eight in the evening universal is half past one in the morning in India.
    expect(isOpenInIndia(new Date('2026-09-05T20:00:00.000Z'), hours)).toBe(false);
  });

  it('say when we are open, and promise nothing else', () => {
    const said = outsideHoursWords(OPEN_HOURS_BY_DEFAULT);
    expect(said).toBe(
      'Fayr is open from nine in the morning to six in the evening. '
      + 'It is outside those hours now, so a person will read this when we open.',
    );
    // No promise about how long, and no hour a reply will come.
    for (const promise of ['tomorrow', 'within', 'hours of', 'usually', '24', '48']) {
      expect(said.toLowerCase()).not.toContain(promise);
    }
  });

  it('say the hours in words, so no sentence about them holds a bare number', () => {
    expect(hourInWords(9)).toBe('nine in the morning');
    expect(hourInWords(18)).toBe('six in the evening');
    expect(hourInWords(0)).toBe('twelve in the morning');
    expect(hourInWords(12)).toBe('twelve in the afternoon');
    expect(hourInWords(13)).toBe('one in the afternoon');
    expect(hourInWords(17)).toBe('five in the evening');
    expect(hourInWords(23)).toBe('eleven in the evening');
    expect(outsideHoursWords({ fromHour: 10, toHour: 17 })).toContain(
      'from ten in the morning to five in the evening',
    );
    // The sentence follows the setting, so the hours are never typed twice.
    expect(outsideHoursWords({ fromHour: 10, toHour: 17 })).not.toContain('nine');
  });
});
