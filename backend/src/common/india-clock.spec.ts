import {
  clockFromText, dayInIndiaOf, instantInIndia, INDIA_OFFSET_MS,
} from './india-clock';

/**
 * INDIA'S CLOCK, CHECKED AGAINST ARITHMETIC AND NOT AGAINST ITSELF.
 *
 * Every instant below is written out as "the time on the page minus five and a
 * half hours". A check that re-ran the conversion to work out what it expected
 * would pass with the offset applied the wrong way round, which is a five and a
 * half hour error in the direction that releases somebody's money early.
 */
describe('reading the time of day off an Indian shop’s own page', () => {
  it('the offset is five and a half hours, stated as a number and not derived', () => {
    expect(INDIA_OFFSET_MS).toBe(19_800_000);
    expect(INDIA_OFFSET_MS).toBe(5.5 * 60 * 60 * 1000);
  });

  describe('the clock face', () => {
    it('reads the three shapes the measured pages print', () => {
      expect(clockFromText(', 9:02 PM')).toEqual({ hours: 21, minutes: 2 });
      expect(clockFromText(', 5:32 PM')).toEqual({ hours: 17, minutes: 32 });
      expect(clockFromText(', 6:09 AM')).toEqual({ hours: 6, minutes: 9 });
    });

    it('takes the comma or no comma, either case, and a full stopped am', () => {
      expect(clockFromText(' 8:04 pm')).toEqual({ hours: 20, minutes: 4 });
      expect(clockFromText(',8:04PM')).toEqual({ hours: 20, minutes: 4 });
      expect(clockFromText(', 8:04 p.m.')).toEqual({ hours: 20, minutes: 4 });
    });

    it('MIDNIGHT IS 12 AM AND NOON IS 12 PM', () => {
      // The one place a naive twelve hour conversion is wrong twice over: it
      // makes midnight noon and noon midnight.
      expect(clockFromText(', 12:00 AM')).toEqual({ hours: 0, minutes: 0 });
      expect(clockFromText(', 12:00 PM')).toEqual({ hours: 12, minutes: 0 });
      expect(clockFromText(', 12:59 AM')).toEqual({ hours: 0, minutes: 59 });
    });

    it('IS ANCHORED AT THE FRONT, so a number further along is never a time', () => {
      // The whole risk of reading a time at all: a price, a quantity or half an
      // order number turning into the moment somebody is paid.
      expect(clockFromText('Total Bill 9:02 PM')).toBeNull();
      expect(clockFromText(' the order arrived 9:02 PM')).toBeNull();
    });

    it('REFUSES ANYTHING IT HAS NOT BEEN SHOWN, and null costs nothing', () => {
      for (const junk of [
        '', ' ', ', 17:32', ', 9:02', ', 9.02 PM', ', 0:15 pm', ', 13:40 pm',
        ', 9:60 pm', ', 149', ', 1 unit', null, undefined, 42 as unknown as string,
      ]) {
        expect(clockFromText(junk as string)).toBeNull();
      }
    });
  });

  describe('the instant', () => {
    it('THE THREE MEASURED ARRIVALS, each one written out as the subtraction', () => {
      // 21:02 in India on 25 August is 21:02 - 5:30 = 15:32 universal, same day.
      expect(instantInIndia('2026-08-25', { hours: 21, minutes: 2 }))
        .toBe(Date.UTC(2026, 7, 25, 15, 32));
      // 17:32 - 5:30 = 12:02, same day.
      expect(instantInIndia('2026-07-21', { hours: 17, minutes: 32 }))
        .toBe(Date.UTC(2026, 6, 21, 12, 2));
      // 06:09 - 5:30 = 00:39, same day. This is the one the six hour skew
      // allowance was refusing when the instant was the day at noon.
      expect(instantInIndia('2026-08-23', { hours: 6, minutes: 9 }))
        .toBe(Date.UTC(2026, 7, 23, 0, 39));
    });

    it('AND IT GOES BACKWARDS OVER MIDNIGHT, not forwards', () => {
      // Half past midnight in India is the PREVIOUS universal day. Applying the
      // offset the other way round would put it eleven hours out.
      expect(instantInIndia('2026-08-25', { hours: 0, minutes: 30 }))
        .toBe(Date.UTC(2026, 7, 24, 19, 0));
    });

    it('refuses a day that is not a day, and a clock that is not a clock', () => {
      expect(instantInIndia('25 Aug 2026', { hours: 9, minutes: 0 })).toBeNull();
      expect(instantInIndia('2026-08-25', null)).toBeNull();
      expect(instantInIndia(null, { hours: 9, minutes: 0 })).toBeNull();
      expect(instantInIndia(undefined, undefined)).toBeNull();
    });
  });

  describe('the day an instant falls on, in India', () => {
    it('IS THE DAY THE PAGE PRINTED, even when universal time says otherwise', () => {
      // 19:00 universal on 24 August is half past midnight on the 25th in India,
      // and the page said the 25th. A record that says the 24th contradicts the
      // page it was read off.
      expect(dayInIndiaOf(Date.UTC(2026, 7, 24, 19, 0))).toBe('2026-08-25');
      expect(dayInIndiaOf(Date.UTC(2026, 7, 25, 15, 32))).toBe('2026-08-25');
    });

    it('and a day-only reading is untouched, because noon is the same day either way', () => {
      // Every delivery read before this phase is an instant at noon universal,
      // which is half past five in the evening in India. Nothing moves.
      expect(dayInIndiaOf(Date.UTC(2026, 5, 5, 12, 0))).toBe('2026-06-05');
      expect(dayInIndiaOf(new Date(Date.UTC(2026, 5, 5, 12, 0)))).toBe('2026-06-05');
    });

    it('says nothing about nothing', () => {
      expect(dayInIndiaOf(null)).toBeNull();
      expect(dayInIndiaOf(undefined)).toBeNull();
      expect(dayInIndiaOf(new Date('nonsense'))).toBeNull();
    });
  });
});
