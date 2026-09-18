/**
 * THE FAYR SCORE, SERVER SIDE — AND IT IS THE SECOND COPY OF ONE RULE.
 *
 * ── WHY THERE ARE TWO, AND WHY NEITHER COULD BE DELETED ────────────────────
 *
 * src/review/theFayrScore.js answers as somebody types, which cannot be a
 * network call per keystroke. This copy exists because THE SERVER SCORES WHAT IT
 * STORES: a number the server cannot vouch for is not worth keeping, so the app
 * never sends a score at all — it sends the text, and this works the score out
 * from the text it is about to store.
 *
 * ── HOW THE TWO ARE KEPT FROM DRIFTING ─────────────────────────────────────
 *
 * Every word list below was spliced out of the app copy rather than retyped, so
 * the port cannot be a transcription error on the day it was made. Afterwards,
 * src/review/score-fixtures.json holds one table of reviews and expected answers
 * that BOTH sides run over — this file in fayr-score.spec.ts, the app copy in
 * theFayrScore.test.mjs — so a rule changed on one side and not the other fails
 * on both. That table says plainly what it does not prove.
 *
 * ── AND EVERYTHING THE APP COPY SAYS ABOUT THE RULES IS TRUE HERE ──────────
 *
 * It measures how DESCRIPTIVE a review is and never how positive. Evaluation
 * words of both directions are removed before anything is counted, and the
 * stock-phrase list is written with a hole in it — `*` stands for any evaluation
 * word — so it cannot tell praise from complaint even in principle. Read the
 * long note at the top of src/review/theFayrScore.js for the whole argument; it
 * is not repeated here because two copies of an argument drift exactly as two
 * copies of a rule do.
 *
 * IT MOVES NO MONEY. Nothing reads this to decide a refund, a hold or a state.
 */

export const THIN = 'THIN';
export const FAIR = 'FAIR';
export const STRONG = 'STRONG';
export type ScoreBand = typeof THIN | typeof FAIR | typeof STRONG;

export const WHY = {
  NOTHING_WRITTEN: 'nothing has been written yet',
  STOCK_PHRASES: 'it uses phrases that are on almost every review',
  FEW_WORDS: 'there are only a few different words in it',
  NOTHING_SPECIFIC: 'nothing in it is specific to this product',
  ONLY_THE_TRANSACTION: 'it is about the delivery rather than the product',
} as const;

export const TIME = 'TIME';
export const AMOUNT = 'AMOUNT';
export const COMPARISON = 'COMPARISON';
export const SENSE = 'SENSE';
export const KINDS: readonly string[] = [TIME, AMOUNT, COMPARISON, SENSE];

/** Categories to think about, never words to copy. See the app copy's note. */
export const MISSING: Record<string, string> = {
  [TIME]: 'how it held up over time',
  [AMOUNT]: 'anything you can put a number on',
  [COMPARISON]: 'how it compares with what you used before',
  [SENSE]: 'what it looks, feels, smells or sounds like',
};

export const PER_WORD = 8;
export const PER_KIND = 12;
export const PER_STOCK_PHRASE = 15;
export const THE_FAIR_LINE = 35;
export const THE_STRONG_LINE = 70;

export const STOCK_PHRASES: readonly string[] = [

  // ── an evaluation word doing all the work, whichever way it points ───────
  '* product', '* quality', '* one', '* buy', '* purchase', '* item',
  '* thing', '* stuff', '* it', '* deal', '* value', '* choice',
  // ── an intensifier in front of one, which adds nothing to nothing ────────
  'very *', 'really *', 'absolutely *', 'highly *', 'totally *', 'extremely *',
  'super *', 'fully *', 'completely *', 'simply *', 'truly *', 'quite *',
  '* *',
  // ── and the set phrases that carry no evaluation word at all ─────────────
  'value for money', 'value for the price', '* of money', '* of time',
  'must buy', 'must have', 'never buy', 'do not buy', 'dont buy',
  'do not recommend', 'dont recommend', 'not recommended',
  'as expected', 'not as expected', 'no complaints', 'nothing to complain',
  'thanks seller', 'thank you seller', 'happy with the purchase',
  'as described', 'as shown', 'go for it', 'dont go for it',
];

const ORDINARY: readonly string[] = [

  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
  'i', 'my', 'me', 'mine', 'we', 'our', 'us', 'you', 'your', 'he', 'she',
  'his', 'her', 'they', 'them', 'their',
  'for', 'of', 'to', 'in', 'on', 'at', 'with', 'from', 'as', 'by', 'into',
  'out', 'up', 'down', 'off', 'over', 'under', 'about', 'after', 'before',
  'all', 'any', 'some', 'no', 'not', 'yes', 'only', 'just', 'still', 'also',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'can', 'could', 'may', 'might', 'must',
  'get', 'got', 'give', 'gave', 'go', 'went', 'make', 'made', 'use', 'used',
  'using', 'buy', 'bought', 'try', 'tried', 'said', 'say', 'think', 'know',
  'what', 'when', 'where', 'which', 'who', 'why', 'how', 'now', 'ever',
  'everyone', 'everybody', 'anyone', 'one', 'am', 'im', 'ive', 'its', 'dont',
];

const EVALUATION_PAIRS: readonly (readonly string[])[] = [

  ['good', 'bad'], ['nice', 'nasty'], ['great', 'awful'],
  ['amazing', 'terrible'], ['excellent', 'poor'], ['perfect', 'useless'],
  ['best', 'worst'], ['love', 'hate'], ['loved', 'hated'], ['loves', 'hates'],
  ['like', 'dislike'], ['liked', 'disliked'], ['wonderful', 'horrible'],
  ['fantastic', 'rubbish'], ['superb', 'pathetic'], ['lovely', 'ugly'],
  ['happy', 'unhappy'], ['satisfied', 'disappointed'], ['pleased', 'annoyed'],
  ['recommend', 'avoid'], ['worth', 'waste'], ['fine', 'faulty'],
  ['brilliant', 'dreadful'], ['impressed', 'unimpressed'], ['awesome', 'crap'],
  ['super', 'lousy'], ['favourite', 'regret'], ['delighted', 'upset'],
];

const INTENSIFIERS: readonly string[] = [

  'very', 'really', 'quite', 'too', 'extremely', 'absolutely', 'highly',
  'totally', 'fully', 'completely', 'entirely', 'definitely', 'certainly',
  'pretty', 'fairly', 'much', 'more', 'most', 'less', 'least', 'well', 'better',
  'worse', 'good', 'simply', 'truly', 'honestly', 'literally',
];

const TRANSACTION: readonly string[] = [

  'delivery', 'delivered', 'deliver', 'delivering', 'courier', 'shipping',
  'shipped', 'dispatch', 'dispatched', 'arrived', 'arrival', 'packaging',
  'packed', 'packing', 'package', 'parcel', 'box', 'seller', 'sellers',
  'order', 'ordered', 'ordering', 'refund', 'refunded', 'return', 'returned',
  'exchange', 'replacement', 'service', 'app', 'site', 'website', 'shop',
  'store', 'amazon', 'flipkart', 'meesho', 'zepto', 'blinkit', 'instamart',
  'swiggy', 'thanks', 'thank', 'thankyou',
];

const GENERIC_THING: readonly string[] = [

  'product', 'products', 'item', 'items', 'thing', 'things', 'stuff',
  'purchase', 'purchased', 'quality', 'brand', 'company', 'piece', 'pieces',
  'model', 'version', 'goods',
];

const NUMBER_WORDS: readonly string[] = [

  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'dozen', 'half', 'couple', 'few', 'several',
  'many', 'twice', 'thrice', 'double', 'triple',
];

const EVALUATION_SET = new Set(EVALUATION_PAIRS.flat());

const NOT_CONTENT = new Set<string>([
  ...ORDINARY,
  ...EVALUATION_PAIRS.flat(),
  ...INTENSIFIERS,
  ...TRANSACTION,
  ...GENERIC_THING,
  ...NUMBER_WORDS,
]);

const TIME_WORDS: readonly string[] = [

  'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days',
  'week', 'weeks', 'month', 'months', 'year', 'years', 'fortnight',
  'overnight', 'daily', 'weekly', 'monthly', 'lasted', 'lasts', 'lasting',
  'since', 'ago', 'yesterday', 'today', 'tomorrow', 'morning', 'evening',
  'night', 'initially', 'eventually', 'gradually',
];

const UNIT_WORDS: readonly string[] = [

  'ml', 'mls', 'litre', 'litres', 'liter', 'liters', 'gm', 'gms', 'gram',
  'grams', 'kg', 'kgs', 'kilo', 'kilos', 'cm', 'mm', 'inch', 'inches', 'feet',
  'metre', 'metres', 'percent', 'rupees', 'rs', 'watt', 'watts', 'hrs',
];

const COMPARISON_WORDS: readonly string[] = [

  'than', 'compared', 'compare', 'comparing', 'versus', 'vs', 'unlike',
  'instead', 'previously', 'previous', 'earlier', 'former', 'whereas',
  'rather', 'against',
];

const SENSE_WORDS: readonly string[] = [

  'texture', 'smell', 'smells', 'smelt', 'smelled', 'scent', 'fragrance',
  'taste', 'tastes', 'tasted', 'flavour', 'flavor', 'sound', 'sounds',
  'noise', 'noisy', 'loud', 'quiet', 'silent', 'weight', 'heavy', 'light',
  'lightweight', 'soft', 'hard', 'firm', 'thick', 'thin', 'smooth', 'rough',
  'sticky', 'oily', 'greasy', 'dry', 'wet', 'damp', 'warm', 'cold', 'hot',
  'cool', 'bright', 'dull', 'matte', 'glossy', 'shiny', 'colour', 'color',
  'fabric', 'material', 'plastic', 'metal', 'rubber', 'foam', 'foams',
  'lather', 'feel', 'feels', 'felt', 'look', 'looks', 'looked', 'grip',
  'sturdy', 'flimsy', 'fragile', 'stiff', 'stretchy', 'itchy', 'scratchy',
  'creamy', 'watery', 'bitter', 'sweet', 'salty', 'sour', 'minty', 'shape',
  'size', 'fit', 'fits', 'tight', 'loose', 'sharp', 'blunt',
];

const has = (words: readonly string[], list: readonly string[]): boolean =>
  list.some((w) => words.indexOf(w) >= 0);

/** Counting only. The stored text is never touched — see ReviewService. */
export function tidy(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function allWords(text: unknown): string[] {
  const t = tidy(text);
  return t === '' ? [] : t.split(' ');
}

export function contentWords(text: unknown): string[] {
  const seen: string[] = [];
  for (const word of allWords(text)) {
    if (word.length < 2) continue;
    if (/^\d+$/.test(word)) continue;
    if (NOT_CONTENT.has(word)) continue;
    if (seen.indexOf(word) === -1) seen.push(word);
  }
  return seen;
}

export function specificKinds(text: unknown): string[] {
  const words = allWords(text);
  const out: string[] = [];
  if (has(words, TIME_WORDS)) out.push(TIME);
  if (
    words.some((w) => /^\d+$/.test(w)) ||
    has(words, UNIT_WORDS) ||
    has(words, NUMBER_WORDS)
  ) {
    out.push(AMOUNT);
  }
  if (has(words, COMPARISON_WORDS)) out.push(COMPARISON);
  if (has(words, SENSE_WORDS)) out.push(SENSE);
  return out;
}

/** Every evaluation word becomes `*`, which is what makes the list blind. */
export function flattenEvaluation(text: unknown): string[] {
  return allWords(text).map((w) => (EVALUATION_SET.has(w) ? '*' : w));
}

function containsRun(words: readonly string[], run: readonly string[]): boolean {
  for (let i = 0; i + run.length <= words.length; i += 1) {
    let all = true;
    for (let j = 0; j < run.length; j += 1) {
      if (words[i + j] !== run[j]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

export function stockPhrasesIn(text: unknown): string[] {
  const flat = flattenEvaluation(text);
  if (flat.length === 0) return [];
  return STOCK_PHRASES.filter((p) => containsRun(flat, p.split(' ')));
}

export interface FayrScore {
  score: number;
  band: ScoreBand;
  because: string[];
  missing: string[];
  words: number;
  kinds: string[];
  stock: number;
}

export function theFayrScore(text: unknown): FayrScore {
  const words = contentWords(text);
  const kinds = specificKinds(text);
  const stock = stockPhrasesIn(text);

  const raw =
    words.length * PER_WORD +
    kinds.length * PER_KIND -
    stock.length * PER_STOCK_PHRASE;
  const score = Math.max(0, Math.min(100, raw));

  const because: string[] = [];
  if (tidy(text) === '') because.push(WHY.NOTHING_WRITTEN);
  else {
    if (stock.length > 0) because.push(WHY.STOCK_PHRASES);
    if (words.length < 4) because.push(WHY.FEW_WORDS);
    if (kinds.length === 0) because.push(WHY.NOTHING_SPECIFIC);
    if (words.length === 0 && has(allWords(text), TRANSACTION)) {
      because.push(WHY.ONLY_THE_TRANSACTION);
    }
  }

  return {
    score,
    band:
      score >= THE_STRONG_LINE ? STRONG : score >= THE_FAIR_LINE ? FAIR : THIN,
    because,
    missing: KINDS.filter((k) => kinds.indexOf(k) === -1).map((k) => MISSING[k]),
    words: words.length,
    kinds,
    stock: stock.length,
  };
}
