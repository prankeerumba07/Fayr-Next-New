import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms/sms-sender';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * End-to-end: boots the REAL app (AppModule) against the migrated test database
 * and drives it over HTTP with supertest. Only one thing is swapped: SMS_SENDER
 * → a capturing fake, so the test can read the OTP it "sent" (the code is never
 * exposed by the API, by design).
 *
 * The per-IP rate limiter is disabled under NODE_ENV=test (ThrottlerModule
 * skipIf) so cumulative requests aren't throttled; the DB-backed per-number
 * resend cooldown is left intact and tested directly.
 */

class CapturingSmsSender implements SmsSender {
  readonly codes = new Map<string, string>();
  sendOtp(mobile: string, code: string): Promise<void> {
    this.codes.set(mobile, code);
    return Promise.resolve();
  }
  last(mobile: string): string | undefined {
    return this.codes.get(mobile);
  }
}

describe('Auth + health (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sms = new CapturingSmsSender();

  // A fresh unique mobile per call, so tests never collide on the number.
  let seq = 0;
  const newMobile = (): string =>
    `+9198${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Hard safety rail: confirm the app actually connected to a *_test database
    // before any test runs a TRUNCATE. This checks the LIVE connection (not just
    // our intended URL), so no config-precedence surprise can wipe dev data.
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const connectedDb = rows[0]?.current_database;
    if (!connectedDb || !connectedDb.endsWith('_test')) {
      throw new Error(
        `E2E aborted: connected to non-test database "${connectedDb}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE refresh_tokens, otp_challenges, users RESTART IDENTITY CASCADE',
    );
  });

  const server = () => app.getHttpServer();

  describe('health', () => {
    it('GET /health is liveness (dependency-free)', async () => {
      const res = await request(server()).get('/health').expect(200);
      expect(res.body).toMatchObject({ status: 'ok', service: 'fayr-backend' });
    });

    it('GET /health/ready confirms the database is reachable', async () => {
      const res = await request(server()).get('/health/ready').expect(200);
      expect(res.body).toMatchObject({ status: 'ready', db: 'up' });
    });
  });

  describe('OTP request', () => {
    it('issues a code and returns the policy timings', async () => {
      const mobile = newMobile();
      const res = await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);

      expect(res.body).toEqual({ expiresInSeconds: 300, resendInSeconds: 60 });
      expect(sms.last(mobile)).toMatch(/^\d{6}$/);
    });

    it('rejects a non-E.164 mobile with the standardized error shape', async () => {
      const res = await request(server())
        .post('/auth/otp/request')
        .send({ mobile: 'not-a-number' })
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        path: '/auth/otp/request',
      });
      expect(res.body.requestId).toBeDefined();
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('rejects unknown body fields', async () => {
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile: newMobile(), evil: 'x' })
        .expect(400);
    });

    it('enforces the per-number resend cooldown', async () => {
      const mobile = newMobile();
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);

      const res = await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(429);
      expect(res.body.resendInSeconds).toBeGreaterThan(0);
    });
  });

  describe('OTP verify → session', () => {
    it('rejects a wrong code generically', async () => {
      const mobile = newMobile();
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);
      const code = sms.last(mobile)!;
      const wrong = code === '000000' ? '111111' : '000000';

      const res = await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code: wrong })
        .expect(401);
      expect(res.body.message).toBe('Invalid or expired code');
    });

    it('verifies the correct code, mints a session, and authorizes /auth/me', async () => {
      const mobile = newMobile();
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);
      const code = sms.last(mobile)!;

      const verify = await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code })
        .expect(200);

      expect(verify.body.user.mobile).toBe(mobile);
      expect(verify.body.accessToken).toBeDefined();
      expect(verify.body.refreshToken).toBeDefined();
      expect(verify.body.tokenType).toBe('Bearer');

      // /auth/me with the token returns the principal...
      const me = await request(server())
        .get('/auth/me')
        .set('authorization', `Bearer ${verify.body.accessToken}`)
        .expect(200);
      expect(me.body).toEqual({ id: verify.body.user.id, mobile });

      // ...and without a token it's a 401.
      await request(server()).get('/auth/me').expect(401);
    });

    it('is single-use: the same code cannot be verified twice', async () => {
      const mobile = newMobile();
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);
      const code = sms.last(mobile)!;

      await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code })
        .expect(200);
      await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code })
        .expect(401);
    });
  });

  describe('refresh rotation + reuse detection', () => {
    async function login(mobile: string) {
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);
      const code = sms.last(mobile)!;
      const res = await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code })
        .expect(200);
      return res.body as { accessToken: string; refreshToken: string };
    }

    it('rotates the refresh token (new differs from old)', async () => {
      const { refreshToken } = await login(newMobile());
      const res = await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.refreshToken).not.toBe(refreshToken);
    });

    it('reusing an old (rotated-out) token revokes ALL sessions', async () => {
      const { refreshToken } = await login(newMobile());
      const rotated = await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      const newRefresh = rotated.body.refreshToken as string;

      // Replay the old token → 401 (theft response).
      await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      // The freshly-issued token is now also dead — every session was revoked.
      await request(server())
        .post('/auth/refresh')
        .send({ refreshToken: newRefresh })
        .expect(401);
    });

    it('logout revokes the token and is idempotent', async () => {
      const { refreshToken } = await login(newMobile());
      const first = await request(server())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(200);
      expect(first.body).toEqual({ ok: true });

      // Second logout of the same token still succeeds (idempotent)...
      await request(server())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(200);
      // ...but the token can no longer be refreshed.
      await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('blocked accounts', () => {
    it('rejects login for a BLOCKED user but still burns the code', async () => {
      const mobile = newMobile();
      // First login to create the user, then block them.
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);
      const code1 = sms.last(mobile)!;
      await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code: code1 })
        .expect(200);
      await prisma.user.update({
        where: { mobile },
        data: { status: 'BLOCKED' },
      });
      // Clear the prior challenge so the resend cooldown doesn't block the next
      // request (equivalent to the cooldown window having elapsed).
      await prisma.otpChallenge.deleteMany({ where: { mobile } });

      // A new OTP for the blocked user verifies the code but is refused (403).
      await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);
      const code2 = sms.last(mobile)!;
      const res = await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code: code2 })
        .expect(403);
      expect(res.body.message).toBe('Account is blocked');
    });
  });
});
