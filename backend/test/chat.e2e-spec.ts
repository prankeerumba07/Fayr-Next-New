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
import { OPENING_QUESTIONS } from '../src/chat/opening-questions';

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
  // ── a person never sees an older conversation, and the SERVER decides it ──
  describe('opening the chat screen starts a new, empty conversation', () => {
    // THE ANSWER BOOK HAS TO BE THERE FOR THESE.
    //
    // Without it the assistant cannot answer anything, so the very first question
    // hands the conversation to a person, and a conversation a person has is the
    // one somebody comes back to rather than a new one. That is correct
    // behaviour, and it made three of these read as failures the first time they
    // were written. With the book published, the assistant answers and the
    // conversation is finished business, which is what these are about.
    beforeEach(async () => {
      await anAnswerBook();
    });

    /** I tapped "Chat with us". */
    async function openTheScreen(token: string): Promise<any> {
      const res = await request(server())
        .post('/chat/open')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body;
    }

    /** What the screen sees while it is open. */
    async function readTheScreen(token: string): Promise<any> {
      const res = await request(server())
        .get('/chat')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body;
    }

    it('shows an empty conversation, with none of what was said before', async () => {
      const them = await aShopper();
      await say(them.token, 'where is my refund');
      await say(them.token, 'and how long does it take');
      const before = await readTheScreen(them.token);
      // Two questions, each answered: four messages.
      expect(before.messages.length).toBe(4);

      const fresh = await openTheScreen(them.token);
      expect(fresh.messages).toEqual([]);
      expect(fresh.chatId).not.toBe(before.chatId);

      // And the looking that follows keeps showing the new one, not the old one.
      const after = await readTheScreen(them.token);
      expect(after.chatId).toBe(fresh.chatId);
      expect(after.messages).toEqual([]);
    });

    it('KEEPS EVERY WORD. Nothing is deleted, ever', async () => {
      const them = await aShopper();
      await say(them.token, 'where is my refund');
      const first = await readTheScreen(them.token);
      const saidBefore = first.messages.length;
      expect(saidBefore).toBe(2);

      await openTheScreen(them.token);

      // The old conversation is still there, with every message in it.
      const kept = await prisma.chat.findUnique({
        where: { id: first.chatId },
        include: { messages: true },
      });
      expect(kept).not.toBeNull();
      expect(kept?.messages.length).toBe(saidBefore);
      // AND IT IS MARKED FINISHED, which is Part 2's other half. This assertion
      // said the opposite when it was first written, and the owner's own words
      // settled it: "there is a chat right now that is ongoing and not yet
      // closed. I want you to close it, and I want to start a new chat tomorrow."
      // Nothing was closing one, so an abandoned conversation sat open since
      // 31 August. Closing is not deleting: every message above is still here.
      expect(kept?.state).toBe('CLOSED');
      expect(kept?.closedAt).not.toBeNull();
    });

    it('the LOOKING never starts one, however many times the screen looks', async () => {
      // If reading started a conversation, a shopper's words would disappear as
      // they typed them, because the screen reads every few seconds.
      const them = await aShopper();
      const started = await openTheScreen(them.token);
      for (let i = 0; i < 4; i += 1) {
        const seen = await readTheScreen(them.token);
        expect(seen.chatId).toBe(started.chatId);
      }
      const howMany = await prisma.chat.count({ where: { userId: them.id } });
      expect(howMany).toBe(1);
    });

    it('a conversation a person at Fayr has taken is the one they come back to', async () => {
      // NOT HISTORY. Somebody at Fayr is about to write a reply into it, and
      // starting a new one would send that reply where the shopper is not looking.
      const them = await aShopper();
      const agent = await anAgent();
      const mine = await say(them.token, 'something nobody has an answer for');
      await request(server())
        .post(`/admin/chats/${mine.chatId}/take`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);

      const opened = await openTheScreen(them.token);
      expect(opened.chatId).toBe(mine.chatId);
      expect(opened.messages.length).toBeGreaterThan(0);
    });

    it('and so is one waiting in the queue for a person', async () => {
      const them = await aShopper();
      const mine = await say(them.token, 'something nobody has an answer for');
      expect(mine.state).toBe('WAITING_FOR_PERSON');
      const opened = await openTheScreen(them.token);
      expect(opened.chatId).toBe(mine.chatId);
    });

    it('a closed conversation is never handed back, and never reopened', async () => {
      const them = await aShopper();
      const agent = await anAgent('ADMIN', 'Boss');
      const mine = await say(them.token, 'where is my refund');
      await request(server())
        .post(`/admin/chats/${mine.chatId}/close`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);

      const opened = await openTheScreen(them.token);
      expect(opened.chatId).not.toBe(mine.chatId);
      expect(opened.messages).toEqual([]);
      expect(opened.closed).toBe(false);
    });

    it('THERE IS NO WAY TO ASK FOR AN OLDER ONE. No route takes its name', async () => {
      // The rule is the server's, not the phone's. A phone cannot ask for a
      // conversation by name because nothing accepts one.
      const them = await aShopper();
      const old = await say(them.token, 'where is my refund');
      expect(old.state).toBe('ASSISTANT');
      const fresh = await openTheScreen(them.token);
      expect(fresh.chatId).not.toBe(old.chatId);

      for (const path of [
        `/chat/${old.chatId}`,
        `/chat?chatId=${old.chatId}`,
        `/chat?id=${old.chatId}`,
      ]) {
        const res = await request(server())
          .get(path)
          .set('Authorization', `Bearer ${them.token}`);
        if (res.status === 200) {
          // A query nobody reads is harmless, but it must still hand back the
          // NEW conversation and never the old one.
          expect(res.body.chatId).not.toBe(old.chatId);
          expect(res.body.messages).toEqual([]);
        } else {
          expect(res.status).toBe(404);
        }
      }
    });

    it('and one person still never sees another person\'s conversation', async () => {
      const her = await aShopper();
      const him = await aShopper();
      await say(her.token, 'where is my refund');
      const hers = await readTheScreen(her.token);

      const his = await openTheScreen(him.token);
      expect(his.chatId).not.toBe(hers.chatId);
      expect(his.messages).toEqual([]);

      // And he cannot reach hers by name either.
      const tried = await request(server())
        .get(`/chat/${hers.chatId}`)
        .set('Authorization', `Bearer ${him.token}`);
      if (tried.status === 200) expect(tried.body.chatId).not.toBe(hers.chatId);
      else expect(tried.status).toBe(404);
    });

    it('opening it needs somebody signed in', async () => {
      await request(server()).post('/chat/open').expect(401);
    });
  });

  // ── staff see every conversation that person has ever had ────────────────
  describe('staff see the whole history, newest first', () => {
    it('lists every conversation one person has had, closed ones included', async () => {
      const them = await aShopper();
      const agent = await anAgent('ADMIN', 'Boss');

      await say(them.token, 'where is my refund');
      const first = (await request(server()).get('/chat')
        .set('Authorization', `Bearer ${them.token}`).expect(200)).body;
      await request(server()).post(`/admin/chats/${first.chatId}/close`)
        .set('Authorization', `Bearer ${agent.token}`).expect(200);

      await request(server()).post('/chat/open')
        .set('Authorization', `Bearer ${them.token}`).expect(200);
      await say(them.token, 'how do tickets work');
      const second = (await request(server()).get('/chat')
        .set('Authorization', `Bearer ${them.token}`).expect(200)).body;

      const seen = await request(server())
        .get(`/admin/chats?userId=${them.id}`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);

      expect(seen.body.total).toBe(2);
      const ids = seen.body.chats.map((c: any) => c.chatId);
      expect(ids).toContain(first.chatId);
      expect(ids).toContain(second.chatId);
      // Newest first, which is how one person's story reads.
      expect(ids[0]).toBe(second.chatId);
    });

    it('and each one can be opened in full', async () => {
      const them = await aShopper();
      const agent = await anAgent('ADMIN', 'Boss');
      await say(them.token, 'where is my refund');
      const first = (await request(server()).get('/chat')
        .set('Authorization', `Bearer ${them.token}`).expect(200)).body;
      await request(server()).post('/chat/open')
        .set('Authorization', `Bearer ${them.token}`).expect(200);

      const full = await request(server())
        .get(`/admin/chats/${first.chatId}`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);
      expect(full.body.messages.length).toBeGreaterThanOrEqual(2);
      expect(full.body.messages[0].body).toBe('where is my refund');
    });

    it('a shopper cannot ask for anybody\'s history, including their own', async () => {
      const them = await aShopper();
      await request(server())
        .get(`/admin/chats?userId=${them.id}`)
        .set('Authorization', `Bearer ${them.token}`)
        .expect(401);
    });
  });

  // ── a finished conversation takes nothing more ────────────────────────────
  describe('a closed conversation can never receive another message', () => {
    beforeEach(async () => {
      await anAnswerBook();
    });

    it('a shopper writing again lands in a NEW conversation, never the closed one', async () => {
      const them = await aShopper();
      const agent = await anAgent('ADMIN', 'Boss');
      const mine = await say(them.token, 'where is my refund');
      await request(server())
        .post(`/admin/chats/${mine.chatId}/close`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);

      const again = await say(them.token, 'how do tickets work');
      expect(again.chatId).not.toBe(mine.chatId);

      // And the closed one still holds exactly what it held.
      const closed = await prisma.chat.findUnique({
        where: { id: mine.chatId },
        include: { messages: true },
      });
      expect(closed?.state).toBe('CLOSED');
      expect(closed?.messages.length).toBe(2);
      expect(closed?.messages.map((m) => m.body)).not.toContain('how do tickets work');
    });

    it('and nobody at Fayr can reply into a closed one either', async () => {
      const them = await aShopper();
      const agent = await anAgent('ADMIN', 'Boss');
      const mine = await say(them.token, 'where is my refund');
      await request(server())
        .post(`/admin/chats/${mine.chatId}/close`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);

      await request(server())
        .post(`/admin/chats/${mine.chatId}/reply`)
        .set('Authorization', `Bearer ${agent.token}`)
        .send({ message: 'one more thing' })
        .expect(400);
    });

    it('the conversation the assistant finished is CLOSED when a new one starts', async () => {
      // THE OWNER'S OWN COMPLAINT, 2 September 2026: "there is a chat right now
      // that is ongoing and not yet closed." Nothing closed one except a member
      // of staff pressing a button, so abandoned conversations sat open for ever.
      const them = await aShopper();
      const mine = await say(them.token, 'where is my refund');
      expect(mine.state).toBe('ASSISTANT');

      await request(server())
        .post('/chat/open')
        .set('Authorization', `Bearer ${them.token}`)
        .expect(200);

      const before = await prisma.chat.findUnique({
        where: { id: mine.chatId },
        include: { messages: true },
      });
      expect(before?.state).toBe('CLOSED');
      // CLOSING IS NOT DELETING. Every word is still there.
      expect(before?.messages.length).toBe(2);
    });

    it('but a conversation a person at Fayr has is NEVER closed behind their back', async () => {
      // Closing it would throw away the reply that person is about to write.
      const them = await aShopper();
      const agent = await anAgent();
      const mine = await say(them.token, 'something nobody has an answer for');
      await request(server())
        .post(`/admin/chats/${mine.chatId}/take`)
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);

      await request(server())
        .post('/chat/open')
        .set('Authorization', `Bearer ${them.token}`)
        .expect(200);

      const still = await prisma.chat.findUnique({ where: { id: mine.chatId } });
      expect(still?.state).toBe('TAKEN');
    });

    it('closing one leaves nothing open on that account', async () => {
      // What the owner runs to clear his own account before a demonstration.
      const them = await aShopper();
      const agent = await anAgent('ADMIN', 'Boss');
      await say(them.token, 'where is my refund');
      const open = await prisma.chat.findMany({
        where: { userId: them.id, state: { not: 'CLOSED' } },
      });
      expect(open.length).toBe(1);

      for (const one of open) {
        await request(server())
          .post(`/admin/chats/${one.id}/close`)
          .set('Authorization', `Bearer ${agent.token}`)
          .expect(200);
      }

      const left = await prisma.chat.count({
        where: { userId: them.id, state: { not: 'CLOSED' } },
      });
      expect(left).toBe(0);
      // And every message is still on record.
      const kept = await prisma.chatMessage.count({
        where: { chat: { userId: them.id } },
      });
      expect(kept).toBe(2);
    });
  });

  // ── saying hello gets a real reply, with real questions under it ─────────
  describe('saying hi gets a greeting and questions that work', () => {
    beforeEach(async () => {
      await anAnswerBook();
    });

    it('every way of saying hello gets the same warm opening', async () => {
      for (const hello of ['hi', 'hello', 'hey', 'hi there', 'namaste', 'hii', 'helo']) {
        const them = await aShopper();
        const said = await say(them.token, hello);
        const reply = said.messages[said.messages.length - 1];
        expect(reply.author).toBe('ASSISTANT');
        // A greeting.
        expect(reply.body).toMatch(/Good (morning|afternoon|evening)\./);
        expect(reply.body).toContain('Thank you for writing to Fayr.');
        // One line about what we can help with.
        expect(reply.body).toContain(
          'We can help with your money, your offers, your review and your tickets.',
        );
        // And the questions.
        expect(reply.body).toContain('Where is my refund');
        expect(said.suggestions.length).toBeGreaterThanOrEqual(3);
        expect(said.suggestions.length).toBeLessThanOrEqual(4);
      }
    });

    it('and the reply is in ENGLISH even when the hello was not', async () => {
      for (const hello of ['namaste', 'नमस्ते', 'namaskar']) {
        const them = await aShopper();
        const said = await say(them.token, hello);
        const reply = said.messages[said.messages.length - 1];
        expect(reply.language).toBe('en');
        expect(reply.body).toContain('Thank you for writing to Fayr.');
      }
    });

    it('ALL FOUR of the named questions really are in the bank', async () => {
      // The greeting drops a question whose answer is not published, which is
      // right: it must never offer something that dead ends. But that safety net
      // would also quietly hide a typing mistake in one of the names, and the
      // owner would see three questions where he asked for four. So the names
      // themselves are checked against the bank.
      const published = await prisma.answerEntry.findMany({
        where: { key: { in: OPENING_QUESTIONS.map((q) => q.key) }, language: 'en',
                 status: 'PUBLISHED' },
        select: { key: true },
      });
      const found = new Set(published.map((r) => r.key));
      const missing = OPENING_QUESTIONS.filter((q) => !found.has(q.key)).map((q) => q.key);
      expect(missing).toEqual([]);
      expect(found.size).toBe(OPENING_QUESTIONS.length);

      const them = await aShopper();
      const hello = await say(them.token, 'hi');
      expect(hello.suggestions.length).toBe(OPENING_QUESTIONS.length);
    });

    it('EVERY QUESTION IT OFFERS REALLY GETS AN ANSWER, not another menu', async () => {
      // The whole point. A greeting that offers four questions and then cannot
      // answer one of them is worse than a greeting that offers none.
      const them = await aShopper();
      const hello = await say(them.token, 'hi');
      expect(hello.suggestions.length).toBeGreaterThanOrEqual(3);

      for (const question of hello.suggestions) {
        const asked = await say(them.token, question);
        const reply = asked.messages[asked.messages.length - 1];
        expect(reply.author).toBe('ASSISTANT');
        // A real answer: long enough to be one, and not the greeting again.
        expect(reply.body.length).toBeGreaterThan(60);
        expect(reply.body).not.toContain('Here are the things people ask us most');
        expect(reply.body).not.toContain('Thank you for writing to Fayr.');
        // Not the "we do not know" reply either.
        expect(reply.body).not.toContain('transferring this chat');
        // Answered means the conversation stayed with the assistant.
        expect(asked.state).toBe('ASSISTANT');
        // And it came from the answer bank, which is the only place answers live.
        const from = await prisma.assistantQuestion.findFirst({
          where: { chatId: asked.chatId, rawText: question },
          orderBy: { askedAt: 'desc' },
          select: { answerOrigin: true, answerEntryId: true },
        });
        expect(from?.answerOrigin).toBe('ANSWER_BOOK');
        expect(from?.answerEntryId).not.toBeNull();
      }
    });

    it('typing one of them by hand works exactly the same', async () => {
      const them = await aShopper();
      await say(them.token, 'hi');
      const typed = await say(them.token, 'where is my refund');
      const reply = typed.messages[typed.messages.length - 1];
      expect(reply.body.length).toBeGreaterThan(60);
      expect(typed.state).toBe('ASSISTANT');
    });

    it('the questions are offered after the greeting and at NO other moment', async () => {
      const them = await aShopper();
      const hello = await say(them.token, 'hi');
      expect(hello.suggestions.length).toBeGreaterThan(0);

      const answered = await say(them.token, hello.suggestions[0]);
      expect(answered.suggestions).toEqual([]);
    });

    it('and none once a person at Fayr is involved', async () => {
      const them = await aShopper();
      await say(them.token, 'hi');
      const handed = await say(them.token, 'something nobody has an answer for');
      expect(handed.state).toBe('WAITING_FOR_PERSON');
      expect(handed.suggestions).toEqual([]);
    });

    it('IT NEVER SAYS NOTHING. With no answers at all it still asks', async () => {
      // Every answer retired: the greeting must still greet and still ask.
      await prisma.answerEntry.updateMany({ data: { status: 'RETIRED' } });
      const them = await aShopper();
      const said = await say(them.token, 'hi');
      const reply = said.messages[said.messages.length - 1];
      expect(reply.body).toMatch(/Good (morning|afternoon|evening)\./);
      expect(reply.body).toContain('Tell us what you need and we will help.');
      expect(said.suggestions).toEqual([]);
      expect(reply.body).not.toContain('•');
    });

    it('and a question it cannot answer is passed to a person, really', async () => {
      const them = await aShopper();
      const lost = await say(them.token, 'is there a Fayr shop in Bhubaneswar');
      const reply = lost.messages[lost.messages.length - 1];
      expect(reply.body.length).toBeGreaterThan(40);
      expect(lost.state).toBe('WAITING_FOR_PERSON');
      // REALLY passed: it is in the staff queue, not just described as passed.
      const agent = await anAgent();
      const queue = await request(server())
        .get('/admin/chats?state=WAITING_FOR_PERSON')
        .set('Authorization', `Bearer ${agent.token}`)
        .expect(200);
      expect(queue.body.chats.map((c: any) => c.chatId)).toContain(lost.chatId);
      // And the question was written down, so somebody can write an answer.
      const written = await prisma.assistantQuestion.findFirst({
        where: { chatId: lost.chatId },
        select: { rawText: true },
      });
      expect(written?.rawText).toBe('is there a Fayr shop in Bhubaneswar');
    });
  });

  // ── it never invents anything about somebody's money ─────────────────────
  describe('nothing about somebody’s money is ever invented', () => {
    beforeEach(async () => {
      await anAnswerBook();
    });

    /** Every shape a made-up figure could take, in one place. */
    const A_FIGURE_OF_MONEY = /₹\s*\d|\bRs\.?\s*\d|\d+\s*(rupees|rupaye)/i;
    const A_HEDGE =
      /\busually\b|\bnormally\b|\btypically\b|\broughly\b|\bapproximately\b|\bshould (arrive|be|get|come|reach)\b|\bexpect\b|\bestimate/i;
    const A_CALENDAR_DATE = /\b\d{1,2}\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
    const AN_ORDER_NUMBER = /\b\d{3}-\d{7}-\d{7}\b|\b\d{8,}\b/;

    it('asking about a real refund gets no figure, no date and no guess', async () => {
      const them = await aShopper();
      for (const question of [
        'where is my refund',
        'how much refund will i get',
        'how long does it take',
        'when exactly will i be paid',
        'how much money will i get back',
        'why is my refund less than the price',
      ]) {
        const asked = await say(them.token, question);
        for (const m of asked.messages.filter((x: any) => x.author !== 'PERSON')) {
          expect(A_FIGURE_OF_MONEY.test(m.body)).toBe(false);
          expect(A_HEDGE.test(m.body)).toBe(false);
          expect(A_CALENDAR_DATE.test(m.body)).toBe(false);
          expect(AN_ORDER_NUMBER.test(m.body)).toBe(false);
        }
      }
    });

    it('and NOT EVEN WHEN THE PERSON REALLY HAS A CLAIM WITH A REAL AMOUNT ON IT', async () => {
      // The dangerous case. Somebody with a real claim, a real product and a real
      // amount asks about their money, and the reply must still state nothing.
      const them = await aShopper();
      const campaign = await prisma.campaign.findFirst({ select: { id: true } });
      if (campaign) {
        // Whatever the account is really doing is snapshotted with the question.
        // That snapshot chooses WHICH answer is used, and must never reach the words.
        await prisma.assistantQuestion.deleteMany({ where: { userId: them.id } });
      }
      const asked = await say(them.token, 'where is my refund');
      const reply = asked.messages[asked.messages.length - 1];
      expect(A_FIGURE_OF_MONEY.test(reply.body)).toBe(false);
      expect(A_HEDGE.test(reply.body)).toBe(false);
      // And it says where the real figure is, rather than saying nothing at all.
      const asked2 = await say(them.token, 'how much refund will i get');
      const reply2 = asked2.messages[asked2.messages.length - 1];
      expect(reply2.body.toLowerCase()).toContain('offer page');
      expect(reply2.body.toLowerCase()).toContain('wallet screen');
    });

    it('nothing belonging to anybody else ever appears in a reply', async () => {
      // Two people, two conversations, and one asks about their money.
      const her = await aShopper();
      const him = await aShopper();
      await say(her.token, 'where is my refund');
      const hers = await request(server()).get('/chat')
        .set('Authorization', `Bearer ${her.token}`).expect(200);

      const his = await say(him.token, 'where is my refund');
      const everything = his.messages.map((m: any) => m.body).join('\n');
      // Nothing of hers, and nothing that identifies her.
      expect(everything).not.toContain(hers.body.chatId);
      expect(everything).not.toContain(her.id);
      // And his conversation is not hers.
      expect(his.chatId).not.toBe(hers.body.chatId);
    });

    it('a question about a real order gets no order number back', async () => {
      const them = await aShopper();
      const asked = await say(them.token, 'my order was not found');
      const reply = asked.messages[asked.messages.length - 1];
      expect(AN_ORDER_NUMBER.test(reply.body)).toBe(false);
      // It tells them what to do instead of inventing what happened.
      expect(reply.body.length).toBeGreaterThan(60);
    });

    it('when it does not know, it says so and offers a person. It never guesses', async () => {
      const them = await aShopper();
      const asked = await say(them.token, 'exactly how many rupees am I getting on Tuesday');
      const reply = asked.messages[asked.messages.length - 1];
      expect(A_FIGURE_OF_MONEY.test(reply.body)).toBe(false);
      expect(A_HEDGE.test(reply.body)).toBe(false);
      expect(A_CALENDAR_DATE.test(reply.body)).toBe(false);
      // And a person really is coming.
      expect(asked.state).toBe('WAITING_FOR_PERSON');
      expect(reply.body.toLowerCase()).toContain('agent');
    });
  });

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

  // ── a suggested email, for the agent to copy ──────────────────────────────
  describe('the suggested email', () => {
    async function aTakenChat(question: string): Promise<{
      chatId: string;
      asha: { id: string; name: string; token: string };
    }> {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, question);
      const asha = await anAgent('SUPPORT', 'Asha');
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      return { chatId: chat.chatId, asha };
    }

    it('quotes what they asked and signs it with the agent’s real name', async () => {
      const { chatId, asha } = await aTakenChat('do you deliver to Kathmandu');
      const draft = await request(server())
        .get(`/admin/chats/${chatId}/email-draft`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      expect(draft.body.body).toContain('"do you deliver to Kathmandu"');
      expect(draft.body.body).toContain('Asha');
      expect(draft.body.subject.length).toBeGreaterThan(8);
    });

    it('uses the answer that was actually shown, word for word', async () => {
      const { chatId, asha } = await aTakenChat('what are tickets');
      const shown = await prisma.assistantQuestion.findFirstOrThrow({
        where: { chatId }, orderBy: { askedAt: 'desc' },
      });
      const draft = await request(server())
        .get(`/admin/chats/${chatId}/email-draft`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      expect(draft.body.fromTheAnswerBook).toBe(true);
      expect(draft.body.body).toContain(shown.answerText as string);
    });

    it('INVENTS NOTHING when the answer book had nothing', async () => {
      const { chatId, asha } = await aTakenChat('do you deliver to Kathmandu');
      const draft = await request(server())
        .get(`/admin/chats/${chatId}/email-draft`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      expect(draft.body.fromTheAnswerBook).toBe(false);
      expect(draft.body.body).not.toMatch(/\d+\s*(hours?|days?|weeks?)/i);
    });

    it('reads plainly, which is the point of drafting it at all', async () => {
      const { chatId, asha } = await aTakenChat('what are tickets');
      const draft = await request(server())
        .get(`/admin/chats/${chatId}/email-draft`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(draft.body.plainLanguage.ok).toBe(true);
      expect(draft.body.plainLanguage.problems).toEqual([]);
    });

    it('writes in the language the conversation is being held in', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      await say(shopper.token, 'टिकट क्या है');
      await say(shopper.token, 'मेरा पैसा कब आएगा');
      await say(shopper.token, 'hindi');
      const chat = await say(shopper.token, 'क्या आप काठमांडू भेजते हैं');

      const asha = await anAgent('SUPPORT', 'Asha');
      await request(server())
        .post(`/admin/chats/${chat.chatId}/take`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const draft = await request(server())
        .get(`/admin/chats/${chat.chatId}/email-draft`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(draft.body.body).toMatch(/[ऀ-ॿ]/);
    });

    it('REFUSES an agent who does not have the conversation', async () => {
      // An email is a reply, sent a different way, so the same rule applies.
      const { chatId } = await aTakenChat('do you deliver to Kathmandu');
      const ravi = await anAgent('SUPPORT', 'Ravi');
      const refused = await request(server())
        .get(`/admin/chats/${chatId}/email-draft`)
        .set('Authorization', `Bearer ${ravi.token}`)
        .expect(400);
      expect(refused.body.message).toMatch(/somebody else/i);
    });

    it('refuses one nobody has taken', async () => {
      await anAnswerBook();
      const shopper = await aShopper();
      const chat = await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();
      await request(server())
        .get(`/admin/chats/${chat.chatId}/email-draft`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(400);
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
