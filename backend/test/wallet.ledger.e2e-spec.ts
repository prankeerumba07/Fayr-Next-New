import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SYSTEM_ACCOUNT_IDS } from '../src/wallet/wallet.constants';
import { WalletModule } from '../src/wallet/wallet.module';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerError } from '../src/wallet/wallet.types';
import { resetDatabase } from './reset-db';

/**
 * Integration ("e2e") tests for the wallet ledger against a REAL Postgres — a
 * money ledger's guarantees (atomic double-entry, SUM balances, idempotency, and
 * the database triggers) are only meaningfully provable against the database, so
 * mocks would prove nothing here. Runs against the migrated `*_test` DB with the
 * same safety rail as the auth e2e.
 */
describe('Wallet ledger (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletService;

  let seq = 0;
  const newMobile = (): string =>
    `+9197${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    return user.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, WalletModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletService);

    // Same hard rail as auth e2e: never TRUNCATE a non-test database.
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `Wallet e2e aborted: connected to non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('postRefund', () => {
    it('credits the user from HOUSE with an exact, balanced double entry', async () => {
      const userId = await createUser();

      const txn = await wallet.postRefund({
        userId,
        amountPaise: 50000n,
        idempotencyKey: 'refund-1',
        referenceType: 'task',
        referenceId: 'task-abc',
      });

      // Two legs, summing to zero.
      expect(txn.entries).toHaveLength(2);
      expect(txn.entries.reduce((s, e) => s + e.amountPaise, 0n)).toBe(0n);
      expect(txn.kind).toBe('REFUND');

      // The user is up 50000 paise; HOUSE is down the same — money is conserved.
      expect(await wallet.getUserBalance(userId)).toBe(50000n);
      expect(await wallet.getBalance(SYSTEM_ACCOUNT_IDS.HOUSE)).toBe(-50000n);
    });

    it('is idempotent: the same key never posts twice', async () => {
      const userId = await createUser();

      const first = await wallet.postRefund({
        userId,
        amountPaise: 30000n,
        idempotencyKey: 'refund-dup',
      });
      const second = await wallet.postRefund({
        userId,
        amountPaise: 30000n,
        idempotencyKey: 'refund-dup',
      });

      expect(second.id).toBe(first.id);
      expect(await wallet.getUserBalance(userId)).toBe(30000n); // not 60000
      expect(await prisma.ledgerTransaction.count()).toBe(1);
      expect(await prisma.walletEntry.count()).toBe(2);
    });

    it('accumulates multiple distinct refunds', async () => {
      const userId = await createUser();
      await wallet.postRefund({
        userId,
        amountPaise: 20000n,
        idempotencyKey: 'r-a',
      });
      await wallet.postRefund({
        userId,
        amountPaise: 15000n,
        idempotencyKey: 'r-b',
      });
      expect(await wallet.getUserBalance(userId)).toBe(35000n);
    });

    it('rejects a non-positive refund amount', async () => {
      const userId = await createUser();
      await expect(
        wallet.postRefund({
          userId,
          amountPaise: 0n,
          idempotencyKey: 'r-zero',
        }),
      ).rejects.toBeInstanceOf(LedgerError);
      await expect(
        wallet.postRefund({
          userId,
          amountPaise: -1n,
          idempotencyKey: 'r-neg',
        }),
      ).rejects.toBeInstanceOf(LedgerError);
      // Nothing was written.
      expect(await prisma.ledgerTransaction.count()).toBe(0);
    });
  });

  describe('balances', () => {
    it('is zero for a user with no account yet', async () => {
      const userId = await createUser();
      expect(await wallet.getUserBalance(userId)).toBe(0n);
    });
  });

  describe('application-layer guards', () => {
    it('refuses an unbalanced post before writing anything', async () => {
      const userId = await createUser();
      const house = await wallet.ensureSystemAccount('HOUSE');
      const userAccount = await wallet.getOrCreateUserAccount(userId);

      await expect(
        wallet.post({
          kind: 'ADJUSTMENT',
          idempotencyKey: 'unbalanced-app',
          legs: [
            { accountId: house.id, amountPaise: -50000n },
            { accountId: userAccount.id, amountPaise: 40000n },
          ],
        }),
      ).rejects.toBeInstanceOf(LedgerError);

      expect(await prisma.ledgerTransaction.count()).toBe(0);
    });
  });

  describe('database guards (independent of the service)', () => {
    it('the deferred trigger rejects an unbalanced transaction at commit', async () => {
      const userId = await createUser();
      const house = await wallet.ensureSystemAccount('HOUSE');
      const userAccount = await wallet.getOrCreateUserAccount(userId);

      await expect(
        prisma.$transaction(async (tx) => {
          const t = await tx.ledgerTransaction.create({
            data: { kind: 'ADJUSTMENT', idempotencyKey: 'unbalanced-db' },
          });
          await tx.walletEntry.create({
            data: {
              transactionId: t.id,
              accountId: house.id,
              amountPaise: 100n,
            },
          });
          await tx.walletEntry.create({
            data: {
              transactionId: t.id,
              accountId: userAccount.id,
              amountPaise: 200n,
            },
          });
        }),
      ).rejects.toThrow(/unbalanced|must be 0/i);
    });

    it('the deferred trigger rejects a single-leg transaction', async () => {
      const house = await wallet.ensureSystemAccount('HOUSE');
      await expect(
        prisma.$transaction(async (tx) => {
          const t = await tx.ledgerTransaction.create({
            data: { kind: 'ADJUSTMENT', idempotencyKey: 'single-leg-db' },
          });
          await tx.walletEntry.create({
            data: {
              transactionId: t.id,
              accountId: house.id,
              amountPaise: 100n,
            },
          });
        }),
      ).rejects.toThrow(/at least 2/i);
    });

    it('blocks UPDATE and DELETE of a posted leg (append-only)', async () => {
      const userId = await createUser();
      const txn = await wallet.postRefund({
        userId,
        amountPaise: 12345n,
        idempotencyKey: 'immutable-leg',
      });
      const legId = txn.entries[0].id;

      await expect(
        prisma.walletEntry.update({
          where: { id: legId },
          data: { amountPaise: 1n },
        }),
      ).rejects.toThrow(/append-only/i);
      await expect(
        prisma.walletEntry.delete({ where: { id: legId } }),
      ).rejects.toThrow(/append-only/i);

      // And the transaction row itself is immutable.
      await expect(
        prisma.ledgerTransaction.update({
          where: { id: txn.id },
          data: { memo: 'x' },
        }),
      ).rejects.toThrow(/append-only/i);

      // The balance is intact after the blocked mutations.
      expect(await wallet.getUserBalance(userId)).toBe(12345n);
    });
  });

  describe('system accounts', () => {
    it('are singletons: ensure is idempotent and duplicates are refused', async () => {
      const a = await wallet.ensureSystemAccount('HOUSE');
      const b = await wallet.ensureSystemAccount('HOUSE');
      expect(b.id).toBe(a.id);
      expect(
        await prisma.walletAccount.count({ where: { kind: 'HOUSE' } }),
      ).toBe(1);

      // A second HOUSE with a different id is rejected by NULLS NOT DISTINCT.
      await expect(
        prisma.walletAccount.create({ data: { kind: 'HOUSE', userId: null } }),
      ).rejects.toThrow();
    });
  });
});
