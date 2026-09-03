/**
 * HOW A PERSON REACHES FAYR, IN WORDS.
 *
 * One file, so the sentence a shopper reads on the Help screen and the sentence
 * the assistant says in the chat are the SAME sentence. Two copies of this would
 * drift, and then the app would offer a number the chat had stopped offering.
 *
 * FOLLOWING THE NOTE BESIDE SUPPORT_EMAIL in chat-words.ts, word for word: the
 * address is written down there because a missing setting would leave an empty gap
 * in the middle of a sentence, and it says that if a second one of these is ever
 * needed it must be a setting WITH a default, never a setting that can come back
 * empty. A phone number IS the second one, and it cannot be written down here: it
 * changes, and it must not sit in a committed file. So it is a setting, and this
 * file holds the safe answer for when it is not set.
 *
 * THERE IS NO BLANK CASE AND NO HALF CASE. Either there is a number and the
 * sentence offers it, or there is not and the sentence offers the app instead.
 * Never an empty space where a number should be, and never the word nothing.
 *
 * ALL OF IT IS PURE, and every sentence is walked through the real plain-language
 * check in its own language by contact.words.spec.ts.
 */

/** What the app and the assistant say when Fayr has a number. */
export function callUsWords(number: string, language: string): string {
  if (language === 'hi') {
    return `आप हमें ${number} पर फोन कर सकते हैं। `
      + 'आप ऐप में हमें लिख भी सकते हैं। फेयर का कोई व्यक्ति उसे पढ़ेगा।';
  }
  if (language === 'hi-en') {
    return `Aap hamein ${number} par phone kar sakte hain. `
      + 'Aap app mein hamein likh bhi sakte hain. Fayr ka koi vyakti use padhega.';
  }
  return `You can call us on ${number}. `
    + 'You can also write to us here in the app and a person from Fayr will read it.';
}

/**
 * What they say when there is no number.
 *
 * It offers no number at all. Not a blank, not part of one, and not a sentence
 * that mentions a number it cannot give.
 */
export function writeToUsWords(language: string): string {
  if (language === 'hi') {
    return 'ऐप में हमें लिख दें। फेयर का कोई व्यक्ति उसे पढ़ेगा।';
  }
  if (language === 'hi-en') {
    return 'App mein hamein likh dein. Fayr ka koi vyakti use padhega.';
  }
  return 'Write to us in the app and a person from Fayr will read it.';
}

/** The heading over it, wherever it is shown as its own thing. */
export function howToReachUsTitle(language: string): string {
  if (language === 'hi') return 'हमसे कैसे बात करें';
  if (language === 'hi-en') return 'Hamse kaise baat karein';
  return 'How to reach us';
}

/** The button on the Help screen when there is a number to ring. */
export const CALL_BUTTON = 'Call Fayr';

/**
 * Ways somebody really asks for a phone number, so the answer book's own search
 * finds this answer rather than something about refunds.
 */
export const HOW_TO_REACH_US_PHRASES: Record<string, string[]> = {
  en: [
    'what is your number',
    'phone number',
    'customer care number',
    'can i call you',
    'helpline',
    'how do i call fayr',
    'is there a number i can ring',
  ],
  hi: [
    'आपका नंबर क्या है',
    'फोन नंबर',
    'कस्टमर केयर नंबर',
    'क्या मैं फोन कर सकता हूँ',
    'हेल्पलाइन',
  ],
  'hi-en': [
    'aapka number kya hai',
    'phone number',
    'customer care number',
    'kya main call kar sakta hoon',
    'helpline',
  ],
};

/** The one name this answer is filed under in the answer book. */
export const HOW_TO_REACH_US_KEY = 'how-to-reach-us';
