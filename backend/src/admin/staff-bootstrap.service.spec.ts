import * as argon2 from 'argon2';
import { StaffBootstrapService } from './staff-bootstrap.service';

/**
 * Pure unit tests for the env-driven bootstrap admin. Prisma is mocked; argon2
 * is real (so we can assert a genuine hash is stored, never the plaintext).
 * These pin the idempotency contract: create when absent, never overwrite.
 */

function makeConfig(vars: Record<string, unknown>) {
  return { get: (key: string) => vars[key] };
}

function makePrisma() {
  return {
    staffUser: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

function build(vars: Record<string, unknown>) {
  const prisma = makePrisma();
  const service = new StaffBootstrapService(
    prisma as never,
    makeConfig(vars) as never,
  );
  return { service, prisma };
}

const FULL = {
  STAFF_BOOTSTRAP_EMAIL: 'Admin@Fayr.local',
  STAFF_BOOTSTRAP_PASSWORD: 'a-strong-bootstrap-passphrase',
};

describe('StaffBootstrapService', () => {
  it('skips when the bootstrap env is not fully set', async () => {
    const { service, prisma } = build({
      STAFF_BOOTSTRAP_EMAIL: 'admin@fayr.local',
    }); // password missing
    expect(await service.ensureBootstrapAdmin()).toBe('skipped');
    expect(prisma.staffUser.findUnique).not.toHaveBeenCalled();
    expect(prisma.staffUser.create).not.toHaveBeenCalled();
  });

  it('creates an ADMIN with a normalized email and a real argon2 hash when absent', async () => {
    const { service, prisma } = build(FULL);
    prisma.staffUser.findUnique.mockResolvedValue(null);

    expect(await service.ensureBootstrapAdmin()).toBe('created');

    // Looked up by the NORMALIZED email...
    expect(prisma.staffUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'admin@fayr.local' },
    });
    const data = prisma.staffUser.create.mock.calls[0][0].data;
    expect(data.email).toBe('admin@fayr.local');
    expect(data.role).toBe('ADMIN');
    // Stores a hash, never the plaintext — and it actually verifies.
    expect(data.passwordHash).not.toBe(FULL.STAFF_BOOTSTRAP_PASSWORD);
    expect(data.passwordHash.startsWith('$argon2')).toBe(true);
    expect(
      await argon2.verify(data.passwordHash, FULL.STAFF_BOOTSTRAP_PASSWORD),
    ).toBe(true);
  });

  it('never overwrites an existing account (idempotent)', async () => {
    const { service, prisma } = build(FULL);
    prisma.staffUser.findUnique.mockResolvedValue({ id: 's1' });

    expect(await service.ensureBootstrapAdmin()).toBe('exists');
    expect(prisma.staffUser.create).not.toHaveBeenCalled();
  });

  it('treats a lost create race (P2002) as the account already existing', async () => {
    const { service, prisma } = build(FULL);
    prisma.staffUser.findUnique.mockResolvedValue(null);
    prisma.staffUser.create.mockRejectedValue({ code: 'P2002' });

    expect(await service.ensureBootstrapAdmin()).toBe('exists');
  });
});
