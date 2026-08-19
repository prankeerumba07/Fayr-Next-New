import { HttpException, Logger as NestLogger, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../auth.service';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS } from '../auth.constants';
import { DevSmsSender } from './dev-sms-sender';
import { MessageCentralSmsSender } from './message-central-sms-sender';
import { TwilioSmsSender } from './twilio-sms-sender';
import { TwoFactorSmsSender } from './two-factor-sms-sender';
import type { SmsSender } from './sms-sender';

/**
 * Changing the postman must never change the locks.
 *
 * The cooldown, the attempt lock and the block check live in AuthService, ABOVE
 * the sender — so they are provider-independent BY CONSTRUCTION. This spec is the
 * guard on that: it runs identical scenarios through both senders and asserts
 * identical outcomes, so nobody can later "optimise" a rate limit down into a
 * provider and quietly weaken one route.
 */

const MOBILE = '+919876543210';

const ENV: Record<string, unknown> = {
  MESSAGECENTRAL_BASE_URL: 'https://cpaas.messagecentral.com',
  MESSAGECENTRAL_CUSTOMER_ID: 'C-TEST0001',
  MESSAGECENTRAL_PASSWORD_BASE64: 'cGFzc3dvcmQ=',
  MESSAGECENTRAL_EMAIL: 'dev@example.com',
  MESSAGECENTRAL_SENDER_ID: 'EXAMPL',
  MESSAGECENTRAL_COUNTRY_CODE: '91',
  MESSAGECENTRAL_MESSAGE_TYPE: 'TRANSACTION',
  MESSAGECENTRAL_TIMEOUT_MS: 15000,
  MESSAGECENTRAL_TOKEN_TTL_MINUTES: 30,
  TWOFACTOR_BASE_URL: 'https://2factor.in',
  TWOFACTOR_API_KEY: 'a1b2c3d4-5e6f-11ee-be56-0242ac120002',
  TWOFACTOR_TEMPLATE_NAME: '',
  TWOFACTOR_COUNTRY_CODE: '91',
  TWOFACTOR_NUMBER_FORMAT: 'e164',
  TWOFACTOR_TIMEOUT_MS: 15000,
  TWILIO_BASE_URL: 'https://api.twilio.com',
  TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  TWILIO_AUTH_TOKEN: 'f0e9d8c7b6a5f0e9d8c7b6a5f0e9d8c7',
  TWILIO_FROM_NUMBER: '+15550001111',
  TWILIO_MESSAGING_SERVICE_SID: '',
  TWILIO_COUNTRY_CODE: '91',
  TWILIO_TIMEOUT_MS: 15000,
};

/**
 * A provider response that always succeeds, re-installed for EVERY test because
 * jest.config sets clearMocks: a stub installed once would be wiped before the
 * second test, and the sender would then see `fetch` return undefined.
 */
function stubNetwork(): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({
          // Message Central's shape...
          responseCode: 200,
          token: 'jwt-token',
          data: { transactionId: 'txn-1', errorMessage: null },
          // ...2Factor's...
          Status: 'Success',
          Details: 'session-id',
          // ...and Twilio's, so one stub satisfies every sender.
          sid: 'SM0123456789abcdef',
          status: 'queued',
          error_code: null,
        }),
      ),
  }) as never;
}

function makeSender(name: string): SmsSender {
  const config = { get: (k: string) => ENV[k] } as never;
  if (name === 'dev') return new DevSmsSender();
  if (name === '2factor') return new TwoFactorSmsSender(config);
  if (name === 'twilio') return new TwilioSmsSender(config);
  return new MessageCentralSmsSender(config);
}

function build(sms: SmsSender) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    otpChallenge: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const tokens = { issueTokens: jest.fn().mockResolvedValue({}) };
  const tickets = { grantSignup: jest.fn().mockResolvedValue({}) };
  const service = new AuthService(
    prisma as never,
    tokens as never,
    tickets as never,
    sms as never,
  );
  return { service, prisma };
}

describe.each([['dev'], ['messagecentral'], ['2factor'], ['twilio']])(
  'security behaviour is identical — sender: %s',
  (name) => {
    let sms: SmsSender;
    beforeEach(() => {
      stubNetwork();
      sms = makeSender(name);
    });

    it('applies the per-number cooldown, and does not reach the sender at all', async () => {
      const spy = jest.spyOn(sms, 'sendOtp');
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue({ createdAt: new Date() });

      const err = await service.requestOtp(MOBILE).catch((e: HttpException) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      const body = (err as HttpException).getResponse() as { resendInSeconds: number };
      expect(body.resendInSeconds).toBeGreaterThan(0);
      expect(body.resendInSeconds).toBeLessThanOrEqual(OTP_RESEND_COOLDOWN_SECONDS);
      // The rate limit is decided BEFORE any provider is involved.
      expect(spy).not.toHaveBeenCalled();
    });

    it('locks the challenge after exactly the same number of wrong attempts', async () => {
      const { service, prisma } = build(sms);
      const codeHash = await argon2.hash('483920');

      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: OTP_MAX_ATTEMPTS - 1,
        consumedAt: null,
      });
      await expect(service.verifyOtp(MOBILE, '000000')).rejects.toThrow(UnauthorizedException);

      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: OTP_MAX_ATTEMPTS,
        consumedAt: null,
      });
      const locked = await service.verifyOtp(MOBILE, '483920').catch((e: Error) => e);
      // Even the CORRECT code is refused once the lock has tripped.
      expect(locked).toBeInstanceOf(UnauthorizedException);
      expect((locked as Error).message).toMatch(/Too many attempts/);
    });

    it('sends exactly one code per accepted request — never two', async () => {
      const spy = jest.spyOn(sms, 'sendOtp');
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      await service.requestOtp(MOBILE);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('issues a 6-digit numeric code, whichever sender carries it', async () => {
      const spy = jest.spyOn(sms, 'sendOtp');
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      await service.requestOtp(MOBILE);
      expect(String(spy.mock.calls[0][1])).toMatch(/^\d{6}$/);
    });

    it('sends NOTHING for a BLOCKED account — the block sits above the sender', async () => {
      // This test is the one the docblock above always claimed existed and did
      // not. Without it, requestOtp loaded the user row, threw away `status`, and
      // spent real SMS money on an account the fraud team had already blocked.
      const spy = jest.spyOn(sms, 'sendOtp');
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', mobile: MOBILE, status: 'BLOCKED' });

      await service.requestOtp(MOBILE);
      expect(spy).not.toHaveBeenCalled();
    });

    it('answers a BLOCKED account exactly as it answers a normal one', async () => {
      // Indistinguishable on purpose: a different status, body or error would turn
      // this endpoint into a way to discover which numbers are blocked.
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);

      prisma.user.findUnique.mockResolvedValue({ id: 'u1', mobile: MOBILE, status: 'ACTIVE' });
      const active = await service.requestOtp(MOBILE);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', mobile: MOBILE, status: 'BLOCKED' });
      const blocked = await service.requestOtp(MOBILE);

      expect(blocked).toEqual(active);
    });

    it('still writes the challenge for a BLOCKED account, so the cooldown applies', async () => {
      // Skipping the row would leave a blocked number free to hammer the endpoint,
      // and would make the two cases distinguishable by timing.
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', mobile: MOBILE, status: 'BLOCKED' });
      await service.requestOtp(MOBILE);
      expect(prisma.otpChallenge.create).toHaveBeenCalledTimes(1);
    });

    it('never names the number in the blocked-account log line', async () => {
      const lines: string[] = [];
      jest.spyOn(NestLogger.prototype, 'warn').mockImplementation(((...a: unknown[]) => {
        lines.push(a.map(String).join(' '));
      }) as never);
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', mobile: MOBILE, status: 'BLOCKED' });
      await service.requestOtp(MOBILE);
      expect(lines.join('\n')).not.toContain('9876543210');
    });

    it('stores only a HASH of the code, never the code itself', async () => {
      const { service, prisma } = build(sms);
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      await service.requestOtp(MOBILE);
      const written = prisma.otpChallenge.create.mock.calls[0][0].data as {
        codeHash: string;
      };
      expect(written.codeHash).toMatch(/^\$argon2/);
    });
  },
);
