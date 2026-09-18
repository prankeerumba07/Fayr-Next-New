import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAIR, THIN, theFayrScore } from './fayr-score';

/**
 * THE SERVER'S COPY OF THE FAYR SCORE, HELD TO THE APP'S.
 *
 * There are two implementations on purpose: src/review/theFayrScore.js answers
 * as somebody types, and this one scores what the server stores. Two copies of
 * one rule drift, so src/review/score-fixtures.json holds one table of reviews
 * and expected answers that BOTH sides run over — the app in
 * theFayrScore.test.mjs, this one here.
 *
 * WHAT THE TABLE DOES NOT PROVE, and it says so itself: it is a
 * cross-implementation agreement check, not a specification of what a good score
 * is. The rules — sentiment-blindness above all — are asserted properly on the
 * app side, against reasoning rather than against recorded output. The two
 * checks below the table are the ones that would still matter if the table
 * vanished.
 */
const FIXTURES = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'src', 'review', 'score-fixtures.json'),
    'utf8',
  ),
) as {
  reviews: {
    text: string;
    score: number;
    band: string;
    words: number;
    kinds: string[];
    stock: number;
  }[];
};

describe('the Fayr score, server side', () => {
  it('has a real table to be held to', () => {
    expect(FIXTURES.reviews.length).toBeGreaterThanOrEqual(15);
  });

  it.each(FIXTURES.reviews.map((r) => [r.text.slice(0, 48) || '(empty)', r]))(
    'agrees with the app copy on %s',
    (_label, row) => {
      const out = theFayrScore(row.text);
      expect(out.score).toBe(row.score);
      expect(out.band).toBe(row.band);
      expect(out.words).toBe(row.words);
      expect(out.stock).toBe(row.stock);
      expect(out.kinds).toEqual(row.kinds);
    },
  );

  /**
   * THE RULE THIS MODULE EXISTS FOR, asserted here too rather than only on the
   * app side. If the server's copy ever starts measuring how somebody felt, a
   * table of recorded numbers would not necessarily notice — every row in it
   * could move together and still agree with a drifted app copy.
   */
  it('scores a review the same in praise and in complaint', () => {
    const pairs: [string, string][] = [
      [
        'The texture is thick and it lasted about a week before the strap loosened. I loved it.',
        'The texture is thick and it lasted about a week before the strap loosened. I hated it.',
      ],
      [
        'Very good. The gel is thin and it dried in two minutes.',
        'Very bad. The gel is thin and it dried in two minutes.',
      ],
      [
        'Foams much less than the one I used before — an excellent change.',
        'Foams much less than the one I used before — a terrible change.',
      ],
    ];
    for (const [praise, complaint] of pairs) {
      expect(theFayrScore(praise).score).toBe(theFayrScore(complaint).score);
      expect(theFayrScore(praise).band).toBe(theFayrScore(complaint).band);
    }
  });

  it('ranks a descriptive one-star above an empty five-star', () => {
    // The owner's own rule, in his own example's shape.
    const oneStar = theFayrScore('separated after a week and left an oily film');
    const fiveStar = theFayrScore('amazing product loved it');
    expect(oneStar.score).toBeGreaterThan(fiveStar.score);
    expect(fiveStar.band).toBe(THIN);
    expect(oneStar.band).toBe(FAIR);
  });

  it('answers for anything at all rather than throwing', () => {
    for (const nothing of [null, undefined, 7, {}, []]) {
      expect(theFayrScore(nothing).score).toBe(0);
    }
  });
});
