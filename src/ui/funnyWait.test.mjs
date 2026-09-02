// The waiting screen's words, and the owner's rule about them.
//
// THE RULE: the screen must never tell somebody their shop account is being
// looked at. Not in a heading, not in small print, not in a loading label. This
// walks every line and fails on any of the words he listed, so a line added later
// cannot quietly break it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WAIT_LINES, WAIT_LINE_MS, waitLineAt } from './funnyWait.js';

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.deepStrictEqual(a, b, what); };

// ── 1. there are lines at all ────────────────────────────────────────────────
ok(Array.isArray(WAIT_LINES), 'the lines are a list');
ok(WAIT_LINES.length > 0, 'there is at least one line');
ok(WAIT_LINES.length >= 4, 'enough lines that a wait does not repeat immediately');

// ── 2. NOT ONE OF THE OWNER'S WORDS, in any case ─────────────────────────────
// His list, exactly as he wrote it.
const FORBIDDEN = [
  'zepto', 'amazon', 'flipkart', 'myntra', 'blinkit', 'instamart', 'swiggy',
  'marketplace', 'account', 'scraping', 'scrape', 'order history', 'checking your',
  'verifying your', 'login', 'logged', 'cookie', 'session',
];
for (const line of WAIT_LINES) {
  const lower = line.toLowerCase();
  for (const word of FORBIDDEN) {
    ok(!lower.includes(word), `"${line}" must not contain "${word}"`);
  }
  // And the same words with a capital letter, which is how they would really be
  // typed if somebody added a shop's name.
  for (const word of FORBIDDEN) {
    const capital = word[0].toUpperCase() + word.slice(1);
    ok(!line.includes(capital), `"${line}" must not contain "${capital}"`);
  }
}

// ── 3. simple words, the way the owner asked ─────────────────────────────────
for (const line of WAIT_LINES) {
  ok(typeof line === 'string' && line.trim() === line, `"${line}" has no stray spaces`);
  ok(line.length <= 60, `"${line}" is short enough to read at a glance`);
  ok(!line.includes('--'), `"${line}" has no double dash`);
  ok(!line.includes('—'), `"${line}" has no long dash either`);
  ok(!line.includes('…'), `"${line}" has no trailing dots`);
  // No short codes and no abbreviations: nothing in capitals but the first letter
  // of a sentence, and no full stop inside a word.
  ok(!/\b[A-Z]{2,}\b/.test(line), `"${line}" has no abbreviation in capitals`);
  ok(!/[a-z]\.[a-z]/i.test(line), `"${line}" has no short code with dots in it`);
  ok(/[.!?]$/.test(line), `"${line}" ends like a sentence`);
}

// Every line is different. A list with the same line twice is a list somebody
// pasted into rather than wrote.
eq(new Set(WAIT_LINES).size, WAIT_LINES.length, 'no line appears twice');

// ── 4. the owner's own rotation time ─────────────────────────────────────────
eq(WAIT_LINE_MS, 2500, 'a line changes every two and a half seconds');

// ── 5. which line at which moment ────────────────────────────────────────────
eq(waitLineAt(0), WAIT_LINES[0], 'the first line is first');
eq(waitLineAt(2499), WAIT_LINES[0], 'still the first line just before the change');
eq(waitLineAt(2500), WAIT_LINES[1], 'the second line at two and a half seconds');
eq(waitLineAt(2500 * (WAIT_LINES.length - 1)), WAIT_LINES[WAIT_LINES.length - 1],
  'the last line, at the last moment it belongs to');
eq(waitLineAt(2500 * WAIT_LINES.length), WAIT_LINES[0], 'then round to the start again');
// Anything unusable is the first line, never nothing. A screen with no words on it
// is worse than the wrong words.
for (const junk of [null, undefined, -1, NaN, Infinity, 'soon', {}]) {
  eq(waitLineAt(junk), WAIT_LINES[0], 'junk gives the first line');
}

// ── 6. the screen that uses them says nothing either ─────────────────────────
// The words are only half of the rule. The screen around them has a heading and a
// smaller line of its own, and those must obey the same rule. Read the screen's
// own source and hold it to the same list.
const screen = readFileSync(
  new URL('../order/LookingForItScreen.js', import.meta.url), 'utf8',
);
// WHAT IS SEARCHED, AND WHY IT IS NOT SIMPLY THE WHOLE FILE.
//
// Comments explain why the rule exists and have to be able to name the words, so
// they go first. What is left is code, and code names things a person never sees:
// the campaign's own `marketplace` field is one, and a rule that failed on it
// would be a rule about variable names rather than about what is on the screen.
//
// So the words a PERSON could see are searched: every piece of text written into
// the file in quotes. Import lines are left out, because a file name is not
// something anybody reads.
const body = screen
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('import '))
  .join('\n');
const written = [...body.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)]
  .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
  .filter((t) => t.trim() !== '');
ok(written.length > 0, 'the screen has words in it to check');
for (const text of written) {
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN) {
    ok(!lower.includes(word),
      `the waiting screen writes "${text}", which contains "${word}"`);
  }
}
ok(body.includes('WAIT_LINES') || body.includes('waitLineAt'),
  'the screen takes its lines from this file rather than typing its own');

console.log(`funnyWait: ${checks} checks passed`);
