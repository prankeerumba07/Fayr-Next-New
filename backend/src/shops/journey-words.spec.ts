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

/**
 * THE RETURN WINDOW'S OWN WORDS, WALKED FOR THE FIRST TIME — Phase 8B-b.
 *
 * ── WHY THIS FILE WAS NOT BEING READ ────────────────────────────────────────
 *
 * src/ui/returnWindow.js has spoken to people about their own money since it was
 * written, and nothing was pointing the rule at it. That was survivable while
 * every sentence in it was a date. Phase 8B-b gives the three quick-commerce
 * shops a hold of three hours, so the file now says the time on the clock, and
 * the owner asked that every new sentence go through the walk that already holds
 * the others. This is that walk, in the same shape, over the same rule.
 */
describe('the return window’s own screen words', () => {
  const source = read('ui/returnWindow.js');

  const everyLiteralIn = (src: string): string[] => {
    const code = withoutComments(src);
    const out: string[] = [];
    for (const m of code.matchAll(/'((?:[^'\\\n]|\\.){4,})'/g)) out.push(m[1]);
    return out;
  };

  const everyTemplateIn = (src: string): string[] => {
    const code = withoutComments(src);
    const out: string[] = [];
    for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
      const filled = m[1]
        // A shop's name is the longest hole any of these sentences has, and the
        // one that can push a sentence past the length rule.
        .replace(/\$\{[^}]*\}/g, 'Amazon')
        .replace(/\\u([0-9a-fA-F]{4})/g,
          (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\s+/g, ' ')
        .trim();
      if (/ /.test(filled)) out.push(filled);
    }
    return out;
  };

  it('every sentence written in the file passes Fayr’s plain language rule', () => {
    const said = everyLiteralIn(source).filter((x) => / /.test(x));
    expect(said.length).toBeGreaterThanOrEqual(4);
    for (const one of said) {
      expect(checkPlainLanguage(one, 'en').problems.map((p) => `${one} :: ${p.detail}`))
        .toEqual([]);
    }
  });

  it('and every sentence it BUILDS passes it too, read off disk', () => {
    const built = everyTemplateIn(source);
    expect(built.length).toBeGreaterThanOrEqual(5);
    for (const one of built) {
      expect(checkPlainLanguage(one, 'en').problems.map((p) => `${one} :: ${p.detail}`))
        .toEqual([]);
    }
  });

  it('AND THE ASSEMBLED CLOCK SENTENCES, which no template shows whole', () => {
    // The heading and the sentence are built from a count and a time at run
    // time, so what a person actually reads appears nowhere in the source. These
    // are the forms, in singular and plural, at both ends of the day.
    for (const said of [
      'Your refund unlocks in a minute',
      'Your refund unlocks in 25 minutes',
      'Your refund unlocks in an hour',
      'Your refund unlocks in 3 hours',
      'Your refund is due now',
      'Your refund unlocks today',
      'Refund unlocks in 1 day',
      'Refund unlocks in 5 days',
      'Waiting for the return window',
      'Your refund is due at 12:00 am today. We hold it for a short while after '
        + 'your parcel arrives, and then it is sent to your wallet.',
      'Your refund is due at 2:30 pm tomorrow. We hold it for a short while after '
        + 'your parcel arrives, and then it is sent to your wallet.',
      // The claim's own status rows, moved into this file on 20 September 2026
      // so that they are walked with everything else the wait says.
      '1 minute remaining', '25 minutes remaining', '1 hour remaining',
      '3 hours remaining', '5d 0h remaining', 'Return window has closed',
      '2:30 pm today', '12:00 am tomorrow', 'Fri Sep 25 2026',
      'Fri Sep 25 2026, 2:30 pm',
    ]) {
      expect(checkPlainLanguage(said, 'en').problems.map((p) => `${said} :: ${p.detail}`))
        .toEqual([]);
    }
  });

  it('and it still writes nothing, reads nothing and draws nothing', () => {
    const code = withoutComments(source);
    for (const wayOut of [
      /\bfetch\s*\(/, /XMLHttpRequest/, /AsyncStorage/, /SecureStore/,
      /console\./, /from 'react/, /<[A-Z]/, /\brequire\s*\(/,
    ]) {
      expect(code).not.toMatch(wayOut);
    }
  });

  it('AND NO DAY-SHAPED SENTENCE IS SHOWN FOR A WAIT UNDER A DAY', () => {
    // The point of the phase on this screen. "closes today, on 20 Sep" is true
    // for a three hour hold and tells nobody anything; the clock branch has to
    // come first, and the day-shaped branch has to be unreachable under a day.
    const code = withoutComments(source);
    const line = code.slice(code.indexOf('export function windowLine'));
    const clockBranch = line.indexOf("wait.kind === 'minutes'");
    const dayBranch = line.indexOf('const when = shortDate');
    expect(clockBranch).toBeGreaterThan(-1);
    expect(dayBranch).toBeGreaterThan(clockBranch);
    // And the clock branch returns rather than falling through.
    expect(line.slice(clockBranch, dayBranch)).toMatch(/return `\$\{soon\}/);
  });
});
