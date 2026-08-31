import { plainLanguageProblems } from '../assistant/plain-language';
import { SUPPORT_EMAIL } from './chat-words';

/**
 * A SUGGESTED EMAIL, FOR THE AGENT TO COPY.
 *
 * FAYR DOES NOT SEND EMAIL. Nothing here talks to a mail server, and there is no
 * address to send from. What this produces is words on a screen with a button
 * that copies them, and the agent sends it from their own email like they would
 * anything else. That is deliberate: an email Fayr sent itself would need an
 * address people can reply to, and there is not one yet.
 *
 * IT NEVER INVENTS ANYTHING. The middle of the email is either an answer that is
 * already in the answer book, word for word, or an honest line saying somebody
 * will confirm it. There is no third case. A drafted email that guessed at a
 * timeline would be Fayr making a promise in writing that nobody had approved.
 *
 * PURE. No database, no clock unless it is handed in, so every line can be
 * checked — including against the same plain-language rule the answer book is
 * held to, which is the whole point of drafting it rather than leaving the agent
 * to write it cold.
 */

/** What a draft is made of. */
export interface DraftInput {
  /** What the person asked, in their own words. The newest question. */
  question: string;
  /** The answer from the answer book, when one matched. Word for word. */
  answer?: string | null;
  /** Who is writing. Their real name goes on it. */
  agentName: string;
  /** Which language to write in. */
  language?: string;
  /** The person's account name, so the email is addressed to somebody. */
  accountName?: string | null;
}

export interface Draft {
  subject: string;
  body: string;
  /** What is wrong with the way it is written, if anything. Should be nothing. */
  plainLanguage: { ok: boolean; problems: string[] };
  /** True when the middle of it is a stored answer rather than a hand-over. */
  fromTheAnswerBook: boolean;
}

const SUBJECT: Record<string, string> = {
  en: 'About your Fayr question',
  hi: 'आपके फेयर सवाल के बारे में',
  'hi-en': 'Aapke Fayr sawaal ke baare mein',
};

const OPENING: Record<string, string> = {
  en: 'Hello,',
  hi: 'नमस्ते,',
  'hi-en': 'Namaste,',
};

const YOU_ASKED: Record<string, string> = {
  en: 'You asked us:',
  hi: 'आपने हमसे पूछा था:',
  'hi-en': 'Aapne humse poocha tha:',
};

/**
 * The honest middle, when the answer book has nothing.
 *
 * It says a person is looking and gives no timeline, because we have not got one
 * written down. An email promising two days would be worse than an email
 * promising nothing.
 */
const WE_ARE_LOOKING: Record<string, string> = {
  en:
    'I am looking into this for you. I will write again as soon as I have a '
    + 'clear answer.',
  hi:
    'मैं इसे देख रहा हूँ। जैसे ही मेरे पास साफ जवाब होगा, मैं आपको फिर लिखूँगा।',
  'hi-en':
    'Main ise dekh raha hoon. Jaise hi mere paas saaf jawab hoga, main aapko '
    + 'phir likhoonga.',
};

const CLOSING: Record<string, string> = {
  en: 'If anything here is not clear, write back and I will explain it again.',
  hi: 'अगर इसमें कुछ साफ न हो, तो जवाब लिखिए और मैं फिर से बताऊँगा।',
  'hi-en':
    'Agar isme kuch saaf na ho, to jawab likhiye aur main phir se bataunga.',
};

const SIGN_OFF: Record<string, string> = {
  en: 'Fayr customer support',
  hi: 'फेयर ग्राहक सेवा',
  'hi-en': 'Fayr grahak seva',
};

const LANGUAGES_WE_WRITE_IN = ['en', 'hi', 'hi-en'];

function pick(map: Record<string, string>, language: string): string {
  return map[language] ?? map.en;
}

/** Trim, collapse runs of blank lines, and drop trailing space on every line. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Draft one email.
 *
 * The question is quoted rather than summarised. Somebody reading an email about
 * a question they asked three days ago needs to see which question, and a
 * summary written by us is a chance to get it wrong.
 */
export function draftEmail(input: DraftInput): Draft {
  const language = LANGUAGES_WE_WRITE_IN.includes(String(input?.language))
    ? (input.language as string)
    : 'en';

  const question = typeof input?.question === 'string' ? input.question.trim() : '';
  const stored = typeof input?.answer === 'string' ? input.answer.trim() : '';
  const fromTheAnswerBook = stored !== '';
  const agentName =
    typeof input?.agentName === 'string' && input.agentName.trim() !== ''
      ? input.agentName.trim()
      : pick(SIGN_OFF, language);
  const accountName =
    typeof input?.accountName === 'string' && input.accountName.trim() !== ''
      ? input.accountName.trim()
      : null;

  const greeting = accountName
    ? `${pick(OPENING, language).replace(/,$/, '')} ${accountName},`
    : pick(OPENING, language);

  const middle = fromTheAnswerBook ? stored : pick(WE_ARE_LOOKING, language);

  const body = tidy(
    [
      greeting,
      '',
      question !== '' ? `${pick(YOU_ASKED, language)}\n"${question}"` : '',
      '',
      middle,
      '',
      pick(CLOSING, language),
      '',
      agentName,
      pick(SIGN_OFF, language),
    ].join('\n'),
  );

  // The same rule the answer book is held to. Checked on the WHOLE email,
  // because the part somebody actually reads is the whole email.
  const problems = plainLanguageProblems(body, language);

  return {
    subject: pick(SUBJECT, language),
    body,
    plainLanguage: { ok: problems.length === 0, problems },
    fromTheAnswerBook,
  };
}

/** The address a shopper is told to write to. The real one. */
export const WRITE_TO_US_AT = SUPPORT_EMAIL;
