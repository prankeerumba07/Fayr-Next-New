import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AssistantSeedService } from '../src/assistant/assistant-seed.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { ContactService } from '../src/contact/contact.service';
import { HOW_TO_REACH_US_KEY } from '../src/contact/contact.words';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * A SUPPORT NUMBER THAT REALLY RINGS, END TO END.
 *
 * THE NUMBER HERE IS MADE UP. The real one is in backend/.env and in no other
 * file, which backend/src/contact/number-lives-in-one-place proves by really
 * walking the tree.
 *
 * AND THIS RUN CANNOT SEE THE REAL ONE. The first version of this spec set its own
 * value into the environment before building the application, on the belief that
 * an existing environment value wins over an env file. IT DOES NOT: the real
 * number came straight back down the route and was printed in a failure message.
 * So the one thing that knows the number is replaced outright for this run, and
 * the last check in the file goes and reads backend/.env to prove nothing this run
 * produced contained it.
 *
 * WHAT IT PROVES, in the order it matters:
 *   the app can read the number, and only when signed in;
 *   the chat gives the same number through the real question route;
 *   with no number set, neither of them offers one, and neither shows a gap.
 */
const A_MADE_UP_NUMBER = '+919000000001';

describe('How to reach Fayr (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let seed: AssistantSeedService;
  let store: AssistantStore;
  let seq = 0;

  /**
   * The number this run uses. Changed by a test to mean "the setting changed".
   *
   * The REAL service, on a made-up setting: the rules being checked are the real
   * ones, and the value is ours.
   */
  let theSetting = A_MADE_UP_NUMBER;
  const contactForThisRun = new ContactService({
    get: (key: string) => (key === 'FAYR_SUPPORT_PHONE' ? theSetting : undefined),
  } as never);

  const server = () => app.getHttpServer();
  const ROUTE = '/me/how-to-reach-us';

  async function newUser(): Promise<{ id: string; token: string }> {
    const mobile = `+9190${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;
    const user = await prisma.user.create({ data: { mobile } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  /** Fill in the answer book and make it readable, the way a practice database is. */
  async function answerBookReady(): Promise<void> {
    await seed.seedDrafts();
    const staff = await prisma.staffUser.create({
      data: {
        email: `support${Date.now()}${seq++}@fayr.local`,
        passwordHash: 'not used here',
        name: 'Test Support',
        role: 'SUPPORT',
      },
    });
    const drafts = await prisma.answerEntry.findMany({ select: { id: true } });
    for (const entry of drafts) {
      await store.setAnswerStatus(entry.id, 'PUBLISHED', staff.id);
    }
  }

  async function askInTheChat(token: string, question: string): Promise<{
    answer: string;
    answered: boolean;
  }> {
    const res = await request(server())
      .post('/assistant/ask')
      .set('authorization', `Bearer ${token}`)
      .send({ question })
      .expect(201);
    return { answer: String(res.body.answer), answered: res.body.answered === true };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ContactService)
      .useValue(contactForThisRun)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    seed = app.get(AssistantSeedService);
    store = app.get(AssistantStore);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('How to reach Fayr e2e aborted: non-test database');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    theSetting = A_MADE_UP_NUMBER;
  });

  describe('the app asking for it', () => {
    it('gives the number, the heading, the sentence and the words on the button', async () => {
      const user = await newUser();
      const res = await request(server())
        .get(ROUTE)
        .set('authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(res.body.phone).toBe(A_MADE_UP_NUMBER);
      expect(res.body.words).toContain(A_MADE_UP_NUMBER);
      expect(String(res.body.title).trim().length).toBeGreaterThan(0);
      expect(String(res.body.button).trim().length).toBeGreaterThan(0);
    });

    it('refuses somebody who is not signed in', async () => {
      await request(server()).get(ROUTE).expect(401);
    });

    it('refuses a made-up sign-in', async () => {
      await request(server())
        .get(ROUTE)
        .set('authorization', 'Bearer not-a-real-sign-in')
        .expect(401);
    });

    it('reads the setting every time, so a change plus a restart is enough', async () => {
      const user = await newUser();
      const first = await request(server())
        .get(ROUTE)
        .set('authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(first.body.phone).toBe(A_MADE_UP_NUMBER);

      theSetting = '';
      const second = await request(server())
        .get(ROUTE)
        .set('authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(second.body.phone).toBeNull();
    });

    describe('with no number set', () => {
      beforeEach(() => {
        theSetting = '';
      });

      it('offers no number at all, and still says what to do instead', async () => {
        const user = await newUser();
        const res = await request(server())
          .get(ROUTE)
          .set('authorization', `Bearer ${user.token}`)
          .expect(200);

        expect(res.body.phone).toBeNull();
        expect(res.body.button).toBeNull();
        // Not a blank, not half a number, not the word nothing.
        expect(String(res.body.words)).not.toMatch(/\d/);
        expect(String(res.body.words)).not.toContain('+');
        expect(String(res.body.words).toLowerCase()).not.toContain('nothing');
        expect(String(res.body.words).trim().length).toBeGreaterThan(20);
      });

      it('a half-written number is treated exactly the same as none', async () => {
        // The setting itself refuses this at boot. This is the second gate, for a
        // configuration built by anything other than a boot.
        theSetting = '+9179';
        const user = await newUser();
        const res = await request(server())
          .get(ROUTE)
          .set('authorization', `Bearer ${user.token}`)
          .expect(200);
        expect(res.body.phone).toBeNull();
        expect(res.body.button).toBeNull();
      });
    });
  });

  describe('the chat being asked for it', () => {
    it('gives the number, through the real question route', async () => {
      await answerBookReady();
      const user = await newUser();
      const said = await askInTheChat(user.token, 'what is your phone number');

      expect(said.answered).toBe(true);
      expect(said.answer).toContain(A_MADE_UP_NUMBER);
    });

    it('finds it however somebody asks', async () => {
      await answerBookReady();
      const user = await newUser();
      for (const question of [
        'can i call you',
        'customer care number',
        'is there a number i can ring',
        'how do i call fayr',
      ]) {
        const said = await askInTheChat(user.token, question);
        expect({ question, answer: said.answer }).toEqual({
          question,
          answer: expect.stringContaining(A_MADE_UP_NUMBER),
        });
      }
    });

    it('is an ordinary answer in the book, not a special case in the chat', async () => {
      await seed.seedDrafts();
      const rows = await prisma.answerEntry.findMany({
        where: { key: HOW_TO_REACH_US_KEY },
        orderBy: { language: 'asc' },
      });
      // One row per language, exactly like every other answer.
      expect(rows.map((r) => r.language)).toEqual(['en', 'hi', 'hi-en']);
      for (const row of rows) {
        expect(row.origin).toBe('ASSISTANT');
        expect(row.status).toBe('DRAFT');
        expect(row.body).toContain(A_MADE_UP_NUMBER);
      }
    });

    it('waits for a person to approve it, like every other answer', async () => {
      // Seeded but NOT published: the number must not reach anybody until a
      // member of staff has read the answer.
      await seed.seedDrafts();
      const user = await newUser();
      const said = await askInTheChat(user.token, 'what is your phone number');
      expect(said.answer).not.toContain(A_MADE_UP_NUMBER);
    });

    it('with no number set, offers no number and no gap', async () => {
      theSetting = '';
      await answerBookReady();
      const user = await newUser();
      const said = await askInTheChat(user.token, 'what is your phone number');

      expect(said.answer).not.toMatch(/\d/);
      expect(said.answer).not.toContain('+');
      expect(said.answer).not.toMatch(/\{|\}/);
      expect(said.answer.trim().length).toBeGreaterThan(20);
    });

    it('NEVER SAW THE REAL NUMBER, on any route, in any answer', async () => {
      // The whole file depends on the real one being replaced. This proves it,
      // by reading backend/.env at the moment it runs and then asking every
      // route that could carry a number. It never writes the number down: it
      // holds it for the length of one check and compares.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { existsSync, readFileSync } = require('node:fs') as typeof import('node:fs');
      const envFile = `${__dirname}/../.env`;
      if (!existsSync(envFile)) return;
      const line = readFileSync(envFile, 'utf8')
        .split('\n')
        .map((l) => /^\s*FAYR_SUPPORT_PHONE\s*=\s*(.*)$/.exec(l))
        .find((m) => m != null);
      const real = line?.[1].trim().replace(/^['"]|['"]$/g, '') ?? '';
      if (real === '') return;
      expect(real).not.toBe(A_MADE_UP_NUMBER);

      await answerBookReady();
      const user = await newUser();
      const fromTheApp = await request(server())
        .get(ROUTE)
        .set('authorization', `Bearer ${user.token}`)
        .expect(200);
      const fromTheChat = await askInTheChat(user.token, 'what is your phone number');

      expect(JSON.stringify(fromTheApp.body).includes(real)).toBe(false);
      expect(fromTheChat.answer.includes(real)).toBe(false);
      // And it really did answer, so the two lines above mean something.
      expect(fromTheApp.body.phone).toBe(A_MADE_UP_NUMBER);
      expect(fromTheChat.answer).toContain(A_MADE_UP_NUMBER);
    });

    it('no longer tells somebody a number is not written down anywhere', async () => {
      // The answer about talking to a person used to claim the phone number was
      // nowhere. It was, from today, and two answers claiming the same question is
      // a coin toss whose losing side told somebody the wrong thing.
      await seed.seedDrafts();
      const gone = await prisma.answerPhrase.findMany({
        where: { text: { in: ['is there a phone number', 'phone number hai kya'] } },
        include: { answer: { select: { key: true } } },
      });
      expect(gone.map((p) => p.answer.key)).toEqual([]);

      // And the answer that used to claim it is still there for the parts that
      // really are not written down: our hours, and how fast somebody replies.
      const stillThere = await prisma.answerEntry.count({
        where: { key: 'talk-to-a-person' },
      });
      expect(stillThere).toBe(3);
    });
  });
});
