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
 * WHAT THE ANSWER BOOK LEARNS FROM WHAT AGENTS ACTUALLY DO.
 *
 * Three things, and each of them is a fact that was being thrown away:
 *
 *   every agent's reply, against the question that caused it,
 *   what kind of question it was,
 *   and how long the whole thing took, from the first message to closed.
 *
 * Plus the screen that turns all of that into a decision: the questions people
 * keep asking that nobody could answer, most asked first, so the team knows what
 * to write next instead of guessing.
 */
describe('Learning from the agents (e2e)', () => {
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
      data: { mobile: `+9191${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}` },
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
        email: `learner${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant-here'),
        name,
        role,
      },
    });
    const session = await staffTokens.issueSession(staff);
    return { id: staff.id, name, token: session.accessToken };
  }

  async function say(token: string, message: string): Promise<any> {
    const res = await request(server())
      .post('/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ message })
      .expect(200);
    return res.body;
  }

  async function anAnswerBook(): Promise<void> {
    await seed.seedDrafts();
    await prisma.answerEntry.updateMany({
      where: { origin: 'ASSISTANT' },
      data: { status: 'PUBLISHED' },
    });
  }

  /** A conversation handed over and taken, ready for a real reply. */
  async function handedOver(question = 'do you deliver to Kathmandu'): Promise<{
    chatId: string;
    asha: { id: string; name: string; token: string };
    shopper: { id: string; token: string };
  }> {
    const shopper = await aShopper();
    const chat = await say(shopper.token, question);
    const asha = await anAgent('SUPPORT', 'Asha');
    await request(server())
      .post(`/admin/chats/${chat.chatId}/take`)
      .set('Authorization', `Bearer ${asha.token}`)
      .expect(200);
    return { chatId: chat.chatId, asha, shopper };
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
      throw new Error(`Learning e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await anAnswerBook();
  });

  // ── every reply, against the question that caused it ──────────────────────
  describe('what is stored about a reply', () => {
    it('keeps the reply against the question it answered', async () => {
      const { chatId, asha } = await handedOver();
      await request(server())
        .post(`/admin/chats/${chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now. Sorry.' })
        .expect(200);

      const question = await prisma.assistantQuestion.findFirstOrThrow({
        where: { chatId },
      });
      const reply = await prisma.chatMessage.findFirstOrThrow({
        where: { chatId, author: 'AGENT' },
      });
      expect(reply.assistantQuestionId).toBe(question.id);
      expect(reply.staffUserId).toBe(asha.id);
      expect(question.rawText).toBe('do you deliver to Kathmandu');
    });

    it('files what kind of question it was, when an answer served it', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'what are tickets');
      const question = await prisma.assistantQuestion.findFirstOrThrow({
        where: { userId: shopper.id },
      });
      expect(question.topic).toBe('tickets');
    });

    it('leaves the kind unset when nobody could answer it', async () => {
      // Which is itself the useful fact: an unsorted pile is exactly what the
      // answer book needs to be told about.
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      const question = await prisma.assistantQuestion.findFirstOrThrow({
        where: { userId: shopper.id },
      });
      expect(question.topic).toBeNull();
      expect(question.answerOrigin).toBe('NONE');
    });

    it('records how long the whole thing took, from first message to closed', async () => {
      const { chatId, asha } = await handedOver();
      await request(server())
        .post(`/admin/chats/${chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now.' })
        .expect(200);
      await request(server())
        .post(`/admin/chats/${chatId}/close`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const chat = await prisma.chat.findUniqueOrThrow({ where: { id: chatId } });
      expect(chat.closedAt).not.toBeNull();
      expect(chat.startedAt).not.toBeNull();
      expect((chat.closedAt as Date).getTime()).toBeGreaterThanOrEqual(
        chat.startedAt.getTime(),
      );
      // And how long somebody waited for a person, separately.
      expect(chat.handedOverAt).not.toBeNull();
      expect(chat.takenAt).not.toBeNull();
    });
  });

  // ── what to write next ────────────────────────────────────────────────────
  describe('what the team should write an answer for next', () => {
    it('counts the same question asked by different people as one thing', async () => {
      for (let i = 0; i < 3; i += 1) {
        const shopper = await aShopper();
        await say(shopper.token, 'do you deliver to Kathmandu');
      }
      // Deliberately something the answer book has nothing for. The first
      // version of this used a question it CAN answer, which is why it never
      // reached the unanswered pile at all.
      const one = await aShopper();
      await say(one.token, 'is there a Fayr shop in Bhubaneswar');

      const asha = await anAgent();
      const out = await request(server())
        .get('/admin/chats/what-to-write-next')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      expect(out.body.groups[0].asked).toBe(3);
      expect(out.body.groups[0].examples[0]).toContain('Kathmandu');
      expect(out.body.groups.length).toBe(2);
      expect(out.body.groups[1].asked).toBe(1);
    });

    it('says how many questions it looked at, rather than implying all of them', async () => {
      const shopper = await aShopper();
      await say(shopper.token, 'do you deliver to Kathmandu');
      const asha = await anAgent();
      const out = await request(server())
        .get('/admin/chats/what-to-write-next')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(out.body.readFrom).toBe(1);
    });

    it('leaves out the ones that WERE answered', async () => {
      // The screen is about what is missing. A question the answer book already
      // handles is not work.
      const shopper = await aShopper();
      await say(shopper.token, 'what are tickets');
      const asha = await anAgent();
      const out = await request(server())
        .get('/admin/chats/what-to-write-next')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(out.body.groups).toEqual([]);
    });

    it('shows which languages it was asked in', async () => {
      const a = await aShopper();
      const b = await aShopper();
      await say(a.token, 'kya aap Kathmandu bhejte hain');
      await say(b.token, 'kya aap Kathmandu bhejte hain');

      const asha = await anAgent();
      const out = await request(server())
        .get('/admin/chats/what-to-write-next')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(out.body.groups[0].languages.length).toBeGreaterThanOrEqual(1);
    });

    it('is empty and does not fall over when nobody has asked anything', async () => {
      const asha = await anAgent();
      const out = await request(server())
        .get('/admin/chats/what-to-write-next')
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      expect(out.body.groups).toEqual([]);
      expect(out.body.readFrom).toBe(0);
    });
  });

  // ── one button, and it needs approving ────────────────────────────────────
  describe('turning a reply into a new answer', () => {
    async function aReply(): Promise<{
      chatId: string;
      messageId: string;
      asha: { id: string; name: string; token: string };
    }> {
      const { chatId, asha } = await handedOver();
      const replied = await request(server())
        .post(`/admin/chats/${chatId}/reply`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ message: 'We only send things inside India for now. Sorry.' })
        .expect(200);
      const last = replied.body.chat.messages.slice(-1)[0];
      return { chatId, messageId: last.id, asha };
    }

    it('IT ARRIVES AS A DRAFT, needing a person to approve it', async () => {
      // The whole point. The person who wrote the words is not automatically the
      // person who decides they are Fayr's official answer.
      const { chatId, messageId, asha } = await aReply();
      const saved = await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ topic: 'about' })
        .expect(200);

      const answer = await prisma.answerEntry.findFirstOrThrow({
        where: { key: saved.body.key },
      });
      expect(answer.status).toBe('DRAFT');
      expect(answer.origin).toBe('STAFF');
      expect(answer.body).toBe('We only send things inside India for now. Sorry.');
      expect(answer.topic).toBe('about');
    });

    it('and is not answering anybody until somebody approves it', async () => {
      const { chatId, messageId, asha } = await aReply();
      await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ topic: 'about' })
        .expect(200);

      const asker = await aShopper();
      const reply = await say(asker.token, 'do you deliver to Kathmandu');
      const last = reply.messages.slice(-1)[0];
      expect(last.body).toContain('transferring this chat');
    });

    it('and answers once it IS approved', async () => {
      const { chatId, messageId, asha } = await aReply();
      const saved = await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ topic: 'about' })
        .expect(200);
      const answer = await prisma.answerEntry.findFirstOrThrow({
        where: { key: saved.body.key },
      });
      await request(server())
        .post(`/admin/assistant/answers/${answer.id}/approve`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);

      const asker = await aShopper();
      const reply = await say(asker.token, 'do you deliver to Kathmandu');
      const last = reply.messages.slice(-1)[0];
      expect(last.body).toContain('inside India');
    });

    it('keeps the question as a way of asking it, so it is findable', async () => {
      const { chatId, messageId, asha } = await aReply();
      const saved = await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ topic: 'about' })
        .expect(200);

      const answer = await prisma.answerEntry.findFirstOrThrow({
        where: { key: saved.body.key },
        include: { phrases: true },
      });
      expect(answer.phrases.map((p) => p.text)).toContain(
        'do you deliver to Kathmandu',
      );
    });

    it('refuses to make an answer out of the shopper’s own words', async () => {
      const { chatId, asha } = await aReply();
      const chat = await request(server())
        .get(`/admin/chats/${chatId}`)
        .set('Authorization', `Bearer ${asha.token}`)
        .expect(200);
      const theirs = chat.body.messages.find((m: any) => m.author === 'PERSON');

      const refused = await request(server())
        .post(`/admin/chats/${chatId}/messages/${theirs.id}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ topic: 'about' })
        .expect(400);
      expect(refused.body.message).toMatch(/a person at Fayr wrote/i);
    });

    it('REFUSES an agent who does not have the conversation', async () => {
      const { chatId, messageId } = await aReply();
      const ravi = await anAgent('SUPPORT', 'Ravi');
      await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${ravi.token}`)
        .send({ topic: 'about' })
        .expect(400);
    });

    it('needs a kind, because an answer filed wrong is never found again', async () => {
      const { chatId, messageId, asha } = await aReply();
      await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({})
        .expect(400);
    });

    it('does not overwrite an answer that already has that name', async () => {
      const first = await aReply();
      const a = await request(server())
        .post(`/admin/chats/${first.chatId}/messages/${first.messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${first.asha.token}`)
        .send({ topic: 'about' })
        .expect(200);

      const second = await aReply();
      const b = await request(server())
        .post(`/admin/chats/${second.chatId}/messages/${second.messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${second.asha.token}`)
        .send({ topic: 'about' })
        .expect(200);

      expect(b.body.key).not.toBe(a.body.key);
      expect(await prisma.answerEntry.count({ where: { origin: 'STAFF' } })).toBe(2);
    });

    it('records who did it', async () => {
      const { chatId, messageId, asha } = await aReply();
      await request(server())
        .post(`/admin/chats/${chatId}/messages/${messageId}/save-as-answer`)
        .set('Authorization', `Bearer ${asha.token}`)
        .send({ topic: 'about' })
        .expect(200);

      const trail = await prisma.adminAuditLog.findMany({
        where: { staffUserId: asha.id, action: 'ASSISTANT_ANSWER_SAVE' },
      });
      expect(trail.length).toBe(1);
    });
  });
});
