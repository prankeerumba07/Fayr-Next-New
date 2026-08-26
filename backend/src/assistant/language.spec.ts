import {
  DEFAULT_LANGUAGE,
  ENGLISH_MARKERS,
  HINDI_IN_LATIN,
  LANGUAGES,
  detectLanguage,
  languageName,
} from './language';

/**
 * WHICH LANGUAGE DID THIS PERSON WRITE IN?
 *
 * A guess, and stored as one. Fayr's users write in English, in Hindi, and — most
 * often of all — in Hindi typed with English letters ("mera refund kab aayega").
 * The third one is not a broken version of either of the other two, so it gets its
 * own name and its own answers.
 *
 * The lists of words are DATA. Adding a language later means adding a list, not
 * rewriting anything here, which is the only reason this is worth a file of its own.
 */
describe('detectLanguage', () => {
  describe('English', () => {
    it('reads plain English as English', () => {
      const guess = detectLanguage('When will my refund arrive?');
      expect(guess.language).toBe('en');
      expect(guess.confidence).toBeGreaterThan(50);
    });

    it('is less sure when there is nothing English to go on', () => {
      const bare = detectLanguage('refund');
      expect(bare.language).toBe('en');
      // No function words, no Hindi — English only because nothing said otherwise.
      expect(bare.confidence).toBeLessThan(50);
    });

    it('says so plainly when there is nothing to read at all', () => {
      for (const empty of ['', '   ', '???', '12345']) {
        const guess = detectLanguage(empty);
        expect(guess.language).toBe(DEFAULT_LANGUAGE);
        expect(guess.confidence).toBe(0);
      }
    });

    it('survives text that is not a string', () => {
      for (const junk of [null, undefined, 42, {}, []]) {
        const guess = detectLanguage(junk as unknown as string);
        expect(guess.language).toBe(DEFAULT_LANGUAGE);
        expect(guess.confidence).toBe(0);
      }
    });
  });

  describe('Hindi', () => {
    it('reads Hindi letters as Hindi', () => {
      const guess = detectLanguage('मेरा पैसा कब आएगा');
      expect(guess.language).toBe('hi');
      expect(guess.confidence).toBeGreaterThanOrEqual(60);
    });

    it('calls a sentence with a few Hindi letters mixed, not Hindi', () => {
      // One Devanagari word in an otherwise English sentence. Hindi is in play,
      // but calling the whole thing Hindi would send them a Hindi answer.
      const guess = detectLanguage('my refund is stuck कब');
      expect(guess.language).toBe('hi-en');
    });
  });

  describe('Hindi in English letters', () => {
    it('reads the way most people actually type', () => {
      const guess = detectLanguage('mera refund kab aayega');
      expect(guess.language).toBe('hi-en');
      expect(guess.confidence).toBeGreaterThan(60);
    });

    it('handles a half-and-half sentence', () => {
      const guess = detectLanguage('refund kab milega please');
      expect(guess.language).toBe('hi-en');
    });

    it('does not call an English sentence Hindi for one stray word', () => {
      // Below the threshold: a fifth of the words have to look Hindi.
      const guess = detectLanguage(
        'I have not received the money for my order and I am worried about it se',
      );
      expect(guess.language).toBe('en');
    });

    it('does not read the commonest English word in the world as Hindi', () => {
      // "the" is a Hindi word too — it means "they were". It is many thousands of
      // times more often the English article, and counting it as Hindi read plain
      // English sentences as Hindi typed in English letters.
      const guess = detectLanguage('the money for the order has not come');
      expect(guess.language).toBe('en');
      expect(guess.confidence).toBeGreaterThan(60);
    });

    it('is more sure the more of the sentence looks Hindi', () => {
      const mostly = detectLanguage('mera paisa kab milega bhai');
      const barely = detectLanguage(
        'when will the money arrive in my account kya milega',
      );
      expect(mostly.confidence).toBeGreaterThan(barely.confidence);
    });
  });

  describe('the guess itself', () => {
    it('only ever names a language we have a name for', () => {
      const samples = [
        'hello',
        'मेरा पैसा',
        'mera paisa',
        '!!!',
        'Refund NOT received!!! kyun??',
      ];
      for (const s of samples) {
        expect(LANGUAGES).toContain(detectLanguage(s).language);
      }
    });

    it('never returns a confidence outside 0 to 100', () => {
      const samples = [
        '',
        'a',
        'mera mera mera mera',
        'मेरा मेरा मेरा',
        'the the the the the',
      ];
      for (const s of samples) {
        const c = detectLanguage(s).confidence;
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(100);
      }
    });

    it('reads the same text the same way every time', () => {
      const text = 'mera refund kab aayega';
      expect(detectLanguage(text)).toEqual(detectLanguage(text));
    });

    it('ignores capitals and punctuation', () => {
      expect(detectLanguage('MERA REFUND KAB AAYEGA!!!').language).toBe(
        detectLanguage('mera refund kab aayega').language,
      );
    });
  });

  describe('the word lists', () => {
    it('never counts the same word as both Hindi and English', () => {
      const both = [...HINDI_IN_LATIN].filter((w) => ENGLISH_MARKERS.has(w));
      expect(both).toEqual([]);
    });

    it('holds only lowercase single words', () => {
      for (const w of [...HINDI_IN_LATIN, ...ENGLISH_MARKERS]) {
        expect(w).toBe(w.toLowerCase());
        expect(w).toMatch(/^[a-z]+$/);
      }
    });
  });

  describe('languageName', () => {
    it('names each language in words a person would use', () => {
      expect(languageName('en')).toBe('English');
      expect(languageName('hi')).toBe('Hindi');
      expect(languageName('hi-en')).toBe('Hindi written in English letters');
    });

    it('does not pretend to know a language it has no name for', () => {
      expect(languageName('ta')).toBe('Not known');
      expect(languageName('')).toBe('Not known');
    });

    it('uses no jargon and no short codes in any name', () => {
      for (const tag of LANGUAGES) {
        const name = languageName(tag);
        expect(name).not.toMatch(
          /[_-]{2}|\bBCP\b|\bISO\b|\bi18n\b|\blocale\b/i,
        );
        expect(name[0]).toBe(name[0].toUpperCase());
      }
    });
  });
});
