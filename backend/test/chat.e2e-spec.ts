import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import { resetDatabase } from './reset-db';

/**
 * A CONVERSATION, WITH BOTH SIDES ABLE TO SPEAK.
 *
 * The half that was missing: somebody could ask, and nobody at Fayr could answer.
 *
 * The test this file exists for is the refusal. Only the person who took a
 * conversation, or an administrator, may reply to it, and that is proved by
 * signing in as a different member of support and being turned away — not by
 * reading the code and agreeing with it.
 */
describe('Chat conversations (e2e)', () => {
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
      data: { mobile: `+9193${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}` },
    });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  async function anAgent(
    role: StaffRole = 'SUPPORT',
    name = 'Asha',
  ): Promise<{ id: string; name: string; token: string }> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `agent${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name,
        role,
      },
    });
    const session = await staffTokens.issueSession(staff);
    return { id: staff.id, name, token: session.accessToken };
  }

  /** Say something as a shopper and get the whole conversation back. */
  async function say(token: string, message: string): Promise<any> {
    const res = await request(server())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ message })
      .expect(200);
    return res.body;
  }

  /** Publish the drafted answers so the assistant has something to say. */
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
      throw new Error(`Chat e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  // ── a conversation, not a question and an answer ──────────────────────────
  describe('many messages, one conversation', () => {
    it('keeps every message in order, both directions', async () => {
      await anAnswerBook();
      const shopper = await aShopper();

      await say(shopper.token, 'what are tickets');
      const after = await say(shopper.token, 'and how do i get more');

      // Two questions, two replies, all in one place, oldest first.
      expect(after.messages.length).toBe(4);
      expect(after.messages.map((m: any) => m.author)).toEqual([
        'PERSON',
        'ASSISTANT',
        'PERSON',
        'ASSISTANT',
      ]);
      expect(after.messages[0].body).toBe('what are tickets');
      expect(after.messages[2].body).toBe('and how do i get more');

      const times = after.messages.map((m: any) => Date.parse(m.sentAt));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('gives the same conversation back on reading it again', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const sent = await say(shopper.token, 'what are tickets');

      const read = await request(server())
        .get('/chat')
        .set('Authorization', `Bearer ${shopper.token}`)
        .expect(200);
      expect(read.body.chatId).toBe(sent.chatId);
      expect(read.body.messages.length).toBe(2);
    });

    it('opens an empty one for somebody who has never written', async () => {
      const shopper = await aShopper();
      const read = await request(server())
        .get('/chat')
        .set('Authorization', `Bearer ${shopper.token}`)
        .expect(200);
      expect(read.body.messages).toEqual([]);
      expect(read.body.state).toBe('ASSISTANT');
      expect(read.body.stateInWords).toMatch(/assistant/i);
    });

    it('still writes the question down, so the answer book still learns', async () => {
      // The conversation is a layer on top of the question record, never
      // instead of it. Losing this would quietly empty the answer book's
      // statistics and the queue that tells the team what to write next.
      await anAnswerBook();
      const shopper = await aShopper();
      const sent = await say(shopper.token, 'what are tickets');

      const questions = await prisma.assistantQuestion.findMany({
        where: { userId: shopper.id },
      });
      expect(questions.length).toBe(1);
      expect(questions[0].rawText).toBe('what are tickets');
      expect(questions[0].chatId).toBe(sent.chatId);
      expect(questions[0].journey).not.toBeNull();
    });

    it('refuses an empty message and one that is far too long', async () => {
      const shopper = await aShopper();
      for (const bad of ['', '   ', 'x'.repeat(2001)]) {
        await request(server())
          .post('/chat/messages')
          .set('Authorization', `Bearer ${shopper.token}`)
          .send({ message: bad })
          .expect(400);
      }
    });

    it('shows nobody else their conversation', async () => {
      await anAnswerBook();
      const ayesha = await aShopper();
      const bhavna = await aShopper();
      await say(ayesha.token, 'what are tickets');

      const hers = await request(server())
        .get('/chat')
        .set('Authorization', `Bearer ${bhavna.token}`)
        .expect(200);
      expect(hers.body.messages).toEqual([]);
    });
  });

  // ── the state, and who has it ─────────────────────────────────────────────
  describe('the state of a conversation', () => {
    it('hands over to a person when the assistant cannot answer', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const after = await say(shopper.token, 'do you deliver to Kathmandu');

      expect(after.state).toBe('WAITING_FOR_PERSON');
      expect(after.waitingForAPerson).toBe(true);
      expect(after.stateInWords).toBe('Waiting for a person');
    });

    it('stays with the assistant when it could answer', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const after = await say(shopper.token, 'what are tickets');
      expect(after.state).toBe('ASSISTANT');
      expect(after.withTheAssistant).toBe(true);
    });

    it('puts a name on it when somebody takes it, and says so in words', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent('SUPPORT', 'Asha');

      const taken = await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      expect(taken.body.state).toBe('TAKEN');
      expect(taken.body.takenBy.name).toBe('Asha');
      expect(taken.body.stateInWords).toBe('Taken by Asha');
    });

    it('the assistant goes quiet once a person is involved', async () => {
      // Two answers to one message, minutes apart and possibly disagreeing, is
      // worse than one slow answer.
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const after = await say(shopper.token, 'what are tickets');
      const assistantReplies = after.messages.filter(
        (m: any) => m.author === 'ASSISTANT',
      );
      // Only the one from before it was taken.
      expect(assistantReplies.length).toBe(1);
      expect(after.messages[after.messages.length - 1].body).toBe(
        'what are tickets',
      );
    });
  });

  // ── the refusal this whole file exists for ────────────────────────────────
  describe('only the person who took it, or an administrator, may reply', () => {
    async function aTakenChat(): Promise<{
      chatId: string;
      asha: { id: string; name: string; token: string };
      shopper: { id: string; token: string };
    }> {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent('SUPPORT', 'Asha');
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      return { chatId: chat.chatId, asha, shopper };
    }

    it('lets the agent who took it reply', async () => {
      const { chatId, asha } = await aTakenChat();
      const replied = await request(server())
        .post(`/admin/chats/${chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We do not send anything outside India yet. Sorry.' })
        .expect(200);

      const last = replied.body.chat.messages.slice(-1)[0];
      expect(last.author).toBe('AGENT');
      expect(last.from).toBe('Asha');
      expect(last.fromAPerson).toBe(true);
    });

    it('REFUSES a different member of support', async () => {
      const { chatId } = await aTakenChat();
      const ravi = await anAgent('SUPPORT', 'Ravi');

      const refused = await request(server())
        .post(`/admin/chats/${chatId}/reply`)
        .set('Authorization', `Bearer ${ravi.token}`)
        .send({ message: 'I will answer this one instead.' })
        .expect(400);
      expect(refused.body.message).toMatch(/somebody else/i);

      // And nothing of his reached the shopper.
      const messages = await prisma.chatMessage.findMany({ where: { chatId } });
      expect(messages.some((m) => m.staffUserId === ravi.id)).toBe(false);
    });

    it('refuses a reply to a conversation nobody has taken', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();

      const refused = await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'Answering without taking it first.' })
        .expect(400);
      expect(refused.body.message).toMatch(/take this conversation first/i);
    });

    it('lets an administrator in, and taking it is what replying does', async () => {
      const { chatId } = await aTakenChat();
      const boss = await anAgent('ADMIN', 'Boss');

      const replied = await request(server())
        .post(`/admin/chats/${chatId}/reply`)
        .set('Authorization', `Bearer ${boss.token}`)
        .send({ message: 'Asha has gone home, so I am picking this one up.' })
        .expect(200);
      expect(replied.body.chat.messages.slice(-1)[0].from).toBe('Boss');
    });

    it('refuses everybody once it is closed', async () => {
      const { chatId, asha } = await aTakenChat();
      await request(server())
        .post(`/admin/chats/${chatId}/close`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const boss = await anAgent('ADMIN', 'Boss');
      for (const who of [asha, boss]) {
        const refused = await request(server())
          .post(`/admin/chats/${chatId}/reply`)
          .set('Authorization', `Bearer ${who.token}`)
          .send({ message: 'One more thing.' })
          .expect(400);
        expect(refused.body.message).toMatch(/closed/i);
      }
    });

    it('refuses a second agent taking one somebody already has', async () => {
      const { chatId } = await aTakenChat();
      const ravi = await anAgent('SUPPORT', 'Ravi');
      await request(server())
        .post(`/admin/chats/${chatId}/take`)
        .set('Authorization', `Bearer ${ravi.token}`)
        .expect(400);
    });
  });

  // ── the reply reaches the phone ───────────────────────────────────────────
  describe('the reply appears in the app', () => {
    it('is there the next time the app reads the conversation', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent('SUPPORT', 'Asha');
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now.' })
        .expect(200);

      const seen = await request(server())
        .get('/chat')
        .set('Authorization', `Bearer ${shopper.token}`)
        .expect(200);

      const last = seen.body.messages.slice(-1)[0];
      expect(last.body).toBe('We only send things inside India for now.');
      expect(last.fromAPerson).toBe(true);
      expect(last.from).toBe('Asha');
      expect(seen.body.stateInWords).toBe('Taken by Asha');
    });

    it('and the shopper can answer back into the same conversation', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now.' })
        .expect(200);

      const after = await say(shopper.token, 'ok thank you');
      expect(after.chatId).toBe(chat.chatId);
      expect(after.messages.slice(-1)[0].body).toBe('ok thank you');
    });
  });

  // ── the queue ─────────────────────────────────────────────────────────────
  describe('the staff queue', () => {
    it('shows the ones waiting, longest wait first', async () => {
      await anAnswerBook();
      const first = await aShopper();
      const second = await aShopper();
      await say(first.token, 'do you deliver to Kathmandu');
      await say(second.token, 'do you deliver to Kathmandu');

      const asha = await anAgent();
      const queue = await request(server())
        .get('/admin/chats?state=WAITING_FOR_PERSON')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      expect(queue.body.total).toBe(2);
      const waits = queue.body.chats.map((c: any) => Date.parse(c.lastMessageAt));
      expect([...waits].sort((a, b) => a - b)).toEqual(waits);
    });

    it('carries the newest message so the queue reads like conversations', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();

      const queue = await request(server())
        .get('/admin/chats')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(queue.body.chats[0].latest.body).toMatch(/[a-z]/);
      expect(queue.body.chats[0].messageCount).toBe(2);
      expect(queue.body.chats[0].user.displayId).toMatch(/^FAYR-/);
    });

    it('never puts a phone number in the queue', async () => {
      // The queue is on screen all day. A number belongs on the one screen that
      // opens one conversation, which is the act that gets recorded.
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();

      const queue = await request(server())
        .get('/admin/chats')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(JSON.stringify(queue.body)).not.toMatch(/\+91/);
    });

    it('records who opened one conversation, and who replied', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();

      await request(server())
        .get(`/admin/chats/${chat.chatId}`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now.' })
        .expect(200);

      const trail = await prisma.adminAuditLog.findMany({
        where: { staffUserId: asha.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(trail.map((t) => t.action)).toEqual(
        expect.arrayContaining(['CHAT_VIEW', 'CHAT_TAKE', 'CHAT_REPLY']),
      );
      // The words a shopper was told are not in the trail.
      expect(JSON.stringify(trail)).not.toContain('inside India');
    });
  });

  // ── the plain language rule, for what an agent types ──────────────────────
  describe('the plain language rule warns an agent, it does not block them', () => {
    it('sends the reply anyway, and says what is wrong with it', async () => {
      // An answer in the answer book is read by thousands and is refused until
      // it reads plainly. A reply to one person who is waiting is not worth
      // holding back over a word we do not like.
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const replied = await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({
          message:
            'Your KYC verification is pending, please initiate the credential '
            + 'authentication workflow via the portal.',
        })
        .expect(200);

      expect(replied.body.plainLanguage.ok).toBe(false);
      expect(replied.body.plainLanguage.problems.length).toBeGreaterThan(0);
      // Sent all the same.
      expect(replied.body.chat.messages.slice(-1)[0].body).toContain('KYC');
    });

    it('says nothing is wrong with plain words', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const replied = await request(server())
        .post(`/admin/chats/${chat.chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now. Sorry.' })
        .expect(200);
      expect(replied.body.plainLanguage.ok).toBe(true);
      expect(replied.body.plainLanguage.problems).toEqual([]);
    });

    it('checks words without sending them', async () => {
      const asha = await anAgent();
      const checked = await request(server())
        .post('/admin/chats/reply/check')
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'Please initiate the KYC authentication workflow.' })
        .expect(200);
      expect(checked.body.ok).toBe(false);
      expect(checked.body.problems.length).toBeGreaterThan(0);
    });
  });
});
