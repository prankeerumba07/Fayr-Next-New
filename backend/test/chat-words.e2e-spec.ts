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
  LANGUAGE_OFFER,
  STILL_WAITING,
  SUPPORT_EMAIL_PLACEHOLDER,
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
    it('says good morning, afternoon or evening, then the same sentence', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'hi');
      const reply = lastFayr(chat).body;

      expect(reply).toMatch(/^Good (morning|afternoon|evening)\. /);
      expect(reply).toContain(
        'Thank you for contacting Fayr customer support. '
        + 'How can I assist you today?',
      );
    });

    it('answers every way of saying hello the same way', async () => {
      for (const hello of ['hello', 'hey', 'namaste', 'नमस्ते', 'good morning']) {
        const shopper = await aShopper();
        const chat = await say(shopper.token, hello);
        expect(lastFayr(chat).body).toContain('How can I assist you today?');
      }
    });

    it('DOES NOT greet somebody who already asked a question', async () => {
      // The failure that matters. Answering "hi where is my refund" with "how
      // can I help you" is the assistant ignoring somebody who already said.
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'hi what are tickets');
      const reply = lastFayr(chat).body;
      expect(reply).not.toContain('How can I assist you today?');
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
  describe('offering to change language', () => {
    it('offers after two messages in a row in another language', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      const second = await say(shopper.token, 'मेरा पैसा कब आएगा');

      const reply = lastFayr(second).body;
      expect(reply).toContain(LANGUAGE_OFFER.en);
      // And in their language too, or the offer is unreadable by the only person
      // it is for.
      expect(reply).toContain(LANGUAGE_OFFER.hi);
    });

    it('does NOT offer after only one', async () => {
      const shopper = await aShopper();
      const first = await say(shopper.token, 'टिकट क्या है');
      expect(lastFayr(first).body).not.toContain(LANGUAGE_OFFER.en);
    });

    it('offers when somebody says they do not understand', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'what are tickets');
      const said = await say(shopper.token, 'i do not understand');
      expect(lastFayr(said).body).toContain(LANGUAGE_OFFER.en);
    });

    it('offers ONCE, and never again', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');
      await say(shopper.token, 'कुछ समझ नहीं आया');
      const last = await say(shopper.token, 'मेरा पैसा कब आएगा');

      const offers = last.messages.filter((m: any) =>
        String(m.body).includes(LANGUAGE_OFFER.en),
      );
      expect(offers.length).toBe(1);
    });

    it('remembers what they chose for the rest of the conversation', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');

      const chose = await say(shopper.token, 'hindi');
      expect(lastFayr(chose).language).toBe('hi');

      const after = await say(shopper.token, 'टिकट क्या है');
      const reply = lastFayr(after);
      expect(reply.language).toBe('hi');
      expect(reply.body).toMatch(/[ऀ-ॿ]/);

      // And it is remembered, not worked out again from what they typed.
      const stored = await prisma.chat.findFirstOrThrow({
        where: { userId: shopper.id },
      });
      expect(stored.chosenLanguage).toBe('hi');
    });

    it('reads Hindi in English letters as its own choice', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');
      await say(shopper.token, 'hinglish');

      const stored = await prisma.chat.findFirstOrThrow({
        where: { userId: shopper.id },
      });
      expect(stored.chosenLanguage).toBe('hi-en');

      const after = await say(shopper.token, 'ticket kya hai');
      expect(lastFayr(after).language).toBe('hi-en');
    });

    it('carries on as before when they answer with a question instead', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');
      const after = await say(shopper.token, 'टिकट क्या है');

      expect(lastFayr(after).language).toBe('en');
      const stored = await prisma.chat.findFirstOrThrow({
        where: { userId: shopper.id },
      });
      expect(stored.chosenLanguage).toBeNull();
    });
  });

  // ── handing over ──────────────────────────────────────────────────────────
  describe('when the assistant does not know', () => {
    it('says what happens next, how long, and what else they can do', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const reply = lastFayr(chat).body;

      expect(reply).toContain('transferring this chat to a customer support agent');
      expect(reply).toContain('a minute or two');
      expect(reply).toContain('reply to you here');
      expect(reply).toContain('24 to 48 hours');
      expect(reply).toContain(SUPPORT_EMAIL_PLACEHOLDER);
    });

    it('and puts it where people look', async () => {
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      expect(chat.state).toBe('WAITING_FOR_PERSON');
    });

    it('says it in the language they chose', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');
      await say(shopper.token, 'hindi');

      const chat = await say(shopper.token, 'क्या आप काठमांडू भेजते हैं');
      const reply = lastFayr(chat);
      expect(reply.language).toBe('hi');
      expect(reply.body).toMatch(/[ऀ-ॿ]/);
      expect(reply.body).toContain(SUPPORT_EMAIL_PLACEHOLDER);
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

    it('says it in the language they chose', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');
      await say(shopper.token, 'hindi');
      await say(shopper.token, 'क्या आप काठमांडू भेजते हैं');
      await hasBeenWaiting(shopper.id, 3);

      const chat = await read(shopper.token);
      expect(
        chat.messages.some((m: any) => m.body === STILL_WAITING.hi),
      ).toBe(true);
    });
  });
});
