import { IST_OFFSET_MINUTES } from '../assistant/journey';
import { LANGUAGES } from '../assistant/language';
import {
  GREETING_PICK_ONE,
  OPENING_QUESTIONS,
  greetingWords,
  type OpeningQuestion,
} from './opening-questions';

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

/**
 * The address people can write to instead of waiting. Real, not a stand-in.
 *
 * It is written here rather than read from a setting on purpose: a missing
 * setting would put an empty gap in the middle of a sentence a shopper reads,
 * and there is exactly one address. If that ever stops being true, move it to a
 * setting WITH a default, never to a setting that can come back empty.
 */
export const SUPPORT_EMAIL = 'Customer.support@theratefair.com';

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

// WHAT FOLLOWS THE GREETING MOVED OUT OF THIS FILE ON 2 SEPTEMBER 2026.
//
// It used to be one sentence in three languages: "Thank you for contacting Fayr
// customer support. How can I assist you today?" The owner asked for something
// better: "whenever I say 'hi,' it should reply with basic questions and
// answers." Asking somebody what they want is putting the whole problem back on
// a person who came to the chat because they did not know what to ask.
//
// So the greeting now offers four real questions, and they are looked up in the
// answer bank before they are offered. See opening-questions.ts.

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

/**
 * THE GREETING, WITH REAL QUESTIONS UNDER IT.
 *
 * `offer` are the questions that were found in the answer bank. Handed in rather
 * than read here, because reading the bank is not this file's job and because a
 * pure function is what lets a test hold the clock still.
 *
 * ENGLISH, ALWAYS, and that is the owner's own instruction: "If someone is
 * sharing their messages in Hindi, then it should reply in English, not in
 * Hindi." One set of answers, one language out.
 */
export function greetingFor(
  now: Date,
  offer: readonly OpeningQuestion[] = OPENING_QUESTIONS,
): string {
  return greetingWords(TIME_GREETING.en[timeOfDayInIndia(now)], offer);
}

/**
 * THE ONE LINE THAT MARKS A MESSAGE AS THE GREETING.
 *
 * The phone draws the four questions as things you can tap, so it has to know
 * which reply is the one they belong to. This line is that marker: it is in every
 * greeting and in nothing else. A marker rather than a new column on the message,
 * because the greeting is words and the words already say it.
 */
export const GREETING_MARKER = GREETING_PICK_ONE;

/**
 * SAYING SO WHEN WE DO NOT KNOW, AND HANDING OVER.
 *
 * The address is handed in rather than read from here, so a test can prove the
 * sentence puts back whatever address it is given. Callers pass SUPPORT_EMAIL.
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

/**
 * The one apology for a slow queue. Sent once, never repeatedly.
 *
 * REWRITTEN ON 2 SEPTEMBER 2026, and the old wording is worth recording because
 * of what was wrong with it. It read: "It is taking a little longer than usual.
 * Because of a high number of questions right now, it is taking time for a person
 * to be free. Thank you for waiting."
 *
 * Every rule about shape passed. It contains no abbreviation, no jargon and no
 * long sentence. And it never once says "we". "It is taking", "a high number of
 * questions", "a person to be free" is a notice on a wall, and it is sent at the
 * exact moment somebody has been kept waiting and most needs to hear a person.
 * The owner's rule for how the assistant talks caught it: "It sounds like a
 * person. It says 'we', it apologises when something has gone wrong."
 *
 * So it apologises now, and it says who is sorry.
 */
export const STILL_WAITING: Record<string, string> = {
  en:
    'We are sorry, this is taking longer than usual. A lot of people are writing '
    + 'to us right now, so it is taking us time to get to you. Thank you for '
    + 'waiting.',
  hi:
    'हमें खेद है, इसमें आम दिनों से ज्यादा समय लग रहा है। अभी बहुत लोग हमें लिख '
    + 'रहे हैं, इसलिए हमें आप तक पहुँचने में समय लग रहा है। रुकने के लिए धन्यवाद।',
  'hi-en':
    'Humein khed hai, isme aam dinon se zyada samay lag raha hai. Abhi bahut log '
    + 'humein likh rahe hain, isliye humein aap tak pahunchne mein samay lag raha '
    + 'hai. Rukne ke liye dhanyavaad.',
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
      HAND_OVER[l] &&
      STILL_WAITING[l] &&
      LANGUAGE_OFFER[l] &&
      LANGUAGE_CHOSEN[l],
  );
}
