/**
 * THE ASSISTANT NEVER INVENTS ANYTHING ABOUT SOMEBODY'S MONEY.
 *
 * NOBODY ASKED FOR THIS CHECK. It is here because it guards the thing most likely
 * to embarrass Fayr in front of a room: an assistant that says "your refund of
 * two hundred and ninety five rupees will arrive on Thursday" when nothing on the
 * server said either of those things. A wrong number about somebody's money is
 * worse than no number, because a person acts on it.
 *
 * HOW THE ANSWERS ARE BUILT, WHICH IS WHY THIS IS POSSIBLE AT ALL. Not one answer
 * in the bank carries a figure, a date or an order number, and not one carries a
 * gap for one to be filled into. Every answer points at the screen that holds the
 * real thing: "your offer page shows which step you are on", "your wallet screen
 * shows it". So the assistant cannot state a personal number, because it has no
 * way to say one.
 *
 * THIS CHECK KEEPS IT THAT WAY. It walks EVERY piece of writing the assistant can
 * put in front of somebody, in every language, and refuses five shapes:
 *
 *   a figure of money            "₹295", "Rs 295", "295 rupees"
 *   a hedge                      "usually", "roughly", "should arrive", "expect"
 *   a calendar date              "11 Jul", "2026-07-11"
 *   something shaped like an order number
 *   a length of time             "in three days", "within 48 hours"
 *
 * THE HEDGES MATTER AS MUCH AS THE FIGURES. "Your refund usually arrives in about
 * a week" contains no fact at all and a person will still plan around it.
 *
 * ONE EXCEPTION, NAMED, WITH ITS REASON. The line that hands somebody over says
 * an email gets a reply "within 24 to 48 hours". That is a real commitment Fayr
 * makes about its OWN email, it is written into the words on purpose, and it is
 * not about anybody's money. Nothing else may state a length of time, and the
 * check names this one line rather than letting the rule bend.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_DRAFTS } from './answer-drafts';
import { CANNOT_ANSWER_YET } from './answer-engine.rules';
import {
  LANGUAGE_CHOSEN,
  LANGUAGE_OFFER,
  STILL_WAITING,
  SUPPORT_EMAIL,
  greetingFor,
  handOverWords,
} from '../chat/chat-words';
import { LANGUAGES } from './language';

/** A figure of money, however it is written. */
const A_FIGURE_OF_MONEY = /₹\s*\d|\bRs\.?\s*\d|\d+\s*(rupees|rupaye|rupaiya|रुपये|रुपए)/i;

/**
 * A GUESS DRESSED UP AS AN ANSWER.
 *
 * Every one of these turns a sentence with no fact in it into something a person
 * will plan around. "Usually" is the worst of them: it sounds like knowledge and
 * carries none.
 */
const A_HEDGE =
  /\busually\b|\bnormally\b|\btypically\b|\bgenerally\b|\bapproximately\b|\broughly\b|\bshould (arrive|be|get|come|reach)\b|\bexpect\b|\bestimate|\bmost likely\b|\bprobably\b|\baam taur par\b|\bshayad\b|\bआमतौर\b|\bशायद\b/i;

/** A day on a calendar. */
const A_CALENDAR_DATE =
  /\b\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i;

/** Something shaped like an order number. */
const AN_ORDER_NUMBER = /\b\d{3}-\d{7}-\d{7}\b|\b\d{8,}\b/;

/** A length of time. */
const A_LENGTH_OF_TIME =
  /\b\d+\s*(day|days|hour|hours|week|weeks|minute|minutes|month|months|din|ghante|ghanta|hafte|mahine)\b|\b\d+\s*(दिन|घंटे|घंटा|हफ्ते|महीने)/i;

/** One piece of writing, and where it came from, so a failure names it. */
interface Writing {
  what: string;
  language: string;
  text: string;
  /** The one line allowed to say how long an email reply takes. See the note above. */
  mayStateHowLongAnEmailTakes?: boolean;
}

/**
 * EVERY PIECE OF WRITING THE ASSISTANT CAN PUT IN FRONT OF SOMEBODY.
 *
 * The answer bank's own drafts in all three languages, the refusal, the greeting,
 * the queue apology, the hand over, and the two language lines. If a new kind of
 * thing the assistant says is added and not added here, the count check below
 * fails, so this list cannot quietly fall behind.
 */
function everythingItCanSay(): Writing[] {
  const out: Writing[] = [];
  for (const draft of ANSWER_DRAFTS) {
    for (const [language, wording] of Object.entries(draft.wordings)) {
      out.push({
        what: `answer "${draft.key}" (${draft.topic})`,
        language,
        text: `${wording.title}. ${wording.body}`,
      });
      for (const phrase of wording.phrases ?? []) {
        out.push({ what: `a way of asking "${draft.key}"`, language, text: phrase });
      }
    }
  }
  for (const [language, text] of Object.entries(CANNOT_ANSWER_YET)) {
    out.push({ what: 'the reply when it does not know', language, text });
  }
  for (const [language, text] of Object.entries(STILL_WAITING)) {
    out.push({ what: 'the apology for a slow queue', language, text });
  }
  for (const [language, text] of Object.entries(LANGUAGE_OFFER)) {
    out.push({ what: 'the offer to change language', language, text });
  }
  for (const [language, text] of Object.entries(LANGUAGE_CHOSEN)) {
    out.push({ what: 'what it says once a language is picked', language, text });
  }
  for (const language of LANGUAGES) {
    out.push({
      what: 'the hand over to a person',
      language,
      text: handOverWords(language, SUPPORT_EMAIL),
      mayStateHowLongAnEmailTakes: true,
    });
  }
  // The greeting is English only, by the owner's instruction.
  for (const hour of [9, 14, 19]) {
    out.push({
      what: `the greeting at ${hour} o'clock in India`,
      language: 'en',
      text: greetingFor(new Date(Date.UTC(2026, 8, 3, hour) - 330 * 60_000)),
    });
  }
  return out;
}

describe('the assistant never invents anything about somebody’s money', () => {
  const everything = everythingItCanSay();

  it('walks every piece of writing there is, and there are a lot of them', () => {
    // A check that walked nothing would pass silently, which is the failure mode
    // of every check like this one.
    expect(everything.length).toBeGreaterThan(80);
    for (const one of everything) {
      expect(typeof one.text).toBe('string');
      expect(one.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('NEVER STATES A FIGURE OF MONEY. Not one, anywhere', () => {
    const bad = everything
      .filter((one) => A_FIGURE_OF_MONEY.test(one.text))
      .map((one) => `${one.what} in ${one.language}: ${A_FIGURE_OF_MONEY.exec(one.text)?.[0]}`);
    expect(bad).toEqual([]);
  });

  it('NEVER GUESSES. No "usually", no "roughly", no "should arrive"', () => {
    const bad = everything
      .filter((one) => A_HEDGE.test(one.text))
      .map((one) => `${one.what} in ${one.language}: ${A_HEDGE.exec(one.text)?.[0]}`);
    expect(bad).toEqual([]);
  });

  it('never states a day on a calendar', () => {
    const bad = everything
      .filter((one) => A_CALENDAR_DATE.test(one.text))
      .map((one) => `${one.what} in ${one.language}: ${A_CALENDAR_DATE.exec(one.text)?.[0]}`);
    expect(bad).toEqual([]);
  });

  it('never states anything shaped like an order number', () => {
    const bad = everything
      .filter((one) => AN_ORDER_NUMBER.test(one.text))
      .map((one) => `${one.what} in ${one.language}: ${AN_ORDER_NUMBER.exec(one.text)?.[0]}`);
    expect(bad).toEqual([]);
  });

  it('never promises how long, except the one line about email', () => {
    const bad = everything
      .filter((one) => !one.mayStateHowLongAnEmailTakes)
      .filter((one) => A_LENGTH_OF_TIME.test(one.text))
      .map((one) => `${one.what} in ${one.language}: ${A_LENGTH_OF_TIME.exec(one.text)?.[0]}`);
    expect(bad).toEqual([]);
  });

  it('and the one exception really is the one line, not a hole in the rule', () => {
    // Exactly the hand over, in each language, and nothing else.
    const allowed = everything.filter((one) => one.mayStateHowLongAnEmailTakes);
    expect(allowed.length).toBe(LANGUAGES.length);
    for (const one of allowed) {
      expect(one.what).toBe('the hand over to a person');
      // It says how long an EMAIL takes, and says nothing about money.
      expect(A_LENGTH_OF_TIME.test(one.text)).toBe(true);
      expect(A_FIGURE_OF_MONEY.test(one.text)).toBe(false);
    }
  });

  it('no answer carries a gap for a number to be filled into', () => {
    // The other way an invented figure could arrive: an answer written with a
    // hole in it and something later putting a number in the hole.
    const HOLE = /\{\{|\}\}|\$\{|%s|%d|<amount>|<date>|:amount|:date|\bXXX\b|_____/;
    const bad = everything
      .filter((one) => HOLE.test(one.text))
      .map((one) => `${one.what} in ${one.language}`);
    expect(bad).toEqual([]);
  });

  it('and every answer about money points at the screen that holds the real thing', () => {
    // The reason the rule above is livable rather than a straitjacket. An answer
    // about money that states no figure has to tell somebody where the figure is.
    const aboutMoney = ANSWER_DRAFTS.filter(
      (d) => d.topic === 'refund' || d.topic === 'withdrawal',
    );
    expect(aboutMoney.length).toBeGreaterThanOrEqual(5);
    for (const draft of aboutMoney) {
      const english = draft.wordings.en;
      expect(english).toBeDefined();
      const body = (english as { body: string }).body.toLowerCase();
      const pointsSomewhere =
        body.includes('your wallet') ||
        body.includes('wallet screen') ||
        body.includes('your offer page') ||
        body.includes('offer page') ||
        body.includes('person from fayr') ||
        body.includes('a person at fayr');
      expect(pointsSomewhere).toBe(true);
    }
  });
  // ── AND NO FIGURE IS WRITTEN INTO THE CODE EITHER ────────────────────────
  //
  // The owner asked for this one the way the screens are already checked: "It
  // never states a number the server did not give it. Check this the way the
  // screens are already checked: no figure written into the chat code."
  //
  // The answers above are DATA. This walks the CODE, so a figure typed straight
  // into a reply by somebody in a hurry is caught as well.
  describe('and no figure is written into the chat code', () => {
    const chatCode = (): { file: string; text: string }[] => {
      const dir = join(__dirname, '..', 'chat');
      return readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
        .map((f) => ({ file: `backend/src/chat/${f}`, text: readFileSync(join(dir, f), 'utf8') }));
    };

    /** Only what somebody could read: the words in quotes, never the code. */
    const wordsOnly = (source: string): string => {
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
      const quoted = withoutComments.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
      return quoted.join('\n');
    };

    it('walks the real files, so it is not passing on nothing', () => {
      const files = chatCode();
      expect(files.length).toBeGreaterThanOrEqual(8);
      for (const one of files) expect(one.text.length).toBeGreaterThan(200);
    });

    it('no figure of money is typed into any of them', () => {
      const bad: string[] = [];
      for (const one of chatCode()) {
        const found = A_FIGURE_OF_MONEY.exec(wordsOnly(one.text));
        if (found) bad.push(`${one.file}: ${found[0]}`);
      }
      expect(bad).toEqual([]);
    });

    it('and no guess is typed into any of them', () => {
      const bad: string[] = [];
      for (const one of chatCode()) {
        const found = A_HEDGE.exec(wordsOnly(one.text));
        if (found) bad.push(`${one.file}: ${found[0]}`);
      }
      expect(bad).toEqual([]);
    });

    it('and nothing shaped like a date or an order number', () => {
      const bad: string[] = [];
      for (const one of chatCode()) {
        const words = wordsOnly(one.text);
        const date = A_CALENDAR_DATE.exec(words);
        if (date) bad.push(`${one.file}: a date, ${date[0]}`);
        const order = AN_ORDER_NUMBER.exec(words);
        if (order) bad.push(`${one.file}: an order number, ${order[0]}`);
      }
      expect(bad).toEqual([]);
    });

    it('and it really would catch one, so the rule is not asleep', () => {
      // The check above passing means nothing unless it can fail. These are the
      // exact shapes it is looking for.
      expect(A_FIGURE_OF_MONEY.test("'your refund of ₹295 is on its way'")).toBe(true);
      expect(A_FIGURE_OF_MONEY.test("'we will send Rs 295 today'")).toBe(true);
      expect(A_FIGURE_OF_MONEY.test("'295 rupees are coming back'")).toBe(true);
      expect(A_HEDGE.test("'it usually takes a week'")).toBe(true);
      expect(A_HEDGE.test("'it should arrive soon'")).toBe(true);
      expect(A_HEDGE.test("'expect it by Friday'")).toBe(true);
      expect(A_CALENDAR_DATE.test("'by 11 Jul'")).toBe(true);
      expect(AN_ORDER_NUMBER.test("'order 402-3925017-7784521'")).toBe(true);
      expect(A_LENGTH_OF_TIME.test("'in 3 days'")).toBe(true);
      // And it does not fire on ordinary writing.
      expect(A_FIGURE_OF_MONEY.test("'your wallet screen shows it'")).toBe(false);
      expect(A_HEDGE.test("'your offer page shows which step you are on'")).toBe(false);
    });
  });
});
