import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms/sms-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './reset-db';

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
  /** How many were sent to each number, so "no new code" can be proved. */
  readonly sent = new Map<string, number>();
  sendOtp(mobile: string, code: string): Promise<void> {
    this.codes.set(mobile, code);
    this.sent.set(mobile, (this.sent.get(mobile) ?? 0) + 1);
    return Promise.resolve();
  }
  count(mobile: string): number {
    return this.sent.get(mobile) ?? 0;
  }
  last(mobile: string): string | undefined {
    return this.codes.get(mobile);
  }
  /** Forget a number, so a later assertion can prove nothing NEW was sent. */
  clear(mobile: string): void {
    this.codes.delete(mobile);
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
    await resetDatabase(prisma);
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

      expect(res.body).toEqual({ expiresInSeconds: 300, resendInSeconds: 30 });
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

  // ── the app remembers me until I log out ─────────────────────────────────
  describe('staying signed in until log out', () => {
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

    it('a stored refresh token alone is enough to get back in', async () => {
      // Closing the app and opening it again. The access token in memory is
      // gone; what came back off the keychain is the refresh token, and that on
      // its own has to be enough or the person is asked for a code again.
      const { refreshToken } = await login(newMobile());

      const reopened = await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(reopened.body.accessToken).toBeDefined();
      await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${reopened.body.accessToken}`)
        .expect(200);
    });

    it('and again, and again, so a long spell away does not sign anybody out', async () => {
      // Every renewal rotates, and each rotation has to leave a token that works
      // for the next one. A chain that breaks on the second link would sign
      // somebody out the second time they came back.
      let { refreshToken } = await login(newMobile());
      for (let time = 0; time < 5; time += 1) {
        const again = await request(server())
          .post('/auth/refresh')
          .send({ refreshToken })
          .expect(200);
        refreshToken = again.body.refreshToken as string;
        await request(server())
          .get('/auth/me')
          .set('Authorization', `Bearer ${again.body.accessToken}`)
          .expect(200);
      }
    });

    it('renewing quietly never asks for a code again', async () => {
      const mobile = newMobile();
      const { refreshToken } = await login(mobile);
      await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      // Nothing about a renewal issues a code. If it did, the person would get a
      // text message every fifteen minutes for as long as the app was open.
      expect(sms.count(mobile)).toBe(1);
    });

    it('LOG OUT ends it: the way back in is dead', async () => {
      const { refreshToken } = await login(newMobile());
      await request(server())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(200);

      // No renewal, so nothing can keep the session alive.
      await request(server())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('but the access token it was already holding lasts out its fifteen minutes', async () => {
      // WRITTEN DOWN BECAUSE IT IS TRUE, not because it is wanted. An access
      // token is checked by its signature and nothing else, so the server cannot
      // take one back without looking something up on every single request.
      //
      // It does not affect the person who pressed log out: the app deletes both
      // tokens from the keychain, so the app itself has nothing left to send.
      // What it means is that a copy of an access token taken off a device stays
      // good for the rest of its fifteen minutes. Making that not so is a real
      // change with a cost on every request, and it is Prakash's to decide.
      const { accessToken, refreshToken } = await login(newMobile());
      await request(server())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(200);

      await request(server())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('log out ends every renewal, not only the one it was given', async () => {
      // Somebody who renewed five times and then logged out must not have four
      // dead links and one live one.
      let { refreshToken } = await login(newMobile());
      const seen: string[] = [refreshToken];
      for (let time = 0; time < 3; time += 1) {
        const again = await request(server())
          .post('/auth/refresh')
          .send({ refreshToken })
          .expect(200);
        refreshToken = again.body.refreshToken as string;
        seen.push(refreshToken);
      }
      await request(server())
        .post('/auth/logout')
        .send({ refreshToken })
        .expect(200);

      for (const dead of seen) {
        await request(server())
          .post('/auth/refresh')
          .send({ refreshToken: dead })
          .expect(401);
      }
    });
  });

  describe('blocked accounts', () => {
    // The test that used to live here was called "rejects login for a BLOCKED user
    // but still burns the code", and it asserted that requesting a code for a
    // blocked number returned 200 AND delivered a code. That encoded a bug: the
    // block check sat only in verifyOtp, after delivery, so a blocked account could
    // spend real SMS money every cooldown window. Both properties are now tested
    // separately, and the delivery one is inverted.

    it('sends no code at all, and looks exactly like a normal request', async () => {
      const mobile = newMobile();
      await request(server()).post('/auth/otp/request').send({ mobile }).expect(200);
      const first = sms.last(mobile)!;
      await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code: first })
        .expect(200);
      await prisma.user.update({ where: { mobile }, data: { status: 'BLOCKED' } });
      // Clear the prior challenge so the resend cooldown doesn't refuse the next
      // request (equivalent to the cooldown window having elapsed).
      await prisma.otpChallenge.deleteMany({ where: { mobile } });
      sms.clear(mobile);

      const res = await request(server())
        .post('/auth/otp/request')
        .send({ mobile })
        .expect(200);

      // Nothing delivered — this is the defect being fixed.
      expect(sms.last(mobile)).toBeUndefined();
      // ...but indistinguishable from a normal success, so the endpoint cannot be
      // used to discover which numbers are blocked.
      expect(res.body).toEqual({
        expiresInSeconds: expect.any(Number),
        resendInSeconds: expect.any(Number),
      });
      // The challenge row is still written, so the cooldown applies identically.
      const rows = await prisma.otpChallenge.count({ where: { mobile } });
      expect(rows).toBe(1);
    });

    it('refuses a correct code, and consumes it, once the account is blocked', async () => {
      const mobile = newMobile();
      await request(server()).post('/auth/otp/request').send({ mobile }).expect(200);
      const code1 = sms.last(mobile)!;
      await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code: code1 })
        .expect(200);

      // Take the SECOND code while the account is still usable, then block — the
      // property under test is what verify does, not what request delivers.
      await prisma.otpChallenge.deleteMany({ where: { mobile } });
      await request(server()).post('/auth/otp/request').send({ mobile }).expect(200);
      const code2 = sms.last(mobile)!;
      await prisma.user.update({ where: { mobile }, data: { status: 'BLOCKED' } });

      const res = await request(server())
        .post('/auth/otp/verify')
        .send({ mobile, code: code2 })
        .expect(403);
      expect(res.body.message).toBe('Account is blocked');

      // Consumed regardless, so a correct code is strictly single-use even for a
      // blocked account — no replaying it if the block is later lifted.
      const challenge = await prisma.otpChallenge.findFirst({ where: { mobile } });
      expect(challenge!.consumedAt).not.toBeNull();
    });
  });
});
