import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPlainLanguage } from '../assistant/plain-language';

/**
 * THE JOURNEY'S OWN SCREEN WORDS, READ OFF DISK AND PUT THROUGH THE REAL RULE.
 *
 * ── WHY A BACKEND SPEC CHECKS AN APP FILE ───────────────────────────────────
 *
 * Because the plain language rule lives here and the words live there, and the
 * rule is worth nothing if it never reads them. This is exactly the arrangement
 * connect-words.spec.ts already uses for src/connect/gateWords.js, and it exists
 * for a reason recorded in that file: three sentences shown to somebody about
 * their own refund carried a long dash for weeks, because nothing was pointing
 * the rule at them.
 *
 * ── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────
 *
 * It is NOT the check for the campaign's own message. Those four sentences are
 * built on this side, in tasks/engine/journey-message.ts, and walked by
 * journey-message.spec.ts. What is checked here is only what the SCREEN owns:
 * what went wrong with a request, what a button is called, and the units of a
 * clock that ticks on the phone.
 */
const APP = join(__dirname, '..', '..', '..', 'src');
const read = (p: string): string => readFileSync(join(APP, p), 'utf8');

/** Comments stripped, so a rule EXPLAINED at length is not read as a breach. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every single-quoted or backticked literal in the words file.
 *
 * Read from the FILE rather than imported, because importing it would need the
 * app's module graph. The point is that the words on disk are the words checked.
 */
function everyLiteral(source: string): string[] {
  const code = withoutComments(source);
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.){4,})'/g)) out.push(m[1]);
  return out;
}

describe('the journey’s own screen words', () => {
  const source = read('ui/journeyWords.js');

  it('every sentence in the file passes Fayr’s plain language rule', () => {
    const literals = everyLiteral(source).filter((s) => / /.test(s));
    // A FLOOR, so a file emptied by a bad edit cannot pass by having nothing in it.
    expect(literals.length).toBeGreaterThanOrEqual(6);
    for (const sentence of literals) {
      const verdict = checkPlainLanguage(sentence, 'en');
      expect(verdict.problems.map((p) => `${sentence} :: ${p}`)).toEqual([]);
    }
  });

  it('and the clock words it builds pass it too, in singular and in plural', () => {
    // The units are assembled at run time, so the literals above never show what
    // a person actually reads. These are the assembled forms.
    for (const said of [
      '1 minute left', '2 minutes left', '1 hour left', '2 hours left',
      '1 hour and 1 minute left', '1 hour and 59 minutes left', 'No time left',
    ]) {
      expect(checkPlainLanguage(said, 'en').ok).toBe(true);
    }
  });

  /**
   * THE SENTENCES THE FILE BUILDS, WHICH THE LITERALS ABOVE CANNOT SEE.
   *
   * ── AND THAT GAP WAS REAL, NOT THEORETICAL ────────────────────────────────
   *
   * everyLiteral above reads SINGLE-QUOTED strings off disk. Every sentence
   * assembled from a template literal — the ones that take a shop's name, the
   * ones that take a span of time — is invisible to it. On 17 September 2026 the
   * review half of the journey added six of those, and not one of them was being
   * read by the rule this file exists to apply.
   *
   * ── READ OFF DISK, NOT WRITTEN OUT HERE ───────────────────────────────────
   *
   * The first version of this check listed the assembled sentences by hand. That
   * was caught by breaking one: the function was changed to say something the
   * rule forbids and the check went on passing, because it was reading a copy
   * somebody had typed rather than the file. So the templates are taken off disk
   * and their holes filled with a sample, which is the same thing a person sees.
   */
  const everyTemplate = (source: string): string[] => {
    const code = withoutComments(source);
    const out: string[] = [];
    for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
      const filled = m[1]
        // The only holes these sentences have are a shop's name, a span of time
        // and an amount. A name is the longest of the three and the one that can
        // push a sentence over the length rule, so a name is what goes in.
        .replace(/\$\{[^}]*\}/g, 'Amazon')
        // AND A CHARACTER WRITTEN AS AN ESCAPE IS STILL THAT CHARACTER. Caught
        // by breaking it: a long dash typed as \u2014 in the source reads as six
        // ordinary letters to anything looking at the file, and sailed past a
        // rule whose whole job is to refuse long dashes.
        .replace(/\\u([0-9a-fA-F]{4})/g,
          (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\s+/g, ' ')
        .trim();
      if (/ /.test(filled)) out.push(filled);
    }
    return out;
  };

  it('and the sentences it BUILDS pass it too, read off disk', () => {
    const built = everyTemplate(source);
    // A FLOOR, so a file whose templates stopped being found cannot pass by
    // having nothing to check.
    expect(built.length).toBeGreaterThanOrEqual(5);
    for (const said of built) {
      const verdict = checkPlainLanguage(said, 'en');
      expect(verdict.problems.map((p) => `${said} :: ${p.detail}`)).toEqual([]);
    }
  });

  it('and so do the spans of time it counts backwards', () => {
    for (const said of [
      'a moment', '1 minute', '5 minutes', '1 hour', '3 hours', '1 day', '3 days',
    ]) {
      expect(checkPlainLanguage(said, 'en').ok).toBe(true);
    }
  });

  it('holds no sentence about a campaign’s state, because the server owns those', () => {
    // THE OWNER'S RULE FROM THIS SIDE. If this file grew one of the server's
    // sentences there would be two sources for one message.
    const code = withoutComments(source);
    for (const serverOwns of [
      'Tell us when you have bought it',
      'Your two hours have run out',
      'We could not find your order',
      'We found your order',
      'held until',
    ]) {
      expect(code).not.toContain(serverOwns);
    }
  });

  it('writes nothing, reads nothing, and draws nothing', () => {
    const code = withoutComments(source);
    // A words file that can reach a network or a screen is not a words file.
    for (const wayOut of [
      /\bfetch\s*\(/, /XMLHttpRequest/, /AsyncStorage/, /SecureStore/,
      /console\./, /from 'react/, /<[A-Z]/, /\brequire\s*\(/,
    ]) {
      expect(code).not.toMatch(wayOut);
    }
  });

  it('is the only place under src that holds these screen words', () => {
    // A TRIPWIRE. A second copy of the refusal sentence anywhere else is two
    // sources for one thing, which is the whole failure being guarded against.
    const elsewhere = [
      'screens/buyinterstitial.js', 'TaskScreen.js', 'MyProductsScreen.js',
      'ui/waiting.js', 'ui/tasklist.js',
    ];
    for (const file of elsewhere) {
      const code = withoutComments(read(file));
      expect(code).not.toContain('We could not start your two hours');
      expect(code).not.toContain('You have not lost your place');
      expect(code).not.toContain('Have you bought the product');
    }
  });
});
