import {
  EXAMPLES_PER_GROUP,
  keyFromQuestion,
  signatureOf,
  whatToWriteNext,
  type AskedQuestion,
} from './what-to-write-next';

let n = 0;
const asked = (rawText: string, over: Partial<AskedQuestion> = {}): AskedQuestion => ({
  id: `q${(n += 1)}`,
  rawText,
  detectedLanguage: 'en',
  askedAt: new Date(Date.UTC(2026, 7, 31, 10, n)),
  ...over,
});

describe('what two questions have to share to be the same one', () => {
  it('ignores word order and the words that carry no meaning', () => {
    expect(signatureOf('where is my refund')).toBe(signatureOf('my refund, where is it'));
    expect(signatureOf('WHERE IS MY REFUND')).toBe(signatureOf('where is my refund'));
  });

  it('does not group two questions that are actually different', () => {
    // The failure that would matter: lumping two things together sends somebody
    // off to write the wrong answer.
    expect(signatureOf('where is my refund')).not.toBe(signatureOf('refund not arrived'));
    expect(signatureOf('what are tickets')).not.toBe(signatureOf('where is my refund'));
  });

  it('does not make a new group out of saying a word twice', () => {
    expect(signatureOf('refund refund refund')).toBe(signatureOf('refund'));
  });

  it('produces nothing at all for words with no meaning in them', () => {
    for (const empty of ['', '   ', '???', '...']) {
      expect(signatureOf(empty)).toBe('');
    }
  });

  it('survives nonsense', () => {
    for (const bad of [null, undefined, 42, {}]) {
      expect(typeof signatureOf(bad as never)).toBe('string');
    }
  });
});

describe('what the team should write next', () => {
  it('puts the most asked first', () => {
    const out = whatToWriteNext([
      asked('do you deliver to Kathmandu'),
      asked('where is my refund'),
      asked('my refund where is it'),
      asked('where is my refund'),
    ]);
    expect(out[0].asked).toBe(3);
    expect(out[0].examples[0].toLowerCase()).toContain('refund');
    expect(out[1].asked).toBe(1);
  });

  it('breaks a tie on which was asked most recently', () => {
    // Between two things asked twice each, the live one is worth writing today.
    const out = whatToWriteNext([
      asked('older question here', { askedAt: new Date(Date.UTC(2026, 0, 1)) }),
      asked('older question here', { askedAt: new Date(Date.UTC(2026, 0, 2)) }),
      asked('newer question there', { askedAt: new Date(Date.UTC(2026, 7, 1)) }),
      asked('newer question there', { askedAt: new Date(Date.UTC(2026, 7, 2)) }),
    ]);
    expect(out[0].examples[0]).toContain('newer');
  });

  it('carries the real sentences, so a person can see what was grouped', () => {
    const out = whatToWriteNext([
      asked('where is my refund'),
      asked('my refund, where is it?'),
    ]);
    expect(out[0].asked).toBe(2);
    expect(out[0].examples.length).toBe(2);
    expect(out[0].examples.some((e) => e.includes('?'))).toBe(true);
  });

  it('keeps a handful of examples, not a wall of them', () => {
    const many = Array.from({ length: 20 }, () => asked('where is my refund'));
    const out = whatToWriteNext(many);
    expect(out[0].asked).toBe(20);
    expect(out[0].examples.length).toBe(EXAMPLES_PER_GROUP);
  });

  it('shows the languages it was asked in, so a translation gap reads as one', () => {
    const out = whatToWriteNext([
      asked('refund', { detectedLanguage: 'en' }),
      asked('refund', { detectedLanguage: 'hi-en' }),
    ]);
    expect(out[0].languages).toEqual(['en', 'hi-en']);
  });

  it('shows what kinds anybody filed it under', () => {
    const out = whatToWriteNext([
      asked('refund', { topic: 'refund' }),
      asked('refund', { topic: null }),
      asked('refund', { topic: 'withdrawal' }),
    ]);
    expect(out[0].topics).toEqual(['refund', 'withdrawal']);
  });

  it('names the words a group is keyed on, so the rule is visible', () => {
    const out = whatToWriteNext([asked('where is my refund')]);
    expect(out[0].signature).toBe(signatureOf('where is my refund'));
    expect(out[0].signature.length).toBeGreaterThan(0);
  });

  it('leaves out anything with no meaning in it', () => {
    // Not a question to send somebody off to write an answer for.
    const out = whatToWriteNext([asked('???'), asked('   '), asked('where is my refund')]);
    expect(out.length).toBe(1);
  });

  it('groups two questions that differ only by a number', () => {
    // Not a bug: a signature is built from LETTERS, so an order number in a
    // question does not split it off into a group of one. "where is order 12345"
    // and "where is order 67890" are one thing to write an answer for, which is
    // exactly right, and finding this out cost a wrong test fixture first.
    const out = whatToWriteNext([
      asked('where is order 12345'),
      asked('where is order 67890'),
    ]);
    expect(out.length).toBe(1);
    expect(out[0].asked).toBe(2);
  });

  it('never returns more than it was asked for', () => {
    // Distinct WORDS, not distinct numbers — see the test above.
    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
    const many = letters.flatMap((a) =>
      letters.slice(0, 2).map((b) => asked(`refund problem ${a}${b}${a}`)));
    expect(new Set(many.map((q) => signatureOf(q.rawText))).size).toBe(52);
    expect(whatToWriteNext(many, 5).length).toBe(5);
    expect(whatToWriteNext(many, 20).length).toBe(20);
  });

  it('copes with thousands without falling over', () => {
    const rows: AskedQuestion[] = [];
    const word = (i: number): string => {
      let out = '';
      let left = i;
      do { out += 'abcdefghijklmnopqrstuvwxyz'[left % 26]; left = Math.floor(left / 26); }
      while (left > 0);
      return out;
    };
    for (let i = 0; i < 5000; i += 1) {
      rows.push(asked(i % 2 === 0 ? 'where is my refund' : `problem with ${word(i)}`));
    }
    const started = process.hrtime.bigint();
    const out = whatToWriteNext(rows, 20);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(out[0].asked).toBe(2500);
    expect(out.length).toBe(20);
    expect(ms).toBeLessThan(1500);
  });

  it('survives rows in shapes we did not expect', () => {
    const out = whatToWriteNext([
      null as never,
      { id: 'x' } as never,
      { id: 'y', rawText: 42 } as never,
      asked('where is my refund', { askedAt: 'not a date' as never }),
    ]);
    expect(out.length).toBe(1);
    expect(JSON.stringify(out)).not.toContain('undefined');
  });

  it('and an empty pile is an empty list, not a crash', () => {
    expect(whatToWriteNext([])).toEqual([]);
    expect(whatToWriteNext(null as never)).toEqual([]);
  });
});

describe('naming a new answer from what somebody asked', () => {
  it('makes a name a person can read', () => {
    expect(keyFromQuestion('where is my refund')).toBe('refund');
    expect(keyFromQuestion('do you deliver to Kathmandu')).toMatch(/^[a-z0-9-]+$/);
  });

  it('only ever uses letters, numbers and dashes', () => {
    for (const text of [
      'WHERE IS MY REFUND?!',
      'टिकट क्या है',
      'my refund — where??',
      'a/b\\c:d',
    ]) {
      expect(keyFromQuestion(text)).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('never comes back empty', () => {
    for (const nothing of ['', '   ', '???', 'टिकट क्या है', null, undefined, 42]) {
      const key = keyFromQuestion(nothing as never);
      expect(key.length).toBeGreaterThan(0);
      expect(key).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('stays short enough to read in a list', () => {
    const long = 'why has my refund for the cotton kurta set not arrived yet '
      + 'after the return window closed last week on amazon';
    expect(keyFromQuestion(long).length).toBeLessThanOrEqual(60);
    expect(keyFromQuestion(long)).not.toMatch(/-$/);
  });
});
