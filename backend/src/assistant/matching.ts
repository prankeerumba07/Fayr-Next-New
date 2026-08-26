/**
 * HOW CLOSE IS THIS QUESTION TO THAT STORED PHRASE?
 *
 * The database does the narrowing. Its two indexes take thousands of stored
 * phrasings down to a few dozen candidates without reading the table — that is
 * the part that has to keep working when there are fifty thousand of them.
 *
 * This file does the deciding, on that short list, and it is pure: no database,
 * no clock, no configuration. Which means every judgement it makes can be argued
 * with in a test instead of guessed at against live data.
 *
 * Two signals, combined:
 *
 *   THE SAME WORDS. How many of the words that carry meaning are shared. Ignores
 *   the words every question contains ("when", "my", "is"), because
 *   "when will my refund arrive" and "when will my order arrive" share four words
 *   out of five and are completely different questions.
 *
 *   A NEAR MISS. How close the letters are, which is the number the database
 *   worked out and the only thing that survives a typo: "refnud" shares no word
 *   with anything, but it shares almost every run of three letters with "refund".
 *
 * Neither alone is enough, so neither alone decides.
 */

import { ENGLISH_MARKERS } from './language';

/**
 * The words that say nothing about which answer somebody needs.
 *
 * English function words, plus the Hindi ones people type in English letters.
 * Deliberately NOT the words Fayr questions are actually about — refund, review,
 * order, tickets, money, paisa — because those are the whole signal.
 *
 * Latin letters only for now. The Hindi-script equivalents (है, का, को, से) belong
 * here too and adding them is adding to this list, which is the point of it being
 * a list.
 */
// prettier-ignore
export const COMMON_WORDS: ReadonlySet<string> = new Set<string>([
  ...ENGLISH_MARKERS,
  // Hindi function words, typed in English letters.
  'mera', 'meri', 'mere', 'aapka', 'aapki', 'apna', 'hamara',
  'hai', 'hain', 'tha', 'thi', 'hua', 'hui', 'hue',
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'par', 'tak', 'na',
  'aur', 'bhi', 'toh', 'lekin', 'magar', 'phir', 'jab', 'tab',
  'kab', 'kya', 'kyun', 'kyu', 'kaise', 'kahan', 'kaun',
  'ji', 'bhai', 'bhaiya', 'didi',
]);

/** How much of the letters have to line up before we call it a near miss. */
const NEAR_MISS_FLOOR = 0.3;

/**
 * What the two signals are worth, and the small nudge for answering in the
 * language the person wrote in. They add to 1, so a perfect match in the right
 * language is exactly 100 and nothing has to be clamped down from above.
 */
const WEIGHT_SAME_WORDS = 0.62;
const WEIGHT_NEAR_MISS = 0.3;
const WEIGHT_SAME_LANGUAGE = 0.08;

/**
 * A word is letters AND the marks that attach to them. The marks matter: Hindi
 * vowel signs are "marks", not "letters", so a pattern of letters alone splits
 * मेरा into म and र — every Hindi word shredded into single consonants, and Hindi
 * matching quietly broken with nothing failing anywhere to say so.
 */
const WORD = /[\p{L}\p{M}]+/gu;

/** One stored phrase the database offered, with its own near-miss number. */
export interface PhraseCandidate {
  answerEntryId: string;
  phrase: string;
  phraseLanguage: string;
  /** 0 to 1, worked out by the database. Anything outside that is treated as the edge. */
  nearness: number;
}

export interface ScoredMatch extends PhraseCandidate {
  /** 0 to 100. */
  score: number;
  /** Why it matched, in words a person can read. */
  how: 'the same words' | 'a near miss' | 'both';
}

function clamp01(n: number): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Every distinct word, lowercased, in the order it first appears. */
function allWords(text: string): string[] {
  if (typeof text !== 'string') return [];
  const found = text.toLowerCase().match(WORD);
  if (!found) return [];
  return [...new Set(found)];
}

/**
 * The words worth comparing. If EVERY word is a common one ("why is it not"),
 * the common ones are kept — comparing small words beats comparing nothing, which
 * would score every such question at zero against everything.
 */
export function meaningfulWords(text: string): string[] {
  const words = allWords(text);
  const meaningful = words.filter((w) => !COMMON_WORDS.has(w));
  return meaningful.length > 0 ? meaningful : words;
}

/**
 * How much meaning the two texts share, 0 to 1.
 *
 * Shared words counted against the size of BOTH sides, so a phrase does not score
 * well just by being long enough to contain everything.
 */
export function sharedWordScore(question: string, phrase: string): number {
  const a = meaningfulWords(question);
  const b = meaningfulWords(phrase);
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let shared = 0;
  for (const w of a) if (bSet.has(w)) shared += 1;
  return (2 * shared) / (a.length + b.length);
}

/** 0 to 100, how likely this phrase is the one the person meant. */
export function scoreCandidate(
  question: string,
  candidate: PhraseCandidate,
  askedLanguage: string,
): number {
  const words = sharedWordScore(question, candidate.phrase);
  const nearness = clamp01(candidate.nearness);
  const sameLanguage = candidate.phraseLanguage === askedLanguage ? 1 : 0;
  const raw =
    WEIGHT_SAME_WORDS * words +
    WEIGHT_NEAR_MISS * nearness +
    WEIGHT_SAME_LANGUAGE * sameLanguage;
  return Math.min(100, Math.max(0, Math.round(raw * 100)));
}

function describe(words: number, nearness: number): ScoredMatch['how'] {
  if (words > 0 && nearness >= NEAR_MISS_FLOOR) return 'both';
  if (words > 0) return 'the same words';
  return 'a near miss';
}

/**
 * The best candidates, closest first, at most one per answer.
 *
 * One answer per row matters: a well-used answer may have forty stored wordings,
 * and without this the whole list would be forty wordings of the same answer with
 * the second-best answer pushed off the end.
 */
export function bestMatches(
  question: string,
  candidates: PhraseCandidate[],
  askedLanguage: string,
  limit: number,
): ScoredMatch[] {
  if (!Array.isArray(candidates) || limit <= 0) return [];

  const best = new Map<string, ScoredMatch>();
  for (const c of candidates) {
    const words = sharedWordScore(question, c.phrase);
    const scored: ScoredMatch = {
      ...c,
      score: scoreCandidate(question, c, askedLanguage),
      how: describe(words, clamp01(c.nearness)),
    };
    const held = best.get(c.answerEntryId);
    if (!held || scored.score > held.score) best.set(c.answerEntryId, scored);
  }

  // Sorted by score, and by answer id when scores tie, so the same call always
  // returns the same order — a list that reshuffles between two identical reads
  // is impossible to test and impossible to trust.
  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score || a.answerEntryId.localeCompare(b.answerEntryId),
    )
    .slice(0, limit);
}

/**
 * The word-search query to hand the database, or null when there is nothing in
 * the text worth searching for.
 *
 * ANY of the meaning words, not all of them. All of them is the default in
 * Postgres and it is wrong here: somebody who types "hi when will my refund
 * arrive please" would match nothing at all, because no stored phrase contains
 * "hi" and "please" too. Any of them casts a wide net and the scoring above
 * decides — which is the right division of labour, because the database is fast
 * at finding candidates and bad at judging them.
 *
 * The same word list that drives the scoring drives the search, so the two can
 * never disagree about what a question is about.
 *
 * SAFETY: this string becomes part of a database search query, so the only thing
 * that may survive into it is letters and the marks that attach to them. Nothing
 * a person types can change what the query means.
 */
export function tsQueryFor(question: string, maxWords = 20): string | null {
  const words = meaningfulWords(question)
    .map((w) => w.replace(/[^\p{L}\p{M}]/gu, ''))
    .filter((w) => w.length > 0)
    .slice(0, Math.max(0, maxWords));
  return words.length > 0 ? words.join(' | ') : null;
}
