import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { StaffRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnswerEngine } from '../src/assistant/answer-engine.service';
import { WalletService } from '../src/wallet/wallet.service';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';

/**
 * SOMEBODY CLEVER AND HOSTILE, WITH A VALID LOGIN OF THEIR OWN.
 *
 * This is the attack that empties real apps: not a broken password check, but a
 * perfectly good login used to read somebody ELSE'S rows by changing an
 * identifier in an address. It is worth testing exhaustively rather than by
 * sampling, because every endpoint has to get it right independently and there is
 * no single place that can be reviewed instead.
 *
 * So: two real accounts, two real tokens. Everything Ayesha can name of Bhavna's
 * is tried — her tasks, her money, her payout requests, her questions, her chat,
 * her pictures, her profile — and every single one has to be refused.
 *
 * WHAT COUNTS AS REFUSED. A 404 or a 403, and NOT a 200 with her data in it. A 404
 * is the better answer: "not found" tells a stranger nothing, while "not yours"
 * confirms the row exists and belongs to somebody.
 */
describe('Security: one person cannot touch another person (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  let staffTokens: StaffTokenService;
  let engine: AnswerEngine;
  let wallet: WalletService;
  let tickets: TicketService;

  let seq = 0;
  const newMobile = (): string =>
    `+9195${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  interface Person {
    id: string;
    mobile: string;
    token: string;
    taskId: string;
    questionId: string;
    chatQuestionId: string;
    payoutMethodId: string;
    withdrawalId: string;
  }

  async function tokenFor(userId: string, mobile: string): Promise<string> {
    return jwt.signAsync(
      { sub: userId, mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
  }

  /** A whole person, with one of everything that has an identifier. */
  async function makePerson(name: string): Promise<Person> {
    const mobile = newMobile();
    const user = await prisma.user.create({ data: { mobile, name } });
    const token = await tokenFor(user.id, mobile);

    const campaign = await prisma.campaign.create({
      data: {
        platform: 'AMAZON',
        title: `${name}'s offer`,
        productName: `${name}'s product`,
        productPricePaise: 129900n,
      },
    });
    await tickets.grantSignup(user.id);
    const task = await prisma.task.create({
      data: { userId: user.id, campaignId: campaign.id, platform: 'AMAZON' },
    });

    const question = await prisma.supportQuestion.create({
      data: {
        userId: user.id,
        subject: `${name} needs help`,
        body: `${name} private words about ${name} money`,
      },
    });

    const chat = await engine.ask(user.id, `${name} private chat question`);

    const payoutMethod = await prisma.payoutMethod.create({
      data: {
        userId: user.id,
        type: 'UPI',
        upiId: `${name.toLowerCase()}@upi`,
      },
    });

    // Real money, so a withdrawal can exist to be attacked.
    await wallet.postRefund({
      userId: user.id,
      amountPaise: 500000n,
      idempotencyKey: `seed-${user.id}`,
      memo: 'seed',
    });
    const withdrawalRes = await request(app.getHttpServer())
      .post('/withdrawals')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountPaise: '100000', payoutMethodId: payoutMethod.id });

    return {
      id: user.id,
      mobile,
      token,
      taskId: task.id,
      questionId: question.id,
      chatQuestionId: chat.questionId,
      payoutMethodId: payoutMethod.id,
      withdrawalId:
        withdrawalRes.body?.id ?? '00000000-0000-4000-8000-000000000000',
    };
  }

  let ayesha: Person;
  let bhavna: Person;

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
    engine = app.get(AnswerEngine);
    wallet = app.get(WalletService);
    tickets = app.get(TicketService);

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
    ayesha = await makePerson('Ayesha');
    bhavna = await makePerson('Bhavna');
  });

  const REFUSED = [403, 404];

  /** Ayesha tries it on Bhavna's row. Anything but a refusal is a leak. */
  async function refused(
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: object,
  ): Promise<void> {
    const req = request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${ayesha.token}`);
    const res = await (body === undefined ? req : req.send(body));
    if (!REFUSED.includes(res.status)) {
      throw new Error(
        `${method.toUpperCase()} ${path} was NOT refused: got ${res.status} ` +
          `with ${JSON.stringify(res.body).slice(0, 200)}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  describe('her tasks — the offers she is working on', () => {
    it('cannot be read', async () => {
      await refused('get', `/tasks/${bhavna.taskId}`);
    });

    it('cannot be pushed forward at any step', async () => {
      // The bodies matter. A 400 for a malformed body proves nothing: the request
      // never reached the ownership check. Each of these has to be a body the DTO
      // accepts, so the only thing left to refuse it is whose task it is.
      for (const step of [
        'confirm-order',
        'reviewed',
        'start-hold',
        'release-refund',
      ]) {
        await refused('post', `/tasks/${bhavna.taskId}/${step}`);
      }
      await refused('post', `/tasks/${bhavna.taskId}/evidence`, {});
    });

    it('and the evidence body really is accepted, so the refusal is about ownership', async () => {
      // Guards the test above: the same call on Ayesha's OWN task must not be a
      // 400, or the loop is only proving that the body is wrong.
      const res = await request(app.getHttpServer())
        .post(`/tasks/${ayesha.taskId}/evidence`)
        .set('Authorization', `Bearer ${ayesha.token}`)
        .send({});
      expect(res.status).not.toBe(400);
    });

    it('does not appear in her own list', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      const ids = (res.body as { id: string }[]).map((t) => t.id);
      expect(ids).toContain(ayesha.taskId);
      expect(ids).not.toContain(bhavna.taskId);
    });
  });

  describe('her pictures — the proof she sent in', () => {
    it('cannot be listed', async () => {
      await refused('get', `/tasks/${bhavna.taskId}/screenshots`);
    });

    it('cannot have one added to her task', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${bhavna.taskId}/screenshot`)
        .set('Authorization', `Bearer ${ayesha.token}`)
        .field('kind', 'PURCHASE')
        .attach('file', Buffer.from('not really a picture'), 'x.png');
      expect(REFUSED.concat([400])).toContain(res.status);
      expect(res.status).not.toBe(201);
    });
  });

  describe('her money', () => {
    it('her wallet is not on her own wallet screen', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/wallet')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      // Ayesha's own balance. Both people were seeded with the same amount, so the
      // check that matters is that it is ONE person's, not the two added together.
      expect(typeof res.body.walletBalancePaise).toBe('string');
      expect(BigInt(res.body.walletBalancePaise)).toBeLessThanOrEqual(500000n);
      expect(JSON.stringify(res.body)).not.toContain(bhavna.mobile);
    });

    it('her payout request cannot be read', async () => {
      await refused('get', `/withdrawals/${bhavna.withdrawalId}`);
    });

    it('her payout request is not in Ayesha’s list', async () => {
      const res = await request(app.getHttpServer())
        .get('/withdrawals')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      const ids = (res.body as { id: string }[]).map((w) => w.id);
      expect(ids).not.toContain(bhavna.withdrawalId);
    });

    it('HER BANK DETAILS CANNOT BE SPENT — a payout to her account, funded by Ayesha', async () => {
      // The single most valuable attack in the whole app: name somebody else's
      // payout method and have your own money sent to their bank. Or worse, name
      // your own and drain theirs.
      const res = await request(app.getHttpServer())
        .post('/withdrawals')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .send({ amountPaise: '100000', payoutMethodId: bhavna.payoutMethodId });
      expect(REFUSED.concat([400])).toContain(res.status);
      expect(res.status).not.toBe(201);
    });

    it('her payout methods are not in Ayesha’s list', async () => {
      const res = await request(app.getHttpServer())
        .get('/me/payout-methods')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      const ids = (res.body as { id: string }[]).map((m) => m.id);
      expect(ids).toContain(ayesha.payoutMethodId);
      expect(ids).not.toContain(bhavna.payoutMethodId);
    });
  });

  describe('her questions and her chat', () => {
    it('her support thread cannot be read', async () => {
      await refused('get', `/questions/${bhavna.questionId}`);
    });

    it('cannot be replied to', async () => {
      await refused('post', `/questions/${bhavna.questionId}/replies`, {
        body: 'pretending to be her',
      });
    });

    it('is not in Ayesha’s own list of threads', async () => {
      const res = await request(app.getHttpServer())
        .get('/questions')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain('Bhavna private words');
    });

    it('her chat question cannot be marked as helpful', async () => {
      await refused(
        'post',
        `/assistant/questions/${bhavna.chatQuestionId}/helpful`,
        {
          helpful: true,
        },
      );
    });

    it('her chat is not in Ayesha’s own chat', async () => {
      const res = await request(app.getHttpServer())
        .get('/assistant/questions')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(
        'Bhavna private chat question',
      );
    });
  });

  describe('her profile', () => {
    it('Ayesha only ever sees her own', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      expect(res.body.mobile).toBe(ayesha.mobile);
      expect(JSON.stringify(res.body)).not.toContain(bhavna.mobile);
    });

    it('and editing only ever changes her own', async () => {
      await request(app.getHttpServer())
        .patch('/me')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .send({ name: 'Changed By Ayesha' })
        .expect(200);
      const her = await prisma.user.findUniqueOrThrow({
        where: { id: bhavna.id },
      });
      expect(her.name).toBe('Bhavna');
    });

    it('an id in the body cannot redirect the edit at somebody else', async () => {
      // The classic: the guard is right, the handler trusts the body.
      const res = await request(app.getHttpServer())
        .patch('/me')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .send({ name: 'Hijacked', id: bhavna.id, userId: bhavna.id });
      // Either refused as an unknown field, or accepted and applied to Ayesha.
      expect([200, 400]).toContain(res.status);
      const her = await prisma.user.findUniqueOrThrow({
        where: { id: bhavna.id },
      });
      expect(her.name).toBe('Bhavna');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('the headers every answer carries', () => {
    it('sets them on a JSON answer', async () => {
      const res = await request(app.getHttpServer())
        .get('/me')
        .set('Authorization', `Bearer ${ayesha.token}`)
        .expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    });

    it('sets them on a refusal too', async () => {
      // A 401 is still an answer, and a browser reads its headers the same way.
      const res = await request(app.getHttpServer()).get('/me').expect(401);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
    });

    it('no longer advertises what this is built with', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('does not demand https outside production', async () => {
      // Sending this on a laptop that serves plain http would lock somebody out of
      // their own machine for a year.
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.headers['strict-transport-security']).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('guessing at addresses', () => {
    it('an identifier that is not an identifier is refused, not searched for', async () => {
      for (const guess of ['1', '0', 'null', 'undefined', 'me', 'not-a-uuid']) {
        const res = await request(app.getHttpServer())
          .get(`/tasks/${guess}`)
          .set('Authorization', `Bearer ${ayesha.token}`);
        if (![400, 404].includes(res.status)) {
          throw new Error(`/tasks/${guess} answered ${res.status}`);
        }
      }
    });

    it('no staff address opens with an ordinary app login', async () => {
      const staffPaths = [
        `/admin/users/${bhavna.id}`,
        '/admin/withdrawals',
        '/admin/questions',
        '/admin/assistant/questions',
        '/admin/assistant/answers',
        '/admin/assistant/stats',
        '/admin/campaigns',
        '/admin/campaign-health',
        '/admin/live-check',
        '/admin/audit',
        '/admin/staff',
        '/admin/verifications',
        '/admin/tasks/awaiting-amount',
        '/admin/reports/payouts',
      ];
      for (const path of staffPaths) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${ayesha.token}`);
        if (res.status !== 401) {
          throw new Error(`${path} answered ${res.status} to an app login`);
        }
      }
    });

    it('the user search takes the number in the body, not the address', async () => {
      // A mobile number in a web address ends up in the application log, in any
      // proxy's log, and in the browser history of whichever staff laptop typed
      // it. The GET is gone, not kept alongside — keeping it would keep the leak.
      const support = await prisma.staffUser.create({
        data: {
          email: `support${Date.now()}${seq++}@fayr.local`,
          passwordHash: await argon2.hash('not-used'),
          name: 'A Support',
          role: 'SUPPORT',
        },
      });
      const { accessToken } = await staffTokens.issueSession(support);

      // The old address no longer names an endpoint at all. It now falls through
      // to "one user by identifier", which refuses "search" as an identifier — so
      // it is a 400. Either way there is nothing there to leak into a log.
      const gone = await request(app.getHttpServer())
        .get('/admin/users/search?mobile=%2B919000000001')
        .set('Authorization', `Bearer ${accessToken}`);
      expect([400, 404]).toContain(gone.status);

      await request(app.getHttpServer())
        .post('/admin/users/search')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ mobile: bhavna.mobile })
        .expect(200);
    });

    it('and no app address opens with a staff login', async () => {
      // The other direction. A staff token must not be able to act AS a user.
      const staff = await prisma.staffUser.create({
        data: {
          email: `admin${Date.now()}${seq++}@fayr.local`,
          passwordHash: await argon2.hash('not-used'),
          name: 'An Admin',
          role: 'ADMIN',
        },
      });
      const { accessToken } = await staffTokens.issueSession(staff);
      for (const path of [
        '/me',
        '/tasks',
        '/questions',
        '/withdrawals',
        '/assistant/questions',
      ]) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${accessToken}`);
        if (res.status !== 401) {
          throw new Error(`${path} answered ${res.status} to a staff token`);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('the four staff teams, tried against each other', () => {
    async function staffToken(role: StaffRole): Promise<string> {
      const staff = await prisma.staffUser.create({
        data: {
          email: `${role.toLowerCase()}${Date.now()}${seq++}@fayr.local`,
          passwordHash: await argon2.hash('not-used'),
          name: `A ${role}`,
          role,
        },
      });
      return (await staffTokens.issueSession(staff)).accessToken;
    }

    /** [path, who may open it]. Everybody else must get a 403. */
    const OWNED: [string, StaffRole[]][] = [
      ['/admin/withdrawals', ['FINANCE']],
      ['/admin/questions', ['SUPPORT']],
      ['/admin/assistant/questions', ['SUPPORT']],
      ['/admin/verifications', ['SUPPORT']],
      ['/admin/tasks/awaiting-amount', ['SUPPORT']],
      ['/admin/campaigns', ['OPERATIONS']],
      ['/admin/campaign-health', ['OPERATIONS']],
      ['/admin/live-check', ['OPERATIONS']],
      ['/admin/audit', []],
      ['/admin/staff', []],
      // A fixed identifier, because this list is built before the fixtures exist.
      // What is being tested is the role gate: an allowed role reaches the handler
      // and gets a 404 for an unknown person, a refused role never gets that far.
      [
        '/admin/users/00000000-0000-4000-8000-0000000000ff',
        ['SUPPORT', 'FINANCE'],
      ],
    ];

    it('each team reaches only its own work, and ADMIN reaches everything', async () => {
      const roles: StaffRole[] = ['SUPPORT', 'FINANCE', 'OPERATIONS', 'ADMIN'];
      const tokens = new Map<StaffRole, string>();
      for (const role of roles) tokens.set(role, await staffToken(role));

      for (const [path, allowed] of OWNED) {
        for (const role of roles) {
          const res = await request(app.getHttpServer())
            .get(path)
            .set('Authorization', `Bearer ${tokens.get(role)!}`);
          // ADMIN is a super-role and passes every check by design.
          const shouldPass = role === 'ADMIN' || allowed.includes(role);
          if (shouldPass && res.status === 403) {
            throw new Error(`${role} was refused ${path}, but owns it`);
          }
          if (!shouldPass && res.status !== 403) {
            throw new Error(
              `${role} reached ${path} with ${res.status}, and must not`,
            );
          }
        }
      }
    });

    it('a staff member cannot do the money actions of another team', async () => {
      const support = await staffToken('SUPPORT');
      const finance = await staffToken('FINANCE');
      // Support must not approve a payout.
      await request(app.getHttpServer())
        .post(`/admin/withdrawals/${bhavna.withdrawalId}/approve`)
        .set('Authorization', `Bearer ${support}`)
        .expect(403);
      // Finance must not write an answer users will read.
      await request(app.getHttpServer())
        .post('/admin/assistant/answers')
        .set('Authorization', `Bearer ${finance}`)
        .send({
          key: 'sneaky',
          language: 'en',
          title: 'A title',
          body: 'A body long enough to be real.',
          topic: 'refund',
        })
        .expect(403);
      // Finance must not publish an offer.
      await request(app.getHttpServer())
        .post('/admin/campaigns')
        .set('Authorization', `Bearer ${finance}`)
        .send({
          title: 'x',
          productName: 'x',
          productPricePaise: '1000',
          platform: 'AMAZON',
        })
        .expect(403);
    });
  });
});
