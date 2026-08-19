import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Consent has to be a RECORD, not a screen.
 *
 * Under the DPDP Act a claim of consent with no timestamp and no version is
 * worthless — you cannot show WHAT was agreed to or WHEN. The setup sequence
 * displays the terms; these tests prove the agreement lands on the user row, where
 * an auditor, or a founder asked to prove it, can actually see it.
 */
describe('Terms consent (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let config: ConfigService;
  const server = () => app.getHttpServer();

  let seq = 0;
  const newMobile = (): string =>
    `+9191${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  async function newUser(): Promise<{ id: string; token: string }> {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    const token = await jwt.signAsync(
      { sub: user.id, mobile: user.mobile },
      { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
    );
    return { id: user.id, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    if (!rows[0]?.current_database?.endsWith('_test')) {
      throw new Error('Consent e2e aborted: non-test database');
    }
  });

  afterAll(async () => app.close());

  const patch = (token: string, body: Record<string, unknown>) =>
    request(server()).patch('/me').set('Authorization', `Bearer ${token}`).send(body);

  it('records nothing until the user actually agrees', async () => {
    const user = await newUser();
    const res = await request(server())
      .get('/me')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(res.body.termsAcceptedAt).toBeNull();
    expect(res.body.termsVersion).toBeNull();

    // Saving other answers must not imply consent.
    await patch(user.token, { name: 'Asha' }).expect(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.termsAcceptedAt).toBeNull();
    expect(row.termsVersion).toBeNull();
  });

  it('stores WHAT was agreed to, WHICH version, and WHEN', async () => {
    const user = await newUser();
    const before = Date.now();
    const res = await patch(user.token, {
      acceptTerms: true,
      termsVersion: '2026-08-13',
    }).expect(200);

    expect(res.body.termsVersion).toBe('2026-08-13');
    expect(res.body.termsAcceptedAt).not.toBeNull();

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.termsVersion).toBe('2026-08-13');
    expect(row.termsAcceptedAt).not.toBeNull();
    // A real timestamp, set by the SERVER — a client-supplied one would be worthless.
    const at = row.termsAcceptedAt!.getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('refuses consent with no version — an unversioned record proves nothing', async () => {
    const user = await newUser();
    await patch(user.token, { acceptTerms: true }).expect(400);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.termsAcceptedAt).toBeNull();
  });

  it('ignores acceptTerms:false rather than treating it as a withdrawal', async () => {
    const user = await newUser();
    await patch(user.token, { acceptTerms: true, termsVersion: '2026-08-13' }).expect(200);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await patch(user.token, { acceptTerms: false }).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    // Withdrawal is a separate, deliberate act — not a side effect of a PATCH.
    expect(after.termsAcceptedAt).toEqual(first.termsAcceptedAt);
    expect(after.termsVersion).toBe(first.termsVersion);
  });

  it('records a NEW acceptance when the terms version changes', async () => {
    const user = await newUser();
    await patch(user.token, { acceptTerms: true, termsVersion: '2026-08-13' }).expect(200);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await new Promise((r) => setTimeout(r, 15));
    await patch(user.token, { acceptTerms: true, termsVersion: '2027-01-01' }).expect(200);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(second.termsVersion).toBe('2027-01-01');
    expect(second.termsAcceptedAt!.getTime()).toBeGreaterThan(first.termsAcceptedAt!.getTime());
  });

  it('never clears an existing record by re-accepting the same version', async () => {
    const user = await newUser();
    await patch(user.token, { acceptTerms: true, termsVersion: '2026-08-13' }).expect(200);
    const first = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await patch(user.token, { acceptTerms: true, termsVersion: '2026-08-13' }).expect(200);
    const again = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(again.termsVersion).toBe('2026-08-13');
    expect(again.termsAcceptedAt).not.toBeNull();
    expect(again.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(
      first.termsAcceptedAt!.getTime(),
    );
  });

  it('rejects a version string that is not a real version', async () => {
    const user = await newUser();
    for (const bad of ['', ' ', 'x'.repeat(200)]) {
      await patch(user.token, { acceptTerms: true, termsVersion: bad }).expect(400);
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.termsAcceptedAt).toBeNull();
  });

  it('needs a session — consent cannot be recorded anonymously', async () => {
    await request(server())
      .patch('/me')
      .send({ acceptTerms: true, termsVersion: '2026-08-13' })
      .expect(401);
  });
});
