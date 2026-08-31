import {
  COMMON_WORDS,
  bestMatches,
  meaningfulWords,
  scoreCandidate,
  sharedWordScore,
  tsQueryFor,
  type PhraseCandidate,
} from './matching';

const candidate = (
  phrase: string,
  nearness = 0,
  phraseLanguage = 'en',
  answerEntryId = 'a1',
): PhraseCandidate => ({ answerEntryId, phrase, phraseLanguage, nearness });

/**
 * HOW CLOSE IS THIS QUESTION TO THAT PHRASE?
 *
 * The database narrows thousands of stored phrasings down to a few dozen using its
 * own indexes. This file decides which of those few dozen is actually the one, and
 * it is pure so that judgement can be argued with in a test rather than guessed at
 * against a live database.
 *
 * Two things are combined: how many of the words that CARRY MEANING are shared, and
 * how close the letters are (which is what survives a typo). Neither alone is
 * enough — "when will my refund arrive" and "when will my order arrive" share four
 * words out of five and are different questions.
 */
describe('meaningfulWords', () => {
  it('drops the words every question contains', () => {
    expect(meaningfulWords('when will my refund arrive')).toEqual([
      'refund',
      'arrive',
    ]);
  });

  it('keeps everything when a question is nothing but common words', () => {
    // Otherwise there is nothing left to compare and every such question scores
    // zero against everything, which is worse than comparing the small words.
    expect(meaningfulWords('why is it not')).toEqual([
      'why',
      'is',
      'it',
      'not',
    ]);
  });

  it('ignores capitals, punctuation and repeats', () => {
    expect(meaningfulWords('REFUND!!! refund, Refund?')).toEqual(['refund']);
  });

  it('reads Hindi letters as whole words', () => {
    // Guards the letters-and-marks pattern: with letters alone, पैसा splits into
    // प and स. Both words here carry meaning, so neither is dropped as common.
    expect(meaningfulWords('रिव्यू पैसा')).toEqual(['रिव्यू', 'पैसा']);
  });

  it('drops the Hindi words every question contains', () => {
    expect(meaningfulWords('मेरा पैसा कब आएगा')).toEqual(['पैसा', 'आएगा']);
  });

  it('returns nothing for text with no words in it', () => {
    for (const junk of ['', '   ', '!!!', null, undefined, 7]) {
      expect(meaningfulWords(junk as unknown as string)).toEqual([]);
    }
  });
});

describe('sharedWordScore', () => {
  it('is 1 when the meaning words are the same', () => {
    expect(sharedWordScore('when will my refund arrive', 'refund arrive')).toBe(
      1,
    );
  });

  it('is 0 when nothing meaningful is shared', () => {
    expect(sharedWordScore('my refund is late', 'change my bank details')).toBe(
      0,
    );
  });

  it('separates two questions that differ by one meaning word', () => {
    const refund = sharedWordScore(
      'when will my refund arrive',
      'when will my refund arrive',
    );
    const order = sharedWordScore(
      'when will my refund arrive',
      'when will my order arrive',
    );
    expect(refund).toBe(1);
    // The common words are ignored, so this is one word shared out of two each.
    expect(order).toBeCloseTo(0.5, 5);
    expect(order).toBeLessThan(refund);
  });

  it('does not reward a phrase for being long', () => {
    const tight = sharedWordScore('refund late', 'refund late');
    const padded = sharedWordScore(
      'refund late',
      'refund late order review delivery tickets account withdrawal',
    );
    expect(tight).toBeGreaterThan(padded);
  });

  it('carries a whole-sentence near miss when no word is shared', () => {
    // "my refnud has not arived" shares no meaning word with anything, and the
    // engine used to say it did not know. The letters alone have to be enough.
    const typo = scoreCandidate(
      'my refnud has not arived',
      candidate('my refund has not arrived', 0.8),
      'en',
    );
    expect(typo).toBeGreaterThan(55);
  });

  it('never leaves the 0 to 1 range', () => {
    const pairs: [string, string][] = [
      ['', ''],
      ['refund', ''],
      ['', 'refund'],
      ['refund refund refund', 'refund'],
      ['!!!', '???'],
    ];
    for (const [a, b] of pairs) {
      const s = sharedWordScore(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(Number.isNaN(s)).toBe(false);
    }
  });
});

describe('scoreCandidate', () => {
  it('scores an exact wording at or near the top', () => {
    const score = scoreCandidate(
      'when will my refund arrive',
      candidate('when will my refund arrive', 1),
      'en',
    );
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('still scores a typo well, on the letters alone', () => {
    // No meaning word is shared: "refnud" is not "refund". The near-miss number
    // from the database is the whole reason this is not a zero.
    const score = scoreCandidate(
      'refnud not recieved',
      candidate('refund not received', 0.8),
      'en',
    );
    expect(score).toBeGreaterThan(25);
  });

  it('scores an unrelated phrase low', () => {
    const score = scoreCandidate(
      'how do I change my bank account',
      candidate('when will my refund arrive', 0.05),
      'en',
    );
    expect(score).toBeLessThan(20);
  });

  it('prefers a phrase written in the language the person used', () => {
    const same = scoreCandidate(
      'mera refund kab aayega',
      candidate('mera refund kab aayega', 1, 'hi-en'),
      'hi-en',
    );
    const other = scoreCandidate(
      'mera refund kab aayega',
      candidate('mera refund kab aayega', 1, 'en'),
      'hi-en',
    );
    expect(same).toBeGreaterThan(other);
  });

  it('lets a strong match in another language beat a weak one in the right language', () => {
    const strongOther = scoreCandidate(
      'when will my refund arrive',
      candidate('when will my refund arrive', 1, 'en'),
      'hi-en',
    );
    const weakSame = scoreCandidate(
      'when will my refund arrive',
      candidate('how do I add a bank account', 0.05, 'hi-en'),
      'hi-en',
    );
    expect(strongOther).toBeGreaterThan(weakSame);
  });

  it('matches a Hindi question to a Hindi phrase', () => {
    // Guards the word pattern: Hindi vowel signs are marks, not letters, so a
    // pattern of letters alone splits मेरा into म and र and no Hindi question ever
    // matches anything again.
    const score = scoreCandidate(
      'मेरा पैसा कब आएगा',
      candidate('मेरा पैसा कब आएगा', 1, 'hi'),
      'hi',
    );
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('always returns a whole number from 0 to 100', () => {
    const cases: PhraseCandidate[] = [
      candidate('', 0),
      candidate('refund', 1),
      candidate('refund', -5),
      candidate('refund', 99),
      candidate('a b c d e f g', 0.5),
    ];
    for (const c of cases) {
      const s = scoreCandidate('my refund is late', c, 'en');
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it('reads the same pair the same way every time', () => {
    const c = candidate('when will my refund arrive', 0.7);
    expect(scoreCandidate('refund late', c, 'en')).toBe(
      scoreCandidate('refund late', c, 'en'),
    );
  });
});

describe('bestMatches', () => {
  const candidates = [
    candidate('how do I change my bank account', 0.1, 'en', 'bank'),
    candidate('when will my refund arrive', 0.9, 'en', 'refund'),
    candidate('my review is not showing', 0.2, 'en', 'review'),
  ];

  it('puts the closest phrase first', () => {
    const [top] = bestMatches(
      'when will my refund arrive',
      candidates,
      'en',
      3,
    );
    expect(top.answerEntryId).toBe('refund');
  });

  it('never returns more than asked for', () => {
    expect(bestMatches('refund', candidates, 'en', 2)).toHaveLength(2);
    expect(bestMatches('refund', candidates, 'en', 0)).toEqual([]);
  });

  it('keeps only the best phrase for each answer', () => {
    // One answer with forty stored wordings must not fill the whole list.
    const many = [
      candidate('refund not arrived', 0.9, 'en', 'refund'),
      candidate('where is my refund', 0.8, 'en', 'refund'),
      candidate('refund kab aayega', 0.7, 'hi-en', 'refund'),
      candidate('my review is not showing', 0.2, 'en', 'review'),
    ];
    const out = bestMatches('refund not arrived', many, 'en', 10);
    expect(out.map((m) => m.answerEntryId)).toEqual(['refund', 'review']);
  });

  it('says in plain words why each one matched', () => {
    const out = bestMatches('refnud not arrived', candidates, 'en', 3);
    for (const m of out) {
      expect(['the same words', 'a near miss', 'both']).toContain(m.how);
      expect(m.how).not.toMatch(/trigram|tsvector|GIN|--/i);
    }
  });

  it('handles an empty candidate list and junk input', () => {
    expect(bestMatches('refund', [], 'en', 5)).toEqual([]);
    expect(
      bestMatches(null as unknown as string, candidates, 'en', 5).length,
    ).toBeLessThanOrEqual(3);
  });

  it('sorts stably so the same call gives the same order', () => {
    const a = bestMatches('refund', candidates, 'en', 3);
    const b = bestMatches('refund', candidates, 'en', 3);
    expect(a.map((m) => m.answerEntryId)).toEqual(
      b.map((m) => m.answerEntryId),
    );
  });
});

describe('the common-word list', () => {
  it('holds only lowercase words', () => {
    for (const w of COMMON_WORDS) {
      expect(w).toBe(w.toLowerCase());
      expect(w.length).toBeGreaterThan(0);
    }
  });

  it('does not throw away the words Fayr questions are actually about', () => {
    for (const w of [
      'refund',
      'review',
      'order',
      'ticket',
      'money',
      'paisa',
      'withdrawal',
      'delivery',
    ]) {
      expect(COMMON_WORDS.has(w)).toBe(false);
    }
  });
});

describe('tsQueryFor', () => {
  it('asks the database for any of the meaning words, not all of them', () => {
    // All of them would be wrong: a person who types "hi when will my refund
    // arrive please" would match nothing, because no stored phrase contains "hi"
    // and "please" as well.
    expect(tsQueryFor('when will my refund arrive')).toBe('refund | arrive');
  });

  it('keeps Hindi words whole, and drops the Hindi ones every question contains', () => {
    // "मेरा" and "कब" are as common in a Hindi question as "my" and "when" are in
    // an English one, so searching for them finds everything and means nothing.
    expect(tsQueryFor('मेरा पैसा कब आएगा')).toBe('पैसा | आएगा');
  });

  it('says there is nothing to search for rather than sending an empty query', () => {
    for (const junk of ['', '   ', '!!!', '123', null, undefined]) {
      expect(tsQueryFor(junk as unknown as string)).toBeNull();
    }
  });

  it('stops at a sensible number of words', () => {
    // Distinct words, letters only: digits are not part of a word, so "word1"
    // and "word2" are both just "word" and would collapse to one.
    const long = Array.from({ length: 60 }, (_, i) => 'q'.repeat(i + 1)).join(
      ' ',
    );
    const built = tsQueryFor(long, 5);
    expect(built!.split(' | ')).toHaveLength(5);
  });

  it('leaves numbers out, so an order number never reaches the search', () => {
    // Numbers are not part of a word here. Stored phrasings never contain an
    // order number anyway, so nothing is lost and nothing personal travels.
    expect(tsQueryFor('order 406-8871234 not received')).toBe(
      'order | received',
    );
  });

  it('can never contain anything that would change what the query means', () => {
    // This string goes into a database search query. Anything other than letters
    // and the marks that attach to them would be able to alter its meaning.
    const nasty = "refund' | !review & (order) <-> 'x:*";
    const built = tsQueryFor(nasty);
    expect(built).toMatch(/^[\p{L}\p{M}]+( \| [\p{L}\p{M}]+)*$/u);
  });
});
