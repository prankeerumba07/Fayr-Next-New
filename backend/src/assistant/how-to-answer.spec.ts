/**
 * THE LANGUAGE RULES, ON REAL EXAMPLES OF ALL THREE.
 *
 * Every example below is a real thing somebody might type, including the awkward
 * short ones the owner named: "hi", "ok", "haan", numbers only, emoji only.
 */

import {
  HOW_TO_ANSWER,
  ONLY_ENGLISH_OR_HINDI,
  howToAnswer,
  languageToAnswerIn,
  shouldSayWhichLanguages,
} from './how-to-answer';

const how = (text: unknown) => howToAnswer(text).how;
const lectures = (text: unknown) => howToAnswer(text).saysWhichLanguagesWeCanTalkIn;

describe('which of three cases a message is', () => {
  it('there are exactly three cases and no fourth', () => {
    expect([...HOW_TO_ANSWER]).toEqual(['english', 'hindi', 'another-language']);
  });

  // ── ENGLISH ───────────────────────────────────────────────────────────────
  describe('English', () => {
    it('an ordinary question', () => {
      expect(how('where is my refund')).toBe('english');
      expect(how('when will my money come back')).toBe('english');
      expect(how('My order was not found. What do I do?')).toBe('english');
      expect(how('How do tickets work')).toBe('english');
      expect(how('I have not been paid and it has been a while')).toBe('english');
    });

    it('short ones, which is where a guess goes wrong', () => {
      expect(how('hi')).toBe('english');
      expect(how('hello')).toBe('english');
      expect(how('ok')).toBe('english');
      expect(how('yes')).toBe('english');
      expect(how('no')).toBe('english');
      expect(how('thanks')).toBe('english');
      expect(how('please help')).toBe('english');
    });

    it('and none of them is lectured about language', () => {
      for (const said of ['hi', 'ok', 'where is my refund', 'thanks']) {
        expect(lectures(said)).toBe(false);
      }
    });
  });

  // ── HINDI, BOTH KINDS ─────────────────────────────────────────────────────
  describe('Hindi, and both kinds count', () => {
    it("Hindi's own letters", () => {
      expect(how('मेरा पैसा कब आएगा')).toBe('hindi');
      expect(how('रिफंड नहीं आया')).toBe('hindi');
      expect(how('मेरा ऑर्डर नहीं मिला')).toBe('hindi');
      expect(how('नमस्ते')).toBe('hindi');
    });

    it('Hindi typed with English letters, which is how most people type', () => {
      expect(how('mera refund kab aayega')).toBe('hindi');
      expect(how('order nahi mila')).toBe('hindi');
      expect(how('kitna time lagega')).toBe('hindi');
      expect(how('paisa kab milega bhai')).toBe('hindi');
      expect(how('haan')).toBe('hindi');
    });

    it('A MIXED MESSAGE IS NOT A FOREIGN ONE, and gets no lecture', () => {
      // The owner named this case: "refund kab aayega please" is Hinglish and
      // gets an ordinary English answer with no remark about language.
      expect(how('refund kab aayega please')).toBe('hindi');
      expect(lectures('refund kab aayega please')).toBe(false);
      expect(how('my refund kab aayega')).toBe('hindi');
      expect(lectures('my refund kab aayega')).toBe(false);
      expect(how('sir mera refund nahi aaya please check')).toBe('hindi');
      expect(lectures('sir mera refund nahi aaya please check')).toBe(false);
    });

    it('and a Hindi word or two inside an English sentence is still not foreign', () => {
      expect(lectures('where is my paisa')).toBe(false);
      expect(lectures('my order nahi mila')).toBe(false);
    });

    it('nobody writing Hindi is ever told to write differently', () => {
      for (const said of [
        'मेरा पैसा कब आएगा', 'mera refund kab aayega', 'haan', 'नमस्ते',
        'kitna time lagega', 'order nahi mila',
      ]) {
        expect(lectures(said)).toBe(false);
      }
    });
  });

  // ── ANOTHER LANGUAGE ──────────────────────────────────────────────────────
  describe('another language', () => {
    it('another script altogether', () => {
      expect(how('我的退款在哪里')).toBe('another-language');            // Chinese
      expect(how('எனது பணம் எப்போது வரும்')).toBe('another-language');   // Tamil
      expect(how('আমার টাকা কোথায়')).toBe('another-language');          // Bengali
      expect(how('نقودي في أي مكان')).toBe('another-language');          // Arabic
      expect(how('Где мои деньги')).toBe('another-language');            // Russian
      expect(how('నా డబ్బు ఎక్కడ ఉంది')).toBe('another-language');        // Telugu
    });

    it('letters English and Hindi never use', () => {
      expect(how('¿Dónde está mi reembolso?')).toBe('another-language');
      expect(how('Où est mon remboursement')).toBe('another-language');
      expect(how('Wo ist meine Rückerstattung')).toBe('another-language');
      expect(how('Où')).toBe('another-language');
    });

    it('and each one is told, once, which languages we can talk in', () => {
      for (const said of ['我的退款在哪里', '¿Dónde está mi reembolso?', 'Где мои деньги']) {
        expect(lectures(said)).toBe(true);
      }
    });

    it('the line apologises, says what we can read, and says what to do', () => {
      expect(ONLY_ENGLISH_OR_HINDI).toContain('We are sorry');
      expect(ONLY_ENGLISH_OR_HINDI).toContain('English');
      expect(ONLY_ENGLISH_OR_HINDI).toContain('Hindi');
      expect(ONLY_ENGLISH_OR_HINDI).toContain('Please write your question');
    });

    it('but one foreign letter in an English sentence is not another language', () => {
      // Somebody quoting a product name. Telling them to write differently would
      // be absurd.
      expect(how('where is my refund for the 我 brand kettle')).toBe('english');
      expect(lectures('where is my refund for the 我 brand kettle')).toBe(false);
    });
  });

  // ── FALLING THE SAFE WAY ──────────────────────────────────────────────────
  describe('anything it cannot place is English, and answered normally', () => {
    it('numbers only', () => {
      expect(how('12345')).toBe('english');
      expect(lectures('12345')).toBe(false);
      expect(how('295')).toBe('english');
      expect(how('9876543210')).toBe('english');
    });

    it('emoji only', () => {
      expect(how('😀')).toBe('english');
      expect(lectures('😀')).toBe(false);
      expect(how('😀😀😀')).toBe('english');
      expect(how('👍')).toBe('english');
    });

    it('punctuation, spaces and nothing at all', () => {
      for (const said of ['', '   ', '???', '...', '!!!', '\n\n']) {
        expect(how(said)).toBe('english');
        expect(lectures(said)).toBe(false);
      }
    });

    it('and something that is not writing at all', () => {
      for (const said of [null, undefined, 12345, {}, [], true]) {
        expect(how(said)).toBe('english');
        expect(lectures(said)).toBe(false);
      }
    });

    it('a Latin sentence with no accents reads as English, ON PURPOSE', () => {
      // Spanish and Indonesian without accents land here. The owner's rule says
      // so: a person asking a plain question must never be told to write
      // differently because a guess went wrong. Being answered in English is
      // harmless; being lectured when you wrote good English is insulting.
      expect(how('donde esta mi dinero')).toBe('english');
      expect(lectures('donde esta mi dinero')).toBe(false);
    });
  });

  // ── THE ANSWER IS ALWAYS ENGLISH ──────────────────────────────────────────
  describe('the answer is always in English, in every case', () => {
    it('there is no case that answers in anything else', () => {
      expect(languageToAnswerIn()).toBe('en');
      for (const said of [
        'where is my refund', 'मेरा पैसा कब आएगा', 'mera refund kab aayega',
        '我的退款在哪里', '¿Dónde está mi reembolso?', '', '12345', '😀',
      ]) {
        // Whatever the case, the language out is the same one thing.
        expect(howToAnswer(said).how).toEqual(expect.any(String));
        expect(languageToAnswerIn()).toBe('en');
      }
    });

    it('and only another language ever carries the extra line', () => {
      const said = [
        ['where is my refund', false], ['hi', false], ['ok', false],
        ['मेरा पैसा कब आएगा', false], ['mera refund kab aayega', false],
        ['haan', false], ['refund kab aayega please', false],
        ['12345', false], ['😀', false], ['', false],
        ['我的退款在哪里', true], ['¿Dónde está mi reembolso?', true],
        ['எனது பணம் எப்போது வரும்', true],
      ] as const;
      for (const [text, expected] of said) {
        expect(lectures(text)).toBe(expected);
      }
    });

    it('every answer says why, in plain words', () => {
      for (const said of ['hi', 'मेरा पैसा कब आएगा', '我的退款在哪里', '12345']) {
        const answer = howToAnswer(said);
        expect(answer.why.length).toBeGreaterThan(30);
        expect(answer.why).not.toContain('undefined');
      }
    });
  });
});

describe('the line about which languages we can talk in is said ONCE', () => {
  const foreign = howToAnswer('我的退款在哪里');
  const hinglish = howToAnswer('mera refund kab aayega');
  const english = howToAnswer('where is my refund');

  it('said the first time somebody writes in another language', () => {
    expect(shouldSayWhichLanguages(foreign, false)).toBe(true);
  });

  it('AND NEVER AGAIN in the same conversation', () => {
    expect(shouldSayWhichLanguages(foreign, true)).toBe(false);
  });

  it('never said to somebody writing English', () => {
    expect(shouldSayWhichLanguages(english, false)).toBe(false);
    expect(shouldSayWhichLanguages(english, true)).toBe(false);
  });

  it('never said to somebody writing Hindi, either kind', () => {
    expect(shouldSayWhichLanguages(hinglish, false)).toBe(false);
    expect(shouldSayWhichLanguages(howToAnswer('मेरा पैसा कब आएगा'), false)).toBe(false);
  });

  it('and never to numbers, emoji or nothing at all', () => {
    for (const said of ['12345', '😀', '', '   ', '???']) {
      expect(shouldSayWhichLanguages(howToAnswer(said), false)).toBe(false);
    }
  });
});
