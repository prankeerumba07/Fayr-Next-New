import {
  ANSWER_DRAFTS,
  DRAFT_LANGUAGES,
  draftsNeedingARealAnswer,
} from './answer-drafts';
import { ANSWER_KEY_PATTERN } from './assistant.constants';
import { detectLanguage } from './language';
import { checkPlainLanguage, plainLanguageProblems } from './plain-language';

/**
 * EVERY DRAFTED ANSWER, AGAINST THE HARD RULE.
 *
 * This is the test that makes the rule real. It is not a sample and it is not a
 * spot check: every wording of every answer in every language goes through the
 * plain-language check, and one failure fails the build.
 *
 * It matters most for exactly the reason the drafts exist. They are copied out of
 * the terms and the privacy policy, whose own words are "materially rewrite",
 * "verifiable charge" and "forfeit unpaid refunds". Without this test, the fastest
 * way to write twenty answers is to paste twenty clauses, and every one of them
 * would be unreadable to the person who needed it.
 */
describe('the drafted answers', () => {
  it('there are enough of them to be useful', () => {
    expect(ANSWER_DRAFTS.length).toBeGreaterThanOrEqual(15);
  });

  it('every one is written in all three languages', () => {
    for (const draft of ANSWER_DRAFTS) {
      for (const language of DRAFT_LANGUAGES) {
        const wording = draft.wordings[language];
        expect(wording).toBeDefined();
        expect(wording.title.trim().length).toBeGreaterThan(3);
        expect(wording.body.trim().length).toBeGreaterThan(30);
        expect(wording.phrases.length).toBeGreaterThan(0);
      }
    }
  });

  // ── THE HARD RULE ───────────────────────────────────────────────────────
  describe('the plain-language rule', () => {
    for (const draft of ANSWER_DRAFTS) {
      for (const language of DRAFT_LANGUAGES) {
        it(`"${draft.key}" in ${language} reads plainly`, () => {
          const { title, body } = draft.wordings[language];

          const bodyResult = checkPlainLanguage(body, language);
          if (!bodyResult.ok) {
            throw new Error(
              `"${draft.key}" (${language}) body breaks the rule:\n  ` +
                plainLanguageProblems(body, language).join('\n  '),
            );
          }

          const titleResult = checkPlainLanguage(title, language);
          if (!titleResult.ok) {
            throw new Error(
              `"${draft.key}" (${language}) title breaks the rule:\n  ` +
                plainLanguageProblems(title, language).join('\n  '),
            );
          }
        });
      }
    }
  });

  describe('the ways of asking', () => {
    it('are all lowercase, so nothing shouts', () => {
      for (const draft of ANSWER_DRAFTS) {
        for (const language of DRAFT_LANGUAGES) {
          for (const phrase of draft.wordings[language].phrases) {
            expect(phrase).toBe(phrase.toLowerCase());
            expect(phrase.trim()).toBe(phrase);
            expect(phrase.length).toBeGreaterThan(3);
          }
        }
      }
    });

    it('never repeat the same wording across two different answers', () => {
      // Two answers claiming the same phrase means the matching has to guess, and
      // which one it picks would depend on nothing a person could reason about.
      const seen = new Map<string, string>();
      for (const draft of ANSWER_DRAFTS) {
        for (const language of DRAFT_LANGUAGES) {
          for (const phrase of draft.wordings[language].phrases) {
            const key = `${language}:${phrase}`;
            const already = seen.get(key);
            if (already && already !== draft.key) {
              throw new Error(
                `"${phrase}" is claimed by both "${already}" and "${draft.key}"`,
              );
            }
            seen.set(key, draft.key);
          }
        }
      }
    });

    it('are written in the language they are filed under', () => {
      // A Hindi phrase filed under English would never be found by a Hindi
      // question, and nothing would fail to say so.
      for (const draft of ANSWER_DRAFTS) {
        for (const phrase of draft.wordings.hi.phrases) {
          expect(detectLanguage(phrase).language).toBe('hi');
        }
      }
    });
  });

  describe('nothing is invented', () => {
    it('every answer names where in the project its words came from', () => {
      for (const draft of ANSWER_DRAFTS) {
        expect(draft.drawnFrom.length).toBeGreaterThan(20);
        // A real path or a real section name, so it can be checked.
        expect(draft.drawnFrom).toMatch(
          /src\/|terms section|privacy section|help subject|Help screen/,
        );
      }
    });

    it('the ones with no written answer say so, in every language', () => {
      const needing = draftsNeedingARealAnswer();
      expect(needing.length).toBeGreaterThan(0);
      for (const draft of needing) {
        for (const language of DRAFT_LANGUAGES) {
          const body = draft.wordings[language].body;
          // The honest hand-over has to be in the body itself, not only in a flag
          // nobody reads.
          expect(body).toMatch(/person|व्यक्ति|vyakti/);
        }
        expect(draft.drawnFrom).toMatch(/not written down|never written/i);
      }
    });

    it('no answer promises a number of days', () => {
      // Nothing in the project states how many days anything takes, so no answer
      // may state one. This is the single easiest thing to invent by accident.
      for (const draft of ANSWER_DRAFTS) {
        for (const language of DRAFT_LANGUAGES) {
          const body = draft.wordings[language].body;
          expect(body).not.toMatch(
            /\b\d+\s*(day|days|hour|hours|week|weeks)\b/i,
          );
          expect(body).not.toMatch(/\d+\s*(दिन|घंटे|हफ्ते)/);
        }
      }
    });

    it('no answer promises a percentage', () => {
      for (const draft of ANSWER_DRAFTS) {
        for (const language of DRAFT_LANGUAGES) {
          expect(draft.wordings[language].body).not.toMatch(
            /\d\s*(%|percent|प्रतिशत)/i,
          );
        }
      }
    });
  });

  describe('the keys', () => {
    it('are all usable and all different', () => {
      const keys = ANSWER_DRAFTS.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(ANSWER_KEY_PATTERN.test(key)).toBe(true);
    });

    it('every answer says which part of the app it is about', () => {
      for (const draft of ANSWER_DRAFTS) {
        expect([
          'about',
          'refund',
          'review',
          'order',
          'tickets',
          'withdrawal',
          'account',
          'privacy',
        ]).toContain(draft.topic);
      }
    });
  });

  describe('the four help subjects the app already offers', () => {
    it('each one has an answer', () => {
      // From src/ui/support.js TOPICS. If somebody adds a fifth subject to the app
      // and no answer for it, this is where that shows up.
      const mustBeAnswered = [
        'refund-not-arrived',
        'order-not-found',
        'review-not-found',
        'withdrawal-problem',
      ];
      const keys = ANSWER_DRAFTS.map((d) => d.key);
      for (const key of mustBeAnswered) expect(keys).toContain(key);
    });
  });
});
