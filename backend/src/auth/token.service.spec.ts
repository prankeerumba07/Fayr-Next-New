import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';

/**
 * Pure unit tests: JwtService, ConfigService, and PrismaService are all mocked,
 * so these run with no database and no real signing. They pin the security
 * behaviour of the refresh-token lifecycle — hashing, rotation, reuse detection.
 */

const CONFIG: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: 30,
};

function makeConfig() {
  return { get: (key: string) => CONFIG[key] };
}

function makeJwt() {
  return { signAsync: jest.fn().mockResolvedValue('signed.access.jwt') };
}

/** A Prisma double with just the methods TokenService touches. */
function makePrisma() {
  return {
    refreshToken: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // Runs the callback against a transaction client that reuses the same mocks.
    $transaction: jest.fn(),
  };
}

function build() {
  const jwt = makeJwt();
  const prisma = makePrisma();
  const service = new TokenService(
    jwt as never,
    makeConfig() as never,
    prisma as never,
  );
  return { service, jwt, prisma };
}

const future = () => new Date(Date.now() + 3_600_000);
const past = () => new Date(Date.now() - 1_000);

describe('TokenService', () => {
  describe('hashToken', () => {
    it('is deterministic, 64-hex, and never equals the input', () => {
      const { service } = build();
      const a = service.hashToken('the-token');
      const b = service.hashToken('the-token');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toBe('the-token');
    });
  });

  describe('issueTokens', () => {
    it('stores only the HASH of the refresh token, never the plaintext', async () => {
      const { service, prisma } = build();
      const result = await service.issueTokens({
        id: 'u1',
        mobile: '+919876543210',
      });

      expect(result.accessToken).toBe('signed.access.jwt');
      expect(result.tokenType).toBe('Bearer');
      expect(result.refreshToken).toBeTruthy();

      const arg = prisma.refreshToken.create.mock.calls[0][0];
      // The row holds the hash of the plaintext we handed back — and not the
      // plaintext itself.
      expect(arg.data.tokenHash).toBe(service.hashToken(result.refreshToken));
      expect(arg.data.tokenHash).not.toBe(result.refreshToken);
      expect(arg.data.userId).toBe('u1');
      expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('rotateRefreshToken', () => {
    it('rejects an unknown token', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotateRefreshToken('nope')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rotates an active token: revokes the old, issues a new pair', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: future(),
        user: { id: 'u1', mobile: '+919876543210', status: 'ACTIVE' },
      });
      const tx = {
        refreshToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      prisma.$transaction.mockImplementation(
        (cb: (client: typeof tx) => unknown) => cb(tx),
      );

      const result = await service.rotateRefreshToken('presented-token');

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(result.refreshToken).toBeTruthy();
      expect(result.accessToken).toBe('signed.access.jwt');
    });

    it('detects reuse of an already-revoked token and nukes all sessions', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        revokedAt: new Date(),
        expiresAt: future(),
        user: { id: 'u1', mobile: '+919876543210', status: 'ACTIVE' },
      });

      await expect(
        service.rotateRefreshToken('stolen-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Every active token for the user is revoked as a theft response.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects an expired token', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: past(),
        user: { id: 'u1', mobile: '+919876543210', status: 'ACTIVE' },
      });
      await expect(
        service.rotateRefreshToken('expired-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a blocked user', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: future(),
        user: { id: 'u1', mobile: '+919876543210', status: 'BLOCKED' },
      });
      await expect(service.rotateRefreshToken('token')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('treats a lost rotation race as reuse and revokes all sessions', async () => {
      const { service, prisma } = build();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: future(),
        user: { id: 'u1', mobile: '+919876543210', status: 'ACTIVE' },
      });
      // The conditional revoke matches 0 rows — another request already rotated.
      const tx = {
        refreshToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({}),
        },
      };
      prisma.$transaction.mockImplementation(
        (cb: (client: typeof tx) => unknown) => cb(tx),
      );

      await expect(
        service.rotateRefreshToken('racing-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tx.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeRefreshToken', () => {
    it('revokes by hash and is scoped to still-active rows', async () => {
      const { service, prisma } = build();
      await service.revokeRefreshToken('logout-token');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: service.hashToken('logout-token'),
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
