/**
 * WHICH OF THREE CASES IS THIS MESSAGE, AND WHAT DO WE DO ABOUT IT?
 *
 * THE OWNER'S RULE, 2 September 2026, word for word: "If someone is sharing their
 * messages in English, I want the chat box to reply in English. If someone is
 * sharing their messages in Hindi, then it should reply in English, not in Hindi.
 * If someone comes with a different language, we will reply in English and say
 * that we can only converse in Hinglish or English."
 *
 * So there are exactly three cases and the answer is ALWAYS English:
 *
 *   ENGLISH           reply in English
 *   HINDI             reply in English. Both kinds count as Hindi: written in
 *                     Devanagari, and written with English letters, which is what
 *                     most people actually type
 *   ANOTHER LANGUAGE  reply in English, and add one line saying Fayr can only
 *                     talk in English or Hindi. Once per conversation, never
 *                     repeated
 *
 * ONE LANGUAGE OUT MAKES THE WHOLE THING SIMPLER, which is why it is the owner's
 * rule and not a shortcut. One set of answers, one language to keep plain, one
 * thing to check.
 *
 * ── WHY THIS IS NOT detectLanguage, WHICH ALREADY EXISTS ────────────────────
 *
 * detectLanguage answers "what did they write in" and is used to file a question
 * for staff. It has only three answers, en, hi and hi-en, and every one of them
 * means we understood. Measured on 2 September 2026, it reads Spanish, French,
 * German, Chinese and Tamil all as English:
 *
 *   "¿Dónde está mi reembolso?"   -> en
 *   "Où est mon remboursement"    -> en
 *   "我的退款在哪里"                -> en
 *   "எனது பணம் எப்போது வரும்"      -> en
 *
 * There is no fourth case to give, so it cannot be the thing that decides this.
 * This file adds the case it is missing and leaves that function alone: the
 * record of what somebody wrote in is a different question from what to do next.
 *
 * ── HOW IT TELLS ANOTHER LANGUAGE APART, AND WHAT IT REFUSES TO GUESS ───────
 *
 * BY THE LETTERS, NEVER BY THE WORDS. Two signals, and both are facts about the
 * characters rather than opinions about the sentence:
 *
 *   ANOTHER SCRIPT. Chinese, Tamil, Bengali, Arabic, Russian and the rest are
 *   written in letters that English and Hindi do not use. That is not a guess.
 *
 *   LETTERS ENGLISH AND HINDI NEVER USE. "¿", "ñ", "ß", "é", "ü". A message with
 *   those in it was not typed by somebody writing English or Hinglish.
 *
 * AND IT REFUSES TO GUESS FROM WORDS. A Spanish sentence with no accents in it
 * reads as English here, and that is deliberate. The owner's own rule says so:
 * "anything it cannot place is treated as English and answered normally. A person
 * asking a plain question must never be told to write differently because a guess
 * went wrong." Being answered in English is harmless. Being told to write
 * differently when you were writing perfectly good English is insulting.
 *
 * A MIXED MESSAGE IS NOT A FOREIGN ONE. "refund kab aayega please" is how a very
 * large number of people in India type, and it gets an ordinary English answer
 * with no lecture about language. Only a message that is really in another
 * language gets that line.
 *
 * PURE. No database, no clock, no network, so every rule in it is checked without
 * a phone.
 */

import { HINDI_IN_LATIN } from './language';

/** The three cases, and there is no fourth. */
export const HOW_TO_ANSWER = ['english', 'hindi', 'another-language'] as const;
export type HowToAnswer = (typeof HOW_TO_ANSWER)[number];

/**
 * WHAT WE SAY TO SOMEBODY WRITING IN ANOTHER LANGUAGE.
 *
 * Once per conversation. In English, because that is the whole point of the line.
 * It apologises, because being unable to read somebody is our shortcoming and not
 * theirs, and it says what to do rather than only what is wrong.
 */
export const ONLY_ENGLISH_OR_HINDI =
  'We are sorry, we could not read that. We can only talk in English, or in '
  + 'Hindi written with English letters. Please write your question in one of '
  + 'those and we will help.';

/** Every letter, in any script. */
const A_LETTER = /\p{L}/u;
/** Hindi's own letters. */
const DEVANAGARI = /[ऀ-ॿ]/u;
/** The letters English is written with. */
const PLAIN_LATIN = /[A-Za-z]/;

/**
 * LATIN LETTERS ENGLISH AND HINDI NEVER USE.
 *
 * Accented Latin and the punctuation that comes with it. Somebody writing English
 * or Hinglish on an Indian phone does not type these, so one of them is a fact
 * about the message and not a guess about the sentence.
 */
const NOT_OUR_LATIN = /[À-ɏḀ-ỿ¿¡]/u;

/**
 * How much of a message has to be in another script before it counts as being in
 * another language.
 *
 * A THIRD. One Chinese character in an English sentence is somebody quoting a
 * product name, and telling them to write differently would be absurd.
 */
const ANOTHER_SCRIPT_SHARE = 1 / 3;

/** The same line for Hindi's own letters, so the two behave alike. */
const DEVANAGARI_SHARE = 1 / 3;

/**
 * How much of a Latin sentence has to be Hindi words before it is Hinglish.
 *
 * A fifth, which is the number src/assistant/language.ts already uses. Below
 * that it is an English sentence with a word borrowed, and either way the answer
 * is in English, so nothing turns on getting this exactly right. It is here so
 * the RECORD of what somebody wrote is the same in both places.
 */
const HINGLISH_SHARE = 0.2;

const WORDS = /[\p{L}\p{M}]+/gu;

export interface HowToAnswerAnswer {
  /** Which of the three this is. */
  how: HowToAnswer;
  /**
   * True when the reply has to carry the line about which languages we can talk
   * in. Only ever for another language, and the conversation decides whether it
   * has already been said.
   */
  saysWhichLanguagesWeCanTalkIn: boolean;
  /** In plain words, for a report and for whoever reads this next. */
  why: string;
}

/**
 * WHICH CASE IS THIS?
 *
 * Answers for anything at all, including nothing at all. Nothing here can throw.
 */
export function howToAnswer(text: unknown): HowToAnswerAnswer {
  const said = typeof text === 'string' ? text : '';

  let letters = 0;
  let devanagari = 0;
  let ourLatin = 0;
  let notOurLatin = 0;
  for (const ch of said) {
    if (NOT_OUR_LATIN.test(ch)) {
      // Counted even when it is punctuation rather than a letter: "¿" is the
      // whole tell in "¿Dónde está mi reembolso?".
      notOurLatin += 1;
      if (A_LETTER.test(ch)) letters += 1;
      continue;
    }
    if (!A_LETTER.test(ch)) continue;
    letters += 1;
    if (DEVANAGARI.test(ch)) devanagari += 1;
    else if (PLAIN_LATIN.test(ch)) ourLatin += 1;
  }

  // ── nothing to read at all ────────────────────────────────────────────────
  //
  // Numbers, emoji, punctuation, an empty message. ENGLISH, because that is the
  // safe way to fall: it answers them normally instead of telling somebody who
  // typed "12345" that they should write in another language.
  if (letters === 0 && notOurLatin === 0) {
    return {
      how: 'english',
      saysWhichLanguagesWeCanTalkIn: false,
      why: 'There are no letters in it, so there is nothing to go on. Answered in '
        + 'English, which is the safe way to fall.',
    };
  }

  // ── letters English and Hindi never use ───────────────────────────────────
  if (notOurLatin > 0) {
    return {
      how: 'another-language',
      saysWhichLanguagesWeCanTalkIn: true,
      why: 'It uses letters that English and Hindi do not use, so it is in some '
        + 'other language.',
    };
  }

  // ── Hindi's own letters ───────────────────────────────────────────────────
  if (letters > 0 && devanagari / letters >= DEVANAGARI_SHARE) {
    return {
      how: 'hindi',
      saysWhichLanguagesWeCanTalkIn: false,
      why: 'It is written in Hindi. Answered in English, which is the rule.',
    };
  }

  // ── another script altogether ─────────────────────────────────────────────
  const anotherScript = letters - devanagari - ourLatin;
  if (letters > 0 && anotherScript / letters >= ANOTHER_SCRIPT_SHARE) {
    return {
      how: 'another-language',
      saysWhichLanguagesWeCanTalkIn: true,
      why: 'It is written in letters that are neither English nor Hindi, so it is '
        + 'in some other language.',
    };
  }

  // ── Latin letters: English, or Hindi typed with English letters ───────────
  //
  // A few Hindi letters mixed into a Latin sentence still land here, and still
  // read as Hindi, which is right: somebody typing mostly Hinglish with one
  // Hindi word in it is writing Hinglish.
  if (devanagari > 0) {
    return {
      how: 'hindi',
      saysWhichLanguagesWeCanTalkIn: false,
      why: 'It mixes Hindi letters into English letters. Answered in English.',
    };
  }

  const words = said.toLowerCase().match(WORDS) ?? [];
  let hindiWords = 0;
  for (const w of words) if (HINDI_IN_LATIN.has(w)) hindiWords += 1;
  if (words.length > 0 && hindiWords / words.length >= HINGLISH_SHARE) {
    return {
      how: 'hindi',
      saysWhichLanguagesWeCanTalkIn: false,
      why: 'It is Hindi typed with English letters. Answered in English, and with '
        + 'no remark about language, because this is how most people type.',
    };
  }

  return {
    how: 'english',
    saysWhichLanguagesWeCanTalkIn: false,
    why: 'It reads as English. Anything that cannot be placed lands here too, on '
      + 'purpose: a person asking a plain question must never be told to write '
      + 'differently because a guess went wrong.',
  };
}

/**
 * DOES THIS REPLY CARRY THE LINE ABOUT WHICH LANGUAGES WE CAN TALK IN?
 *
 * ONCE PER CONVERSATION, which is the owner's own instruction: "it gets it ONCE
 * per chat, never repeated." Being told twice that you are writing in the wrong
 * language is the assistant talking about itself instead of helping.
 *
 * PURE, AND THAT IS THE POINT. This was two conditions written inline in the
 * service, and a deliberate break that removed the "only once" half sailed
 * straight past every check: a message in another language cannot be answered, so
 * the conversation hands over to a person and the messages after it get no reply
 * at all. The hand over was doing the work and the rule was untested. Pulled out
 * here, it is checked directly.
 */
export function shouldSayWhichLanguages(
  said: HowToAnswerAnswer,
  alreadyToldThem: boolean,
): boolean {
  return said.saysWhichLanguagesWeCanTalkIn && !alreadyToldThem;
}

/**
 * THE LANGUAGE THE REPLY IS WRITTEN IN. English, always, in every case.
 *
 * A function rather than a constant so that every place that needs it reads the
 * same one thing, and so that a check can prove there is no case anywhere that
 * answers in anything else.
 */
export function languageToAnswerIn(): 'en' {
  return 'en';
}
