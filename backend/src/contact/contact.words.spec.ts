import { checkPlainLanguage } from '../assistant/plain-language';
import {
  CALL_BUTTON,
  HOW_TO_REACH_US_KEY,
  HOW_TO_REACH_US_PHRASES,
  callUsWords,
  howToReachUsTitle,
  writeToUsWords,
} from './contact.words';

/**
 * EVERY WORD A PERSON READS WHEN THEY WANT TO REACH FAYR, WALKED.
 *
 * Walked and not read: the same shape as chat/how-it-talks.spec.ts and
 * running/running.words.spec.ts. Every sentence in the file goes through the real
 * plain-language check in its own language, so a sentence added later cannot get
 * onto the Help screen without this having read it.
 *
 * The number used here is a made-up one. The real one lives in backend/.env and
 * appears in no check, which number-lives-in-one-place.spec.ts enforces.
 */
const A_MADE_UP_NUMBER = '+919000000001';
const LANGUAGES = ['en', 'hi', 'hi-en'] as const;

describe('how to reach Fayr, in words', () => {
  /** Every piece of writing, in the language it is written in. */
  function everythingItSays(): [string, string, string][] {
    const out: [string, string, string][] = [];
    const say = (what: string, language: string, text: string): void => {
      out.push([what, language, text]);
    };
    for (const language of LANGUAGES) {
      say('the heading', language, howToReachUsTitle(language));
      say('with a number', language, callUsWords(A_MADE_UP_NUMBER, language));
      say('with no number', language, writeToUsWords(language));
    }
    say('the button', 'en', CALL_BUTTON);
    return out;
  }

  it('says something in every language, in both cases', () => {
    // 3 headings + 3 with a number + 3 without + the button.
    expect(everythingItSays()).toHaveLength(10);
  });

  it('reads plainly, every piece, in its own language', () => {
    const bad: string[] = [];
    for (const [what, language, text] of everythingItSays()) {
      const result = checkPlainLanguage(text, language);
      if (!result.ok) {
        bad.push(
          `${what} (${language}): ${result.problems.map((p) => p.detail).join(' ')}`,
        );
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no long dash anywhere, in any language', () => {
    for (const [what, , text] of everythingItSays()) {
      expect(text).not.toMatch(/--|—|–/);
      expect(what).not.toBe('');
    }
  });

  it('offers the number when there is one', () => {
    for (const language of LANGUAGES) {
      expect(callUsWords(A_MADE_UP_NUMBER, language)).toContain(A_MADE_UP_NUMBER);
    }
  });

  it('offers NO number at all when there is none, not a gap and not the word nothing', () => {
    for (const language of LANGUAGES) {
      const said = writeToUsWords(language);
      // No digits, no plus sign, no empty brackets, and no leftover fill-in.
      expect(said).not.toMatch(/\d/);
      expect(said).not.toContain('+');
      expect(said).not.toMatch(/\{|\}/);
      expect(said.toLowerCase()).not.toContain('nothing');
      // And it still tells them what to do instead.
      expect(said.trim().length).toBeGreaterThan(20);
    }
  });

  it('tells somebody they can write to us, in both cases, in every language', () => {
    // The two cases must not be one sentence about a number and one dead end.
    for (const language of LANGUAGES) {
      for (const said of [callUsWords(A_MADE_UP_NUMBER, language), writeToUsWords(language)]) {
        const mentionsTheApp = /app|ऐप/i.test(said);
        expect(mentionsTheApp).toBe(true);
      }
    }
  });

  it('has ways of asking in every language, and no two the same', () => {
    for (const language of LANGUAGES) {
      const phrases = HOW_TO_REACH_US_PHRASES[language];
      expect(Array.isArray(phrases)).toBe(true);
      expect(phrases.length).toBeGreaterThanOrEqual(5);
      expect(new Set(phrases).size).toBe(phrases.length);
      for (const phrase of phrases) expect(phrase.trim()).toBe(phrase);
    }
  });

  it('is filed under one name', () => {
    expect(HOW_TO_REACH_US_KEY).toBe('how-to-reach-us');
  });

  /**
   * A TRIPWIRE. This file is the whole reason the Help screen and the chat cannot
   * disagree, so a new file in this folder that holds writing must be walked too.
   */
  it('is still the only place in this folder that holds writing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const here = readdirSync(__dirname).sort();
    expect(here).toEqual([
      'contact.module.ts',
      'contact.service.spec.ts',
      'contact.service.ts',
      'contact.words.spec.ts',
      'contact.words.ts',
      'number-lives-in-one-place.spec.ts',
    ]);
  });
});
