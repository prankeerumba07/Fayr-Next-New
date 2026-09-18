import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from './auth.constants';

/**
 * Unit tests with Prisma, TokenService, and the SMS sender all mocked. argon2 is
 * used FOR REAL so the hash/verify path is exercised end to end — a handful of
 * real hashes, well within the default timeout.
 */

const MOBILE = '+919876543210';

function makePrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    otpChallenge: {
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeTokens() {
  return {
    issueTokens: jest.fn().mockResolvedValue({
      accessToken: 'access.jwt',
      refreshToken: 'refresh-plain',
      tokenType: 'Bearer',
      accessTokenExpiresIn: '15m',
    }),
  };
}

function makeSms() {
  return { sendOtp: jest.fn().mockResolvedValue(undefined) };
}

function makeTickets() {
  return { grantSignup: jest.fn().mockResolvedValue({}) };
}

/**
 * The measurement double.
 *
 * Here so the funnel steps auth records can be ASSERTED, not merely tolerated.
 * The rule that a blocked account never appears in the funnel is a rule about
 * this service, and a stub nobody looks at would let it rot silently.
 */
function makeEvents() {
  return {
    record: jest.fn().mockResolvedValue(true),
    recordOnce: jest.fn().mockResolvedValue(true),
  };
}

function build() {
  const prisma = makePrisma();
  const tokens = makeTokens();
  const tickets = makeTickets();
  const sms = makeSms();
  const events = makeEvents();
  const service = new AuthService(
    prisma as never,
    tokens as never,
    tickets as never,
    events as never,
    sms as never,
  );
  return { service, prisma, tokens, tickets, sms, events };
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1_000);

describe('AuthService', () => {
  describe('requestOtp', () => {
    it('issues a hashed code and sends it, returning the policy timings', async () => {
      const { service, prisma, sms } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue(null); // no recent challenge
      prisma.user.findUnique.mockResolvedValue(null); // brand-new number

      const result = await service.requestOtp(MOBILE);

      expect(result).toEqual({
        expiresInSeconds: OTP_TTL_SECONDS,
        resendInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      });

      // The code was sent...
      expect(sms.sendOtp).toHaveBeenCalledTimes(1);
      const sentCode = sms.sendOtp.mock.calls[0][1] as string;
      expect(sentCode).toMatch(/^\d{6}$/);

      // ...and the STORED value is an argon2 hash that verifies against it —
      // never the plaintext code.
      const storedHash = prisma.otpChallenge.create.mock.calls[0][0].data
        .codeHash as string;
      expect(storedHash.startsWith('$argon2')).toBe(true);
      expect(storedHash).not.toContain(sentCode);
      await expect(argon2.verify(storedHash, sentCode)).resolves.toBe(true);
    });

    it('enforces the resend cooldown and does not send again', async () => {
      const { service, prisma, sms } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        createdAt: new Date(), // just now → inside cooldown
      });

      await expect(service.requestOtp(MOBILE)).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(sms.sendOtp).not.toHaveBeenCalled();
      expect(prisma.otpChallenge.create).not.toHaveBeenCalled();
    });

    it('generates a genuinely new random code on every request — a resend never repeats the previous code', async () => {
      const { service, prisma, sms } = build();
      // No recent challenge -> the cooldown never blocks, so each call issues a
      // code (this is exactly the resend path once the cooldown has elapsed).
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      // Three back-to-back requests for the SAME number.
      await service.requestOtp(MOBILE);
      await service.requestOtp(MOBILE);
      await service.requestOtp(MOBILE);

      const codes = sms.sendOtp.mock.calls.map((c) => c[1] as string);
      expect(codes).toHaveLength(3);
      codes.forEach((c) => expect(c).toMatch(/^\d{6}$/));
      // Each request draws a fresh code from the CSPRNG, so the codes differ —
      // proof the code is regenerated per request, never reused from the last one.
      expect(new Set(codes).size).toBe(3);
    });
  });

  describe('verifyOtp', () => {
    it('rejects when there is no pending challenge', async () => {
      const { service, prisma } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      await expect(service.verifyOtp(MOBILE, '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an expired challenge', async () => {
      const { service, prisma } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: past(),
        attempts: 0,
        consumedAt: null,
      });
      await expect(service.verifyOtp(MOBILE, '123456')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('locks after too many attempts', async () => {
      const { service, prisma } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: future(),
        attempts: OTP_MAX_ATTEMPTS,
        consumedAt: null,
      });
      await expect(service.verifyOtp(MOBILE, '123456')).rejects.toThrow(
        'Too many attempts',
      );
    });

    it('increments attempts and rejects on a wrong code', async () => {
      const { service, prisma, tokens } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('111111'),
        expiresAt: future(),
        attempts: 1,
        consumedAt: null,
      });

      await expect(service.verifyOtp(MOBILE, '222222')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { attempts: { increment: 1 } },
      });
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('consumes the challenge and mints a session on the correct code', async () => {
      const { service, prisma, tokens } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: future(),
        attempts: 0,
        consumedAt: null,
      });
      prisma.user.upsert.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'ACTIVE',
      });

      const result = await service.verifyOtp(MOBILE, '123456');

      expect(result.user).toEqual({ id: 'u1', mobile: MOBILE });
      expect(result.accessToken).toBe('access.jwt');
      expect(result.refreshToken).toBe('refresh-plain');

      // The challenge is consumed (single-use)...
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { consumedAt: expect.any(Date), userId: 'u1' },
      });
      // ...and exactly one session was minted.
      expect(tokens.issueTokens).toHaveBeenCalledTimes(1);
    });

    it('rejects a blocked user but still consumes the code, minting nothing', async () => {
      const { service, prisma, tokens } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: future(),
        attempts: 0,
        consumedAt: null,
      });
      prisma.user.upsert.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'BLOCKED',
      });

      await expect(service.verifyOtp(MOBILE, '123456')).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      // The correct code is burned even for a blocked account, so it can't be
      // retried, and no token is issued.
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { consumedAt: expect.any(Date), userId: 'u1' },
      });
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });
  });


  // ── WHAT GOES INTO THE FUNNEL, AND WHAT MUST NOT ──────────────────────────
  //
  // These are rules about the SHAPE of a number a director will read off a
  // dashboard, so they are asserted rather than left to a stub nobody checks.
  describe('what it records for the funnel', () => {
    it('counts a code request only once a code has actually gone out', async () => {
      const { service, prisma, events } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestOtp(MOBILE);

      expect(events.record).toHaveBeenCalledWith({
        type: 'OTP_REQUESTED',
        userId: null,
      });
    });

    it('does NOT count a blocked account as having asked for a code', async () => {
      // A blocked account is returned to before any SMS is sent. Counting it
      // would put somebody in the funnel who was never going to receive a code,
      // which shows up later as delivery getting quietly worse.
      const { service, prisma, events } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'BLOCKED',
      });

      await service.requestOtp(MOBILE);

      expect(events.record).not.toHaveBeenCalled();
    });

    it('separates somebody signing up from somebody coming back', async () => {
      const { service, prisma, events } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: future(),
        attempts: 0,
        consumedAt: null,
      });
      // Nobody with this number yet, so the verification creates the account.
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.upsert.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'ACTIVE',
      });

      await service.verifyOtp(MOBILE, '123456');

      expect(events.record).toHaveBeenCalledWith({
        type: 'OTP_VERIFIED',
        userId: 'u1',
        payload: { created: true },
      });
      expect(events.record).toHaveBeenCalledWith({
        type: 'ACCOUNT_CREATED',
        userId: 'u1',
      });
    });

    it('does not count a returning person as a new account', async () => {
      const { service, prisma, events } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: future(),
        attempts: 0,
        consumedAt: null,
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.upsert.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'ACTIVE',
      });

      await service.verifyOtp(MOBILE, '123456');

      expect(events.record).toHaveBeenCalledWith({
        type: 'OTP_VERIFIED',
        userId: 'u1',
        payload: { created: false },
      });
      const kinds = events.record.mock.calls.map((c) => c[0].type);
      expect(kinds).not.toContain('ACCOUNT_CREATED');
    });

    it('does NOT count a blocked account as having got in', async () => {
      const { service, prisma, events } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue({
        id: 'c1',
        codeHash: await argon2.hash('123456'),
        expiresAt: future(),
        attempts: 0,
        consumedAt: null,
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.upsert.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'BLOCKED',
      });

      await expect(service.verifyOtp(MOBILE, '123456')).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      const kinds = events.record.mock.calls.map((c) => c[0].type);
      expect(kinds).not.toContain('OTP_VERIFIED');
      expect(kinds).not.toContain('ACCOUNT_CREATED');
    });

    it('never puts a mobile number into a recorded step', async () => {
      // This table is read by dashboards and exported into spreadsheets, which
      // is exactly the journey that turns a column into a leak.
      const { service, prisma, events } = build();
      prisma.otpChallenge.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      await service.requestOtp(MOBILE);

      const written = JSON.stringify(events.record.mock.calls);
      expect(written).not.toContain(MOBILE);
      expect(written).not.toContain('9876543210');
    });
  });

  describe('getMe', () => {
    it('returns the principal for an active user', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'ACTIVE',
      });
      await expect(service.getMe('u1')).resolves.toEqual({
        id: 'u1',
        mobile: MOBILE,
      });
    });

    it('rejects a blocked user', async () => {
      const { service, prisma } = build();
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        mobile: MOBILE,
        status: 'BLOCKED',
      });
      await expect(service.getMe('u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
