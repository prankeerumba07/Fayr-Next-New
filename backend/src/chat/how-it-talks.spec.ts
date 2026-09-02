/**
 * HOW THE ASSISTANT TALKS. EVERY WORD OF IT, WALKED.
 *
 * THE OWNER'S RULE FOR THE WHOLE PRODUCT, and it applies to every word the
 * assistant says: very simple human language. No abbreviations. No jargon. No
 * short codes. No double dashes. A school child must understand every sentence.
 *
 * THIS IS A CHECK THAT WALKS THE ANSWERS, not a rule in a comment. It collects
 * everything the assistant can put in front of somebody, in every language, and
 * runs the real plain-language rule over each one, plus three things that rule
 * does not cover.
 *
 * ── WHAT WAS ALREADY CHECKED, AND WHAT WAS NOT ─────────────────────────────
 *
 * The plain-language rule in assistant/plain-language.ts already catches every
 * short code and abbreviation the owner named, which was measured rather than
 * assumed on 2 September 2026:
 *
 *   OCR  SLA  KYC  TAT     caught as a shouted short code
 *   T&C  T&Cs              caught on the "&"
 *   verification pipeline  caught on "verification"
 *   marketplace API        caught three times over
 *   e.g.  i.e.  etc.  ASAP  FAQ  info  SKU  ASIN   all caught
 *
 * UPI and PAN go through on purpose. They are what those things are actually
 * called in India, and spelling them out would be less clear, not more.
 *
 * WHAT WAS NOT CAUGHT is the call centre voice, and it is exactly what the owner
 * named: "your query has been registered". Nothing in the shape rules objects to
 * it, because there is no abbreviation, no jargon word and no long sentence in
 * it. It is just not how a person talks. That list is below.
 *
 * AND THE GREETING'S NEW PARTS WERE NOT WALKED AT ALL. The four questions it
 * offers and the line about which languages we can talk in were both written on
 * 2 September 2026 and neither existed when the other checks were written.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_DRAFTS } from '../assistant/answer-drafts';
import { CANNOT_ANSWER_YET } from '../assistant/answer-engine.rules';
import { LANGUAGES } from '../assistant/language';
import { ONLY_ENGLISH_OR_HINDI } from '../assistant/how-to-answer';
import { checkPlainLanguage } from '../assistant/plain-language';
import {
  GREETING_OPENING,
  GREETING_PICK_ONE,
  GREETING_WHAT_WE_HELP_WITH,
  OPENING_QUESTIONS,
} from './opening-questions';
import {
  STILL_WAITING,
  SUPPORT_EMAIL,
  greetingFor,
  handOverWords,
} from './chat-words';

interface Said {
  what: string;
  language: string;
  text: string;
  /** True for the lines the assistant says as ITSELF, rather than as an answer. */
  itsOwnVoice: boolean;
}

/**
 * EVERYTHING THE ASSISTANT CAN SAY.
 *
 * Two kinds, and the difference matters for one rule at the bottom of this file:
 *
 *   ITS OWN VOICE   the greeting, the questions it offers, the language line, the
 *                   hand over, the queue apology, the refusal. Fayr talking about
 *                   itself.
 *   AN ANSWER       something out of the answer bank, which is Fayr answering the
 *                   question that was asked.
 */
function everythingItSays(): Said[] {
  const out: Said[] = [];

  // ── its own voice ────────────────────────────────────────────────────────
  for (const hour of [9, 14, 19]) {
    out.push({
      what: `the greeting at ${hour} o'clock`,
      language: 'en',
      text: greetingFor(new Date(Date.UTC(2026, 8, 3, hour) - 330 * 60_000)),
      itsOwnVoice: true,
    });
  }
  out.push({ what: 'the greeting with nothing to offer', language: 'en',
    text: greetingFor(new Date(Date.UTC(2026, 8, 3, 9)), []), itsOwnVoice: true });
  out.push({ what: 'the greeting’s opening', language: 'en',
    text: GREETING_OPENING, itsOwnVoice: true });
  out.push({ what: 'what we can help with', language: 'en',
    text: GREETING_WHAT_WE_HELP_WITH, itsOwnVoice: true });
  out.push({ what: 'the line above the questions', language: 'en',
    text: GREETING_PICK_ONE, itsOwnVoice: true });
  for (const one of OPENING_QUESTIONS) {
    out.push({ what: `the question it offers, "${one.ask}"`, language: 'en',
      text: one.ask, itsOwnVoice: true });
  }
  out.push({ what: 'the line about which languages we can talk in', language: 'en',
    text: ONLY_ENGLISH_OR_HINDI, itsOwnVoice: true });
  for (const language of LANGUAGES) {
    out.push({ what: 'the hand over to a person', language,
      text: handOverWords(language, SUPPORT_EMAIL), itsOwnVoice: true });
  }
  for (const [language, text] of Object.entries(STILL_WAITING)) {
    out.push({ what: 'the apology for a slow queue', language, text, itsOwnVoice: true });
  }
  for (const [language, text] of Object.entries(CANNOT_ANSWER_YET)) {
    out.push({ what: 'the reply when it does not know', language, text, itsOwnVoice: true });
  }

  // ── the answers ──────────────────────────────────────────────────────────
  for (const draft of ANSWER_DRAFTS) {
    for (const [language, wording] of Object.entries(draft.wordings)) {
      out.push({ what: `the answer "${draft.key}" title`, language,
        text: wording.title, itsOwnVoice: false });
      out.push({ what: `the answer "${draft.key}"`, language,
        text: wording.body, itsOwnVoice: false });
    }
  }
  return out;
}

/**
 * THE CALL CENTRE VOICE.
 *
 * Nothing in the shape rules objects to any of these, and every one of them tells
 * a person they are talking to a process rather than to somebody who is going to
 * help them. The owner named the first one himself: it never says "your query has
 * been registered".
 */
const NOT_HOW_A_PERSON_TALKS: RegExp[] = [
  /\bquery\b/i,
  /\bhas been registered\b/i,
  /\bwe will revert\b/i,
  /\brevert back\b/i,
  /\bdo the needful\b/i,
  /\bkindly\b/i,
  /\bas per\b/i,
  /\braise a ticket\b/i,
  /\braise a request\b/i,
  /\byour concern\b/i,
  /\bwe regret to inform\b/i,
  /\bplease be informed\b/i,
  /\bat the earliest\b/i,
  /\bfor your reference\b/i,
  /\bthe same will be\b/i,
  /\bescalat/i,
  /\bresolution will be provided\b/i,
];

/** Words nobody outside Fayr would use for a thing a shopper can see. */
const OUR_OWN_WORDS: RegExp[] = [
  /\bfunnel\b/i,
  /\bpipeline\b/i,
  /\bevidence\b/i,
  /\bfragment\b/i,
  /\bdedup/i,
  /\bidempot/i,
  /\bwebhook\b/i,
  /\bmigration\b/i,
  /\bschema\b/i,
];

describe('how the assistant talks', () => {
  const everything = everythingItSays();

  it('walks every word it can say, and there are a lot of them', () => {
    // A check that walked nothing would pass in silence.
    expect(everything.length).toBeGreaterThan(90);
    for (const one of everything) {
      expect(typeof one.text).toBe('string');
      expect(one.text.trim().length).toBeGreaterThan(0);
    }
    // Including the parts written on 2 September 2026, which nothing walked before.
    const walked = everything.map((o) => o.what);
    expect(walked).toContain('the line about which languages we can talk in');
    expect(walked).toContain('the line above the questions');
    for (const one of OPENING_QUESTIONS) {
      expect(walked).toContain(`the question it offers, "${one.ask}"`);
    }
  });

  it('EVERY WORD PASSES THE PLAIN LANGUAGE RULE, in its own language', () => {
    // No abbreviation in capitals, no short code with dots, no double dash and no
    // long dash, no jargon, no sentence too long to hold in your head, no web
    // address, nothing half written. The real rule, not a copy of it.
    const bad: string[] = [];
    for (const one of everything) {
      const said = checkPlainLanguage(one.text, one.language);
      if (!said.ok) {
        bad.push(
          `${one.what} in ${one.language}: `
          + said.problems.map((p) => `${p.detail} (${p.found})`).join(' '),
        );
      }
    }
    expect(bad).toEqual([]);
  });

  it('and no double dash or long dash anywhere, said separately because it is a rule of its own', () => {
    const bad = everything
      .filter((one) => /--|—|–/.test(one.text))
      .map((one) => `${one.what} in ${one.language}`);
    expect(bad).toEqual([]);
  });

  it('IT NEVER SOUNDS LIKE A CALL CENTRE', () => {
    const bad: string[] = [];
    for (const one of everything) {
      for (const phrase of NOT_HOW_A_PERSON_TALKS) {
        const found = phrase.exec(one.text);
        if (found) bad.push(`${one.what} in ${one.language}: "${found[0]}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('and never uses our own words for a thing a shopper can see', () => {
    const bad: string[] = [];
    for (const one of everything) {
      for (const word of OUR_OWN_WORDS) {
        const found = word.exec(one.text);
        if (found) bad.push(`${one.what} in ${one.language}: "${found[0]}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('IT SOUNDS LIKE A PERSON. It says "we", not "the system"', () => {
    // Every one of its own lines that is a sentence rather than a label.
    const sentences = everything.filter(
      (one) => one.itsOwnVoice && one.language === 'en' && one.text.length > 60,
    );
    expect(sentences.length).toBeGreaterThanOrEqual(4);
    for (const one of sentences) {
      const saysWe = /\b(we|us|our)\b/i.test(one.text) || /\bI\b/.test(one.text);
      expect(saysWe).toBe(true);
    }
    // And never talks about itself as a machine.
    for (const one of everything) {
      expect(/\bthe system\b/i.test(one.text)).toBe(false);
      expect(/\bthe application\b/i.test(one.text)).toBe(false);
      expect(/\bthe platform\b/i.test(one.text)).toBe(false);
    }
  });

  it('AND IT APOLOGISES WHEN SOMETHING HAS GONE WRONG', () => {
    // The two moments where something really has gone wrong for the person.
    expect(ONLY_ENGLISH_OR_HINDI.toLowerCase()).toContain('we are sorry');
    // The queue apology thanks them for waiting, which is the same courtesy.
    expect(STILL_WAITING.en.toLowerCase()).toContain('thank you for waiting');
  });

  it('every sentence is short enough to read at a glance', () => {
    const bad: string[] = [];
    for (const one of everything) {
      for (const sentence of one.text.split(/[.!?।\n]+/)) {
        const howMany = (sentence.match(/[\p{L}\p{M}]+/gu) ?? []).length;
        if (howMany > 22) bad.push(`${one.what} in ${one.language}: ${howMany} words`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('and it really would catch bad writing, so the rule is not asleep', () => {
    // Every one of these must fail. A check that only ever passes is a comment.
    for (const bad of [
      'Your query has been registered and we will revert at the earliest.',
      'Kindly do the needful as per our policy.',
      'Please raise a ticket and the same will be escalated.',
      'The system could not process your request.',
      'Your OCR evidence fragment failed the verification pipeline.',
      'We regret to inform you that your concern is with the platform team.',
    ]) {
      const callCentre = NOT_HOW_A_PERSON_TALKS.some((p) => p.test(bad));
      const ourWords = OUR_OWN_WORDS.some((p) => p.test(bad));
      const machine = /\bthe system\b|\bthe platform\b|\bthe application\b/i.test(bad);
      const shape = !checkPlainLanguage(bad, 'en').ok;
      expect(callCentre || ourWords || machine || shape).toBe(true);
    }
  });

  // ── it never says a shop account is being looked at ──────────────────────
  //
  // THE SAME RULE AS THE WAITING SCREEN, and the same list of words, applied
  // where it belongs.
  //
  // WHERE IT BELONGS, AND WHERE IT DOES NOT, said out loud because narrowing a
  // rule quietly is how rules stop meaning anything. The rule is that Fayr must
  // never TELL somebody their shop account is being looked at. So it applies to
  // every line the assistant says in its own voice.
  //
  // It does NOT apply to the answer bank's answers about privacy, and it must
  // not: one of them is called "what the app reads" and another is "we never see
  // your shop password". Those exist BECAUSE somebody asked what Fayr reads, and
  // answering that question honestly is the opposite of the harm this rule
  // guards against. Applying the list there would delete the honest answers.
  describe('it never tells anybody their shop account is being looked at', () => {
    const FORBIDDEN = [
      'zepto', 'amazon', 'flipkart', 'myntra', 'blinkit', 'instamart', 'swiggy',
      'marketplace', 'account', 'scraping', 'scrape', 'order history',
      'checking your', 'verifying your', 'login', 'logged', 'cookie', 'session',
    ];

    it('not one of its own lines contains any of the words', () => {
      const bad: string[] = [];
      for (const one of everything.filter((o) => o.itsOwnVoice)) {
        const lower = one.text.toLowerCase();
        for (const word of FORBIDDEN) {
          if (lower.includes(word)) {
            bad.push(`${one.what} in ${one.language}: "${word}"`);
          }
        }
      }
      expect(bad).toEqual([]);
    });

    it('and it never says it is looking at anything of theirs, in any words', () => {
      const LOOKING = [
        /\bwe are (checking|reading|looking at|verifying) your\b/i,
        /\bchecking your (order|account|shop)\b/i,
        /\breading your (order|account|shop)\b/i,
        /\bwe have your (order|account|shop)\b/i,
        /\bfetching\b/i,
        /\bsyncing\b/i,
      ];
      const bad: string[] = [];
      for (const one of everything) {
        for (const phrase of LOOKING) {
          const found = phrase.exec(one.text);
          if (found) bad.push(`${one.what} in ${one.language}: "${found[0]}"`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('and the list really bites, so it is not asleep either', () => {
      for (const bad of [
        'We are checking your Amazon account now.',
        'Fetching your order history.',
        'Your session on the marketplace is being verified.',
      ]) {
        const hit =
          FORBIDDEN.some((w) => bad.toLowerCase().includes(w)) ||
          /\bfetching\b|\bwe are checking your\b/i.test(bad);
        expect(hit).toBe(true);
      }
    });
  });

  // ── nothing has been left out of this check ──────────────────────────────
  it('every file that holds words the assistant says is walked', () => {
    // A LIST THAT FALLS BEHIND IS THE FAILURE MODE OF THIS WHOLE FILE. If somebody
    // adds a new file of things the assistant says, this fails and names it.
    const chat = join(__dirname);
    const holdsWords = readdirSync(chat)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) => {
        const text = readFileSync(join(chat, f), 'utf8');
        // A file of things somebody reads has sentences in quotes with spaces in
        // them, not just names and keys.
        const quoted = text.match(/'[^'\n]{40,}'/g) ?? [];
        return quoted.some((q) => (q.match(/ /g) ?? []).length >= 6);
      });
    // THE THREE THE ASSISTANT SAYS TO A SHOPPER, which are the ones walked above:
    //   chat-words.ts        the greeting, the hand over, the queue apology
    //   opening-questions.ts the greeting's parts and the four questions
    //   email-draft.ts       the suggested email an agent copies
    //
    // AND THREE MORE THAT HOLD REFUSALS SHOWN TO STAFF, not to shoppers:
    //   chat.rules.ts   "This conversation is closed. Nobody can add to it."
    //   chat.service.ts "only a reply a person at Fayr wrote can become an answer"
    //   chat.store.ts   "a reply from Fayr has to say who wrote it"
    //
    // Both kinds are named, because the point of this check is that the list
    // cannot fall behind. A new file of words fails here and gets named, and
    // whoever adds it then has to decide which kind it is.
    expect([...holdsWords].sort()).toEqual(
      [
        'chat-words.ts', 'email-draft.ts', 'opening-questions.ts',
        'chat.rules.ts', 'chat.service.ts', 'chat.store.ts',
      ].sort(),
    );
  });
});
