import {
  CLAIM_TO_TAP_SETTING,
  HOURS_TO_COME_BACK,
  THE_HOLD_MS,
  THE_THREE_NUMBERS,
  asOrderWindowVerdict,
  cameBackInTime,
  checkOrderAgainstTheVisit,
  mayTapBuy,
  theHold,
} from './shop-visit';

/**
 * THE TWO CLOCKS, AND EVERY EDGE THE OWNER ASKED FOR BY NAME.
 *
 * He listed six: tapping at 29 minutes, tapping at 31, coming back at 1 hour 59,
 * coming back at 2 hours 1 minute, an order placed 5 minutes before the tap, and
 * two taps by the same person on the same task. Five of those are decisions this
 * pure file makes and they are checked here by those names. The sixth is about a
 * row in a database rather than a number, so it is checked where the row is
 * written, in the end to end walk.
 *
 * EVERY INSTANT HERE IS BUILT FROM ONE ANCHOR and none of them is the real clock.
 * A suite pinned to a fixed calendar date passes until the calendar walks past it,
 * which happened to chat-hours-and-time.e2e-spec.ts on 7 September and cost two
 * failing checks that had nothing wrong with them.
 */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** The moment somebody claimed the offer. Everything below is relative to it. */
const CLAIMED = Date.UTC(2026, 8, 8, 6, 0, 0);
/** Their thirty minute deadline to tap Buy, as the claim itself would set it. */
const TAP_DEADLINE = CLAIMED + 30 * MINUTE;

describe('the three numbers', () => {
  it('names the thirty minutes rather than keeping a second copy of it', () => {
    // A LITERAL 30 IN THIS FILE WOULD BE THE DEFECT. The operator's own setting is
    // the authority and this file only names it, so the two cannot disagree.
    expect(CLAIM_TO_TAP_SETTING).toBe('CLAIM_TTL_MINUTES');
    expect(THE_THREE_NUMBERS.claimToTapSetting).toBe('CLAIM_TTL_MINUTES');
  });

  it('holds the place for two hours, and says so in one number', () => {
    expect(HOURS_TO_COME_BACK).toBe(2);
    expect(THE_HOLD_MS).toBe(2 * HOUR);
    expect(THE_THREE_NUMBERS.hoursToComeBack).toBe(2);
  });

  it('and the order own window IS the hold, not a third number', () => {
    // The whole reason the third thing is not its own setting: one number doing
    // two jobs cannot drift against itself.
    expect(THE_THREE_NUMBERS.theOrderMustBeInsideTheHold).toBe(true);
    const hold = theHold(CLAIMED);
    expect(hold.endsAt - hold.tappedAt).toBe(THE_HOLD_MS);
  });
});

describe('may they tap Buy', () => {
  it('TAPPING AT 29 MINUTES IS IN TIME', () => {
    expect(mayTapBuy({ claimExpiresAt: TAP_DEADLINE, now: CLAIMED + 29 * MINUTE }))
      .toBe('ok');
  });

  it('and thirty minutes exactly is in time, because somebody will land on it', () => {
    expect(mayTapBuy({ claimExpiresAt: TAP_DEADLINE, now: TAP_DEADLINE })).toBe('ok');
  });

  it('TAPPING AT 31 MINUTES IS TOO LATE', () => {
    expect(mayTapBuy({ claimExpiresAt: TAP_DEADLINE, now: CLAIMED + 31 * MINUTE }))
      .toBe('the-thirty-minutes-ran-out');
  });

  it('and one millisecond past the deadline is already too late', () => {
    expect(mayTapBuy({ claimExpiresAt: TAP_DEADLINE, now: TAP_DEADLINE + 1 }))
      .toBe('the-thirty-minutes-ran-out');
  });

  it('a task with no deadline is not refused, because it predates the deadline', () => {
    expect(mayTapBuy({ claimExpiresAt: null, now: CLAIMED + 400 * HOUR })).toBe('ok');
    expect(mayTapBuy({ claimExpiresAt: undefined, now: CLAIMED })).toBe('ok');
  });
});

describe('did they come back in time', () => {
  const TAPPED = CLAIMED + 10 * MINUTE;
  const hold = theHold(TAPPED);

  it('COMING BACK AT 1 HOUR 59 MINUTES IS IN TIME', () => {
    expect(cameBackInTime({ hold, now: TAPPED + 1 * HOUR + 59 * MINUTE })).toBe('ok');
  });

  it('and two hours exactly is in time', () => {
    expect(cameBackInTime({ hold, now: hold.endsAt })).toBe('ok');
  });

  it('COMING BACK AT 2 HOURS 1 MINUTE IS OVER', () => {
    expect(cameBackInTime({ hold, now: TAPPED + 2 * HOUR + 1 * MINUTE }))
      .toBe('the-two-hours-ran-out');
  });

  it('and one millisecond past the hold is already over', () => {
    expect(cameBackInTime({ hold, now: hold.endsAt + 1 })).toBe('the-two-hours-ran-out');
  });

  it('somebody who never went is told that, and not that their time ran out', () => {
    // A DIFFERENT ANSWER ON PURPOSE. Telling somebody their two hours are up when
    // they never started them is a lie about their own history.
    expect(cameBackInTime({ hold: null, now: TAPPED })).toBe('never-went');
    expect(cameBackInTime({ hold: undefined, now: TAPPED })).toBe('never-went');
  });
});

describe('was the order placed inside the hold', () => {
  const TAPPED = CLAIMED + 10 * MINUTE;
  const hold = theHold(TAPPED);

  it('AN ORDER PLACED 5 MINUTES BEFORE THE TAP IS REFUSED', () => {
    // The owner's own edge. It is not a near miss: the campaign cannot have caused
    // a purchase that already existed when he tapped.
    expect(checkOrderAgainstTheVisit(TAPPED - 5 * MINUTE, hold)).toBe('before-the-tap');
  });

  it('and one millisecond before the tap is refused too', () => {
    expect(checkOrderAgainstTheVisit(TAPPED - 1, hold)).toBe('before-the-tap');
  });

  it('the tap own instant qualifies, and so does the last instant of the hold', () => {
    expect(checkOrderAgainstTheVisit(TAPPED, hold)).toBe('ok');
    expect(checkOrderAgainstTheVisit(hold.endsAt, hold)).toBe('ok');
  });

  it('an order in the middle of the hold qualifies', () => {
    expect(checkOrderAgainstTheVisit(TAPPED + 45 * MINUTE, hold)).toBe('ok');
  });

  it('an order placed after the hold is refused', () => {
    expect(checkOrderAgainstTheVisit(hold.endsAt + 1, hold)).toBe('after-the-hold');
    expect(checkOrderAgainstTheVisit(TAPPED + 3 * HOUR, hold)).toBe('after-the-hold');
  });

  it('A DATE WE COULD NOT READ IS NOT A REFUSAL', () => {
    // Blinkit and Instamart routinely print no date this app can read. Refusing on
    // absence would throw away real evidence from real purchases, so it holds.
    expect(checkOrderAgainstTheVisit(null, hold)).toBe('unknown');
    expect(checkOrderAgainstTheVisit(undefined, hold)).toBe('unknown');
    expect(checkOrderAgainstTheVisit(Number.NaN, hold)).toBe('unknown');
  });

  it('and with no recorded tap there is nothing to measure against', () => {
    expect(checkOrderAgainstTheVisit(CLAIMED, null)).toBe('unknown');
  });

  it('the two refusals speak the older rule own vocabulary, not a second one', () => {
    // order-window.ts already refuses both directions and its wording has been
    // through the plain language walk. Mapping onto it beats a second vocabulary.
    expect(asOrderWindowVerdict('before-the-tap')).toBe('before-claim');
    expect(asOrderWindowVerdict('after-the-hold')).toBe('after-deadline');
    expect(asOrderWindowVerdict('ok')).toBeNull();
    expect(asOrderWindowVerdict('unknown')).toBeNull();
  });
});

describe('the whole span, walked minute by minute', () => {
  it('every minute of a three hour span answers the way the rules say', () => {
    // NOT A LIST OF CASES BUT THE WHOLE SPAN, so a boundary moved by one
    // millisecond cannot hide between two hand-picked examples.
    const TAPPED = CLAIMED;
    const hold = theHold(TAPPED);
    let inside = 0;
    let outside = 0;
    for (let m = -30; m <= 180; m += 1) {
      const at = TAPPED + m * MINUTE;
      const order = checkOrderAgainstTheVisit(at, hold);
      const person = cameBackInTime({ hold, now: at });
      if (m < 0) {
        expect(order).toBe('before-the-tap');
        outside += 1;
      } else if (m <= HOURS_TO_COME_BACK * 60) {
        expect(order).toBe('ok');
        expect(person).toBe('ok');
        inside += 1;
      } else {
        expect(order).toBe('after-the-hold');
        expect(person).toBe('the-two-hours-ran-out');
        outside += 1;
      }
    }
    // The counts are asserted so a rule that answered 'ok' everywhere, or a loop
    // that never ran, cannot pass this as though it had walked the span.
    expect(inside).toBe(121);
    expect(outside).toBe(90);
  });
});
