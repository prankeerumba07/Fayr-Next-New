import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { AnswerEngine } from '../src/assistant/answer-engine.service';
import { WalletService } from '../src/wallet/wallet.service';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';

/**
 * TWO DIFFERENT ATTACKS, IN ONE PLACE BECAUSE BOTH ARE "SEND SOMETHING HOSTILE".
 *
 * FIRST, INJECTION. The assistant's search is the newest hand-written database
 * query in the project, and the only one that puts a person's own typing anywhere
 * near a query. Everything is passed as a parameter and nothing is built into the
 * query text, so the way to prove it is to type the things that would break a
 * query that did, and watch the search simply not find them.
 *
 * SECOND, MONEY. The protections already exist. The job here is to try to defeat
 * them with hostile requests: a payout nobody earned, more than the wallet holds,
 * the same money spent twice, a balance below zero.
 */
describe('Security: hostile input and hostile money (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: AssistantStore;
  let engine: AnswerEngine;
  let wallet: WalletService;
  let tickets: TicketService;
  let jwt: JwtService;
  let config: ConfigService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function makeUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    store = app.get(AssistantStore);
    engine = app.get(AnswerEngine);
    wallet = app.get(WalletService);
    tickets = app.get(TicketService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Security e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  /**
   * Every one of these breaks a query that builds a person's typing into its own
   * text. Against a query that passes it as a parameter they are just words
   * nobody has an answer for. The null character is in the list because some
   * database drivers silently cut a string short at one.
   */
  const NASTY = [
    "'; DROP TABLE answer_entries; --",
    "' OR 1=1 --",
    "'; SELECT pg_sleep(10); --",
    "1' UNION SELECT NULL, NULL, NULL, NULL --",
    "'); DELETE FROM wallet_entries; --",
    "refund'; UPDATE campaigns SET status='ENDED'; --",
    'refund & !review | (order <-> money):*',
    "%' AND SLEEP(5) AND '%'='",
    '${process.env.JWT_ACCESS_SECRET}',
    '{{7*7}}',
    '<script>alert(1)</script>',
    String.fromCharCode(0) + ' a null character',
    String.fromCharCode(92) + "'; DROP TABLE users; --",
    'a'.repeat(1999),
  ];

  describe('hostile typing, sent at the search', () => {
    beforeEach(async () => {
      await store.saveAnswer({
        key: 'refund-timing',
        language: 'en',
        title: 'When your money comes back',
        body: 'After your review is live and the return window has closed.',
        topic: 'refund',
        status: 'PUBLISHED',
        phrases: ['when will my refund arrive'],
      });
    });

    it('the tables are all still there afterwards', async () => {
      const before = await prisma.answerEntry.count();
      const users = await prisma.user.count();

      for (const nasty of NASTY) {
        // Never throws. A null character used to come back as a raw database
        // complaint from here, which is how that finding was found.
        await store.searchAnswers({ text: nasty });
      }

      expect(await prisma.answerEntry.count()).toBe(before);
      expect(await prisma.user.count()).toBe(users);
      // And the real answer still works, so nothing was quietly broken.
      const hits = await store.searchAnswers({
        text: 'when will my refund arrive',
      });
      expect(hits[0].answer.key).toBe('refund-timing');
    });

    it('none of it is treated as anything but words', async () => {
      for (const nasty of NASTY) {
        const hits = await store.searchAnswers({ text: nasty });
        // It may find nothing, or a weak match. What it may never do is throw, or
        // return something it was told to return.
        expect(Array.isArray(hits)).toBe(true);
        for (const hit of hits) expect(hit.score).toBeLessThan(60);
      }
    });

    it('a null character is refused cleanly, not as a database complaint', async () => {
      // The finding this suite produced. Postgres cannot hold a null character, so
      // the question could neither be stored nor searched, and the person got a
      // raw database error telling them how the query is built.
      const user = await makeUser();
      const res = await request(app.getHttpServer())
        .post('/assistant/ask')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ question: String.fromCharCode(0) + 'hello' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(
        /UTF8|0x00|byte sequence|prisma/i,
      );
      expect(await prisma.assistantQuestion.count()).toBe(0);
    });

    it('the same thing sent through the app, end to end', async () => {
      const user = await makeUser();
      for (const nasty of NASTY.slice(0, 8)) {
        const res = await request(app.getHttpServer())
          .post('/assistant/ask')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ question: nasty })
          .expect(201);
        // Answered honestly or not at all. Never a database complaint reaching a
        // person, which is how an attacker learns what the query looks like.
        expect(typeof res.body.answer).toBe('string');
        expect(res.body.answer).not.toMatch(
          /syntax error|pg_|relation|SQLSTATE/i,
        );
      }
    });

    it('what a person typed is stored exactly, dangerous or not', async () => {
      // The evidence has to survive. Cleaning it on the way IN would mean the
      // answer somebody eventually writes is written from a mangled copy.
      const user = await makeUser();
      const typed = "'; DROP TABLE answer_entries; --";
      const asked = await engine.ask(user.id, typed);
      const stored = await store.getQuestion(asked.questionId);
      expect(stored.rawText).toBe(typed);
    });

    it('and it survives being read back out through the staff screen', async () => {
      const user = await makeUser();
      await engine.ask(user.id, "<script>alert(1)</script>' OR 1=1 --");
      const page = await store.listQuestions({ limit: 10, offset: 0 });
      expect(page.questions).toHaveLength(1);
      expect(page.questions[0].rawText).toContain('<script>');
    });

    it('a hostile answer name or language cannot reach the query either', async () => {
      for (const bad of [
        { key: "x'; DROP TABLE users; --", language: 'en' },
        { key: 'ok-key', language: "en'; DROP TABLE users; --" },
      ]) {
        await expect(
          store.saveAnswer({
            ...bad,
            title: 'A title',
            body: 'A body long enough to be real.',
            topic: 'refund',
          }),
        ).rejects.toBeDefined();
      }
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('hostile money', () => {
    it('cannot ask for a payout with an empty wallet', async () => {
      const user = await makeUser();
      const method = await prisma.payoutMethod.create({
        data: { userId: user.id, type: 'UPI', upiId: 'nobody@upi' },
      });
      const res = await request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ amountPaise: '100000', payoutMethodId: method.id });
      expect(res.status).not.toBe(201);
      expect(await prisma.withdrawal.count()).toBe(0);
    });

    it('cannot ask for more than the wallet holds', async () => {
      const user = await makeUser();
      await wallet.postRefund({
        userId: user.id,
        amountPaise: 50000n,
        idempotencyKey: `seed-${user.id}`,
        memo: 'seed',
      });
      const method = await prisma.payoutMethod.create({
        data: { userId: user.id, type: 'UPI', upiId: 'nobody@upi' },
      });
      const res = await request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ amountPaise: '5000000', payoutMethodId: method.id });
      expect(res.status).not.toBe(201);
    });

    it('cannot ask for a negative amount, or nothing, or a fraction', async () => {
      const user = await makeUser();
      await wallet.postRefund({
        userId: user.id,
        amountPaise: 500000n,
        idempotencyKey: `seed-${user.id}`,
        memo: 'seed',
      });
      const method = await prisma.payoutMethod.create({
        data: { userId: user.id, type: 'UPI', upiId: 'nobody@upi' },
      });
      for (const amount of [
        '-100000',
        '0',
        '10.5',
        '1e9',
        'lots',
        '  ',
        '999999999999999999999',
      ]) {
        const res = await request(app.getHttpServer())
          .post('/withdrawals')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ amountPaise: amount, payoutMethodId: method.id });
        if (res.status === 201) {
          throw new Error(`a payout of "${amount}" was accepted`);
        }
      }
      expect(await prisma.withdrawal.count()).toBe(0);
    });

    it('two payout requests at once cannot spend the same money twice', async () => {
      const user = await makeUser();
      await wallet.postRefund({
        userId: user.id,
        amountPaise: 100000n,
        idempotencyKey: `seed-${user.id}`,
        memo: 'seed',
      });
      const method = await prisma.payoutMethod.create({
        data: { userId: user.id, type: 'UPI', upiId: 'nobody@upi' },
      });

      // Both for the whole balance, sent together.
      const both = await Promise.all([
        request(app.getHttpServer())
          .post('/withdrawals')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ amountPaise: '100000', payoutMethodId: method.id }),
        request(app.getHttpServer())
          .post('/withdrawals')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ amountPaise: '100000', payoutMethodId: method.id }),
      ]);
      const accepted = both.filter((r) => r.status === 201).length;
      expect(accepted).toBeLessThanOrEqual(1);
      expect(await wallet.getUserBalance(user.id)).toBeGreaterThanOrEqual(0n);
    });

    it('no request can take a wallet below zero', async () => {
      // Through every door a person can actually reach. The balance check lives in
      // the withdrawal service, and there is no route that posts a movement
      // without going through it.
      const user = await makeUser();
      const method = await prisma.payoutMethod.create({
        data: { userId: user.id, type: 'UPI', upiId: 'nobody@upi' },
      });
      for (const amount of ['1', '100000', '999999999']) {
        await request(app.getHttpServer())
          .post('/withdrawals')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ amountPaise: amount, payoutMethodId: method.id });
      }
      expect(await wallet.getUserBalance(user.id)).toBe(0n);
      expect(await prisma.withdrawal.count()).toBe(0);
    });

    it('BUT the ledger itself has no floor, and this records that honestly', async () => {
      // A FINDING, written as a test rather than as a comment nobody reads.
      //
      // The ticket ledger has a DEFERRED database trigger refusing any commit that
      // would leave a balance below zero. The WALLET has no equivalent for a user
      // account. It is not reachable — every route checks the balance first, which
      // the test above proves — so this is depth, not a hole.
      //
      // It is flagged rather than fixed because a floor interacts with a rule that
      // is written in the terms and not yet built: if a review is removed after
      // payout, Fayr may take the refund back out of the wallet. Whether that may
      // take a wallet below zero, or stops at zero and the rest becomes a debt, is
      // a decision for a person. Add the floor and the answer is decided by
      // accident.
      //
      // When that decision is made, the fix is the same shape as the ticket one:
      //   CREATE CONSTRAINT TRIGGER wallet_entries_user_nonnegative
      //     AFTER INSERT ON "wallet_entries" DEFERRABLE INITIALLY DEFERRED
      //     FOR EACH ROW EXECUTE FUNCTION fayr_wallet_user_nonnegative();
      const user = await makeUser();
      await expect(
        wallet.postWithdrawal({
          userId: user.id,
          amountPaise: 100000n,
          idempotencyKey: `overdraw-${user.id}`,
          memo: 'straight at the ledger, past every check',
        }),
      ).resolves.toBeDefined();
      expect(await wallet.getUserBalance(user.id)).toBe(-100000n);
    });

    it('tickets can never go below zero either', async () => {
      const user = await makeUser();
      await tickets.grantSignup(user.id);
      let refusals = 0;
      for (let i = 0; i < 6; i += 1) {
        try {
          await tickets.adjust(user.id, -5, `drain-${user.id}-${i}`);
        } catch {
          refusals += 1;
        }
      }
      expect(refusals).toBeGreaterThan(0);
      expect(await tickets.getBalance(user.id)).toBeGreaterThanOrEqual(0);
    });

    it('every wallet movement is still balanced after all of that', async () => {
      // The one check that catches money appearing out of nowhere: every
      // transaction's two sides must add up to zero.
      const rows = await prisma.$queryRaw<{ unbalanced: bigint }[]>`
        SELECT count(*) AS unbalanced FROM (
          SELECT "transactionId", SUM("amountPaise") AS total
          FROM "wallet_entries" GROUP BY "transactionId" HAVING SUM("amountPaise") <> 0
        ) bad`;
      expect(Number(rows[0].unbalanced)).toBe(0);
    });
  });
});
