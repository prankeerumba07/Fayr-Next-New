/**
 * WHICH LANGUAGE DID THIS PERSON WRITE IN?
 *
 * Pure, and deliberately small. It answers one question — what does this text
 * look like — and it answers it with a number saying how sure it is, because a
 * guess recorded as a fact is the thing that goes wrong later.
 *
 * Fayr's users write in three ways, and the third is the most common of all:
 *
 *   en      English            "when will my refund arrive"
 *   hi      Hindi              "मेरा पैसा कब आएगा"
 *   hi-en   Hindi, typed with  "mera refund kab aayega"
 *           English letters
 *
 * The third is not broken English and it is not broken Hindi. It is how a very
 * large number of people in India type, so it gets its own name and its own
 * answers.
 *
 * WHY WORD LISTS AND NOT A LIBRARY: every off-the-shelf detector we could use
 * reads "mera refund kab aayega" as English, because every letter in it is a
 * Latin letter. The thing we most need to tell apart is the thing they cannot
 * tell apart. The lists below are DATA — a fourth language is a fourth list, not
 * a rewrite of the function underneath.
 */

/** Every language the assistant can currently be asked in. */
export const LANGUAGES = ['en', 'hi', 'hi-en'] as const;
export type LanguageTag = (typeof LANGUAGES)[number];

/** What we fall back to when there is nothing at all to go on. */
export const DEFAULT_LANGUAGE: LanguageTag = 'en';

export interface LanguageGuess {
  language: LanguageTag;
  /**
   * How sure we are, 0 to 100. Zero means there was nothing to read — not
   * "definitely English". Nothing downstream should treat a low number as a fact.
   */
  confidence: number;
}

/**
 * Hindi words as people type them with English letters. Function words and the
 * words that come up when money is late, which is what people write in about.
 *
 * Only words that are NOT also English words: a list that counts "to" or "is"
 * as Hindi would read half the English questions as Hindi.
 */
// prettier-ignore
export const HINDI_IN_LATIN = new Set([
  // who and whose
  'mera', 'meri', 'mere', 'aapka', 'aapki', 'apna', 'hamara', 'tumhara',
  'bhai', 'bhaiya', 'didi', 'ji',
  // question words
  'kab', 'kyun', 'kyu', 'kya', 'kaise', 'kaisa', 'kaun', 'kahan', 'kitna',
  'kitne', 'kitni', 'kaunsa',
  // being and having — NOT 'the' (a Hindi word, and the commonest English one)
  'hai', 'hain', 'tha', 'thi', 'hua', 'hui', 'hue', 'hoga', 'hogi', 'hona',
  'raha', 'rahi', 'rahe',
  // getting and giving
  'mila', 'mili', 'mile', 'milega', 'milegi', 'milta', 'aaya', 'aayi',
  'aayega', 'aayegi', 'diya', 'dena', 'dijiye', 'dedo', 'bhejo', 'bheja',
  'bhejiye', 'karo', 'kare', 'karna', 'kiya', 'kijiye', 'batao', 'bataye',
  'dekho', 'dekha', 'dikha', 'gaya', 'gayi', 'liya',
  // money and amounts — NOT 'rupee' or 'problem', which are English words Hindi speakers use constantly
  'paisa', 'paise', 'rupaye', 'pura', 'poora', 'adha', 'thoda', 'bahut',
  'jyada', 'zyada', 'kam',
  // yes, no, and judgement
  'nahi', 'nahin', 'haan', 'accha', 'achha', 'theek', 'thik', 'sahi',
  'galat', 'jhooth',
  // time and sequence
  'abhi', 'aaj', 'kal', 'jaldi', 'der', 'phir', 'wapas', 'wapis', 'baad',
  'pehle',
  // joining words
  'aur', 'lekin', 'magar', 'bhi', 'toh', 'kyunki', 'isliye', 'jab', 'tab',
  'mein', 'saath', 'liye', 'wala', 'wali', 'se', 'ko', 'ka', 'ki', 'ke',
  'tak', 'na',
  // being understood
  'samajh', 'pata', 'malum', 'maloom',
]);

/**
 * Ordinary English words. Used only to say how sure we are that something is
 * English — a sentence with none of these is still called English, just with a
 * low number attached.
 */
// prettier-ignore
export const ENGLISH_MARKERS = new Set([
  'a', 'an', 'am', 'and', 'are', 'about', 'been', 'but', 'can', 'did', 'do',
  'does', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'how', 'i',
  'if', 'in', 'is', 'it', 'me', 'my', 'no', 'not', 'of', 'on', 'or',
  'please', 'said', 'should', 'so', 'still', 'that', 'the', 'they', 'this',
  'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why',
  'will', 'with', 'would', 'yet', 'you', 'your',
]);

/**
 * How much of a sentence has to look like Hindi before we call it Hindi typed in
 * English letters. A fifth: below that it is an English sentence with a word
 * borrowed, and answering it in Hindi would be the wrong reply.
 */
const HINDI_IN_LATIN_THRESHOLD = 0.2;

/** How much Devanagari makes it Hindi outright rather than a mix. */
const DEVANAGARI_THRESHOLD = 0.3;

const LETTER = /\p{L}/u;
const DEVANAGARI_LETTER = /[ऀ-ॿ]/u;
// Letters AND attaching marks — see the note in matching.ts. Only fully Latin
// text ever reaches the word stage here, but the two must not disagree.
const WORD = /[\p{L}\p{M}]+/gu;

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(n)));
}

export function detectLanguage(text: string): LanguageGuess {
  if (typeof text !== 'string' || text.length === 0) {
    return { language: DEFAULT_LANGUAGE, confidence: 0 };
  }

  // Count letters, not characters: punctuation and digits say nothing about
  // language, and a sentence of exclamation marks must not read as confident.
  let letters = 0;
  let devanagari = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    letters += 1;
    if (DEVANAGARI_LETTER.test(ch)) devanagari += 1;
  }
  if (letters === 0) return { language: DEFAULT_LANGUAGE, confidence: 0 };

  const devanagariShare = devanagari / letters;
  if (devanagariShare >= DEVANAGARI_THRESHOLD) {
    return { language: 'hi', confidence: clamp(devanagariShare * 100, 60, 95) };
  }
  if (devanagari > 0) {
    // Hindi letters are present but most of it is not. That is a mixed sentence,
    // which is exactly what hi-en is for.
    return {
      language: 'hi-en',
      confidence: clamp(50 + devanagariShare * 100, 50, 90),
    };
  }

  const words = text.toLowerCase().match(WORD) ?? [];
  if (words.length === 0) return { language: DEFAULT_LANGUAGE, confidence: 0 };

  let hindiHits = 0;
  let englishHits = 0;
  for (const w of words) {
    if (HINDI_IN_LATIN.has(w)) hindiHits += 1;
    else if (ENGLISH_MARKERS.has(w)) englishHits += 1;
  }

  const hindiShare = hindiHits / words.length;
  if (hindiShare >= HINDI_IN_LATIN_THRESHOLD) {
    return {
      language: 'hi-en',
      confidence: clamp(50 + hindiShare * 50, 50, 95),
    };
  }

  const englishShare = englishHits / words.length;
  if (englishHits > 0) {
    return {
      language: 'en',
      confidence: clamp(50 + englishShare * 50, 55, 90),
    };
  }
  // No marker either way. English is the fallback, and the low number says so.
  return { language: 'en', confidence: 40 };
}

/** Names for staff screens and for the app. Plain words, never a code. */
const NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  'hi-en': 'Hindi written in English letters',
};

export function languageName(tag: string): string {
  return NAMES[tag] ?? 'Not known';
}

/** Is this one of the languages we know about? Used to validate stored data. */
export function isKnownLanguage(tag: unknown): tag is LanguageTag {
  return (
    typeof tag === 'string' && (LANGUAGES as readonly string[]).includes(tag)
  );
}
