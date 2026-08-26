import {
  durationInWords,
  toAnswerSummary,
  toQuestionDetail,
  toQuestionSummary,
  toStatsResponse,
} from './assistant.response';
import type { ResolutionStats } from './assistant.types';

const ASKED = new Date('2026-08-27T06:00:00.000Z');

const question = (over: Record<string, unknown> = {}) =>
  ({
    id: 'q1',
    userId: 'u1',
    rawText: '  mera refund kab aayega  ',
    detectedLanguage: 'hi-en',
    languageConfidence: 88,
    askedAt: ASKED,
    answerEntryId: 'a1',
    answerText: 'Jab aapka review live ho jaye.',
    answerOrigin: 'ANSWER_BOOK',
    matchScore: 91,
    answerRevision: 2,
    status: 'ANSWERED',
    helpful: null,
    helpfulAt: null,
    resolvedAt: null,
    resolvedByStaffId: null,
    journey: { nowDoing: ['Waiting out the return window.'] },
    answerEntry: {
      id: 'a1',
      key: 'refund-timing',
      language: 'hi-en',
      title: 'Paisa kab wapas aayega',
      revision: 2,
      status: 'PUBLISHED',
    },
    ...over,
  }) as never;

const user = { id: 'u1', displayId: 'FAYR-100004', mobile: '+919000000001' };

const answer = (over: Record<string, unknown> = {}) =>
  ({
    id: 'a1',
    key: 'refund-timing',
    language: 'hi-en',
    title: 'Paisa kab wapas aayega',
    body: 'Jab aapka review live ho jaye aur return window band ho jaye.',
    topic: 'refund',
    status: 'PUBLISHED',
    origin: 'SEED',
    revision: 2,
    updatedByStaffId: null,
    createdAt: ASKED,
    updatedAt: ASKED,
    _count: { phrases: 4 },
    ...over,
  }) as never;

/**
 * WHAT THE STAFF SCREENS ARE HANDED.
 *
 * Two rules run through all of it. Every date and every number crosses the wire as
 * text a person can read, the way the rest of the backend does it. And the queue
 * shows LESS about a person than the single question does — scanning a list is not
 * the same act as opening one, and only the second is recorded in the audit trail.
 */
describe('toQuestionSummary', () => {
  it('keeps the words exactly as typed, spaces and all', () => {
    const out = toQuestionSummary(question(), user);
    expect(out.rawText).toBe('  mera refund kab aayega  ');
  });

  it('names the language in words as well as its short tag', () => {
    const out = toQuestionSummary(question(), user);
    expect(out.language.tag).toBe('hi-en');
    expect(out.language.name).toBe('Hindi written in English letters');
    expect(out.language.confidence).toBe(88);
  });

  it('shows which answer was given and how well it matched', () => {
    const out = toQuestionSummary(question(), user);
    expect(out.answer!.origin).toBe('ANSWER_BOOK');
    expect(out.answer!.score).toBe(91);
    expect(out.answer!.entry!.key).toBe('refund-timing');
  });

  it('says plainly that no answer was given, rather than showing an empty one', () => {
    const out = toQuestionSummary(
      question({
        answerEntryId: null,
        answerText: null,
        answerOrigin: 'NONE',
        matchScore: null,
        answerRevision: null,
        answerEntry: null,
        status: 'UNRESOLVED',
      }),
      user,
    );
    expect(out.answer).toBeNull();
  });

  it('works out how long it took, and says nothing when it is not resolved yet', () => {
    const open = toQuestionSummary(question(), user);
    expect(open.secondsToResolve).toBeNull();

    const closed = toQuestionSummary(
      question({
        status: 'RESOLVED',
        resolvedAt: new Date(ASKED.getTime() + 20 * 60_000),
      }),
      user,
    );
    expect(closed.secondsToResolve).toBe(1_200);
    expect(closed.timeToResolve).toBe('20 minutes');
  });

  it('shows who asked by their Fayr number and NOT by their phone number', () => {
    const out = toQuestionSummary(question(), user);
    expect(out.user.displayId).toBe('FAYR-100004');
    expect(JSON.stringify(out)).not.toContain(user.mobile);
  });

  it('leaves what they were doing out of the queue entirely', () => {
    // The queue is a list to scan. The whole record of somebody's movements
    // belongs behind the one deliberate act that gets written to the audit trail.
    const out = toQuestionSummary(question(), user);
    expect(JSON.stringify(out)).not.toContain('nowDoing');
  });

  it('sends every date as text', () => {
    const out = toQuestionSummary(question(), user);
    expect(out.askedAt).toBe(ASKED.toISOString());
    expect(typeof out.askedAt).toBe('string');
  });
});

describe('toQuestionDetail', () => {
  it('adds what they were doing, and the number to call them back on', () => {
    const out = toQuestionDetail(question(), user);
    expect(out.journey).toEqual({
      nowDoing: ['Waiting out the return window.'],
    });
    expect(out.user.mobile).toBe(user.mobile);
  });

  it('says so when the context could not be captured', () => {
    const out = toQuestionDetail(question({ journey: null }), user);
    expect(out.journey).toBeNull();
    expect(out.journeyNote).toMatch(/could not be read|not captured/i);
  });

  it('adds no note when the context is there', () => {
    expect(toQuestionDetail(question(), user).journeyNote).toBeNull();
  });
});

describe('toAnswerSummary', () => {
  it('shows the answer, its language in words, and how many wordings lead to it', () => {
    const out = toAnswerSummary(answer());
    expect(out.key).toBe('refund-timing');
    expect(out.languageName).toBe('Hindi written in English letters');
    expect(out.waysOfAsking).toBe(4);
    expect(out.revision).toBe(2);
  });

  it('counts no wordings as none rather than as missing', () => {
    const out = toAnswerSummary(answer({ _count: { phrases: 0 } }));
    expect(out.waysOfAsking).toBe(0);
  });
});

describe('durationInWords', () => {
  it('says nothing when there is nothing to say', () => {
    expect(durationInWords(null)).toBeNull();
  });

  it('uses whole words, never short forms', () => {
    expect(durationInWords(1)).toBe('1 second');
    expect(durationInWords(45)).toBe('45 seconds');
    expect(durationInWords(60)).toBe('1 minute');
    expect(durationInWords(1_200)).toBe('20 minutes');
    expect(durationInWords(3_600)).toBe('1 hour');
    // Two and a half hours. Rounded up on purpose: this number is about how long
    // Fayr took, and it should never round in the direction that flatters us.
    expect(durationInWords(9_000)).toBe('3 hours');
    // And the step up happens on the rounded number, so this is not "60 minutes".
    expect(durationInWords(3_599)).toBe('1 hour');
    expect(durationInWords(86_399)).toBe('1 day');
    expect(durationInWords(86_400)).toBe('1 day');
    expect(durationInWords(200_000)).toBe('2 days');
  });

  it('says under a second rather than zero', () => {
    expect(durationInWords(0)).toBe('less than a second');
  });

  it('never uses an abbreviation, a symbol or a double dash', () => {
    for (const s of [0, 1, 59, 60, 3599, 3600, 86_399, 86_400, 999_999]) {
      const words = durationInWords(s)!;
      expect(words).not.toMatch(/\bsec\b|\bmin\b|\bhr\b|\bhrs\b|--|[0-9]s\b/);
    }
  });
});

describe('toStatsResponse', () => {
  const stats: ResolutionStats = {
    windowDays: 30,
    asked: 40,
    answered: 12,
    unresolved: 8,
    resolved: 20,
    saidItHelped: 18,
    saidItDidNotHelp: 2,
    didNotSay: 20,
    resolution: {
      counted: 20,
      fastestSeconds: 30,
      typicalSeconds: 1_200,
      slowestSeconds: 86_400,
      nineOutOfTenWithinSeconds: 7_200,
    },
  };

  it('puts a readable version of every duration beside the number', () => {
    const out = toStatsResponse(stats);
    expect(out.resolution.typical).toEqual({
      seconds: 1_200,
      inWords: '20 minutes',
    });
    expect(out.resolution.fastest.inWords).toBe('30 seconds');
    expect(out.resolution.slowest.inWords).toBe('1 day');
    expect(out.resolution.nineOutOfTenWithin.inWords).toBe('2 hours');
  });

  it('says nothing rather than zero when nothing has been resolved', () => {
    const out = toStatsResponse({
      ...stats,
      resolved: 0,
      resolution: {
        counted: 0,
        fastestSeconds: null,
        typicalSeconds: null,
        slowestSeconds: null,
        nineOutOfTenWithinSeconds: null,
      },
    });
    expect(out.resolution.typical).toEqual({ seconds: null, inWords: null });
  });

  it('carries the counts through untouched', () => {
    const out = toStatsResponse(stats);
    expect(out.asked).toBe(40);
    expect(out.unresolved).toBe(8);
    expect(out.saidItHelped).toBe(18);
  });

  it('has no undefined and no not-a-number anywhere in it', () => {
    const written = JSON.stringify(toStatsResponse(stats));
    expect(written).not.toContain('undefined');
    expect(written).not.toContain('NaN');
  });
});
