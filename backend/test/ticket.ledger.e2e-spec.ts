import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketModule } from '../src/tickets/ticket.module';
import { TicketService } from '../src/tickets/ticket.service';
import {
  InsufficientTicketsError,
  TicketError,
} from '../src/tickets/ticket.types';

/**
 * Integration ("e2e") tests for the ticket ledger against a REAL Postgres. Like
 * the wallet, the ledger's guarantees (the non-negative floor under concurrency,
 * exact balances, idempotency, and the DB triggers) are only provable against
 * the database. Runs against the migrated `*_test` DB with the same safety rail.
 */
describe('Ticket ledger (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tickets: TicketService;

  let seq = 0;
  const newMobile = (): string =>
    `+9196${String(Date.now()).slice(-6)}${String(seq++).padStart(2, '0')}`;

  const createUser = async (): Promise<string> => {
    const user = await prisma.user.create({ data: { mobile: newMobile() } });
    return user.id;
  };

  // A fake task id; tasks aren't built until 1.5 and ticket_entries.taskId has no
  // FK to keep the ledger decoupled, so any uuid stands in here.
  let taskSeq = 0;
  const newTaskId = (): string =>
    `00000000-0000-4000-8000-${String(++taskSeq).padStart(12, '0')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, TicketModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tickets = app.get(TicketService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `Ticket e2e aborted: connected to non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "users","ticket_entries" RESTART IDENTITY CASCADE',
    );
  });

  describe('signup grant', () => {
    it('grants 15 tickets, once, idempotently', async () => {
      const userId = await createUser();
      const first = await tickets.grantSignup(userId);
      const second = await tickets.grantSignup(userId);

      expect(first.balanceAfter).toBe(15);
      expect(second.id).toBe(first.id); // no second grant
      expect(await tickets.getBalance(userId)).toBe(15);
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('claim consumes 5; completion returns 10 (net +5)', async () => {
      const userId = await createUser();
      const taskId = newTaskId();

      const grant = await tickets.grantSignup(userId);
      const claim = await tickets.deductForClaim(userId, taskId);
      const done = await tickets.grantCompletion(userId, taskId);

      // balanceAfter is exact at each step.
      expect(grant.balanceAfter).toBe(15);
      expect(claim.balanceAfter).toBe(10);
      expect(done.balanceAfter).toBe(20);
      expect(await tickets.getBalance(userId)).toBe(20);
    });

    it('returns exactly the claimed cost on expiry', async () => {
      const userId = await createUser();
      const taskId = newTaskId();

      await tickets.grantSignup(userId); // 15
      await tickets.deductForClaim(userId, taskId); // 10
      const back = await tickets.returnOnExpiry(userId, taskId); // 15

      expect(back.delta).toBe(5);
      expect(back.balanceAfter).toBe(15);
      expect(await tickets.getBalance(userId)).toBe(15);
    });

    it('a confirmed purchase consumes the claim permanently (no auto-return)', async () => {
      const userId = await createUser();
      const taskId = newTaskId();

      await tickets.grantSignup(userId); // 15
      await tickets.deductForClaim(userId, taskId); // 10 — stays 10 on purchase
      // There is deliberately no "purchase" ticket method: the −5 is consumed.
      expect(await tickets.getBalance(userId)).toBe(10);
    });

    it('honors a campaign-specific claim cost', async () => {
      const userId = await createUser();
      const taskId = newTaskId();
      await tickets.grantSignup(userId); // 15
      const claim = await tickets.deductForClaim(userId, taskId, 7); // cost 7
      expect(claim.balanceAfter).toBe(8);
      const back = await tickets.returnOnExpiry(userId, taskId); // returns 7
      expect(back.delta).toBe(7);
      expect(await tickets.getBalance(userId)).toBe(15);
    });
  });

  describe('idempotency', () => {
    it('never double-posts claim / completion / expiry', async () => {
      const userId = await createUser();
      const taskId = newTaskId();
      await tickets.grantSignup(userId);

      const c1 = await tickets.deductForClaim(userId, taskId);
      const c2 = await tickets.deductForClaim(userId, taskId);
      expect(c2.id).toBe(c1.id);

      const d1 = await tickets.grantCompletion(userId, taskId);
      const d2 = await tickets.grantCompletion(userId, taskId);
      expect(d2.id).toBe(d1.id);

      expect(await tickets.getBalance(userId)).toBe(20); // 15 −5 +10
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(3);
    });
  });

  describe('the zero floor', () => {
    it('refuses a claim the user cannot afford, and writes nothing', async () => {
      const userId = await createUser(); // balance 0, no signup grant
      const taskId = newTaskId();

      await expect(
        tickets.deductForClaim(userId, taskId),
      ).rejects.toBeInstanceOf(InsufficientTicketsError);
      expect(await tickets.getBalance(userId)).toBe(0);
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(0);
    });

    it('carries how many are available vs. required', async () => {
      const userId = await createUser();
      await tickets.grantSignup(userId); // 15
      await tickets.deductForClaim(userId, newTaskId()); // 10
      await tickets.deductForClaim(userId, newTaskId()); // 5
      await tickets.deductForClaim(userId, newTaskId()); // 0

      await tickets
        .deductForClaim(userId, newTaskId())
        .then(() => {
          throw new Error('expected rejection');
        })
        .catch((err: unknown) => {
          expect(err).toBeInstanceOf(InsufficientTicketsError);
          const e = err as InsufficientTicketsError;
          expect(e.available).toBe(0);
          expect(e.required).toBe(5);
        });
    });

    it('lets the balance reach exactly zero', async () => {
      const userId = await createUser();
      await tickets.grantSignup(userId); // 15
      await tickets.deductForClaim(userId, newTaskId(), 15); // → 0
      expect(await tickets.getBalance(userId)).toBe(0);
    });
  });

  describe('guardrails', () => {
    it('rejects a claim for a user that does not exist', async () => {
      const ghost = '00000000-0000-4000-8000-0000000000ff';
      await expect(
        tickets.deductForClaim(ghost, newTaskId()),
      ).rejects.toBeInstanceOf(TicketError);
    });

    it('cannot return tickets for a task that was never claimed', async () => {
      const userId = await createUser();
      await expect(
        tickets.returnOnExpiry(userId, newTaskId()),
      ).rejects.toBeInstanceOf(TicketError);
    });

    it('rejects a non-positive claim cost', async () => {
      const userId = await createUser();
      await tickets.grantSignup(userId);
      await expect(
        tickets.deductForClaim(userId, newTaskId(), 0),
      ).rejects.toBeInstanceOf(TicketError);
    });
  });

  describe('database guards (independent of the service)', () => {
    it('the deferred trigger rejects a commit that drives the balance negative', async () => {
      const userId = await createUser(); // balance 0
      await expect(
        prisma.ticketEntry.create({
          data: {
            userId,
            delta: -5,
            reason: 'CLAIM',
            balanceAfter: -5,
            idempotencyKey: 'raw-negative',
          },
        }),
      ).rejects.toThrow(/negative/i);
      expect(await tickets.getBalance(userId)).toBe(0);
    });

    it('blocks UPDATE and DELETE of a posted entry (append-only)', async () => {
      const userId = await createUser();
      const entry = await tickets.grantSignup(userId);

      await expect(
        prisma.ticketEntry.update({
          where: { id: entry.id },
          data: { delta: 999 },
        }),
      ).rejects.toThrow(/append-only/i);
      await expect(
        prisma.ticketEntry.delete({ where: { id: entry.id } }),
      ).rejects.toThrow(/append-only/i);

      expect(await tickets.getBalance(userId)).toBe(15);
    });
  });
});
