/**
 * EVERY WORD ON THE PAGE THAT MEASURES FAYR ITSELF, WALKED.
 *
 * The owner's rule, and this page is where it matters most: he shows it to
 * directors and senior product people, and nobody stands next to them
 * translating. So the same rule the assistant's words live under is applied
 * here, the same way chat/how-it-talks.spec.ts applies it: A CHECK THAT WALKS
 * THE WORDS, not a rule written down in a comment.
 *
 * ── WHAT IS DELIBERATELY NOT WALKED, AND WHY IT IS NAMED HERE ────────────────
 *
 * Two things on the page are DATA rather than writing, and pretending otherwise
 * would make the page worse:
 *
 *   1. The names in our own records ('order-details', 'dkim', 'amount-unknown').
 *      They are stored values. Renaming one so it reads prettily would change
 *      what the grouping matches, and the owner asked for the grouping table to
 *      be ON THE SCREEN precisely so nobody has to trust it.
 *   2. The name of the code that worked a figure out. He asked for it by name so
 *      a number can be traced, and a function name is not English.
 *
 * Both are skipped ON PURPOSE and listed below, so a future reader can see the
 * exception was decided rather than forgotten.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { explainHoldForStaff } from '../tasks/engine/hold-reasons';
import { checkPlainLanguage } from '../assistant/plain-language';
import { HELD_REASONS } from './running.rules';
import {
  DO_NOT_KNOW,
  EXPIRED,
  HELD,
  HOW_ORDERS,
  JOURNEY,
  MACHINE,
  MONEY,
  NOBODY_CAN_CLEAR_THIS_ONE,
  NOBODY_CAN_CLEAR_WARNING,
  NOTHING_YET,
  NOT_REAL_YET,
  NOT_WATCHING,
  OFFERS,
  ORDER_SOURCE_GROUPS,
  PAGE,
  STEPS,
  WAITING,
  alsoWaitingWords,
  lastLookedWords,
  moneyHasLeftWords,
} from './running.words';
import {
  CANNOT_TELL_DROP,
  DO_NOT_ADD_UP,
  disagreementWords,
  doesNotLineUpWords,
  readAtWords,
} from './running.rules';

interface Said {
  what: string;
  text: string;
}

/**
 * EVERYTHING THE PAGE CAN PUT IN FRONT OF A DIRECTOR.
 *
 * Built by hand rather than by reading the file, because a reader that walked
 * every string in the module would also walk the stored names above and would
 * have to be taught to skip them, and a skip list inside a walker is a skip list
 * nobody reads. The file list at the bottom is what stops this going stale.
 */
function everythingItSays(): Said[] {
  const out: Said[] = [];
  const say = (what: string, text: string): void => {
    out.push({ what, text });
  };

  say('the page title', PAGE.title);
  say('the first line', PAGE.lead);
  say('the second line', PAGE.leadTwo);
  say('the third line', PAGE.leadThree);
  say('the way it says nothing yet', NOTHING_YET);
  say('the way it says we are not watching', NOT_WATCHING);

  // ── Section A ────────────────────────────────────────────────────────────
  for (const [key, text] of Object.entries(JOURNEY)) {
    say(`the journey's ${key}`, text);
  }
  for (const [key, words] of Object.entries(STEPS)) {
    say(`the step ${key}`, words.step);
    say(`what ${key} means`, words.meaning);
    if ('whatItWouldTake' in words && words.whatItWouldTake) {
      say(`what ${key} would take`, words.whatItWouldTake);
    }
  }
  say('the expired row', EXPIRED.step);
  say('what the expired row means', EXPIRED.meaning);
  say('the drop that cannot be told', CANNOT_TELL_DROP);
  for (const by of [1, 4]) {
    say(`the drop that does not line up, by ${by}`, doesNotLineUpWords(by));
  }
  for (const [chosen, other] of [
    [7, 6],
    [6, 9],
    [10, 1],
  ] as const) {
    say(
      `two columns disagreeing by ${Math.abs(chosen - other)}`,
      disagreementWords(chosen, other, JOURNEY.bySittingStep) ?? '',
    );
  }

  // ── Section B ────────────────────────────────────────────────────────────
  for (const [key, text] of Object.entries(HOW_ORDERS)) {
    say(`how orders were established, ${key}`, text);
  }
  for (const group of ORDER_SOURCE_GROUPS) {
    say(`the group heading "${group.key}"`, group.heading);
    say(`what the group "${group.key}" means`, group.meaning);
  }
  say('the we-do-not-know heading', DO_NOT_KNOW.heading);
  say('what we-do-not-know means', DO_NOT_KNOW.meaning);
  say('the words when the parts do not add up', DO_NOT_ADD_UP);

  // ── Section C ────────────────────────────────────────────────────────────
  for (const [key, text] of Object.entries(MONEY)) {
    say(`the money block's ${key}`, text);
  }
  for (const [paid, rupees] of [
    [0, '₹0'],
    [1, '₹100'],
    [2, '₹400'],
    [17, '₹1,23,456.78'],
  ] as const) {
    say(
      `what has left Fayr, with ${paid} marked paid`,
      moneyHasLeftWords(paid, rupees),
    );
  }
  for (const [key, text] of Object.entries(WAITING)) {
    say(`the waiting block's ${key}`, text);
  }
  for (const [key, text] of Object.entries(HELD)) {
    say(`the held block's ${key}`, text);
  }
  for (const both of [0, 1, 3]) {
    say(`how many are also waiting, with ${both}`, alsoWaitingWords(both));
  }
  // The words a reviewer reads against each held reason are hold-reasons.ts's
  // own, and this page shows them, so this page has to walk them too.
  for (const reason of HELD_REASONS) {
    say(`the held reason "${reason}"`, explainHoldForStaff(reason));
  }
  say('the held reason nobody recognised', explainHoldForStaff('made-up'));

  // ── Section D ────────────────────────────────────────────────────────────
  for (const [key, text] of Object.entries(MACHINE)) {
    say(`the machine block's ${key}`, text);
  }
  say('the warning that nobody can clear a hold', NOBODY_CAN_CLEAR_WARNING);
  say('the note on one hold nobody can clear', NOBODY_CAN_CLEAR_THIS_ONE);

  // ── Section E ────────────────────────────────────────────────────────────
  for (const [key, text] of Object.entries(OFFERS)) {
    say(`the offers block's ${key}`, text);
  }
  for (const days of [0, 1, 8, 365]) {
    say(`when it was last looked at, ${days} days ago`, lastLookedWords('26 August', days));
  }

  // ── Section F ────────────────────────────────────────────────────────────
  say('the not-real-yet title', NOT_REAL_YET.title);
  say('the not-real-yet lead', NOT_REAL_YET.lead);
  NOT_REAL_YET.items.forEach((item, i) => {
    say(`the not-real-yet item ${i + 1}`, item);
  });

  // ── The stamp at the top ─────────────────────────────────────────────────
  for (const hour of ['03:44', '08:30', '14:05']) {
    say(
      `the stamp at ${hour}`,
      readAtWords(new Date(`2026-09-03T${hour}:00Z`)),
    );
  }

  return out;
}

describe('every word on the page', () => {
  const everything = everythingItSays();

  it('has something to walk, and a lot of it', () => {
    expect(everything.length).toBeGreaterThan(90);
    for (const said of everything) {
      expect(typeof said.text).toBe('string');
      expect(said.text.trim()).not.toBe('');
    }
  });

  it('passes the real plain-language rule, every line of it', () => {
    const failures: string[] = [];
    for (const said of everything) {
      const result = checkPlainLanguage(said.text, 'en');
      if (!result.ok) {
        for (const problem of result.problems) {
          failures.push(
            `${said.what}: ${problem.code} on "${problem.found}" — ${problem.detail}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('has no long dash and no double dash anywhere', () => {
    // Named separately from the rule above because the owner named it twice, and
    // because a rule that catches it as one problem among nine is a rule whose
    // failure is easy to skim past.
    for (const said of everything) {
      expect(said.text).not.toMatch(/--|—|–|―/);
    }
  });

  it('never says a nought where it means it is not looking', () => {
    // The two phrases are different sentences and must never become one. This is
    // the wording half; running.rules.spec.ts holds the shape half.
    expect(NOTHING_YET).not.toBe(NOT_WATCHING);
    expect(NOT_WATCHING).toContain('not watching');
    expect(NOTHING_YET).not.toContain('0');
    expect(NOT_WATCHING).not.toContain('0');
  });
});

describe('the sentences that carry the most weight', () => {
  it('says the held rule in the owner’s own words, neither cut nor lengthened', () => {
    expect(HELD.theRule).toBe(
      'Money is held when Fayr is not sure. '
      + 'Fayr would rather make somebody wait for a person than send the wrong amount.',
    );
  });

  it('says money has not left Fayr, and says why, without blaming the book', () => {
    const words = moneyHasLeftWords(2, '₹400');
    expect(words).toContain('2 payouts are marked paid');
    expect(words).toContain('records no money leaving');
    expect(words).toContain('because Fayr cannot send money yet');
    expect(words).toContain('a person moved the money by hand, outside Fayr');
    expect(words).toContain('₹400 is sitting in the payout holding account');
  });

  it('counts payouts properly at nought and at one', () => {
    expect(moneyHasLeftWords(0, '₹0')).toContain('No payout is marked paid');
    expect(moneyHasLeftWords(1, '₹100')).toContain('One payout is marked paid');
  });

  it('keeps waiting and held apart in words, not just in numbers', () => {
    expect(HELD.leadOne).toContain('Held is not the same as waiting');
    expect(WAITING.lead).toContain('normal');
    expect(HELD.leadOne).toContain('Held is a decision');
  });

  it('admits the step nothing records rather than dropping it', () => {
    // THIS USED TO BE TWO. On 5 September 2026 signing in at the shop became a
    // real count: the phone now tells our side the moment a shop's own page
    // treats somebody as signed in. Going to the shop is still not recorded, and
    // is still admitted rather than dropped.
    expect(STEPS.wentToTheShop.whatItWouldTake.length).toBeGreaterThan(20);
    // And the row that became real must NOT still carry an excuse, because a row
    // with a number and a reason nobody is watching it is a contradiction.
    expect('whatItWouldTake' in STEPS.signedInAtTheShop).toBe(false);
    // It says what the number is and, in the same breath, what it is not.
    expect(STEPS.signedInAtTheShop.meaning).toContain('not proof');
    expect(STEPS.signedInAtTheShop.meaning).toContain('moves no money');
  });

  it('says what is not real yet, at length, including the awkward parts', () => {
    expect(NOT_REAL_YET.items.length).toBeGreaterThanOrEqual(8);
    const all = NOT_REAL_YET.items.join(' ');
    expect(all).toContain('cannot send money');
    expect(all).toContain('Nobody is ever told anything');
    expect(all).toContain('practice data');
    expect(all).toContain('has ever been checked against the real shop');
    expect(all).toContain('not recorded at all');
    expect(all).toContain('counted only from the day the phone started');
  });

  it('says yesterday and today rather than a bare day count', () => {
    expect(lastLookedWords('3 September', 0)).toContain('which was today');
    expect(lastLookedWords('2 September', 1)).toContain('which was yesterday');
    expect(lastLookedWords('26 August', 8)).toContain('which was 8 days ago');
  });
});

/**
 * THE TRIPWIRE.
 *
 * A new file of words in this folder would not be walked by anything above, and
 * nothing else would notice. So the folder is listed, and adding a file to it
 * fails this until somebody decides whether its words are shown to a person.
 *
 * The same shape as the one in chat/how-it-talks.spec.ts, for the same reason:
 * every gap in these checks so far has been a thing nobody thought to read.
 */
describe('nothing new goes unwalked', () => {
  it('knows every file in this folder', () => {
    const here = readdirSync(__dirname).sort();
    expect(here).toEqual([
      'admin-running.controller.ts',
      'running.module.ts',
      'running.response.ts',
      'running.rules.spec.ts',
      'running.rules.ts',
      'running.service.ts',
      'running.words.spec.ts',
      'running.words.ts',
    ]);
  });

  it('finds the writing only in the words file, and never in the service', () => {
    // A sentence written in the service would reach a director unread. Long
    // quoted strings are what a sentence looks like, so the service is not
    // allowed any: it assembles words, it does not write them.
    const service = readFileSync(join(__dirname, 'running.service.ts'), 'utf8');
    const withoutComments = service
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const sentences = (withoutComments.match(/'[^'\n]{20,}'/g) ?? [])
      .filter((s) => (s.match(/[a-z]+ /g) ?? []).length >= 7)
      .filter(
        // The one exception, and it is not English: the name of the code that
        // worked a figure out, which the owner asked for so a number can be
        // traced back from the page.
        (s) => !s.includes('computeRefundPaise'),
      );
    expect(sentences).toEqual([]);
  });
});
