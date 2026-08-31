import { IST_OFFSET_MINUTES } from '../assistant/journey';
import { LANGUAGES } from '../assistant/language';

/**
 * EVERYTHING THE ASSISTANT SAYS THAT IS NOT AN ANSWER.
 *
 * The greeting, the offer to change language, the hand over to a person, and the
 * apology for a queue. None of them are answers to anything, so none of them
 * belong in the answer book: nobody should have to approve "good morning", and
 * nobody should be able to retire it either.
 *
 * ALL OF IT IS PURE. No database, no network, and the clock is always handed in,
 * so every line and every decision can be checked without running anything.
 *
 * EVERY LINE EXISTS IN ALL THREE LANGUAGES AND PASSES THE PLAIN LANGUAGE CHECK.
 * That is not a convention here, it is a test: chat-words.spec.ts runs the same
 * check the answer book uses over every string in this file, in its own language.
 */

/** The stand-in for the address people can write to instead of waiting. */
export const SUPPORT_EMAIL_PLACEHOLDER = 'support@fayr.example';

/** India, always. It has never had daylight saving, so a fixed offset is right. */
const IST = IST_OFFSET_MINUTES;

/** Noon and five o'clock, the two lines the greeting turns on. */
const AFTERNOON_FROM_HOUR = 12;
const EVENING_FROM_HOUR = 17;

/** How long somebody waits before being told the queue is busy. */
export const WAITING_NOTE_AFTER_MS = 2 * 60 * 1000;

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

/**
 * What time of day it is in India.
 *
 * India and not wherever the server happens to be: a shopper in Kolkata being
 * wished good morning at nine at night is the kind of small wrongness that tells
 * somebody they are talking to a machine that does not know where they are.
 */
export function timeOfDayInIndia(now: Date): TimeOfDay {
  const minutesSinceMidnight =
    (now.getUTCHours() * 60 + now.getUTCMinutes() + IST + 24 * 60) % (24 * 60);
  const hour = Math.floor(minutesSinceMidnight / 60);
  if (hour < AFTERNOON_FROM_HOUR) return 'morning';
  if (hour < EVENING_FROM_HOUR) return 'afternoon';
  return 'evening';
}

/** "Good morning" and its two neighbours, in each language. */
const TIME_GREETING: Record<string, Record<TimeOfDay, string>> = {
  en: {
    morning: 'Good morning',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
  },
  hi: {
    morning: 'सुप्रभात',
    afternoon: 'नमस्कार',
    evening: 'शुभ संध्या',
  },
  'hi-en': {
    morning: 'Suprabhat',
    afternoon: 'Namaskar',
    evening: 'Shubh sandhya',
  },
};

/** What follows the greeting. */
const GREETING_TAIL: Record<string, string> = {
  en: 'Thank you for contacting Fayr customer support. How can I assist you today?',
  hi: 'फेयर ग्राहक सेवा से संपर्क करने के लिए धन्यवाद। मैं आपकी क्या मदद कर सकता हूँ?',
  'hi-en':
    'Fayr grahak seva se sampark karne ke liye dhanyavaad. Main aapki kya madad kar sakta hoon?',
};

/**
 * WORDS THAT ARE ONLY A GREETING.
 *
 * Kept deliberately short. Every extra word here is a real question that gets
 * answered with "how can I help you" instead of an answer, which is worse than
 * greeting somebody twice — so this list only holds words that cannot be part of
 * a question about anything.
 */
// prettier-ignore
const GREETING_WORDS = new Set([
  // English
  'hi', 'hii', 'hiii', 'hello', 'helo', 'hey', 'heyy', 'hlo', 'yo',
  'greetings', 'morning', 'afternoon', 'evening',
  'good', 'day',
  // Hindi typed in English letters
  'namaste', 'namaskar', 'namaskaar', 'namastey', 'suprabhat', 'shubh',
  'sandhya', 'pranam', 'salaam', 'salam', 'adaab',
  // Hindi
  'नमस्ते', 'नमस्कार', 'सुप्रभात', 'शुभ', 'संध्या', 'प्रणाम', 'सलाम', 'आदाब',
  'हाय', 'हैलो', 'हेलो',
]);

/** Politeness that can follow a greeting without making it a question. */
// prettier-ignore
const GREETING_FILLER = new Set([
  'there', 'sir', 'madam', 'ma', 'am', 'bhai', 'ji', 'team', 'fayr',
  'सर', 'मैडम', 'भाई', 'जी', 'टीम',
]);

/** Letters and the marks that belong to them. Marks matter: see matching.ts. */
const WORD = /[\p{L}\p{M}]+/gu;

function words(text: string): string[] {
  return (String(text ?? '').toLowerCase().match(WORD) ?? []).map((w) => w);
}

/**
 * Is this ONLY a greeting?
 *
 * Every word has to be one, or a piece of politeness. "hi" is a greeting; "hi
 * where is my refund" is a question that happens to start politely, and
 * answering it with "how can I help you" would be the assistant ignoring
 * somebody who had already told it what they wanted.
 */
export function isOnlyAGreeting(text: string): boolean {
  const found = words(text);
  if (found.length === 0 || found.length > 5) return false;
  let greetings = 0;
  for (const w of found) {
    if (GREETING_WORDS.has(w)) {
      greetings += 1;
      continue;
    }
    if (GREETING_FILLER.has(w)) continue;
    return false;
  }
  return greetings > 0;
}

/** The greeting, in one language, for the time it is in India right now. */
export function greetingFor(language: string, now: Date): string {
  const lang = TIME_GREETING[language] ? language : 'en';
  const head = TIME_GREETING[lang][timeOfDayInIndia(now)];
  return `${head}. ${GREETING_TAIL[lang]}`;
}

/**
 * SAYING SO WHEN WE DO NOT KNOW, AND HANDING OVER.
 *
 * The address is a stand-in and is named as one. Putting a made-up address in
 * front of somebody who is already waiting would be worse than the wait.
 */
export function handOverWords(language: string, email: string): string {
  const lang = HAND_OVER[language] ? language : 'en';
  return HAND_OVER[lang].replace('{email}', email);
}

const HAND_OVER: Record<string, string> = {
  en:
    'I am transferring this chat to a customer support agent. It will take a '
    + 'minute or two to be assigned, and they will reply to you here. If you '
    + 'would rather not wait, you can email us at {email} and you will get a '
    + 'reply within 24 to 48 hours.',
  hi:
    'मैं यह बातचीत ग्राहक सेवा के एक व्यक्ति को दे रहा हूँ। उन्हें जोड़ने में एक '
    + 'या दो मिनट लगेंगे, और वे आपको यहीं जवाब देंगे। अगर आप रुकना नहीं चाहते, तो '
    + '{email} पर लिख भेजिए और 24 से 48 घंटे में जवाब मिल जाएगा।',
  'hi-en':
    'Main yah baatcheet grahak seva ke ek vyakti ko de raha hoon. Unhe jodne '
    + 'mein ek ya do minute lagenge, aur ve aapko yahin jawab denge. Agar aap '
    + 'rukna nahi chahte, to {email} par likh bhejiye aur 24 se 48 ghante mein '
    + 'jawab mil jaayega.',
};

/** The one apology for a slow queue. Sent once, never repeatedly. */
export const STILL_WAITING: Record<string, string> = {
  en:
    'It is taking a little longer than usual. Because of a high number of '
    + 'questions right now, it is taking time for a person to be free. Thank you '
    + 'for waiting.',
  hi:
    'इसमें आम दिनों से थोड़ा ज्यादा समय लग रहा है। अभी सवाल बहुत आ रहे हैं, इसलिए '
    + 'किसी व्यक्ति के खाली होने में समय लग रहा है। रुकने के लिए धन्यवाद।',
  'hi-en':
    'Isme aam dinon se thoda zyada samay lag raha hai. Abhi sawaal bahut aa rahe '
    + 'hain, isliye kisi vyakti ke khali hone mein samay lag raha hai. Rukne ke '
    + 'liye dhanyavaad.',
};

/** The offer to change language. Made once. */
export const LANGUAGE_OFFER: Record<string, string> = {
  en:
    'Would you like to continue in another language? You can choose Hindi, or '
    + 'Hindi written in English letters, or English.',
  hi:
    'क्या आप किसी दूसरी भाषा में बात करना चाहेंगे? आप हिंदी चुन सकते हैं, या '
    + 'अंग्रेजी अक्षरों में लिखी हिंदी, या अंग्रेजी।',
  'hi-en':
    'Kya aap kisi doosri bhasha mein baat karna chahenge? Aap Hindi chun sakte '
    + 'hain, ya angrezi aksharon mein likhi Hindi, ya English.',
};

/** What we say once somebody has picked one. Said in the language they picked. */
export const LANGUAGE_CHOSEN: Record<string, string> = {
  en: 'We will carry on in English.',
  hi: 'हम हिंदी में बात करेंगे।',
  'hi-en': 'Hum Hindi mein baat karenge, angrezi aksharon mein.',
};

/**
 * "I DO NOT UNDERSTAND", IN THE WORDS PEOPLE ACTUALLY USE.
 *
 * Not a clever guess: a short list of the ways somebody says the reply made no
 * sense to them. Anything not on it is treated as a question, because treating a
 * real question as confusion would answer it with a language menu.
 */
// prettier-ignore
const NOT_UNDERSTOOD = [
  'i do not understand', 'i dont understand', "i don't understand",
  'not understand', 'not understood', 'no understand', 'dont understand',
  'i cannot understand', 'cant understand', "can't understand",
  'samajh nahi', 'samajh nahin', 'samjha nahi', 'samjha nahin',
  'nahi samjha', 'nahin samjha', 'kuch samajh', 'ye kya hai',
  'समझ नहीं', 'समझा नहीं', 'नहीं समझा', 'कुछ समझ',
];

/** Did they just tell us the reply made no sense? */
export function saysTheyDoNotUnderstand(text: string): boolean {
  const flat = String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (flat === '') return false;
  return NOT_UNDERSTOOD.some((phrase) => flat.includes(phrase));
}

/**
 * WHICH LANGUAGE DID THEY PICK?
 *
 * Only from a short message. "hindi" is a choice; a sentence with the word Hindi
 * somewhere in it is a question about Hindi, and reading it as a choice would
 * silently switch the whole conversation.
 */
// prettier-ignore
const CHOICES: [string, string[]][] = [
  ['hi-en', [
    'hinglish', 'hindi in english', 'hindi in english letters',
    'hindi english', 'roman hindi', 'hindi roman', 'english letters',
    'angrezi', 'hindi angrezi',
  ]],
  ['hi', ['hindi', 'हिंदी', 'हिन्दी', 'हिंदी में', 'hindi mein']],
  ['en', ['english', 'angrez', 'अंग्रेजी', 'अंग्रेज़ी', 'english mein']],
];

export function languageChoiceFrom(text: string): string | null {
  const flat = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat === '' || words(flat).length > 6) return null;

  // hi-en first: "hindi in english letters" contains both "hindi" and "english",
  // and the more specific reading is the one they meant.
  for (const [language, phrases] of CHOICES) {
    for (const phrase of phrases) {
      if (flat === phrase || flat.includes(phrase)) return language;
    }
  }
  return null;
}

/** Every language this file has words for. Checked against the assistant's list. */
export function languagesWeHaveWordsFor(): string[] {
  return LANGUAGES.filter(
    (l) =>
      TIME_GREETING[l] &&
      GREETING_TAIL[l] &&
      HAND_OVER[l] &&
      STILL_WAITING[l] &&
      LANGUAGE_OFFER[l] &&
      LANGUAGE_CHOSEN[l],
  );
}
