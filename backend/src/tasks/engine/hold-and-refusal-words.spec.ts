import { readdirSync, readFileSync } from 'node:fs';
import { checkPlainLanguage } from '../../assistant/plain-language';
import {
  EVERY_HELD_WORDING,
  FALLBACK,
  HOLD_MESSAGES,
  STAFF_FALLBACK,
  STAFF_HOLD_MESSAGES,
  explainHold,
  explainHoldForStaff,
} from './hold-reasons';
import { OUT_OF_WINDOW_MESSAGE } from './order-window';
import { EVERY_REFUSAL } from './refusal-words';
import { everySentence } from './shop-visit-words';
import { everyMessageSentence } from './journey-message';
import { PRICE_GAP_REASONS } from './watched-price';

/**
 * EVERY WORD SAID TO SOMEBODY ABOUT THEIR OWN MONEY, WALKED.
 *
 * WHY THIS FILE EXISTS, and it matters more than the sentences it checks.
 * checkPlainLanguage was written for the assistant and had only ever been run
 * over the assistant's answers. It had never read a held-money wording or a
 * refusal reason. So three sentences shown to a person about their own refund
 * carried a long dash, which is the one shape the rule names and tells you how to
 * fix, and they sat there from the day they were written. Nothing was wrong with
 * the rule. Nothing was pointing it at these words.
 *
 * WALKED AND NOT READ, the same shape as chat/how-it-talks.spec.ts and
 * running/running.words.spec.ts: the sentences are collected by walking the
 * exported lists rather than typed out here, so a wording added later is walked
 * without anybody remembering to add it.
 *
 * WHAT IS NOT COVERED, said plainly because a check trusted for more than it does
 * is worse than no check: the six diagnostic reasons refundEligibility returns in
 * engine/transition.ts are NOT in this walk, and several of them would fail it.
 * They are machine reasons that currently reach a person unchanged, and turning
 * them into sentences means a translation at two separate boundaries. That is a
 * decision about the money engine, not a wording fix, and it has not been made.
 */
describe('every word said about somebody’s own money', () => {
  /** Every sentence, with a name for it and the language it is written in. */
  function everythingItSays(): [string, string, string][] {
    const out: [string, string, string][] = [];
    const say = (what: string, text: string): void => {
      out.push([what, 'en', text]);
    };
    for (const [reason, words] of Object.entries(HOLD_MESSAGES)) {
      say(`held, to the person waiting (${reason})`, words);
    }
    say('held, to the person waiting, when the reason is not one we know', FALLBACK);
    for (const [reason, words] of Object.entries(STAFF_HOLD_MESSAGES)) {
      say(`held, to the reviewer clearing it (${reason})`, words);
    }
    say('held, to the reviewer, when the reason is not one we know', STAFF_FALLBACK);
    for (const words of EVERY_REFUSAL) {
      say('a refund refused', words);
    }
    // FOUND BY THIS WALK AND NOT BY READING. These are the two refusals for an
    // order bought outside the offer's own window, and they were not on the list
    // anybody asked for. They are shown to a person about their own money, which
    // is the only test for whether they belong here.
    for (const [verdict, words] of Object.entries(OUT_OF_WINDOW_MESSAGE)) {
      say(`bought outside the offer's window (${verdict})`, words);
    }
    // THE POP-UP BEFORE THEY LEAVE FOR THE SHOP, added 8 September. It is not
    // about a refund already earned, but it is the sentence that tells somebody
    // how long they have before they CANNOT be paid, which is the same money seen
    // from the other end. Walked here as well as in its own spec, so the tripwire
    // below is telling the truth rather than trusting a file it never reads.
    for (const words of everySentence()) {
      say('before they leave for the shop', words);
    }
    // THE ONE MESSAGE FOR A CAMPAIGN, added 8 September. Both lengths of all four,
    // because the short form is what the bar and the list show and the long form
    // is what the opened screen shows, and a rule that read only one of them
    // would leave the other unwalked.
    for (const words of everyMessageSentence()) {
      say('the one message for this campaign', words);
    }
    return out;
  }

  it('is a real list, and every piece of it is somebody’s money', () => {
    // Six held reasons, said twice, plus two fallbacks, plus five refusals,
    // plus the two for an order bought outside the offer's own window.
    expect(everythingItSays()).toHaveLength(6 + 1 + 6 + 1 + 5 + 2 + 6 + 8);
  });

  it('reads plainly, every sentence, with nothing skipped', () => {
    const bad: string[] = [];
    for (const [what, language, text] of everythingItSays()) {
      const result = checkPlainLanguage(text, language);
      if (!result.ok) {
        bad.push(`${what}: ${result.problems.map((p) => p.detail).join(' ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no long dash anywhere, which is what went wrong', () => {
    for (const [what, , text] of everythingItSays()) {
      expect({ what, hasALongDash: /--|—|–/.test(text) }).toEqual({
        what,
        hasALongDash: false,
      });
    }
  });

  it('never shows an internal name to anybody', () => {
    // The thing this whole file replaced: "Order amount is unknown, cannot
    // compute the refund (quantity-unknown)" on the screen where somebody checks
    // whether they are getting paid.
    for (const [what, , text] of everythingItSays()) {
      for (const name of Object.keys(HOLD_MESSAGES)) {
        expect({ what, shows: text.includes(name) }).toEqual({ what, shows: false });
      }
    }
  });

  it('says what happens next, in every held wording', () => {
    // Two rules this file has always claimed: it must not read as though the app
    // is broken, and it must say what happens next.
    for (const words of Object.values(HOLD_MESSAGES)) {
      expect(words.toLowerCase()).toContain('a person at fayr');
    }
    expect(FALLBACK.toLowerCase()).toContain('a person at fayr');
  });

  it('tells the reviewer what to look at, and never tells them to relax', () => {
    // The user-facing reassurance is exactly wrong in front of the person whose
    // job it is to do something about it.
    for (const words of Object.values(STAFF_HOLD_MESSAGES)) {
      expect(words.toLowerCase()).not.toContain('nothing is lost');
      expect(words.toLowerCase()).not.toContain('you do not need to do anything');
    }
  });

  it('walks what is really reachable, not a copy of it', () => {
    // The lists above must be the same words the two functions really return, or
    // the walk is checking a second copy that nothing shows anybody.
    for (const reason of Object.keys(HOLD_MESSAGES)) {
      expect(everythingItSays().map(([, , t]) => t)).toContain(explainHold(reason));
      expect(everythingItSays().map(([, , t]) => t)).toContain(
        explainHoldForStaff(reason),
      );
    }
    expect(explainHold('something nobody has seen')).toBe(FALLBACK);
    expect(explainHoldForStaff(null)).toBe(STAFF_FALLBACK);
  });

  it('has one wording for each held reason, on both sides', () => {
    expect(Object.keys(STAFF_HOLD_MESSAGES).sort()).toEqual(
      Object.keys(HOLD_MESSAGES).sort(),
    );
    expect(EVERY_HELD_WORDING).toHaveLength(
      Object.keys(HOLD_MESSAGES).length * 2 + 2,
    );
  });

  /**
   * A TRIPWIRE. A new file of wording in this folder is a new set of sentences
   * nothing is walking. The failure this catches is the one that happened.
   */
  it('is still walking every words file in this folder', () => {
    const wordFiles = readdirSync(__dirname)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .filter((name) => {
        const source = readFileSync(`${__dirname}/${name}`, 'utf8');
        // A file holds writing when it has a single-line string of seven or more
        // plain words in it. A diagnostic reason is shorter than that.
        return /'[a-z][^'\n]*(?: [a-z][^'\n ]*){6,}[^'\n]*'/i.test(source);
      })
      .sort();
    // transition.ts is in this list and NOT in the walk. That is the gap named at
    // the top of this file, kept visible rather than quietly excluded.
    //
    // AND watched-price.ts IS HERE FOR A DIFFERENT REASON — 19 September 2026.
    // It holds no wording at all. The test above matches it because its comment
    // says "The product's own price as the page prints it AFTER the shop's own
    // discount", and the two apostrophes in `product's` and `shop's` look to that
    // regular expression exactly like a quoted sentence. Its only strings are the
    // six machine names in PRICE_GAP_REASONS, and the test below this one is what
    // holds them to being machine names rather than sentences — which is the real
    // version of the question this tripwire is asking.
    expect(wordFiles).toEqual([
      'hold-reasons.ts',
      'journey-message.ts',
      'order-window.ts',
      'refusal-words.ts',
      'shop-visit-words.ts',
      'states.ts',
      'transition.ts',
      'watched-price.ts',
    ]);
  });

  /**
   * AND THE PRICE-GAP REASONS ARE NAMES, NOT SENTENCES.
   *
   * The reason watched-price.ts is excused from the walk above. If one of these
   * ever becomes a sentence, it becomes a sentence shown to a person about their
   * own refund, and it must then be walked like every other one — so this fails
   * the moment one grows a space in it.
   */
  it('the price-gap reasons stay machine names and never become wording', () => {
    expect(PRICE_GAP_REASONS.length).toBeGreaterThan(0);
    for (const reason of PRICE_GAP_REASONS) {
      expect(reason).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });
});
