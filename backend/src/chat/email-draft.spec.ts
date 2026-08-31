import { LANGUAGES } from '../assistant/language';
import { plainLanguageProblems } from '../assistant/plain-language';
import { draftEmail } from './email-draft';

describe('a suggested email for the agent to copy', () => {
  it('quotes the question rather than summarising it', () => {
    // Somebody reading an email about a question they asked three days ago needs
    // to see WHICH question, and a summary written by us is a chance to get it
    // wrong in writing.
    const draft = draftEmail({
      question: 'my refnud has not arived',
      answer: 'Your money comes back once your review is live.',
      agentName: 'Asha',
    });
    expect(draft.body).toContain('"my refnud has not arived"');
  });

  it('uses the stored answer word for word', () => {
    const stored = 'Your money comes back once your review is live and the '
      + 'return window has closed.';
    const draft = draftEmail({ question: 'where is my money', answer: stored, agentName: 'Asha' });
    expect(draft.body).toContain(stored);
    expect(draft.fromTheAnswerBook).toBe(true);
  });

  it('INVENTS NOTHING when the answer book has nothing', () => {
    // The failure that matters. A drafted email guessing at a timeline would be
    // Fayr making a promise in writing that nobody approved.
    const draft = draftEmail({ question: 'do you deliver to Kathmandu', agentName: 'Asha' });
    expect(draft.fromTheAnswerBook).toBe(false);
    expect(draft.body).toContain('looking into this');
    expect(draft.body).not.toMatch(/\d+\s*(hours?|days?|weeks?)/i);
    expect(draft.body).not.toMatch(/percent|%/);
  });

  it('never promises a timeline, whatever it was given', () => {
    for (const answer of [null, undefined, '', '   ']) {
      const draft = draftEmail({
        question: 'when will I be paid', answer, agentName: 'Asha',
      });
      expect(draft.fromTheAnswerBook).toBe(false);
      expect(draft.body).not.toMatch(/\d+\s*(hours?|days?)/i);
    }
  });

  it('signs it with the real name of whoever is writing', () => {
    const draft = draftEmail({ question: 'x y z', agentName: 'Asha' });
    expect(draft.body).toContain('Asha');
    expect(draft.body).toContain('Fayr customer support');
  });

  it('still signs something when there is no name', () => {
    for (const name of ['', '   ', undefined as unknown as string]) {
      const draft = draftEmail({ question: 'x y z', agentName: name });
      expect(draft.body).toContain('Fayr customer support');
      expect(draft.body).not.toContain('undefined');
    }
  });

  it('addresses it to somebody when we know their name', () => {
    const draft = draftEmail({
      question: 'x y z', agentName: 'Asha', accountName: 'Bhavna',
    });
    expect(draft.body.startsWith('Hello Bhavna,')).toBe(true);
  });

  it('and just says hello when we do not', () => {
    const draft = draftEmail({ question: 'x y z', agentName: 'Asha' });
    expect(draft.body.startsWith('Hello,')).toBe(true);
  });

  it('writes in all three languages', () => {
    for (const language of LANGUAGES) {
      const draft = draftEmail({ question: 'x y z', agentName: 'Asha', language });
      expect(draft.subject.length).toBeGreaterThan(8);
      expect(draft.body.length).toBeGreaterThan(60);
    }
    const all = LANGUAGES.map(
      (l) => draftEmail({ question: 'x', agentName: 'A', language: l }).body,
    );
    expect(new Set(all).size).toBe(LANGUAGES.length);
  });

  it('falls back to English for a language we do not write in', () => {
    const draft = draftEmail({ question: 'x y z', agentName: 'Asha', language: 'ta' });
    expect(draft.body).toContain('Hello');
  });

  // ── the rule the answer book is held to, applied here ──────────────────────
  it('READS PLAINLY, in every language, with or without an answer', () => {
    // The whole reason for drafting it rather than leaving the agent to write it
    // cold. These words go out over Fayr's name.
    for (const language of LANGUAGES) {
      for (const answer of [null, 'Your money comes back once your review is live.']) {
        const draft = draftEmail({
          question: 'where is my money', answer, agentName: 'Asha', language,
        });
        expect(draft.plainLanguage.problems).toEqual([]);
        expect(draft.plainLanguage.ok).toBe(true);
      }
    }
  });

  it('says so when the answer it was handed does not read plainly', () => {
    // An answer that somehow got into the book badly written must not go out in
    // an email with nobody told. It is a warning, not a refusal: the agent can
    // still send it, exactly like a reply in the chat.
    const draft = draftEmail({
      question: 'where is my money',
      answer: 'Please initiate the KYC authentication workflow via the portal API.',
      agentName: 'Asha',
    });
    expect(draft.plainLanguage.ok).toBe(false);
    expect(draft.plainLanguage.problems.length).toBeGreaterThan(0);
    // Drafted anyway.
    expect(draft.body).toContain('KYC');
  });

  it('is tidy: no trailing spaces and no run of blank lines', () => {
    const draft = draftEmail({
      question: 'where is my money   ', answer: 'A stored answer.', agentName: 'Asha',
    });
    expect(draft.body).not.toMatch(/[ \t]+\n/);
    expect(draft.body).not.toMatch(/\n{3,}/);
    expect(draft.body).toBe(draft.body.trim());
  });

  it('survives nonsense without throwing', () => {
    for (const bad of [
      undefined, null, {}, { question: 42 }, { question: null, answer: 42 },
      { agentName: {} },
    ]) {
      const draft = draftEmail(bad as never);
      expect(typeof draft.body).toBe('string');
      expect(draft.body).not.toContain('undefined');
      expect(draft.body).not.toContain('[object Object]');
      expect(plainLanguageProblems(draft.body, 'en')).toEqual([]);
    }
  });

  it('leaves the question out entirely when there is not one', () => {
    const draft = draftEmail({ question: '', agentName: 'Asha' });
    expect(draft.body).not.toContain('You asked us:');
    expect(draft.body).not.toContain('""');
  });
});
