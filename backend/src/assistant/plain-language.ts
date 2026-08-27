/**
 * THE HARD RULE: every answer reads as if it were explained to a child.
 *
 * Not a guideline. Every answer the assistant returns goes through this first,
 * and an answer that fails is never sent to anybody.
 *
 * WHY IT HAS TO BE ENFORCED AND NOT JUST INTENDED. The first answers are drawn
 * out of the terms and the privacy policy, which are written in the language of
 * terms and privacy policies: "a verifiable charge", "materially rewrite",
 * "forfeit unpaid refunds". That is precisely the wording a person whose money is
 * stuck cannot read, and it is what copying-out produces unless something that
 * does not get tired is checking.
 *
 * It also has to survive the future. Somebody will paste a state name into an
 * answer, or an error code, or a web address, and it will look fine in review.
 *
 * WHAT IT CAN AND CANNOT DO — said plainly, because a check that is trusted for
 * more than it does is worse than no check. It catches shapes: long dashes, short
 * codes, shouted capitals, little Latin abbreviations, known jargon, sentences
 * nobody could hold in their head, web addresses, half-written text. It cannot
 * tell whether an answer is TRUE, whether it is kind, or whether it actually
 * answers the question. Those need a person, which is why every drafted answer
 * starts as a draft and a person has to approve it.
 */

/** Longer than this and a person loses the thread halfway through. */
export const MAX_WORDS_PER_SENTENCE = 22;

/**
 * The only short names allowed through.
 *
 * Both are what these things are actually CALLED in India — spelling them out
 * would be less clear, not more, and the terms and the payout screen both use
 * them already. Everything else has to be words.
 */
export const ALLOWED_SHORT_NAMES = new Set(['UPI', 'PAN', 'I', 'A', 'OK']);

/**
 * Words that are not plain, and what to write instead.
 *
 * The replacement matters more than the ban: a warning that says "this is jargon"
 * helps nobody, and a warning that says "write 'sign in'" gets fixed.
 */
// prettier-ignore
export const JARGON: ReadonlyMap<string, string> = new Map([
  // How the thing is built. Never a user's problem.
  ['api', 'say "the app"'],
  ['endpoint', 'say "the app"'],
  ['backend', 'say "our side"'],
  ['server', 'say "our side"'],
  ['database', 'say "our records"'],
  ['token', 'say "your sign-in"'],
  ['cache', 'say "a saved copy"'],
  ['ledger', 'say "your money list"'],
  ['paise', 'use rupees'],
  ['idempotent', 'say "safe to do twice"'],
  ['null', 'say "nothing"'],
  ['boolean', 'say "yes or no"'],
  ['parameter', 'say "the thing you sent"'],
  ['payload', 'say "what you sent"'],
  // Sign-in words.
  ['authenticate', 'say "sign in"'],
  ['authentication', 'say "signing in"'],
  ['authorise', 'say "let you in"'],
  ['authorize', 'say "let you in"'],
  ['credentials', 'say "your sign-in details"'],
  ['session', 'say "while you are signed in"'],
  // The language a terms page is written in.
  ['materially', 'leave it out'],
  ['forfeit', 'say "lose"'],
  ['reclaim', 'say "take back"'],
  ['clawback', 'say "taking it back"'],
  ['deducting', 'say "taking it off"'],
  ['deduct', 'say "take off"'],
  ['eligible', 'say "allowed"'],
  ['ineligible', 'say "not allowed"'],
  ['verifiable', 'say "we can check it"'],
  ['pursuant', 'leave it out'],
  ['herein', 'leave it out'],
  ['thereof', 'leave it out'],
  ['aforementioned', 'say "the one above"'],
  ['notwithstanding', 'say "even so"'],
  ['stipulated', 'say "we said"'],
  ['remittance', 'say "the money we send"'],
  ['disbursement', 'say "sending your money"'],
  ['disburse', 'say "send your money"'],
  ['reimbursement', 'say "your money back"'],
  ['reimburse', 'say "pay you back"'],
  ['incentive', 'say "a reason to"'],
  ['instrument', 'say "card or bank"'],
  ['instruments', 'say "cards and banks"'],
  ['transaction', 'say "payment"'],
  ['transactions', 'say "payments"'],
  ['initiate', 'say "start"'],
  ['initiated', 'say "started"'],
  ['terminate', 'say "close"'],
  ['commence', 'say "start"'],
  ['utilise', 'say "use"'],
  ['utilize', 'say "use"'],
  ['facilitate', 'say "help"'],
  ['subsequent', 'say "next"'],
  ['prior', 'say "before"'],
  ['ascertain', 'say "find out"'],
  ['endeavour', 'say "try"'],
  ['endeavor', 'say "try"'],
  ['requisite', 'say "needed"'],
  ['applicable', 'say "that applies"'],
  ['discrepancy', 'say "difference"'],
  ['erroneous', 'say "wrong"'],
  ['rectify', 'say "fix"'],
  ['expedite', 'say "hurry up"'],
  ['adjudicate', 'say "decide"'],
  // Shop and money words people do not use out loud.
  ['marketplace', 'say "the shop"'],
  ['merchant', 'say "the shop"'],
  ['sku', 'say "the product"'],
  ['asin', 'say "the product number"'],
  ['metadata', 'say "the details"'],
  ['attribute', 'say "the detail"'],
  ['validate', 'say "check"'],
  ['validation', 'say "the check"'],
  ['verification', 'say "the check"'],
]);

/**
 * Words on the jargon list that are ORDINARY WORDS in Hindi typed with English
 * letters, so the ban must not apply there.
 *
 * "paise" is the whole reason this exists. In English it is the smallest part of a
 * rupee and it IS jargon: every amount a person sees has to be in rupees. In Hindi
 * it simply means MONEY. "Paise kaise dein" is "how do I pay". Banning it for
 * Hindi in English letters made writing plain Hindi impossible, which the drafts
 * test found the moment the first drafts were written.
 */
export const ORDINARY_IN_HINDI_LATIN = new Set(['paise']);

/** The little Latin ones and the typed-shorthand ones. */
// prettier-ignore
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['e.g.', 'say "for example"'],
  ['eg.', 'say "for example"'],
  ['i.e.', 'say "which means"'],
  ['ie.', 'say "which means"'],
  ['etc.', 'name the last one instead'],
  ['etc', 'name the last one instead'],
  ['vs.', 'say "or"'],
  ['vs', 'say "or"'],
  ['approx.', 'say "about"'],
  ['approx', 'say "about"'],
  ['asap', 'say "as soon as we can"'],
  ['faq', 'say "common questions"'],
  ['info', 'say "details"'],
  ['w/', 'say "with"'],
  ['pls', 'say "please"'],
  ['thx', 'say "thank you"'],
  ['&', 'say "and"'],
]);

export interface PlainLanguageProblem {
  /** A short name for the kind of problem. For the code, never shown as-is. */
  code:
    | 'empty'
    | 'not-text'
    | 'long-dash'
    | 'short-code'
    | 'abbreviation'
    | 'jargon'
    | 'long-sentence'
    | 'web-address'
    | 'unfinished';
  /** What is wrong, in the same plain words the rule demands. */
  detail: string;
  /** The exact thing that tripped it, so a person can find it. */
  found: string;
  /** What to write instead, when there is a sensible answer. */
  instead: string | null;
}

export interface PlainLanguageResult {
  ok: boolean;
  problems: PlainLanguageProblem[];
}

const LONG_DASHES = /--|—|–/;
const WEB_ADDRESS = /https?:\/\/|www\./i;
const UNFINISHED = /\{\{|\}\}|\$\{|\bTODO\b|\bTBD\b|\bXXX\b|<[a-z]/i;
const WORD_WITH_UNDERSCORE = /[A-Za-z]+_[A-Za-z_]+/;
const SHOUTED = /\b[A-Z][A-Z0-9]{1,}\b/g;
const SENTENCE_SPLIT = /[.!?।\n]+/;
const WORD = /[\p{L}\p{M}]+/gu;

function problem(
  code: PlainLanguageProblem['code'],
  detail: string,
  found: string,
  instead: string | null = null,
): PlainLanguageProblem {
  return { code, detail, found, instead };
}

/**
 * Check one piece of text.
 *
 * `language` decides which checks run. The shape checks run for every language —
 * a long dash is a long dash in Hindi. The word lists are English, so they run for
 * English and for Hindi typed in English letters, and NOT for Devanagari, where
 * they would be noise at best and would reject correct Hindi at worst.
 */
export function checkPlainLanguage(
  text: string,
  language: string,
): PlainLanguageResult {
  const problems: PlainLanguageProblem[] = [];

  if (typeof text !== 'string') {
    return {
      ok: false,
      problems: [
        problem('not-text', 'This is not writing at all.', String(text)),
      ],
    };
  }
  if (text.trim() === '') {
    return {
      ok: false,
      problems: [problem('empty', 'There is nothing here to read.', '')],
    };
  }

  // ── checks that run for every language ────────────────────────────────
  const dash = LONG_DASHES.exec(text);
  if (dash) {
    problems.push(
      problem(
        'long-dash',
        'This has a long dash in it. Use a full stop and start a new sentence.',
        dash[0],
      ),
    );
  }

  const web = WEB_ADDRESS.exec(text);
  if (web) {
    problems.push(
      problem(
        'web-address',
        'This has a web address in it. Say where to tap in the app instead.',
        web[0],
      ),
    );
  }

  const unfinished = UNFINISHED.exec(text);
  if (unfinished) {
    problems.push(
      problem(
        'unfinished',
        'This looks half written. Something was meant to be filled in here.',
        unfinished[0],
      ),
    );
  }

  const underscored = WORD_WITH_UNDERSCORE.exec(text);
  if (underscored) {
    problems.push(
      problem(
        'short-code',
        'This has a code in it that only makes sense to us. Say what it means.',
        underscored[0],
      ),
    );
  }

  for (const shout of text.match(SHOUTED) ?? []) {
    if (ALLOWED_SHORT_NAMES.has(shout)) continue;
    problems.push(
      problem(
        'short-code',
        'This shouts a short name nobody outside Fayr would know. Use words.',
        shout,
      ),
    );
  }

  for (const sentence of text.split(SENTENCE_SPLIT)) {
    const words = sentence.match(WORD) ?? [];
    if (words.length > MAX_WORDS_PER_SENTENCE) {
      problems.push(
        problem(
          'long-sentence',
          `This sentence has ${words.length} words in it. Break it into shorter ones.`,
          sentence.trim().slice(0, 60),
        ),
      );
    }
  }

  // ── checks that only make sense where the letters are English ─────────
  if (language !== 'hi') {
    const lower = text.toLowerCase();

    for (const [short, instead] of ABBREVIATIONS) {
      // Word-ish boundaries, so "etc" does not fire inside "etcetera" and "&"
      // still fires on its own.
      const escaped = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = /^[a-z]/.test(short)
        ? new RegExp(`(^|[^a-z])${escaped}(?![a-z])`, 'i')
        : new RegExp(escaped, 'i');
      if (pattern.test(lower)) {
        problems.push(
          problem(
            'abbreviation',
            'This uses a short form instead of the words.',
            short,
            instead,
          ),
        );
      }
    }

    for (const word of lower.match(/[a-z]+/g) ?? []) {
      if (language === 'hi-en' && ORDINARY_IN_HINDI_LATIN.has(word)) continue;
      const instead = JARGON.get(word);
      if (instead) {
        problems.push(
          problem(
            'jargon',
            `"${word}" is not a word a person here would use.`,
            word,
            instead,
          ),
        );
      }
    }
  }

  // Same problem found twice says nothing new.
  const seen = new Set<string>();
  const unique = problems.filter((p) => {
    const key = `${p.code}:${p.found}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: unique.length === 0, problems: unique };
}

/** The short answer. */
export function isPlainLanguage(text: string, language: string): boolean {
  return checkPlainLanguage(text, language).ok;
}

/** The problems as lines a screen can put in front of a person. */
export function plainLanguageProblems(
  text: string,
  language: string,
): string[] {
  return checkPlainLanguage(text, language).problems.map((p) =>
    p.instead ? `${p.detail} Instead, ${p.instead}.` : p.detail,
  );
}
