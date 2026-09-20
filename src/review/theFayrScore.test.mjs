// THE FAYR SCORE — AND THE ONE CHECK THE WHOLE MODULE EXISTS FOR.
//
// Section 3 walks a MATCHED PAIR: the same review written approvingly and
// disapprovingly, the same specifics, and asserts THE SAME SCORE. If that ever
// fails, the scorer has started measuring how somebody felt instead of how much
// they described, and everything else in this file is beside the point.
//
// IT ALREADY CAUGHT ONE. The first writing of theFayrScore.js had a hand-written
// stock-phrase list carrying "loved it" and not "hated it", so a review ending
// "I loved it" scored 57 and the same review ending "I hated it" scored 72 —
// sentiment bias arriving through the back door of a list nobody had kept level.
// The fix was structural rather than another entry: the phrases are now written
// with a hole in them, `*` standing for any evaluation word, so there is no list
// left to keep balanced.
//
// EVERY NUMBER IN THE MODULE IS A GUESS. Nobody has scored a real Fayr review.
// These checks prove the RULES behave as written — that distinct words beat
// length, that stock phrases drag it down, that a descriptive one-star beats an
// empty five-star. They do not prove 56 is the right answer for anything.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EVALUATION_WORDS, FAIR, KINDS, MISSING, PER_KIND, PER_STOCK_PHRASE, PER_WORD,
  STOCK_PHRASES, STRONG, THE_FAIR_LINE, THE_STRONG_LINE, THIN, TRANSACTION_WORDS,
  WHY, contentWords, flattenEvaluation, specificKinds, stockPhrasesIn,
  theFayrScore, tidy,
} from './theFayrScore.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const score = (t) => theFayrScore(t).score;
const band = (t) => theFayrScore(t).band;

console.log('=== 1. the seven the owner named ===');
{
  // HIS OWN EXAMPLE OF WHAT FAYR DOES NOT WANT.
  const empty = theFayrScore('Good product, very nice product, loved it');
  ok(empty.band === THIN, '"Good product, very nice product, loved it" is THIN');
  ok(empty.stock >= 2, 'and it is caught as stock phrases, not merely as short');

  // A SHORT SPECIFIC NEGATIVE, which must beat every empty positive there is.
  const sharp = theFayrScore('Texture is thin and it separated after about a week');
  ok(sharp.band === FAIR, 'a short specific review is FAIR');
  ok(sharp.kinds.length >= 2, 'because it carries more than one kind of specific');

  // A LONG EMPTY POSITIVE.
  const gush = theFayrScore('Absolutely amazing, best purchase ever, highly recommend to everyone');
  ok(gush.band === THIN, 'a long enthusiastic review with nothing in it is THIN');
  ok(gush.words === 0, 'because not one of its words describes the product');

  // PADDED REPETITION.
  ok(band('very nice very nice very nice') === THIN, 'repetition is THIN');
  ok(theFayrScore('very nice very nice very nice').words === 0,
    'and saying it three times is still nothing said once');

  // ABOUT THE COURIER, NOT THE PRODUCT.
  const courier = theFayrScore('Fast delivery, well packed, thanks seller');
  ok(courier.band === THIN, 'a review about the delivery is THIN');
  ok(score('Fast delivery, well packed, thanks seller')
    < score('Texture is thin and it separated after about a week'),
    'and it scores below a review about the thing that was bought');

  ok(band('') === THIN && score('') === 0, 'an empty review is nothing');
  ok(theFayrScore('').because.indexOf(WHY.NOTHING_WRITTEN) >= 0, 'and says so');
  ok(band('good') === THIN, 'one word is THIN');
  for (const nothing of [null, undefined, 7, {}, []]) {
    ok(theFayrScore(nothing).score === 0,
      `${JSON.stringify(nothing)} scores nothing rather than throwing`);
  }
}

console.log('\n=== 2. THE OWNER’S RULE: descriptive beats positive, every time ===');
{
  // HIS OWN WORDS: "Even if it is bad — 'The texture is not nice, this is not
  // nice' — it is scoring." A one-star review that says what went wrong must
  // beat a five-star one that says nothing. This is the single easiest thing in
  // the whole phase to get backwards.
  const oneStar = 'separated after a week and left an oily film';
  const fiveStar = 'amazing product loved it';
  ok(score(oneStar) > score(fiveStar),
    'a one-star review that describes something beats a five-star one that does not');
  ok(band(oneStar) !== THIN && band(fiveStar) === THIN,
    'and by a whole band, not by a point');

  for (const [bad, good] of [
    ['The strap snapped after two weeks of daily use', 'Best product ever, fully satisfied'],
    ['Smells strongly of plastic and the lid does not seal', 'Superb quality, must buy'],
    ['Thinner than the one I had before and it tears easily', 'Loved it, value for money'],
  ]) {
    ok(score(bad) > score(good), `"${bad.slice(0, 34)}…" beats "${good.slice(0, 26)}…"`);
  }
}

console.log('\n=== 3. SENTIMENT-BLINDNESS — the check this module exists for ===');
{
  // THE MATCHED PAIR. The same review, the same specifics, one written in praise
  // and one in complaint. Anything other than an identical score means the
  // scorer has started measuring feeling.
  const PAIRS = [
    [
      'The texture is thick and it lasted about a week before the strap loosened. I loved it.',
      'The texture is thick and it lasted about a week before the strap loosened. I hated it.',
    ],
    [
      'Wonderfully soft, and after three washes the colour stayed bright.',
      'Horribly soft, and after three washes the colour stayed bright.',
    ],
    [
      'Foams much less than the one I used before — an excellent change.',
      'Foams much less than the one I used before — a terrible change.',
    ],
    [
      'Very good. The gel is thin and it dried in two minutes.',
      'Very bad. The gel is thin and it dried in two minutes.',
    ],
    [
      'Perfect weight, and the metal feels smooth after a month of use.',
      'Useless weight, and the metal feels smooth after a month of use.',
    ],
  ];
  for (const [praise, complaint] of PAIRS) {
    const a = theFayrScore(praise);
    const b = theFayrScore(complaint);
    ok(a.score === b.score, `the same score in praise and in complaint: "${praise.slice(0, 40)}…"`);
    ok(a.band === b.band, 'and the same band');
    ok(a.words === b.words && a.stock === b.stock,
      'and the same counts underneath, so it is not two errors cancelling out');
  }

  // AND IT IS STRUCTURAL, NOT BALANCED BY HAND. Every evaluation word becomes
  // the same character before a stock phrase is looked for, so the list cannot
  // tell praise from complaint even in principle.
  ok(flattenEvaluation('loved it').join(' ') === flattenEvaluation('hated it').join(' '),
    '"loved it" and "hated it" are the same thing once evaluation is flattened');
  ok(stockPhrasesIn('loved it').length === stockPhrasesIn('hated it').length,
    'so they are penalised identically');
  ok(stockPhrasesIn('very good').length === stockPhrasesIn('very bad').length,
    'and so are "very good" and "very bad"');

  // THE EVALUATION LIST IS WRITTEN IN PAIRS, so a one-sided entry is visible.
  for (const pair of EVALUATION_WORDS) {
    ok(Array.isArray(pair) && pair.length === 2,
      `${JSON.stringify(pair)} is a pair, not a lone word`);
  }
  // NO EVALUATION WORD CAN MOVE A SCORE, in either direction.
  const plain = 'the lid is thin and it cracked after two days';
  for (const [up, down] of EVALUATION_WORDS.slice(0, 12)) {
    ok(score(`${plain} ${up}`) === score(`${plain} ${down}`),
      `adding "${up}" and adding "${down}" do the same thing: nothing`);
  }
}

console.log('\n=== 4. distinct words, not length ===');
{
  // PADDING ADDS NOTHING. The same four real words, one of them repeated twenty
  // times, must not beat the plain version.
  const plain = 'leaks at the seam';
  const padded = `${plain} ${'leaks '.repeat(20)}`.trim();
  ok(score(padded) === score(plain), 'saying a word twenty more times adds nothing');
  ok(score('very nice very nice very nice') < score('leaks at the seam'),
    'and three repetitions lose to four words of which two are real');

  // AND A LONGER REVIEW IS ONLY BETTER IF IT SAYS MORE.
  const short = 'the lid cracked';
  const longer = 'the lid cracked and the rubber seal came away after two weeks';
  ok(score(longer) > score(short), 'a review that says more does score more');
  const longEmpty = 'it is a product and the product is a product that is a product';
  ok(score(longEmpty) < score(short), 'while a longer review saying nothing scores less');

  ok(contentWords('leaks leaks leaks at the seam').length === 2,
    'distinct content words are counted once each');
  ok(contentWords('').length === 0, 'and an empty review has none');
}

console.log('\n=== 5. what counts as a specific, and what does not ===');
{
  ok(specificKinds('it lasted about a week').indexOf('TIME') >= 0, 'time is a specific');
  ok(specificKinds('the tube holds 75 ml').indexOf('AMOUNT') >= 0, 'a quantity is a specific');
  ok(specificKinds('thinner than the old one').indexOf('COMPARISON') >= 0,
    'a comparison is a specific');
  ok(specificKinds('it smells of plastic').indexOf('SENSE') >= 0, 'a sense is a specific');
  ok(specificKinds('good product').length === 0, 'and an opinion is not');

  // KINDS AND NOT OCCURRENCES. Four mentions of time are one kind, because
  // counting occurrences would reward saying the same sort of thing repeatedly.
  const once = 'the seal went after a week';
  const fourTimes = 'the seal went after a week, a week, a week and a week';
  ok(specificKinds(fourTimes).length === specificKinds(once).length,
    'saying the same kind of thing four times is one kind');

  // THE TRANSACTION IS NOT THE PRODUCT.
  for (const word of ['delivery', 'packaging', 'seller', 'courier', 'parcel']) {
    ok(TRANSACTION_WORDS.indexOf(word) >= 0, `"${word}" is about the transaction`);
    ok(contentWords(`the ${word} was here`).indexOf(word) === -1,
      `and "${word}" never counts as describing the product`);
  }
  const onlyCourier = theFayrScore('the delivery and the packaging and the seller');
  ok(onlyCourier.because.indexOf(WHY.ONLY_THE_TRANSACTION) >= 0,
    'a review made only of the transaction is named as such');
}

console.log('\n=== 6. the stock phrases, and they drag it DOWN ===');
{
  ok(STOCK_PHRASES.length > 20, 'there is a real list of them');
  const base = 'the lid is thin and it cracked after two days';
  ok(score(`${base} good product`) < score(base),
    'adding a stock phrase lowers the score rather than leaving it alone');
  ok(score(`${base} bad product`) === score(`${base} good product`),
    'and the complaining one lowers it by exactly as much');
  ok(PER_STOCK_PHRASE > PER_WORD,
    'one stock phrase costs more than one real word earns, or filler would pay');

  // ONE LIST, IN ONE PLACE, so it can be added to from real reviews.
  const code = read('src/review/theFayrScore.js');
  ok(/export const STOCK_PHRASES = \[/.test(code),
    'the list is exported from one place and can be added to');
  ok(stockPhrasesIn('* items').length === 0,
    '"* it" does not strike "* items" — phrases are whole words, never substrings');
}

console.log('\n=== 7. the bands, and the weights they come from ===');
{
  ok(THE_FAIR_LINE === 35 && THE_STRONG_LINE === 70, 'the two lines are where they say');
  ok(band('x') === THIN, 'below the first line is thin');
  const code = withoutComments(read('src/review/theFayrScore.js'));
  ok(/words\.length \* PER_WORD/.test(code), 'distinct words really drive the score');
  ok(/kinds\.length \* PER_KIND/.test(code), 'and so do kinds of specific');
  ok(/stock\.length \* PER_STOCK_PHRASE/.test(code), 'and stock phrases subtract');
  ok(!/\.length \* PER_WORD[\s\S]{0,40}allWords/.test(code),
    'and it is contentWords that is measured, never the raw length');
  ok(PER_KIND > PER_WORD, 'a specific is worth more than a word, which is the point');
  ok(theFayrScore('a').score >= 0 && theFayrScore(
    'texture smell taste sound weight colour fabric metal foam grip after a week than before 75 ml',
  ).score <= 100, 'the score never leaves 0..100');
}

console.log('\n=== 8. FAYR NEVER WRITES ANYBODY’S REVIEW ===');
{
  // The prompts may name CATEGORIES of thing worth thinking about. They may
  // never contain a phrase somebody could paste, an example sentence, or an
  // instruction to say any particular thing.
  for (const kind of KINDS) {
    const line = MISSING[kind];
    ok(typeof line === 'string' && line.length > 8, `${kind} has a category name`);
    ok(!/["'“”‘’]/.test(line), `${kind}'s prompt carries no quoted phrase to copy`);
    ok(!/^(try|say|write|type|use|mention that|tell them)\b/i.test(line),
      `${kind}'s prompt does not tell anybody what to write`);
    ok(!/e\.g\.|for example|such as|like "/i.test(line), `${kind} gives no example`);
  }

  const screen = withoutComments(read('src/review/WriteReviewScreen.js'));
  // NOTHING PUTS WORDS IN THE BOX. A suggestion control would have to set the
  // text to something this file chose.
  ok(!/setText\(['"`]/.test(screen), 'nothing sets the box to a literal string');
  ok(!/suggest|autocomplete|template|placeholderSuggestion|examples/i.test(screen),
    'there is no suggestion, template or example machinery on the screen');
  ok(!/anthropic|openai|generate|completion|prompt\(/i.test(screen),
    'and nothing generates text');
  // The one literal the box carries is its placeholder, which is a question and
  // not an answer.
  ok(/placeholder="What was it like to use\?"/.test(screen),
    'the placeholder asks a question rather than offering words');
  ok(/scored\.missing\.map/.test(screen),
    'the prompts on screen come from the score’s own categories');
}

console.log('\n=== 9. it warns and it NEVER blocks ===');
{
  const screen = withoutComments(read('src/review/WriteReviewScreen.js'));
  // NOTHING ON THIS SCREEN IS DISABLED, AND CERTAINLY NOT BY A SCORE.
  //
  // This used to read `ok(/disabled={saving}/)` — the SAVE MY REVIEW button was
  // the only thing that carried it. That button went on 20 September 2026, when
  // the owner said saving should not be a thing a person has to remember to do:
  // the one tap that copies and opens the order saves as well. With it went the
  // last `disabled` on the screen.
  //
  // WHAT ACTUALLY MATTERED IS KEPT, and it is the harder promise: a thin review
  // is warned about and never blocked. So this now refuses ANY disabled at all,
  // which is strictly stronger than the line it replaces and cannot be satisfied
  // by disabling on the score.
  ok(!/disabled=/.test(screen),
    'nothing on the review screen is disabled — a thin review is warned about, never blocked');

  // ── AND THE ONE TAP WRITES THE WORDS DOWN BEFORE IT SENDS ANYBODY OFF ─────
  //
  // 20 SEPTEMBER 2026. The owner wrote a review, tapped "copy and add review",
  // pasted it on Zepto and submitted — and task_reviews still had 0 rows,
  // because saving sat behind a button he had no reason to press. His reason
  // for wanting it saved is the one that matters: "at the time of refunding the
  // money to the wallet, the backend will check for the last time if the review
  // is there or not ... we can check if the review has been edited, updated,
  // removed, or deleted."
  //
  // Those saved words are the ONLY copy Fayr holds of what was meant to be
  // posted. Without them the end-of-hold check can see that SOMETHING is on the
  // page, never that it is still the same thing — which is the clawback half of
  // loophole three in CLAUDE.md.
  const oneTap = screen.slice(
    screen.indexOf('const copyAndOpenTheOrder'),
    screen.indexOf('}, [send, text, campaignId'),
  );
  ok(oneTap.length > 40, 'the one tap is where expected');
  const saves = oneTap.indexOf('await send();');
  const opens = oneTap.indexOf("navigation.navigate('Shop'");
  ok(saves > -1, 'the one tap saves the review');
  ok(opens > saves, 'and it saves BEFORE it opens the order, not after');
  ok(/setCopied\(copyToClipboard\(text\)\)/.test(oneTap),
    'and still copies exactly what is in the box');
  ok(!/disabled=\{[^}]*(score|band|THIN|scored)/.test(screen),
    'no score, band or scored value reaches a disabled prop');
  ok(!/if \([^)]*THIN[^)]*\) return/.test(screen), 'a thin review is never refused');
  ok(!/Alert\.|cannot send|too short|please write more/i.test(screen),
    'nothing nags, warns off, or refuses');
  // AND THE SEND PATH DOES NOT READ THE SCORE AT ALL.
  const send = screen.slice(screen.indexOf('const send = useCallback'),
    screen.indexOf('}, [taskId, text, stars]);'));
  ok(send.length > 80, 'the send path was found');
  ok(!/scored|score|band/.test(send), 'sending a review never looks at its score');
}

console.log('\n=== 10. the text is the person’s, and is never tidied ===');
{
  const messy = '  they  said\n\nit WOULD last.   It did not.  ';
  // The scorer tidies a THROWAWAY COPY. Nothing it does can reach what is stored.
  ok(tidy(messy) !== messy, 'the scorer works on a tidied copy');
  const client = withoutComments(read('src/backend/reviewsApi.js'));
  ok(/const body = typeof stars === 'number' \? \{ text, stars \} : \{ text \};/.test(client)
    && /JSON\.stringify\(body\)/.test(client),
    'the client sends the text as it is, with the stars only when there are some');
  ok(!/\.trim\(\)|replace\(/.test(client), 'and trims or rewrites nothing on the way out');
  const screen = withoutComments(read('src/review/WriteReviewScreen.js'));
  ok(/putReview\(taskId, text, stars\)/.test(screen),
    'the screen sends exactly what is in the box');
  ok(!/text\.trim\(\)|\.normalize\(/.test(screen), 'and never trims or normalises it');

  const service = withoutComments(read('backend/src/reviews/review.service.ts'));
  ok(/create: \{ taskId, text,/.test(service) && /update: \{ text,/.test(service),
    'the server stores the text it was given, on both branches');
  ok(!/text\.trim\(\)|text\.replace\(|normalize/.test(service),
    'and there is no trim, replace or normalise anywhere in the service');
  const dto = withoutComments(read('backend/src/reviews/dto/write-review.dto.ts'));
  ok(!/Transform|trim/.test(dto), 'and the DTO does not transform it on the way in');
  const response = withoutComments(read('backend/src/reviews/review.response.ts'));
  ok(/text: r\.text,/.test(response), 'and it comes back exactly as it was stored');
}

console.log('\n=== 11. writing a review MOVES NO MONEY and NO TASK ===');
{
  const service = withoutComments(read('backend/src/reviews/review.service.ts'));
  for (const name of ['transition', 'TaskService', 'taskflow', 'engine/',
    'wallet', 'ledger', 'refund', 'Refund', 'paise', 'evidence', 'submitEvidence']) {
    ok(!new RegExp(name).test(service), `the service never touches ${name}`);
  }
  ok(!/task\.update|prisma\.task\.update/.test(service),
    'and it never writes to the task row at all');
  ok(/prisma\.taskReview\.upsert/.test(service), 'the only write it makes is its own row');
  const controller = withoutComments(read('backend/src/reviews/review.controller.ts'));
  ok(!/TaskService|transition|evidence/.test(controller),
    'and the controller reaches nothing in the task loop');
  // ITS OWN MODULE, so it cannot drift into the task loop's file.
  ok(/@Controller\('tasks\/:taskId\/review'\)/.test(controller),
    'it lives under the task’s path but in its own controller');
}

console.log('\n=== 12. the two copies of the rule agree, row for row ===');
{
  // There are two implementations on purpose — the app scores as somebody types,
  // the server scores what it stores — and this table is what makes a drift
  // between them a failing check rather than a surprise. The backend runs the
  // same rows in fayr-score.spec.ts.
  const doc = JSON.parse(read('src/review/score-fixtures.json'));
  ok(Array.isArray(doc.reviews) && doc.reviews.length >= 15,
    `the shared table has real rows in it (${doc.reviews.length})`);
  let same = 0;
  for (const row of doc.reviews) {
    const out = theFayrScore(row.text);
    const agrees = out.score === row.score && out.band === row.band
      && out.words === row.words && out.stock === row.stock
      && out.kinds.join(',') === row.kinds.join(',');
    if (agrees) same += 1;
    else ok(false, `the app copy disagrees with the table on ${JSON.stringify(row.text).slice(0, 44)}`);
  }
  ok(same === doc.reviews.length, `the app copy matches every row (${same}/${doc.reviews.length})`);
  ok(Array.isArray(doc._whatThisIs) && doc._whatThisIs.join(' ').includes('not a specification'),
    'and the table says plainly what it does not prove');
}

console.log('\n=== 13. THE STARS — a record, and never a reason to pay ===');
{
  const screen = withoutComments(read('src/review/WriteReviewScreen.js'));

  // NOTHING IS CHOSEN FOR THEM. null is where it starts and where tapping the
  // chosen one puts it back. Not 0, which would be a rating; not 5, which would
  // be Fayr asking for a number.
  ok(/const \[stars, setStars\] = useState\(null\);/.test(screen),
    'the star picker starts with nothing chosen');
  ok(!/useState\(5\)|useState\(1\)|useState\(0\)|defaultStars|stars = 5/.test(screen),
    'and nothing anywhere pre-selects a number');
  ok(/setStars\(stars === n \? null : n\)/.test(screen),
    'and a number can be un-said as easily as it was said');
  // Only a real 1-5 from the server becomes a choice; null stays null.
  ok(/typeof r\.review\.stars === 'number'/.test(screen),
    'a rating loaded back is only taken when it is really a number');

  // FAYR NEVER ASKS FOR A NUMBER OF STARS. Not in a label, not in a hint, not in
  // an accessibility string, and not in a colour.
  const nearTheStars = screen.slice(screen.indexOf('starsBlock'), screen.indexOf('{refusal ?'));
  ok(nearTheStars.length > 100, 'the star block was found');
  ok(!/recommend|suggest|most people|usually|at least|minimum|expected|should give|try/i
    .test(nearTheStars), 'no words near the picker suggest which number to pick');
  ok(!/\b(five|four|5 star|4 star|5-star)\b/i.test(nearTheStars),
    'and no particular number is named');
  // ONE COLOUR ON, ONE COLOUR OFF. A warmer tone at five would be a
  // recommendation drawn instead of written.
  const styles = screen.slice(screen.indexOf('starOn:'), screen.indexOf('copied:'));
  ok(/starOn: \{ fontSize: 30, lineHeight: 34, color: COLOR\.goldDeep \}/.test(styles)
    && /starOff: \{ fontSize: 30, lineHeight: 34, color: COLOR\.line \}/.test(styles),
    'every chosen star is drawn the same, and so is every unchosen one');

  // THE SERVER KEEPS IT OPTIONAL.
  const dto = withoutComments(read('backend/src/reviews/dto/write-review.dto.ts'));
  ok(/@IsOptional\(\)\s*@IsInt\(\)\s*@Min\(1\)\s*@Max\(5\)\s*stars\?: number;/.test(dto),
    'stars is optional, an integer, and between one and five');
  ok(/text!: string;/.test(dto), 'while the text is still required');
  ok(!/score|band/.test(dto), 'and a score or a band still cannot be sent at all');

  // AND NOT ONE THING IN THE BACKEND READS IT TO DECIDE ANYTHING.
  //
  // Walked over the whole of backend/src rather than over a named list, so a new
  // file that starts reading it is caught the day it is written. Comments
  // stripped first: the column's own documentation explains at length that it
  // must never decide money, and reading that sentence as evidence of the
  // opposite is the mistake this project has now made eight times.
  const walked = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) walked.push(full);
    }
  };
  walk(join(ROOT, 'backend', 'src'));
  ok(walked.length > 100, `walked the backend (${walked.length} files)`);

  // The two files that may mention it at all: the one that stores it and the one
  // that hands it back. Everything else must not name it in code.
  const MAY = ['reviews/review.service.ts', 'reviews/review.response.ts',
    'reviews/review.controller.ts', 'reviews/dto/write-review.dto.ts'];
  // THE FIELD, NEVER THE ENGLISH WORD. The first writing of this matched
  // /\bstars\b/ and caught two files that have nothing to do with the column:
  // ocr/review-text.ts parses "5 out of 5 stars" off an Amazon review page, and
  // assistant/answer-drafts.ts contains the sentence "We never ask you for a
  // number of stars" — the rule itself, being told to a user. Neither reads the
  // stored value. So this matches a property access, a destructuring or a
  // declaration, which is how the stored value can actually be reached.
  const READS_THE_FIELD = /\.stars\b|\bstars\s*[,}]|\bstars\s*\??\s*:/;
  const reads = walked
    .filter((f) => READS_THE_FIELD.test(withoutComments(readFileSync(f, 'utf8'))))
    .map((f) => f.slice(join(ROOT, 'backend', 'src').length + 1));
  const stray = reads.filter((f) => MAY.indexOf(f) === -1);
  ok(stray.length === 0,
    `only the review module names stars in code; these also do: ${stray.join(', ')}`);

  // AND THE PLACES THAT DECIDE MONEY ARE NAMED AND CHECKED ONE BY ONE, so the
  // walk above cannot pass by the refund gate having been moved or renamed.
  for (const f of walked.filter((x) => /refund|engine|wallet|task\.service|payout/i.test(x))) {
    ok(!READS_THE_FIELD.test(withoutComments(readFileSync(f, 'utf8'))),
      `${f.slice(join(ROOT, 'backend', 'src').length + 1)} does not read stars`);
  }
}

console.log('\n=== 14. THE COPY BUTTON — character for character ===');
{
  const screen = withoutComments(read('src/review/WriteReviewScreen.js'));

  // IT COPIES THE BOX'S OWN STATE, not a derived or tidied one.
  ok(/const copy = useCallback\(\(\) => \{\s*setCopied\(copyToClipboard\(text\)\);\s*\}, \[text\]\);/
    .test(screen), 'the clipboard is handed `text` itself, and nothing else');
  ok(!/copyToClipboard\([^)]*\.(trim|replace|normalize)/.test(screen),
    'and it is not trimmed, replaced or normalised on the way');
  ok(!/text\.trim\(\)|text\.replace\(|text\.normalize\(/.test(screen),
    'nothing anywhere on this screen tidies the text');

  // THE EXISTING CLIPBOARD PATH, and the RIGHT one.
  ok(/import \{ copyToClipboard \} from '\.\.\/ui\/clipboard'/.test(screen),
    'it reuses ui/clipboard.js rather than reaching the clipboard a second way');
  ok(!/expo-clipboard|Clipboard\.setString|setStringAsync/.test(screen),
    'and touches no clipboard API of its own');
  // AND NOT openShop.js's copyProductName, which would collapse the whitespace:
  // right for a product name going into a search box, wrong for somebody's own
  // paragraph. That is a real difference, so it is checked rather than trusted.
  ok(!/copyProductName/.test(screen), 'it does not use the product-name copier');
  const shopApp = read('src/ui/shopApp.js');
  ok(/const tidy = productName\.replace\(\/\\s\+\/g, ' '\)\.trim\(\);/.test(shopApp),
    'because whatToCopy really does collapse whitespace — which is why it is wrong here');
  const clip = withoutComments(read('src/ui/clipboard.js'));
  ok(/Clipboard\.setString\(s\)/.test(clip) && /const s = text == null \? '' : String\(text\)/.test(clip),
    'and ui/clipboard.js really hands over the string unchanged');

  // COPY AND SAVE ARE INDEPENDENT: neither reads the other's state.
  const copyFn = screen.slice(screen.indexOf('const copy = useCallback'),
    screen.indexOf('}, [text]);') + 12);
  ok(!/saving|saved|putReview|taskId/.test(copyFn), 'copying needs no save and no network');
  const sendFn = screen.slice(screen.indexOf('const send = useCallback'),
    screen.indexOf('}, [taskId, text, stars]);'));
  ok(!/copied|copyToClipboard/.test(sendFn), 'and saving needs no copy');

  // NEITHER BUTTON IS DISABLED BY THE SCORE — AND SINCE 18 SEPTEMBER 2026 THERE
  // ARE THREE. Phase 7's one tap (copy AND open the order's own page) took the
  // green; the plain copy stays beneath it in the quiet colour. This line used
  // to pin the copy button's colour along with its lack of a `disabled`, which
  // was the wrong thing to pin: what matters is that no copy control is ever
  // disabled, whatever colour it is drawn in.
  ok(/<Pill onPress=\{copy\} color=\{COLOR\.[a-zA-Z]+\}>COPY MY REVIEW<\/Pill>/.test(screen),
    'the copy button is not disabled at all');
  ok(/<Pill onPress=\{copyAndOpenTheOrder\} color=\{COLOR\.[a-zA-Z]+\}>/.test(screen),
    'and neither is the one tap that copies and opens the order');
  ok(!/onPress=\{copy(AndOpenTheOrder)?\}[^>]*disabled/.test(screen),
    'no copy control carries a disabled prop of any kind');
  ok(!/disabled=\{[^}]*(score|band|scored|THIN)/.test(screen),
    'and no score, band or scored value reaches any disabled prop');

  // AND IT SAYS SO AFTERWARDS.
  ok(/on the clipboard/.test(screen) && /Paste it into/.test(screen),
    'a line says it is on the clipboard and to paste it into the shop');
  ok(/\{copied \?/.test(screen), 'and only after a copy that really happened');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
