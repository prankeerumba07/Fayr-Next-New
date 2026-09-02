import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import {
  STILL_WAITING,
  SUPPORT_EMAIL,
} from '../src/chat/chat-words';
import { resetDatabase } from './reset-db';

/**
 * THE WORDS THE ASSISTANT SAYS WHEN IT IS NOT ANSWERING ANYTHING.
 *
 * Whether each line reads plainly is checked next to the words themselves. What
 * can only be proved here is WHEN each one comes out: that a greeting is answered
 * as a greeting and a question is not, that a Hindi question is answered in
 * English until somebody says otherwise, that the offer to change language is
 * made once and never again, and that the apology for a slow queue arrives after
 * two minutes and exactly once.
 */
describe('What the assistant says (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTokens: StaffTokenService;
  let seed: AssistantSeedService;

  let seq = 0;
  const server = (): ReturnType<INestApplication['getHttpServer']> =>
    app.getHttpServer();

  async function aShopper(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({
      data: { mobile: `+9192${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}` },
    });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  async function say(token: string, message: string): Promise<any> {
    const res = await request(server())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ message })
      .expect(200);
    return res.body;
  }

  async function read(token: string): Promise<any> {
    const res = await request(server())
      .get('/chat')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body;
  }

  const lastFayr = (chat: any): any =>
    [...chat.messages].reverse().find((m: any) => m.author !== 'PERSON');

  async function anAnswerBook(): Promise<void> {
    await seed.seedDrafts();
    await prisma.answerEntry.updateMany({
      where: { origin: 'ASSISTANT' },
      data: { status: 'PUBLISHED' },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    staffTokens = app.get(StaffTokenService);
    seed = app.get(AssistantSeedService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Chat words e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await anAnswerBook();
  });

  // ── the greeting ──────────────────────────────────────────────────────────
  describe('a greeting is answered as a greeting', () => {
    // CHANGED ON 2 SEPTEMBER 2026. This used to require the sentence "Thank you
    // for contacting Fayr customer support. How can I assist you today?" The
    // owner asked for something better: "whenever I say 'hi,' it should reply
    // with basic questions and answers." Asking somebody what they want puts the
    // whole problem back on a person who came to the chat because they did not
    // know what to ask. It is NOT a weaker check: it went from asking for one
    // sentence to asking for a greeting, a line about what we help with, and
    // four questions that are proved to work in chat.e2e-spec.ts.
    it('says good morning, afternoon or evening, then what we can help with', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'hi');
      const reply = lastFayr(chat).body;

      expect(reply).toMatch(/^Good (morning|afternoon|evening)\. /);
      expect(reply).toContain('Thank you for writing to Fayr.');
      expect(reply).toContain(
        'We can help with your money, your offers, your review and your tickets.',
      );
      expect(reply).toContain('Here are the things people ask us most.');
      expect(reply).toContain('Tap one, or just type your own question.');
    });

    it('answers every way of saying hello the same way', async () => {
      for (const hello of ['hello', 'hey', 'namaste', 'नमस्ते', 'good morning']) {
        const shopper = await aShopper();
        const chat = await say(shopper.token, hello);
        expect(lastFayr(chat).body).toContain('Here are the things people ask us most.');
      }
    });

    it('DOES NOT greet somebody who already asked a question', async () => {
      // The failure that matters. Answering "hi where is my refund" with a menu
      // is the assistant ignoring somebody who already said what they wanted.
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'hi what are tickets');
      const reply = lastFayr(chat).body;
      expect(reply).not.toContain('Here are the things people ask us most.');
      expect(reply.toLowerCase()).toContain('ticket');
    });

    it('does not write a greeting down as a question nobody could answer', async () => {
      // "hi" sitting in the queue of unanswered questions would bury the ones
      // that really do need an answer written for them.
      const shopper = await aShopper();
      await say(shopper.token, 'hi');
      expect(await prisma.assistantQuestion.count()).toBe(0);
    });
  });

  // ── English by default ────────────────────────────────────────────────────
  describe('the assistant answers in English until somebody says otherwise', () => {
    it('answers a Hindi question in English', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'टिकट क्या है');
      const reply = lastFayr(chat);

      expect(reply.language).toBe('en');
      expect(reply.body.toLowerCase()).toContain('ticket');
      // And it is a real answer, not the hand over.
      expect(reply.body).not.toContain('transferring this chat');
    });

    it('answers Hindi typed in English letters in English too', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'ticket kya hai');
      expect(lastFayr(chat).language).toBe('en');
    });

    it('still writes down the language the question was really in', async () => {
      // What we answer in is a decision. What they typed in is evidence, and the
      // answer book reads it to find out which languages people write to us in.
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      const asked = await prisma.assistantQuestion.findFirstOrThrow({
        where: { userId: shopper.id },
      });
      expect(asked.detectedLanguage).toBe('hi');
      expect(asked.rawText).toBe('टिकट क्या है');
    });
  });

  // ── offering another language ─────────────────────────────────────────────
  // ── THE LANGUAGE RULE, REPLACED ON 2 SEPTEMBER 2026 ─────────────────────
  //
  // There used to be a block here called "offering to change language". It
  // proved that somebody who wrote twice in Hindi was offered a menu of three
  // languages, that picking one was remembered, and that every reply afterwards
  // came back in it. All five of those tests are gone, because the behaviour they
  // guarded is withdrawn.
  //
  // THE OWNER'S RULE INSTEAD: "If someone is sharing their messages in English, I
  // want the chat box to reply in English. If someone is sharing their messages
  // in Hindi, then it should reply in English, not in Hindi. If someone comes
  // with a different language, we will reply in English and say that we can only
  // converse in Hinglish or English."
  //
  // THIS IS NOT A SMALLER SET OF CHECKS. It went from five tests about a menu to
  // eight about the rule, and the pure decision behind it has twenty two of its
  // own in backend/src/assistant/how-to-answer.spec.ts.
  describe('the answer is always in English, whatever they wrote in', () => {
    it('English in, English out', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'how do tickets work');
      const reply = lastFayr(chat);
      expect(reply.language).toBe('en');
      expect(reply.body).not.toMatch(/[ऀ-ॿ]/);
    });

    it('HINDI IN, ENGLISH OUT. Written in Hindi letters', async () => {
      const shopper = await aShopper();
      for (const said of ['टिकट क्या है', 'मेरा पैसा कब आएगा', 'मेरा ऑर्डर नहीं मिला']) {
        const chat = await say(shopper.token, said);
        const reply = lastFayr(chat);
        expect(reply.language).toBe('en');
        expect(reply.body).not.toMatch(/[ऀ-ॿ]/);
      }
    });

    it('HINDI IN, ENGLISH OUT. Written with English letters', async () => {
      const shopper = await aShopper();
      for (const said of ['mera refund kab aayega', 'order nahi mila', 'kitna time lagega']) {
        const chat = await say(shopper.token, said);
        const reply = lastFayr(chat);
        expect(reply.language).toBe('en');
        expect(reply.body).not.toMatch(/[ऀ-ॿ]/);
      }
    });

    it('and NOBODY writing Hindi is told to write differently', async () => {
      // The thing that would insult a shopper. Hinglish is how most people type.
      const shopper = await aShopper();
      for (const said of [
        'mera refund kab aayega', 'refund kab aayega please', 'order nahi mila',
        'मेरा पैसा कब आएगा', 'haan',
      ]) {
        const chat = await say(shopper.token, said);
        expect(lastFayr(chat).body).not.toContain('We can only talk in English');
      }
    });

    it('another language gets an English answer AND one line about it', async () => {
      for (const said of ['我的退款在哪里', '¿Dónde está mi reembolso?', 'Где мои деньги']) {
        const shopper = await aShopper();
        const chat = await say(shopper.token, said);
        const reply = lastFayr(chat);
        expect(reply.language).toBe('en');
        expect(reply.body).toContain('We are sorry, we could not read that.');
        expect(reply.body).toContain(
          'We can only talk in English, or in Hindi written with English letters.',
        );
        // THE LINE ON ITS OWN, AND THAT IS RIGHT.
        //
        // This asserted the opposite when it was first written: that the line was
        // added to an answer or to the hand over, never sent alone. Holding a real
        // conversation showed why that was wrong. Nothing in the answer bank
        // matches a message nobody can read, so the conversation was handed to a
        // person, and the assistant goes quiet once a person has it. Somebody who
        // did exactly what the line asked and retyped in English got nothing back
        // at all.
        expect(reply.body).not.toContain('transferring this chat');
        // AND THE CONVERSATION IS STILL OURS, so they can try again in English.
        expect(chat.state).toBe('ASSISTANT');
      }
    });

    it('and they can then ask again in English and really be answered', async () => {
      // The whole point of the change above. The line tells somebody to write in
      // English, so writing in English has to work.
      const shopper = await aShopper();
      const first = await say(shopper.token, '我的退款在哪里');
      expect(lastFayr(first).body).toContain('We are sorry, we could not read that.');

      const again = await say(shopper.token, 'where is my refund');
      const answer = lastFayr(again);
      expect(answer.body.length).toBeGreaterThan(60);
      expect(answer.body).not.toContain('We are sorry, we could not read that.');
      expect(again.state).toBe('ASSISTANT');
    });

    it('and the team still sees that somebody wrote to us in another language', async () => {
      // Not handing over is not the same as ignoring it. The question is written
      // down, so whoever reads the queue of questions knows it happened.
      const shopper = await aShopper();
      await say(shopper.token, 'எனது பணம் எப்போது வரும்');
      const written = await prisma.assistantQuestion.findFirst({
        where: { userId: shopper.id },
        select: { rawText: true },
      });
      expect(written?.rawText).toBe('எனது பணம் எப்போது வரும்');
    });

    it('that line is said ONCE in a conversation, and never again', async () => {
      // COUNTED ACROSS THE WHOLE CONVERSATION, not read off the last message.
      // The first version of this test read the newest Fayr message each time and
      // failed, because a message in another language cannot be answered, so the
      // conversation hands over to a person and the messages after it get no
      // reply at all. The newest Fayr message was therefore still the first one.
      // Counting is the assertion that actually says "once".
      const shopper = await aShopper();
      const first = await say(shopper.token, '我的退款在哪里');
      expect(lastFayr(first).body).toContain('We are sorry, we could not read that.');

      // Written to again in another language: NOT the same line a second time.
      // Handed to a person instead, who can at least use a translator.
      const second = await say(shopper.token, 'எனது பணம் எப்போது வரும்');
      expect(lastFayr(second).body).not.toContain('We are sorry, we could not read that.');
      expect(lastFayr(second).body).toContain('customer support agent');
      expect(second.state).toBe('WAITING_FOR_PERSON');
      // And it never says nothing: there is a real reply both times.
      expect(lastFayr(second).body.length).toBeGreaterThan(60);

      for (const again of ['我的退款在哪里', 'Где мои деньги']) {
        await say(shopper.token, again);
      }

      const whole = await read(shopper.token);
      const timesSaid = whole.messages.filter((m: any) =>
        m.body.includes('We are sorry, we could not read that.'),
      ).length;
      expect(timesSaid).toBe(1);

      // AND THE CONVERSATION REALLY REMEMBERS having said it, stamped once.
      // Counting the messages alone is not enough: a message in another language
      // cannot be answered, so the conversation hands over and later messages get
      // no reply at all. That was hiding whether the rule worked, so this reads
      // the record instead.
      const record = await prisma.chat.findUnique({
        where: { id: whole.chatId },
        select: { languageOfferedAt: true },
      });
      expect(record?.languageOfferedAt).not.toBeNull();
    });

    it('and it is never said to somebody writing numbers or emoji', async () => {
      // Falling the safe way. Somebody who typed "12345" is answered normally.
      for (const said of ['12345', '😀😀', '???']) {
        const shopper = await aShopper();
        const chat = await say(shopper.token, said);
        expect(lastFayr(chat).body).not.toContain('We can only talk in English');
      }
    });

    // THE RECORD STILL SAYS WHAT THEY WROTE IN, WHICH STAFF NEED. The reply is
    // English; the question is filed under the language it was asked in, because
    // that is what tells the team who is writing to them.
    it('the record still says what they wrote in', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'mera refund kab aayega');
      const theirs = await prisma.chatMessage.findFirst({
        where: { author: 'PERSON', body: 'mera refund kab aayega' },
        select: { language: true },
      });
      expect(theirs?.language).toBe('hi-en');
    });
  });

  describe('when the assistant does not know', () => {
    it('says what happens next, how long, and what else they can do', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const reply = lastFayr(chat).body;

      expect(reply).toContain('transferring this chat to a customer support agent');
      expect(reply).toContain('a minute or two');
      expect(reply).toContain('reply to you here');
      expect(reply).toContain('24 to 48 hours');
      expect(reply).toContain(SUPPORT_EMAIL);
    });

    it('and puts it where people look', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      expect(chat.state).toBe('WAITING_FOR_PERSON');
    });

    it('says it in ENGLISH even when the question was in Hindi', async () => {
      // CHANGED ON 2 SEPTEMBER 2026. This used to require the hand over in the
      // language somebody had chosen. There is no choosing any more: the answer
      // is always in English, which is the owner's own instruction.
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'क्या आप काठमांडू भेजते हैं');
      const reply = lastFayr(chat);
      expect(reply.language).toBe('en');
      expect(reply.body).not.toMatch(/[ऀ-ॿ]/);
      expect(reply.body).toContain(SUPPORT_EMAIL);
      // And Hindi is not another language, so no line about which we can talk in.
      expect(reply.body).not.toContain('We can only talk in English');
    });
  });

  // ── the one apology for a slow queue ──────────────────────────────────────
  describe('when nobody has taken it after two minutes', () => {
    /** Push a conversation's hand-over back in time, as if it had been waiting. */
    async function hasBeenWaiting(userId: string, minutes: number): Promise<string> {
      const chat = await prisma.chat.findFirstOrThrow({ where: { userId } });
      await prisma.chat.update({
        where: { id: chat.id },
        data: { handedOverAt: new Date(Date.now() - minutes * 60_000) },
      });
      return chat.id;
    }

    it('says nothing at all before two minutes', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      await hasBeenWaiting(shopper.id, 1);

      const chat = await read(shopper.token);
      expect(
        chat.messages.some((m: any) => m.body === STILL_WAITING.en),
      ).toBe(false);
    });

    it('says it once after two minutes, when they next look', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      await hasBeenWaiting(shopper.id, 3);

      const chat = await read(shopper.token);
      const note = chat.messages.filter((m: any) => m.body === STILL_WAITING.en);
      expect(note.length).toBe(1);
      expect(note[0].author).toBe('SYSTEM');
    });

    it('NEVER says it twice, however many times they look', async () => {
      // A queue that keeps apologising is worse than a quiet one.
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      await hasBeenWaiting(shopper.id, 3);

      for (let i = 0; i < 5; i += 1) await read(shopper.token);
      const chat = await read(shopper.token);
      expect(
        chat.messages.filter((m: any) => m.body === STILL_WAITING.en).length,
      ).toBe(1);
    });

    it('says nothing once somebody has taken it', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      const chatId = await hasBeenWaiting(shopper.id, 3);

      const staff = await prisma.staffUser.create({
        data: {
          email: `taker${seq++}@fayr.local`,
          passwordHash: await argon2.hash('irrelevant-here'),
          name: 'Asha',
          role: 'SUPPORT',
        },
      });
      const session = await staffTokens.issueSession(staff);
      await request(server())
        .post(`/admin/chats/${chatId}/take`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      const chat = await read(shopper.token);
      expect(
        chat.messages.some((m: any) => m.body === STILL_WAITING.en),
      ).toBe(false);
    });

    it('says it in ENGLISH even when the questions were in Hindi', async () => {
      // CHANGED ON 2 SEPTEMBER 2026, same reason as above.
      const shopper = await aShopper();
      await say(shopper.token, 'क्या आप काठमांडू भेजते हैं');
      await hasBeenWaiting(shopper.id, 3);

      const chat = await read(shopper.token);
      expect(
        chat.messages.some((m: any) => m.body === STILL_WAITING.en),
      ).toBe(true);
      expect(
        chat.messages.some((m: any) => m.body === STILL_WAITING.hi),
      ).toBe(false);
    });
  });
});
