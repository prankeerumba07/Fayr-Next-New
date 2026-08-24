import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StaffTokenService } from '../src/admin/staff-token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

/**
 * End-to-end for support questions (2.3): the full user↔staff round-trip, the
 * status lifecycle (OPEN → ANSWERED → OPEN on follow-up → CLOSED), trust-domain
 * isolation on both controllers, per-user scoping, and staff-action auditing.
 */
describe('Support questions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staffTokens: StaffTokenService;
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

  async function makeStaffToken(): Promise<string> {
    const staff = await prisma.staffUser.create({
      data: {
        email: `staff${Date.now()}${seq++}@fayr.local`,
        passwordHash: await argon2.hash('irrelevant'),
        name: 'Support Agent',
        role: 'SUPPORT',
      },
    });
    return (await staffTokens.issueSession(staff)).accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    staffTokens = app.get(StaffTokenService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(`Support e2e aborted: non-test database "${db}"`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const server = () => app.getHttpServer();
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

  it('drives the full submit → answer → follow-up → close lifecycle', async () => {
    const user = await makeUser();
    const staff = await makeStaffToken();

    // User submits a question → OPEN, no replies.
    const created = await request(server())
      .post('/questions')
      .set(bearer(user.token))
      .send({ subject: 'Where is my refund?', body: 'It has been 20 days.' })
      .expect(201);
    expect(created.body.status).toBe('OPEN');
    expect(created.body.replies).toHaveLength(0);
    const qId = created.body.id as string;

    // Staff sees it in the OPEN list, with the raising user attached.
    const openList = await request(server())
      .get('/admin/questions')
      .query({ status: 'OPEN' })
      .set(bearer(staff))
      .expect(200);
    expect(openList.body).toHaveLength(1);
    expect(openList.body[0].user.id).toBe(user.id);

    // Staff answers → ANSWERED, reply authored by staff.
    const answered = await request(server())
      .post(`/admin/questions/${qId}/reply`)
      .set(bearer(staff))
      .send({ body: 'Your refund releases once the return window closes.' })
      .expect(201);
    expect(answered.body.status).toBe('ANSWERED');
    expect(answered.body.replies).toHaveLength(1);
    expect(answered.body.replies[0].author).toBe('staff');

    // The user sees the staff reply on their own thread.
    const userView = await request(server())
      .get(`/questions/${qId}`)
      .set(bearer(user.token))
      .expect(200);
    expect(userView.body.replies[0].author).toBe('staff');

    // User follows up → re-OPENs, reply authored by user.
    const followed = await request(server())
      .post(`/questions/${qId}/replies`)
      .set(bearer(user.token))
      .send({ body: 'The window closed yesterday though.' })
      .expect(201);
    expect(followed.body.status).toBe('OPEN');
    expect(followed.body.replies).toHaveLength(2);
    expect(followed.body.replies[1].author).toBe('user');

    // Staff closes → CLOSED.
    const closed = await request(server())
      .post(`/admin/questions/${qId}/close`)
      .set(bearer(staff))
      .expect(200);
    expect(closed.body.status).toBe('CLOSED');

    // Staff actions were audited (reply + close), tied to the user.
    const audits = await prisma.adminAuditLog.findMany({
      where: { targetUserId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('QUESTION_REPLY');
    expect(actions).toContain('QUESTION_CLOSE');
  });

  it('scopes user reads to the owner (a foreign question is a 404)', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const created = await request(server())
      .post('/questions')
      .set(bearer(alice.token))
      .send({ subject: 'Q', body: 'body' })
      .expect(201);

    await request(server())
      .get(`/questions/${created.body.id}`)
      .set(bearer(bob.token))
      .expect(404);
    // Bob's own list is empty.
    const bobList = await request(server())
      .get('/questions')
      .set(bearer(bob.token))
      .expect(200);
    expect(bobList.body).toHaveLength(0);
  });

  it('enforces trust-domain isolation on both controllers', async () => {
    const user = await makeUser();
    const staff = await makeStaffToken();

    // No token anywhere.
    await request(server()).get('/questions').expect(401);
    await request(server()).get('/admin/questions').expect(401);

    // A staff token cannot use the user endpoints...
    await request(server()).get('/questions').set(bearer(staff)).expect(401);
    // ...and a user token cannot use the staff endpoints.
    await request(server())
      .get('/admin/questions')
      .set(bearer(user.token))
      .expect(401);
  });

  it('validates input (blank body rejected)', async () => {
    const user = await makeUser();
    await request(server())
      .post('/questions')
      .set(bearer(user.token))
      .send({ subject: 'ok', body: '' })
      .expect(400);
  });

  it('surfaces the question in the staff unified user view (2.2)', async () => {
    const user = await makeUser();
    const staff = await makeStaffToken();
    await request(server())
      .post('/questions')
      .set(bearer(user.token))
      .send({ subject: 'Visible in profile', body: 'hello' })
      .expect(201);

    const view = await request(server())
      .get(`/admin/users/${user.id}`)
      .set(bearer(staff))
      .expect(200);
    expect(view.body.questions).toHaveLength(1);
    expect(view.body.questions[0].subject).toBe('Visible in profile');
  });
});
