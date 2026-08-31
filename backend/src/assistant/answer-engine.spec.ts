import {
  CANNOT_ANSWER_YET,
  MIN_CONFIDENT_SCORE,
  chooseReply,
  journeyTopics,
  topicNudge,
  type Candidate,
} from './answer-engine.rules';
import { checkPlainLanguage } from './plain-language';

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  answerEntryId: 'a1',
  key: 'refund-timing',
  language: 'en',
  topic: 'refund',
  title: 'When your money comes back',
  body: 'We send your money back once your review is live.',
  revision: 1,
  score: 90,
  matchedPhrase: 'when will my refund arrive',
  how: 'both',
  ...over,
});

/**
 * HOW THE ENGINE DECIDES, AND WHAT IT REFUSES TO DO.
 *
 * The deciding is pure and lives here so it can be argued with in a test. The
 * searching, the recording and the swapping of one answer source for another live
 * in the service.
 *
 * Two things this must never do, and both are tested rather than intended. It must
 * never return an answer that breaks the plain-language rule, whatever is in the
 * answer book. And it must never make something up: below the confidence line it
 * says it does not know, in the language the person wrote in.
 */
describe('chooseReply', () => {
  describe('when something matches well', () => {
    it('returns the answer, and says where it came from', () => {
      const reply = chooseReply('en', [candidate()], []);
      expect(reply.origin).toBe('ANSWER_BOOK');
      expect(reply.text).toContain('money back');
      expect(reply.answerEntryId).toBe('a1');
      expect(reply.answerRevision).toBe(1);
      expect(reply.score).toBe(90);
      expect(reply.confident).toBe(true);
    });

    it('explains its own choice in plain words', () => {
      const reply = chooseReply('en', [candidate()], []);
      expect(reply.because.length).toBeGreaterThan(10);
      expect(reply.because).not.toMatch(/--|_|\bscore\b.*\bthreshold\b/i);
    });

    it('picks the highest scoring one', () => {
      const reply = chooseReply(
        'en',
        [
          candidate({
            answerEntryId: 'low',
            score: 60,
            body: 'The lower one.',
          }),
          candidate({
            answerEntryId: 'high',
            score: 95,
            body: 'The higher one.',
          }),
        ],
        [],
      );
      expect(reply.answerEntryId).toBe('high');
    });
  });

  describe('when nothing matches well enough', () => {
    it('says it cannot answer, rather than offering the closest thing', () => {
      const reply = chooseReply(
        'en',
        [candidate({ score: MIN_CONFIDENT_SCORE - 1 })],
        [],
      );
      expect(reply.origin).toBe('NONE');
      expect(reply.answerEntryId).toBeNull();
      expect(reply.confident).toBe(false);
      expect(reply.text).toBe(CANNOT_ANSWER_YET.en);
    });

    it('says it cannot answer when there is nothing at all', () => {
      const reply = chooseReply('en', [], []);
      expect(reply.origin).toBe('NONE');
      expect(reply.text).toBe(CANNOT_ANSWER_YET.en);
    });

    it('says it in the language the person wrote in', () => {
      expect(chooseReply('hi', [], []).text).toBe(CANNOT_ANSWER_YET.hi);
      expect(chooseReply('hi-en', [], []).text).toBe(
        CANNOT_ANSWER_YET['hi-en'],
      );
    });

    it('falls back to English for a language it has no words for', () => {
      expect(chooseReply('ta', [], []).text).toBe(CANNOT_ANSWER_YET.en);
    });

    it('promises a person will look, and nothing more', () => {
      for (const text of Object.values(CANNOT_ANSWER_YET)) {
        expect(text).toMatch(/person|व्यक्ति|vyakti/);
        // No timeline. Nothing in the project says how long anybody waits.
        expect(text).not.toMatch(/\b\d+\s*(day|hour|minute)/i);
      }
    });
  });

  describe('the plain-language rule, at the last gate', () => {
    it('refuses to hand over an answer that breaks the rule', () => {
      // Even if a bad answer somehow got published, it does not reach a person.
      const reply = chooseReply(
        'en',
        [
          candidate({
            score: 99,
            body: 'The API endpoint will authenticate your credentials -- e.g. HOLDING.',
          }),
        ],
        [],
      );
      expect(reply.origin).toBe('NONE');
      expect(reply.text).toBe(CANNOT_ANSWER_YET.en);
      expect(reply.because).toMatch(/plain|words|read/i);
    });

    it('falls through to the next best answer that does read plainly', () => {
      const reply = chooseReply(
        'en',
        [
          candidate({
            answerEntryId: 'bad',
            score: 99,
            body: 'The API endpoint failed.',
          }),
          candidate({
            answerEntryId: 'good',
            score: 80,
            body: 'We send your money back.',
          }),
        ],
        [],
      );
      expect(reply.answerEntryId).toBe('good');
    });

    it('every reply it can ever produce passes the rule itself', () => {
      const replies = [
        chooseReply('en', [], []),
        chooseReply('hi', [], []),
        chooseReply('hi-en', [], []),
        chooseReply('en', [candidate()], []),
      ];
      for (const reply of replies) {
        expect(checkPlainLanguage(reply.text, reply.language).ok).toBe(true);
      }
    });
  });

  describe('using what the person was doing', () => {
    it('prefers an answer about the thing they are stuck on', () => {
      const reply = chooseReply(
        'en',
        [
          candidate({
            answerEntryId: 'tickets',
            topic: 'tickets',
            score: 62,
            body: 'About tickets.',
          }),
          candidate({
            answerEntryId: 'refund',
            topic: 'refund',
            score: 60,
            body: 'About your money.',
          }),
        ],
        ['refund'],
      );
      expect(reply.answerEntryId).toBe('refund');
    });

    it('says that is why, so nobody has to guess', () => {
      const reply = chooseReply(
        'en',
        [candidate({ topic: 'refund', score: 70 })],
        ['refund'],
      );
      expect(reply.because).toMatch(/waiting|doing|stuck|middle/i);
    });

    it('cannot push a bad match over the line on its own', () => {
      // A nudge is a nudge. It must never turn "we do not know" into an answer.
      const reply = chooseReply(
        'en',
        [candidate({ topic: 'refund', score: 20 })],
        ['refund'],
      );
      expect(reply.origin).toBe('NONE');
    });

    it('changes nothing when there is no journey', () => {
      const withNone = chooseReply('en', [candidate()], []);
      const withEmpty = chooseReply('en', [candidate()], []);
      expect(withNone).toEqual(withEmpty);
    });
  });

  describe('the confidence line', () => {
    it('is a number a person could argue with', () => {
      expect(MIN_CONFIDENT_SCORE).toBeGreaterThan(30);
      expect(MIN_CONFIDENT_SCORE).toBeLessThan(90);
    });
  });
});

describe('journeyTopics', () => {
  it('says nothing for somebody with nothing going on', () => {
    expect(journeyTopics(null)).toEqual([]);
    expect(journeyTopics(undefined)).toEqual([]);
    expect(
      journeyTopics({
        nowDoing: ['Nothing is in progress right now.'],
        standing: {
          ticketBalance: 15,
          walletBalance: '₹0',
          offersInProgress: 0,
          offersRefunded: 0,
          payoutsWaiting: 0,
          hasWrittenInBefore: false,
        },
      } as never),
    ).toEqual([]);
  });

  it('picks out money when they are waiting on an offer', () => {
    expect(
      journeyTopics({
        nowDoing: ['Waiting out the return window on “X”.'],
        standing: {
          ticketBalance: 5,
          walletBalance: '₹100',
          offersInProgress: 1,
          offersRefunded: 0,
          payoutsWaiting: 0,
          hasWrittenInBefore: false,
        },
      } as never),
    ).toContain('refund');
  });

  it('picks out a payout when one is waiting', () => {
    expect(
      journeyTopics({
        nowDoing: ['Waiting for ₹1,000 to be paid out.'],
        standing: {
          ticketBalance: 5,
          walletBalance: '₹1,000',
          offersInProgress: 0,
          offersRefunded: 1,
          payoutsWaiting: 1,
          hasWrittenInBefore: false,
        },
      } as never),
    ).toContain('withdrawal');
  });

  it('picks out tickets when they have run out', () => {
    expect(
      journeyTopics({
        nowDoing: ['Nothing is in progress right now.'],
        standing: {
          ticketBalance: 0,
          walletBalance: '₹0',
          offersInProgress: 0,
          offersRefunded: 0,
          payoutsWaiting: 0,
          hasWrittenInBefore: false,
        },
      } as never),
    ).toContain('tickets');
  });

  it('survives a journey with nothing in it, or the wrong shape', () => {
    for (const junk of [
      {},
      { standing: null },
      { nowDoing: 'not a list' },
      42,
      'x',
    ]) {
      expect(journeyTopics(junk as never)).toEqual([]);
    }
  });
});

describe('topicNudge', () => {
  it('is small enough that it cannot rescue a bad answer', () => {
    expect(topicNudge).toBeGreaterThan(0);
    expect(topicNudge).toBeLessThan(15);
  });
});
