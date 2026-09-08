import { checkPlainLanguage } from '../../assistant/plain-language';
import { EVERY_PLATFORM_NAME } from '../../common/platform-name';
import { theHold } from './shop-visit';
import {
  clockInIndia,
  dayInIndia,
  everySentence,
  theNotice,
  yourPlaceIsHeldUntil,
} from './shop-visit-words';

/**
 * EVERY WORD ON THE POP-UP, THROUGH THE REAL RULE.
 *
 * Walked and not typed out: everySentence() calls the real builders, so a
 * sentence edited above is checked here without anybody remembering to add it.
 * That is the shape hold-and-refusal-words.spec.ts already uses, and its own
 * header says why it exists.
 */
describe('the words before somebody leaves for the shop', () => {
  it('every sentence passes Fayr own plain language rule', () => {
    for (const sentence of everySentence()) {
      const verdict = checkPlainLanguage('en', sentence);
      expect(verdict.problems.map((p) => `${sentence} :: ${p}`)).toEqual([]);
      expect(verdict.ok).toBe(true);
    }
  });

  it('and passes it for every shop name the app knows, not only Amazon', () => {
    // The sentence is built around the shop's name, so a long name is what would
    // push it past the sentence length limit, not the wording.
    for (const name of Object.values(EVERY_PLATFORM_NAME)) {
      for (const sentence of everySentence(name)) {
        expect(checkPlainLanguage('en', sentence).ok).toBe(true);
      }
    }
  });

  it('says all six things, and none of them is empty', () => {
    const sentences = everySentence();
    expect(sentences).toHaveLength(6);
    for (const s of sentences) expect(s.trim().length).toBeGreaterThan(0);
  });
});

describe('the clock time is worked out for real', () => {
  it('reads the afternoon the way somebody would say it', () => {
    // 11:15 universal is 4:45 in India, which is the owner's own example.
    expect(clockInIndia(Date.UTC(2026, 8, 8, 11, 15))).toBe('4:45 pm');
  });

  it('midnight is 12 am and noon is 12 pm, which is where a naive twelve hour prints 0', () => {
    expect(clockInIndia(Date.UTC(2026, 8, 8, 18, 30))).toBe('12:00 am');
    expect(clockInIndia(Date.UTC(2026, 8, 8, 6, 30))).toBe('12:00 pm');
  });

  it('the morning is am and the evening is pm', () => {
    expect(clockInIndia(Date.UTC(2026, 8, 8, 3, 30))).toBe('9:00 am');
    expect(clockInIndia(Date.UTC(2026, 8, 8, 15, 30))).toBe('9:00 pm');
  });

  it('and it does not move when the server is somewhere else', () => {
    // The offset is applied here rather than left to the machine's own zone, so
    // the same instant reads the same in every deployment.
    const at = Date.UTC(2026, 8, 8, 11, 15);
    const before = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      expect(clockInIndia(at)).toBe('4:45 pm');
      process.env.TZ = 'UTC';
      expect(clockInIndia(at)).toBe('4:45 pm');
    } finally {
      process.env.TZ = before;
    }
  });
});

describe('today or tomorrow is not decoration', () => {
  it('a hold inside the same Indian day says today', () => {
    const from = Date.UTC(2026, 8, 8, 6, 0); // 11:30 am in India
    const hold = theHold(from);
    expect(dayInIndia(hold.endsAt, from)).toBe('today');
    expect(yourPlaceIsHeldUntil(hold.endsAt, from)).toBe(
      'Your place is held until 1:30 pm today.',
    );
  });

  it('A HOLD STARTED LATE AT NIGHT SAYS TOMORROW, and this is the one that would lie', () => {
    // 11:30 pm in India. Two hours later is 1:30 am the NEXT day, and printing
    // "today" there is simply false.
    const from = Date.UTC(2026, 8, 8, 18, 0);
    const hold = theHold(from);
    expect(dayInIndia(hold.endsAt, from)).toBe('tomorrow');
    expect(yourPlaceIsHeldUntil(hold.endsAt, from)).toBe(
      'Your place is held until 1:30 am tomorrow.',
    );
  });

  it('and further away than tomorrow drops the word rather than guessing', () => {
    const from = Date.UTC(2026, 8, 8, 6, 0);
    const faraway = from + 5 * 24 * 60 * 60 * 1000;
    expect(dayInIndia(faraway, from)).toBeNull();
    expect(yourPlaceIsHeldUntil(faraway, from)).toBe('Your place is held until 11:30 am.');
  });

  it('every minute of a full Indian day says today or tomorrow and never nothing', () => {
    // A TWO HOUR HOLD CAN START AT ANY MINUTE, so every minute is walked rather
    // than three examples. A null here would print a sentence with no day in it.
    const midnightIndia = Date.UTC(2026, 8, 8, 18, 30);
    let today = 0;
    let tomorrow = 0;
    for (let m = 0; m < 24 * 60; m += 1) {
      const from = midnightIndia + m * 60 * 1000;
      const word = dayInIndia(theHold(from).endsAt, from);
      expect(word).not.toBeNull();
      if (word === 'today') today += 1;
      else tomorrow += 1;
    }
    // The last two hours of the day are the ones that roll over, and 22 hours are
    // not. Asserted so a rule answering 'today' everywhere cannot pass this.
    expect(today).toBe(22 * 60);
    expect(tomorrow).toBe(2 * 60);
  });
});

describe('what gets frozen onto the task', () => {
  it('the whole thing carries every sentence the person actually read', () => {
    const from = Date.UTC(2026, 8, 8, 6, 0);
    const notice = theNotice({ shopName: 'Amazon', endsAt: theHold(from).endsAt, from });
    for (const piece of [
      notice.heading, notice.whatToDo, notice.heldUntil,
      notice.ifYouDoNot, notice.weCannotPay,
    ]) {
      expect(notice.wholeThing).toContain(piece);
    }
  });

  it('and the real time is in it, so the record is not a template', () => {
    // THE POINT OF FREEZING IT. A record that says "held until {time}" is not a
    // record of what anybody was promised.
    const from = Date.UTC(2026, 8, 8, 6, 0);
    const notice = theNotice({ shopName: 'Amazon', endsAt: theHold(from).endsAt, from });
    expect(notice.wholeThing).toContain('1:30 pm today');
    expect(notice.wholeThing).not.toContain('{');
    expect(notice.wholeThing).not.toContain('}');
  });

  it('the button is not in the frozen record, because a button is not a promise', () => {
    const from = Date.UTC(2026, 8, 8, 6, 0);
    const notice = theNotice({ shopName: 'Amazon', endsAt: theHold(from).endsAt, from });
    expect(notice.button).toBe('OK, take me to Amazon');
    expect(notice.wholeThing).not.toContain(notice.button);
  });
});
