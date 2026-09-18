// THE FAYR SCORE: HOW DESCRIPTIVE A REVIEW IS. NEVER HOW POSITIVE.
//
// ── THE OWNER'S OWN WORDS, BECAUSE EVERYTHING HERE FOLLOWS FROM THEM ────────
//
// "A Fayr score is something where the user cannot write a 2-3 word review ...
// If he is giving a bad review, a neutral review or a good review, they are
// giving their fair review. Whatever review is given, the score will show how
// good his review is. Even if it is bad — 'The texture is not nice, this is not
// nice' — it is scoring. Even a worse review is also a worse review, so it is a
// fair review."
//
// So: a one-star review saying "separated after a week and left an oily film"
// MUST score higher than a five-star "amazing product loved it". If this file
// ever ranks those the other way round it is broken, and that is the single
// easiest thing to get wrong here.
//
// ── HOW SENTIMENT-BLINDNESS IS ACHIEVED, AND IT IS STRUCTURAL ───────────────
//
// Not by balancing two lists of feelings. By having NO measure of feeling at all:
//
//   EVALUATION WORDS OF BOTH DIRECTIONS ARE REMOVED BEFORE ANYTHING IS COUNTED.
//   "amazing" and "terrible" are treated identically — as nothing. They say how
//   somebody felt, which this file does not measure, and they describe nothing
//   about the product, which is the only thing it does measure.
//
//   THE STOCK-PHRASE LIST CARRIES BOTH DIRECTIONS TOO. A list of only "loved it"
//   and "must buy" would penalise praise and let filler complaint through, and
//   that is sentiment bias arriving through the back door. So "waste of money"
//   and "worst product" sit in the same list as "value for money" and "must buy".
//
// The check that matters most in theFayrScore.test.mjs walks a MATCHED PAIR: the
// same review written approvingly and disapprovingly, same specifics, and asserts
// THE SAME SCORE.
//
// ── AND FAYR NEVER WRITES ANYBODY'S REVIEW ──────────────────────────────────
//
// No suggestions, no autocomplete, no templates, no examples to copy, and
// absolutely no generated text. The whole company rests on these being real
// opinions from real people who really used the thing; a review Fayr helped write
// is the exact fraud it exists to replace.
//
// This file may say a review is THIN. It may name CATEGORIES worth thinking about
// — how it behaved over time, how it compared with what they used before — which
// is a prompt to think and not words to copy. It must never produce a phrase
// somebody could paste. There is no sentence in `MISSING` below that could be.
//
// ── EVERY NUMBER IN HERE IS A GUESS ─────────────────────────────────────────
//
// Nobody has scored a real Fayr review. The weights, the thresholds and the band
// edges are what "descriptive" looks like from first principles, not from data,
// exactly as theRightProduct.js's thresholds are. The score and its reasons are
// written to the log so they can be tuned against real writing.
//
// ── AND IT WARNS, IT NEVER BLOCKS ───────────────────────────────────────────
//
// Nothing here refuses, withholds or disables anything. A thin review is scored
// thin and the person is told which KINDS of thing would make it fuller. They may
// send it exactly as it is. The owner chose this over blocking.
//
// ── THERE IS A SECOND COPY OF THIS FILE, ON PURPOSE ─────────────────────────
//
// backend/src/reviews/fayr-score.ts is the same rules in TypeScript, because the
// SERVER scores what it stores — a number the server cannot vouch for is not
// worth storing — while this copy answers as somebody types, which cannot be a
// network call per keystroke. The app never sends a score; it sends the text.
//
// The two are kept honest by one shared table of reviews and expected answers,
// src/review/score-fixtures.json, which both this file's checks and the backend's
// read. A rule changed in one copy and not the other fails on both sides.

/** The three bands. A person cannot act on "62"; they can act on "thin". */
export const THIN = 'THIN';
export const FAIR = 'FAIR';
export const STRONG = 'STRONG';

/** Named reasons, for the screen to say something useful and the log to carry. */
export const WHY = {
  NOTHING_WRITTEN: 'nothing has been written yet',
  STOCK_PHRASES: 'it uses phrases that are on almost every review',
  FEW_WORDS: 'there are only a few different words in it',
  NOTHING_SPECIFIC: 'nothing in it is specific to this product',
  ONLY_THE_TRANSACTION: 'it is about the delivery rather than the product',
};

/** The kinds of specific thing a review can carry. Categories, never words. */
export const TIME = 'TIME';
export const AMOUNT = 'AMOUNT';
export const COMPARISON = 'COMPARISON';
export const SENSE = 'SENSE';
export const KINDS = [TIME, AMOUNT, COMPARISON, SENSE];

/**
 * WHAT A MISSING KIND IS CALLED ON SCREEN.
 *
 * READ THESE AGAINST THE RULE ABOVE. Every one names a CATEGORY of thing to
 * think about. Not one of them contains a phrase somebody could paste into the
 * box, an example sentence, or an instruction to say any particular thing. If a
 * future line here starts with "try saying" or carries a quoted phrase, the rule
 * has been broken — and there is a check that refuses exactly that.
 */
export const MISSING = {
  [TIME]: 'how it held up over time',
  [AMOUNT]: 'anything you can put a number on',
  [COMPARISON]: 'how it compares with what you used before',
  [SENSE]: 'what it looks, feels, smells or sounds like',
};

/** What each distinct content word is worth. */
export const PER_WORD = 8;
/** What each KIND of specific is worth. Kinds, not occurrences — see theFayrScore. */
export const PER_KIND = 12;
/** What each stock phrase takes off. Larger than a word is worth, on purpose. */
export const PER_STOCK_PHRASE = 15;
/** Below this it is thin; at or above THE_STRONG_LINE it is strong. */
export const THE_FAIR_LINE = 35;
export const THE_STRONG_LINE = 70;

/**
 * THE PHRASES THAT APPEAR ON ALMOST EVERY REVIEW EVER WRITTEN.
 *
 * ── WRITTEN WITH A HOLE IN THEM, AND THAT IS THE WHOLE DESIGN ──────────────
 *
 * `*` stands for ANY evaluation word, in either direction. So one pattern —
 * `* product` — catches "good product", "bad product", "nice product", "worst
 * product" and every other one, and it is impossible for the list to penalise
 * praise more than complaint because it cannot tell them apart.
 *
 * THE FIRST WRITING OF THIS FILE DID NOT DO THAT and it was wrong within an
 * hour. It listed "loved it" and not "hated it", so the matched-pair check —
 * the same review ending "I loved it" and "I hated it" — came back 57 against
 * 72. A hand-written list of both directions is a list somebody has to keep
 * balanced by eye for ever, and this is the third phase in which reading prose
 * instead of structure has cost something. The hole is structural: there is no
 * list to keep balanced.
 *
 * Matched as consecutive WORDS, never as a substring, so "* it" cannot strike
 * "* items".
 */
export const STOCK_PHRASES = [
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

/**
 * ORDINARY ENGLISH, which describes nothing about any product.
 */
const ORDINARY = [
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

/**
 * EVALUATION, IN BOTH DIRECTIONS, AND IT IS WHAT MAKES THIS SENTIMENT-BLIND.
 *
 * Written as PAIRS so the symmetry can be seen by eye and checked by a test: for
 * every way of saying a thing is good there is the matching way of saying it is
 * bad, and both are removed before a single word is counted. They tell us how
 * somebody felt, which this file does not measure, and they describe nothing
 * about the product, which is the only thing it does.
 *
 * A word that appears here can never raise or lower a score. That is the point.
 */
const EVALUATION_PAIRS = [
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

/** Intensifiers, which carry no direction at all and describe nothing either. */
const INTENSIFIERS = [
  'very', 'really', 'quite', 'too', 'extremely', 'absolutely', 'highly',
  'totally', 'fully', 'completely', 'entirely', 'definitely', 'certainly',
  'pretty', 'fairly', 'much', 'more', 'most', 'less', 'least', 'well', 'better',
  'worse', 'good', 'simply', 'truly', 'honestly', 'literally',
];

/**
 * THE TRANSACTION, WHICH IS NOT THE PRODUCT.
 *
 * "fast delivery" and "well packed" are about the courier. A brand paying for
 * descriptive feedback about its product learns nothing from either, so neither
 * counts as content — and a review made only of these is named as such.
 */
const TRANSACTION = [
  'delivery', 'delivered', 'deliver', 'delivering', 'courier', 'shipping',
  'shipped', 'dispatch', 'dispatched', 'arrived', 'arrival', 'packaging',
  'packed', 'packing', 'package', 'parcel', 'box', 'seller', 'sellers',
  'order', 'ordered', 'ordering', 'refund', 'refunded', 'return', 'returned',
  'exchange', 'replacement', 'service', 'app', 'site', 'website', 'shop',
  'store', 'amazon', 'flipkart', 'meesho', 'zepto', 'blinkit', 'instamart',
  'swiggy', 'thanks', 'thank', 'thankyou',
];

/** The generic nouns for "the thing", which name nothing about it. */
const GENERIC_THING = [
  'product', 'products', 'item', 'items', 'thing', 'things', 'stuff',
  'purchase', 'purchased', 'quality', 'brand', 'company', 'piece', 'pieces',
  'model', 'version', 'goods',
];

/** Number words, which count as an AMOUNT but are not descriptive on their own. */
const NUMBER_WORDS = [
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'dozen', 'half', 'couple', 'few', 'several',
  'many', 'twice', 'thrice', 'double', 'triple',
];

/** Every evaluation word, either direction, as one set — see flattenEvaluation. */
const EVALUATION_SET = new Set(EVALUATION_PAIRS.flat());

const NOT_CONTENT = new Set([
  ...ORDINARY,
  ...EVALUATION_PAIRS.flat(),
  ...INTENSIFIERS,
  ...TRANSACTION,
  ...GENERIC_THING,
  ...NUMBER_WORDS,
]);

/** Exported so a check can prove the evaluation list really is symmetric. */
export const EVALUATION_WORDS = EVALUATION_PAIRS;
/** Exported so a check can prove a transaction-only review scores as one. */
export const TRANSACTION_WORDS = TRANSACTION;

/** Words that are about time, so "after about a week" is recognised as one. */
const TIME_WORDS = [
  'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days',
  'week', 'weeks', 'month', 'months', 'year', 'years', 'fortnight',
  'overnight', 'daily', 'weekly', 'monthly', 'lasted', 'lasts', 'lasting',
  'since', 'ago', 'yesterday', 'today', 'tomorrow', 'morning', 'evening',
  'night', 'initially', 'eventually', 'gradually',
];

/** Units, so "75 ml" and "2 kg" are recognised as an amount. */
const UNIT_WORDS = [
  'ml', 'mls', 'litre', 'litres', 'liter', 'liters', 'gm', 'gms', 'gram',
  'grams', 'kg', 'kgs', 'kilo', 'kilos', 'cm', 'mm', 'inch', 'inches', 'feet',
  'metre', 'metres', 'percent', 'rupees', 'rs', 'watt', 'watts', 'hrs',
];

/** Markers that something is being compared with something else. */
const COMPARISON_WORDS = [
  'than', 'compared', 'compare', 'comparing', 'versus', 'vs', 'unlike',
  'instead', 'previously', 'previous', 'earlier', 'former', 'whereas',
  'rather', 'against',
];

/**
 * THE SENSES, and the physical properties a person can actually observe.
 *
 * Sentiment-free by construction: "thick" and "thin", "soft" and "hard",
 * "sturdy" and "flimsy" are all here, and none of them is an opinion — they are
 * what the thing is like. A sense word counts twice on purpose: once as a
 * distinct content word and once as evidence of a specific.
 */
const SENSE_WORDS = [
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

const has = (words, list) => list.some((w) => words.indexOf(w) >= 0);

/**
 * THE TEXT, TIDIED, FOR COUNTING ONLY.
 *
 * NOTHING HERE EVER TOUCHES WHAT IS STORED OR SHOWN. The person's own words are
 * kept exactly as they typed them, everywhere — this produces a throwaway copy
 * used to count things and is discarded. See the note on the service, which
 * stores the text untouched.
 */
export function tidy(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Every word of it, in order, including the ones that will not be counted. */
export function allWords(text) {
  const t = tidy(text);
  return t === '' ? [] : t.split(' ');
}

/**
 * THE DISTINCT WORDS THAT ACTUALLY DESCRIBE SOMETHING.
 *
 * DISTINCT, NOT TOTAL, and that is the whole defence against padding: "very nice
 * very nice very nice" is one word three times and scores as nothing, while
 * "leaks at the seam" is four words of which two are real.
 */
export function contentWords(text) {
  const seen = [];
  for (const word of allWords(text)) {
    if (word.length < 2) continue;
    if (/^\d+$/.test(word)) continue;
    if (NOT_CONTENT.has(word)) continue;
    if (seen.indexOf(word) === -1) seen.push(word);
  }
  return seen;
}

/** Which KINDS of specific this review carries. */
export function specificKinds(text) {
  const words = allWords(text);
  const out = [];
  if (has(words, TIME_WORDS)) out.push(TIME);
  if (words.some((w) => /^\d+$/.test(w)) || has(words, UNIT_WORDS)
    || has(words, NUMBER_WORDS)) out.push(AMOUNT);
  if (has(words, COMPARISON_WORDS)) out.push(COMPARISON);
  if (has(words, SENSE_WORDS)) out.push(SENSE);
  return out;
}

/**
 * THE TEXT WITH EVERY EVALUATION WORD REPLACED BY `*`.
 *
 * This is what makes the stock-phrase list sentiment-blind rather than
 * sentiment-balanced: after this, "loved it" and "hated it" are the same three
 * characters, and no list needs keeping level by hand.
 *
 * `*` can never occur naturally here, because tidy() has already removed every
 * character that is not a letter or a digit.
 */
export function flattenEvaluation(text) {
  return allWords(text).map((w) => (EVALUATION_SET.has(w) ? '*' : w));
}

/** Does this run of words contain that run of words, whole and in order? */
function containsRun(words, run) {
  for (let i = 0; i + run.length <= words.length; i += 1) {
    let all = true;
    for (let j = 0; j < run.length; j += 1) {
      if (words[i + j] !== run[j]) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

/** Which stock phrases it uses, counted once each however often they appear. */
export function stockPhrasesIn(text) {
  const flat = flattenEvaluation(text);
  if (flat.length === 0) return [];
  return STOCK_PHRASES.filter((p) => containsRun(flat, p.split(' ')));
}

/**
 * THE SCORE, THE BAND, AND WHY.
 *
 * Answers `{ score, band, because, missing, words, kinds, stock }` — the counts
 * as well as the answer, because the log carries them and they are what make the
 * weights above tunable against real writing.
 *
 * KINDS AND NOT OCCURRENCES. Four mentions of time are one kind of specific.
 * Counting occurrences would reward saying the same sort of thing repeatedly,
 * which is padding by another name.
 */
export function theFayrScore(text) {
  const words = contentWords(text);
  const kinds = specificKinds(text);
  const stock = stockPhrasesIn(text);

  const raw = words.length * PER_WORD
    + kinds.length * PER_KIND
    - stock.length * PER_STOCK_PHRASE;
  const score = Math.max(0, Math.min(100, raw));

  const because = [];
  if (tidy(text) === '') because.push(WHY.NOTHING_WRITTEN);
  else {
    if (stock.length > 0) because.push(WHY.STOCK_PHRASES);
    if (words.length < 4) because.push(WHY.FEW_WORDS);
    if (kinds.length === 0) because.push(WHY.NOTHING_SPECIFIC);
    // A review made ONLY of the transaction is named as such: it talks about the
    // courier and says nothing at all about the thing that was bought.
    if (words.length === 0 && has(allWords(text), TRANSACTION)) {
      because.push(WHY.ONLY_THE_TRANSACTION);
    }
  }

  return {
    score,
    band: score >= THE_STRONG_LINE ? STRONG : score >= THE_FAIR_LINE ? FAIR : THIN,
    because,
    // CATEGORIES TO THINK ABOUT, never words to copy. See the note on MISSING.
    missing: KINDS.filter((k) => kinds.indexOf(k) === -1).map((k) => MISSING[k]),
    words: words.length,
    kinds,
    stock: stock.length,
  };
}
