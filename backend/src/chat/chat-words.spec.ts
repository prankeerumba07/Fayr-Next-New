import { LANGUAGES } from '../assistant/language';
import { plainLanguageProblems } from '../assistant/plain-language';
import {
  LANGUAGE_CHOSEN,
  LANGUAGE_OFFER,
  STILL_WAITING,
  SUPPORT_EMAIL_PLACEHOLDER,
  WAITING_NOTE_AFTER_MS,
  greetingFor,
  handOverWords,
  isOnlyAGreeting,
  languageChoiceFrom,
  languagesWeHaveWordsFor,
  saysTheyDoNotUnderstand,
  timeOfDayInIndia,
} from './chat-words';

/** A moment, given as the time in India, turned into real time. */
const inIndia = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 7, 31, hour, minute) - 330 * 60_000);

describe('what time of day it is in India', () => {
  it('is morning before twelve noon', () => {
    for (const h of [0, 5, 9, 11]) {
      expect(timeOfDayInIndia(inIndia(h, 59))).toBe('morning');
    }
  });

  it('is afternoon from twelve until five', () => {
    for (const h of [12, 13, 16]) {
      expect(timeOfDayInIndia(inIndia(h))).toBe('afternoon');
    }
    expect(timeOfDayInIndia(inIndia(16, 59))).toBe('afternoon');
  });

  it('is evening from five onwards', () => {
    for (const h of [17, 20, 23]) {
      expect(timeOfDayInIndia(inIndia(h))).toBe('evening');
    }
  });

  it('turns at exactly noon and exactly five', () => {
    expect(timeOfDayInIndia(inIndia(11, 59))).toBe('morning');
    expect(timeOfDayInIndia(inIndia(12, 0))).toBe('afternoon');
    expect(timeOfDayInIndia(inIndia(16, 59))).toBe('afternoon');
    expect(timeOfDayInIndia(inIndia(17, 0))).toBe('evening');
  });

  it('reads the clock in India and not wherever the server is', () => {
    // Nine in the evening in India is half past three in the afternoon in
    // London. A shopper in Kolkata wished good afternoon at nine at night is
    // exactly the small wrongness this exists to avoid.
    const nineAtNightInIndia = inIndia(21);
    expect(nineAtNightInIndia.getUTCHours()).toBe(15);
    expect(timeOfDayInIndia(nineAtNightInIndia)).toBe('evening');
  });
});

describe('the greeting', () => {
  it('uses the time of day, then the same sentence every time', () => {
    expect(greetingFor('en', inIndia(9))).toBe(
      'Good morning. Thank you for contacting Fayr customer support. '
      + 'How can I assist you today?',
    );
    expect(greetingFor('en', inIndia(14))).toContain('Good afternoon.');
    expect(greetingFor('en', inIndia(19))).toContain('Good evening.');
  });

  it('exists in all three languages', () => {
    for (const language of LANGUAGES) {
      const said = greetingFor(language, inIndia(9));
      expect(said.length).toBeGreaterThan(20);
    }
    // And they are actually different words, not English three times.
    const all = LANGUAGES.map((l) => greetingFor(l, inIndia(9)));
    expect(new Set(all).size).toBe(LANGUAGES.length);
  });

  it('falls back to English for a language we have no words for', () => {
    expect(greetingFor('ta', inIndia(9))).toContain('Good morning');
  });
});

describe('knowing a greeting from a question', () => {
  it('spots one on its own, however it is typed', () => {
    for (const said of [
      'hi', 'Hi', 'HI', 'hii', 'hello', 'helo', 'hey', 'hlo',
      'namaste', 'Namaste', 'namaskar', 'नमस्ते', 'नमस्कार',
      'good morning', 'Good Evening', 'suprabhat',
      'hi there', 'hello sir', 'namaste ji', 'hi fayr',
    ]) {
      expect(isOnlyAGreeting(said)).toBe(true);
    }
  });

  it('REFUSES anything with a real question in it', () => {
    // The failure that matters. Answering "hi where is my refund" with "how can
    // I help you" is the assistant ignoring somebody who already said.
    for (const said of [
      'hi where is my refund',
      'hello my money has not come',
      'namaste mera refund kaha hai',
      'hey what are tickets',
      'good morning i need help with my order',
    ]) {
      expect(isOnlyAGreeting(said)).toBe(false);
    }
  });

  it('is not fooled by an empty message or one with no greeting in it', () => {
    for (const said of ['', '   ', 'refund', 'where is my money', '???', '123']) {
      expect(isOnlyAGreeting(said)).toBe(false);
    }
  });

  it('refuses a long message even if every word looks like a greeting', () => {
    expect(isOnlyAGreeting('hi hello hey namaste good morning evening')).toBe(false);
  });
});

describe('handing over to a person', () => {
  it('says what will happen, how long, and what else they can do', () => {
    const said = handOverWords('en', SUPPORT_EMAIL_PLACEHOLDER);
    expect(said).toContain('transferring this chat to a customer support agent');
    expect(said).toContain('a minute or two');
    expect(said).toContain('reply to you here');
    expect(said).toContain('24 to 48 hours');
    expect(said).toContain(SUPPORT_EMAIL_PLACEHOLDER);
  });

  it('puts the address in, whatever address it is given', () => {
    expect(handOverWords('en', 'help@somewhere.test')).toContain(
      'help@somewhere.test',
    );
    expect(handOverWords('en', 'help@somewhere.test')).not.toContain('{email}');
  });

  it('leaves no gap unfilled in any language', () => {
    for (const language of LANGUAGES) {
      expect(handOverWords(language, 'a@b.test')).not.toContain('{');
      expect(handOverWords(language, 'a@b.test')).toContain('a@b.test');
    }
  });
});

describe('the one apology for a slow queue', () => {
  it('waits two minutes before saying anything', () => {
    expect(WAITING_NOTE_AFTER_MS).toBe(120_000);
  });

  it('exists in all three languages', () => {
    for (const language of LANGUAGES) {
      expect(STILL_WAITING[language]).toBeTruthy();
    }
    expect(STILL_WAITING.en).toContain('longer than usual');
    expect(STILL_WAITING.en).toContain('Thank you for waiting');
  });
});

describe('offering another language', () => {
  it('names all three, so nobody has to guess what is on offer', () => {
    expect(LANGUAGE_OFFER.en).toContain('Hindi');
    expect(LANGUAGE_OFFER.en).toContain('Hindi written in English letters');
    expect(LANGUAGE_OFFER.en).toContain('English');
  });

  it('exists in all three languages, and so does the confirmation', () => {
    for (const language of LANGUAGES) {
      expect(LANGUAGE_OFFER[language]).toBeTruthy();
      expect(LANGUAGE_CHOSEN[language]).toBeTruthy();
    }
  });
});

describe('reading which language they picked', () => {
  it('takes a plain one-word answer', () => {
    expect(languageChoiceFrom('hindi')).toBe('hi');
    expect(languageChoiceFrom('Hindi')).toBe('hi');
    expect(languageChoiceFrom('हिंदी')).toBe('hi');
    expect(languageChoiceFrom('english')).toBe('en');
    expect(languageChoiceFrom('English please')).toBe('en');
  });

  it('reads Hindi in English letters as its own choice, not as either half', () => {
    // "hindi in english letters" holds both words. The specific reading wins.
    expect(languageChoiceFrom('hinglish')).toBe('hi-en');
    expect(languageChoiceFrom('hindi in english letters')).toBe('hi-en');
    expect(languageChoiceFrom('roman hindi')).toBe('hi-en');
  });

  it('reads nothing out of a real question that mentions a language', () => {
    // Switching the whole conversation because somebody used the word Hindi in
    // a sentence would be worse than not offering at all.
    for (const said of [
      'do you have an answer for this in hindi or should i wait for a person',
      'my review is in hindi and the shop will not show it',
      '',
      'where is my refund',
    ]) {
      expect(languageChoiceFrom(said)).toBeNull();
    }
  });
});

describe('hearing that the reply made no sense', () => {
  it('recognises the ways people say it', () => {
    for (const said of [
      'i do not understand',
      "i don't understand this",
      'not understood',
      'samajh nahi aaya',
      'nahi samjha',
      'समझ नहीं आया',
    ]) {
      expect(saysTheyDoNotUnderstand(said)).toBe(true);
    }
  });

  it('does not hear it in an ordinary question', () => {
    for (const said of [
      'where is my refund',
      'i understand the rules but my money has not come',
      '',
    ]) {
      expect(saysTheyDoNotUnderstand(said)).toBe(false);
    }
  });
});

describe('EVERY LINE READS PLAINLY, IN ITS OWN LANGUAGE', () => {
  // The rule the answer book is held to, applied to the words the assistant says
  // without anybody approving them. These lines never pass a person's desk, so
  // this test is the only thing standing between them and a real shopper.
  const everyLine = (): [string, string, string][] => {
    const out: [string, string, string][] = [];
    for (const language of LANGUAGES) {
      out.push([`greeting, morning`, language, greetingFor(language, inIndia(9))]);
      out.push([`greeting, afternoon`, language, greetingFor(language, inIndia(14))]);
      out.push([`greeting, evening`, language, greetingFor(language, inIndia(19))]);
      out.push([`hand over`, language, handOverWords(language, SUPPORT_EMAIL_PLACEHOLDER)]);
      out.push([`still waiting`, language, STILL_WAITING[language]]);
      out.push([`language offer`, language, LANGUAGE_OFFER[language]]);
      out.push([`language chosen`, language, LANGUAGE_CHOSEN[language]]);
    }
    return out;
  };

  it.each(everyLine())('%s in %s reads plainly', (_what, language, line) => {
    const problems = plainLanguageProblems(line, language);
    expect(problems).toEqual([]);
  });

  it('has words for every language the assistant knows', () => {
    expect(languagesWeHaveWordsFor()).toEqual([...LANGUAGES]);
  });

  it('uses a stand-in address, and says so by looking like one', () => {
    // Named in the report as needing a real one. An invented address in front of
    // somebody who is already waiting would be worse than the wait.
    expect(SUPPORT_EMAIL_PLACEHOLDER).toContain('example');
  });
});
