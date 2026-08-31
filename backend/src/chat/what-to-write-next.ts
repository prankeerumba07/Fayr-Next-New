import { meaningfulWords } from '../assistant/matching';

/**
 * WHAT THE TEAM SHOULD WRITE AN ANSWER FOR NEXT.
 *
 * The answer book is only as good as what is in it, and the honest way to decide
 * what goes in next is to look at what people keep asking that nobody could
 * answer. That pile already exists — every question the assistant could not
 * answer is written down with the words somebody actually typed.
 *
 * PURE. No database. It is handed the rows and returns the groups, so the
 * grouping can be checked without a server.
 *
 * ── HOW THE GROUPING WORKS, AND WHAT IT DOES NOT CATCH ──────────────────────
 *
 * Two questions land in the same group when they use the SAME MEANINGFUL WORDS,
 * whatever order they are in. "where is my refund" and "my refund, where is it"
 * group together. "refund not arrived" does NOT: it shares one word out of two
 * and is a different set.
 *
 * That is deliberately a simple rule, and it is the right kind of simple. It can
 * be explained to the person reading the screen in one sentence, it never groups
 * two things that are actually different, and every group carries the real
 * sentences somebody typed so a person can see what got put together. A cleverer
 * grouping that occasionally lumped two unrelated questions into one row would
 * send somebody off to write the wrong answer.
 *
 * WHAT IT MISSES: the same question asked in different words, and the same
 * question asked in a different language. Both come out as separate rows, which
 * over-counts the number of things to write and never under-counts any of them.
 * Erring that way round means the screen never hides work.
 */

/** One question, as much of it as the grouping needs. */
export interface AskedQuestion {
  id: string;
  rawText: string;
  detectedLanguage: string;
  askedAt: Date | string;
  topic?: string | null;
}

/** One thing the team could write an answer for. */
export interface ToWrite {
  /** The words the group is keyed on, so the rule is visible on the screen. */
  signature: string;
  /** How many people asked it. */
  asked: number;
  /** Which languages it was asked in, so a translation gap shows up as one. */
  languages: string[];
  /** What kinds it was filed under, when anybody said. */
  topics: string[];
  /** Real sentences, newest first, so a person can see what was grouped. */
  examples: string[];
  /** When it was last asked, so a dead question sinks. */
  lastAskedAt: string;
}

/** How many real sentences to keep per group. Enough to judge, not a wall. */
export const EXAMPLES_PER_GROUP = 4;

/**
 * The signature two questions share when they mean the same thing to us.
 *
 * Meaningful words only — the function words are dropped by the same list the
 * search already uses, so "where is my refund" and "wheres the refund" agree.
 * Sorted, so word order does not matter. Deduplicated, so saying a word twice
 * does not make a new group.
 */
export function signatureOf(text: string): string {
  const words = meaningfulWords(String(text ?? ''));
  return [...new Set(words)].sort().join(' ');
}

function asDate(value: Date | string): number {
  const at = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(at) ? at : 0;
}

/**
 * Group them, most asked first.
 *
 * Ties break on which was asked most recently, because between two things asked
 * three times each the live one is the one worth writing about today.
 */
export function whatToWriteNext(
  questions: AskedQuestion[],
  limit = 20,
): ToWrite[] {
  const rows = Array.isArray(questions) ? questions : [];
  const groups = new Map<string, {
    signature: string;
    asked: number;
    languages: Set<string>;
    topics: Set<string>;
    examples: { text: string; at: number }[];
    lastAt: number;
  }>();

  for (const q of rows) {
    if (!q || typeof q.rawText !== 'string' || q.rawText.trim() === '') continue;
    const signature = signatureOf(q.rawText);
    // Nothing meaningful in it at all. Not a question we can group, and
    // certainly not one to send somebody off to write an answer for.
    if (signature === '') continue;

    const at = asDate(q.askedAt);
    let g = groups.get(signature);
    if (!g) {
      g = {
        signature,
        asked: 0,
        languages: new Set(),
        topics: new Set(),
        examples: [],
        lastAt: 0,
      };
      groups.set(signature, g);
    }
    g.asked += 1;
    if (typeof q.detectedLanguage === 'string' && q.detectedLanguage) {
      g.languages.add(q.detectedLanguage);
    }
    if (typeof q.topic === 'string' && q.topic) g.topics.add(q.topic);
    g.examples.push({ text: q.rawText.trim(), at });
    if (at > g.lastAt) g.lastAt = at;
  }

  return [...groups.values()]
    .sort((a, b) => b.asked - a.asked || b.lastAt - a.lastAt)
    .slice(0, Math.max(1, limit))
    .map((g) => ({
      signature: g.signature,
      asked: g.asked,
      languages: [...g.languages].sort(),
      topics: [...g.topics].sort(),
      examples: g.examples
        .sort((a, b) => b.at - a.at)
        .slice(0, EXAMPLES_PER_GROUP)
        .map((e) => e.text),
      lastAskedAt: new Date(g.lastAt).toISOString(),
    }));
}

/**
 * A name for a new answer, made out of the words somebody asked.
 *
 * Lowercase letters, numbers and dashes only, because that is what an answer's
 * name may be. Short, because a name is read in a list. Never empty: a question
 * with nothing nameable in it still gets a name, so the button never fails on
 * words we did not expect.
 */
export function keyFromQuestion(text: string, fallback = 'a-new-answer'): string {
  const words = meaningfulWords(String(text ?? ''))
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w !== '');
  const key = words.slice(0, 5).join('-').slice(0, 60).replace(/-+$/, '');
  return key === '' ? fallback : key;
}
