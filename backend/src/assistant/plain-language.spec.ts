import {
  JARGON,
  ORDINARY_IN_HINDI_LATIN,
  MAX_WORDS_PER_SENTENCE,
  checkPlainLanguage,
  isPlainLanguage,
  plainLanguageProblems,
} from './plain-language';

const good =
  'We send your money back after your review is live on the shop page.';

/**
 * THE HARD RULE.
 *
 * Every answer this thing ever gives a person has to read like it was explained
 * to a child. Not "should" — every answer returned goes through this first, and an
 * answer that fails is never sent.
 *
 * The rule exists because of where the words come from. The first answers are
 * drawn out of the terms and the privacy policy, which are written in the language
 * of terms and privacy policies: "materially rewrite", "verifiable charge",
 * "forfeit unpaid refunds". That is exactly the wording somebody with money stuck
 * cannot read, so the copying-out has to be checked by something that does not get
 * tired.
 *
 * It has to work for Hindi and for Hindi typed in English letters too, so the
 * checks that only make sense for English are separated from the ones that do not.
 */
describe('checkPlainLanguage', () => {
  describe('what passes', () => {
    it('accepts a plain sentence', () => {
      expect(isPlainLanguage(good, 'en')).toBe(true);
      expect(checkPlainLanguage(good, 'en').problems).toEqual([]);
    });

    it('accepts plain Hindi', () => {
      expect(
        isPlainLanguage(
          'आपका पैसा वापस तब आता है जब आपका रिव्यू दिख जाता है।',
          'hi',
        ),
      ).toBe(true);
    });

    it('accepts plain Hindi typed in English letters', () => {
      expect(
        isPlainLanguage(
          'Aapka paisa wapas tab aata hai jab aapka review dikh jata hai.',
          'hi-en',
        ),
      ).toBe(true);
    });

    it('allows the two short names people here actually use', () => {
      // UPI and PAN are what these things are called. Spelling them out would be
      // less clear, not more, and the terms themselves use both.
      expect(
        isPlainLanguage(
          'You can send the money to your UPI or your bank.',
          'en',
        ),
      ).toBe(true);
      expect(
        isPlainLanguage(
          'We ask for your PAN so one person has one account.',
          'en',
        ),
      ).toBe(true);
    });

    it('allows the name Fayr and ordinary capitals at the start of a sentence', () => {
      expect(
        isPlainLanguage('Fayr pays you back. You keep the product.', 'en'),
      ).toBe(true);
    });

    it('allows a rupee amount', () => {
      expect(
        isPlainLanguage('You will see ₹295.20 in your wallet.', 'en'),
      ).toBe(true);
    });
  });

  describe('what it refuses', () => {
    it('refuses a double dash and a long dash', () => {
      for (const bad of [
        'We pay you back -- once your review is live.',
        'We pay you back — once your review is live.',
        'We pay you back – once your review is live.',
      ]) {
        expect(problemCodes(bad)).toContain('long-dash');
      }
    });

    it('refuses a short code with an underscore in it', () => {
      expect(
        problemCodes('Your task is in state order_unreadable right now.'),
      ).toContain('short-code');
    });

    it('refuses a word shouted in capitals', () => {
      expect(
        problemCodes('Your offer is now HOLDING and you must wait.'),
      ).toContain('short-code');
      expect(problemCodes('Send us the ASIN from the page.')).toContain(
        'short-code',
      );
    });

    it('refuses the little Latin abbreviations', () => {
      for (const bad of [
        'Send a picture, e.g. of the order page.',
        'Send a picture, i.e. of the order page.',
        'We check the order, the review, etc.',
        'Card vs. cash on delivery both work.',
      ]) {
        expect(problemCodes(bad)).toContain('abbreviation');
      }
    });

    it('refuses jargon, and says what to write instead', () => {
      const result = checkPlainLanguage(
        'The endpoint will authenticate your credentials.',
        'en',
      );
      expect(result.ok).toBe(false);
      const jargon = result.problems.filter((p) => p.code === 'jargon');
      expect(jargon.length).toBeGreaterThan(0);
      // The whole point of naming it is being able to tell somebody what to do.
      expect(jargon[0].instead).toBeTruthy();
      expect(jargon[0].detail).not.toMatch(/_|--/);
    });

    it('refuses the language a terms page is written in', () => {
      // This is the real risk: the first answers are copied out of the terms.
      const fromTheTerms =
        'If you materially rewrite your review, Fayr may reclaim the refund by deducting it from your wallet balance.';
      expect(isPlainLanguage(fromTheTerms, 'en')).toBe(false);
    });

    it('refuses a sentence nobody could hold in their head', () => {
      const long = `${'we pay you back for the thing you bought and reviewed and kept '.repeat(3)}today.`;
      expect(problemCodes(long)).toContain('long-sentence');
    });

    it('refuses a web address', () => {
      expect(problemCodes('Read more at https://fayr.example/terms')).toContain(
        'web-address',
      );
      expect(problemCodes('Read more at www.fayr.example')).toContain(
        'web-address',
      );
    });

    it('refuses something left half written', () => {
      for (const bad of [
        'Your refund is {{amount}}.',
        'Coming soon: TODO',
        'Amount: ${x}',
      ]) {
        expect(problemCodes(bad)).toContain('unfinished');
      }
    });

    it('refuses nothing at all', () => {
      for (const bad of ['', '   ', '\n']) {
        expect(problemCodes(bad)).toContain('empty');
      }
    });

    it('survives something that is not text', () => {
      for (const junk of [null, undefined, 42, {}, []]) {
        const result = checkPlainLanguage(junk as unknown as string, 'en');
        expect(result.ok).toBe(false);
        expect(result.problems.length).toBeGreaterThan(0);
      }
    });
  });

  describe('across the three languages', () => {
    it('refuses a long dash in Hindi too', () => {
      expect(problemCodes('आपका पैसा — रिव्यू के बाद आता है।', 'hi')).toContain(
        'long-dash',
      );
    });

    it('refuses a short code in Hindi too', () => {
      expect(problemCodes('आपका order_unreadable है।', 'hi')).toContain(
        'short-code',
      );
    });

    it('does not judge Hindi words by an English word list', () => {
      // The jargon list is English. Running it over Devanagari would be noise at
      // best and would reject correct Hindi at worst.
      const hindi = 'आपका पैसा वापस तब आता है जब आपका रिव्यू दिख जाता है।';
      expect(checkPlainLanguage(hindi, 'hi').problems).toEqual([]);
    });

    it('lets Hindi use words that are jargon only in English', () => {
      // "paise" is the smallest part of a rupee in English and it is jargon — a
      // person must always see rupees. In Hindi it just means MONEY, and
      // "paise kaise dein" is "how do I pay". Banning it in Hindi made writing
      // plain Hindi impossible.
      expect(
        isPlainLanguage('Paise kaise dein, card se ya UPI se.', 'hi-en'),
      ).toBe(true);
      expect(problemCodes('We hold 29520 paise for you.', 'en')).toContain(
        'jargon',
      );
      for (const word of ORDINARY_IN_HINDI_LATIN)
        expect(JARGON.has(word)).toBe(true);
    });

    it('still checks Hindi typed in English letters against the English list', () => {
      // Because it IS English letters, and "endpoint" written in them is still
      // "endpoint" to the person reading it.
      expect(
        problemCodes('Aapka endpoint kaam nahi kar raha.', 'hi-en'),
      ).toContain('jargon');
    });
  });

  describe('the problems it reports', () => {
    it('describes each problem in the same plain words it demands', () => {
      const result = checkPlainLanguage(
        'The API endpoint returned state HOLDING -- e.g. a 4xx.',
        'en',
      );
      expect(result.ok).toBe(false);
      for (const problem of result.problems) {
        expect(problem.detail.length).toBeGreaterThan(5);
        expect(problem.detail).not.toMatch(/--|\bregex\b|\bboolean\b/i);
      }
    });

    it('finds every problem, not just the first', () => {
      const codes = problemCodes('The API endpoint -- e.g. HOLDING_STATE.');
      expect(new Set(codes).size).toBeGreaterThan(2);
    });

    it('lists the offending word so somebody can find it', () => {
      const result = checkPlainLanguage('Check the endpoint.', 'en');
      expect(result.problems[0].found).toBe('endpoint');
    });

    it('is a plain list of strings for a screen to show', () => {
      const lines = plainLanguageProblems(
        'The API endpoint -- e.g. HOLDING.',
        'en',
      );
      expect(Array.isArray(lines)).toBe(true);
      for (const line of lines) expect(typeof line).toBe('string');
      expect(lines.join(' ')).not.toContain('undefined');
    });
  });

  describe('the jargon list itself', () => {
    it('gives a plain replacement for every word it bans', () => {
      for (const [word, instead] of JARGON) {
        expect(word).toBe(word.toLowerCase());
        expect(instead.length).toBeGreaterThan(3);
        // A replacement that itself breaks the rule would be worse than useless.
        expect(instead).not.toMatch(/--|—|_/);
      }
    });

    it('does not ban the ordinary words Fayr answers are made of', () => {
      for (const word of [
        'refund',
        'review',
        'order',
        'money',
        'wallet',
        'ticket',
        'offer',
        'shop',
        'buy',
        'paid',
        'wait',
        'picture',
        'account',
        'bank',
      ]) {
        expect(JARGON.has(word)).toBe(false);
      }
    });
  });

  describe('the sentence-length limit', () => {
    it('is a number a person could argue with', () => {
      expect(MAX_WORDS_PER_SENTENCE).toBeGreaterThan(8);
      expect(MAX_WORDS_PER_SENTENCE).toBeLessThan(40);
    });

    it('counts each sentence on its own, not the whole answer', () => {
      const many = Array.from(
        { length: 6 },
        () => 'You keep the product.',
      ).join(' ');
      expect(isPlainLanguage(many, 'en')).toBe(true);
    });
  });
});

function problemCodes(text: string, language = 'en'): string[] {
  return checkPlainLanguage(text, language).problems.map((p) => p.code);
}
