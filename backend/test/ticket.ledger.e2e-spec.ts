import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TicketModule } from '../src/tickets/ticket.module';
import { TicketService } from '../src/tickets/ticket.service';
import { resetDatabase } from './reset-db';
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
    await resetDatabase(prisma);
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

  /**
   * A MANUAL CORRECTION — the only way tickets can be added outside the two
   * grants, and it exists for a real reason found on a real account: the signup
   * grant is idempotent per user FOR LIFE, so an account that has already spent
   * its 15 can never be re-granted. A demo seed pointed at such an account had no
   * way to fund the claims it needs to build, and failed on the first one.
   *
   * It is a posting like every other: append-only, floored at zero, serialized on
   * the user row, idempotent by key. What it is NOT is an edit — no prior row is
   * ever rewritten, which is the whole reason the ledger can be trusted.
   */
  describe('manual adjustment', () => {
    it('adds tickets on an account whose signup grant is already spent', async () => {
      const userId = await createUser();
      await tickets.grantSignup(userId);
      await tickets.deductForClaim(userId, newTaskId());
      await tickets.deductForClaim(userId, newTaskId());
      await tickets.deductForClaim(userId, newTaskId());
      expect(await tickets.getBalance(userId)).toBe(0);

      // The re-grant that cannot work. This is not a bug to fix — one signup, one
      // grant — it is the reason an adjustment has to exist.
      await tickets.grantSignup(userId);
      expect(await tickets.getBalance(userId)).toBe(0);

      const entry = await tickets.adjust(userId, 15, `test:baseline:${userId}`);
      expect(entry.reason).toBe('ADJUSTMENT');
      expect(entry.delta).toBe(15);
      expect(entry.balanceAfter).toBe(15);
      expect(await tickets.getBalance(userId)).toBe(15);
    });

    it('is idempotent by key — a replay returns the same row and posts nothing', async () => {
      const userId = await createUser();
      const key = `test:replay:${userId}`;
      const first = await tickets.adjust(userId, 7, key);
      const again = await tickets.adjust(userId, 7, key);
      expect(again.id).toBe(first.id);
      expect(await tickets.getBalance(userId)).toBe(7);
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(1);

      // A DIFFERENT amount under the same key is still the same posting. The key
      // is the identity of the event, not a hash of its contents.
      const third = await tickets.adjust(userId, 99, key);
      expect(third.id).toBe(first.id);
      expect(await tickets.getBalance(userId)).toBe(7);
    });

    it('can take tickets away, and still cannot go below zero', async () => {
      const userId = await createUser();
      await tickets.grantSignup(userId); // 15
      await tickets.adjust(userId, -5, `test:down:${userId}`);
      expect(await tickets.getBalance(userId)).toBe(10);

      await expect(
        tickets.adjust(userId, -11, `test:toofar:${userId}`),
      ).rejects.toBeInstanceOf(InsufficientTicketsError);
      expect(await tickets.getBalance(userId)).toBe(10);
      // And nothing was written on the way to being refused.
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(2);
    });

    it('refuses a delta that is not a non-zero whole number', async () => {
      const userId = await createUser();
      for (const bad of [0, 1.5, -0.5, NaN, Infinity]) {
        await expect(
          tickets.adjust(userId, bad, `test:bad${bad}:${userId}`),
        ).rejects.toBeInstanceOf(TicketError);
      }
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(0);
    });

    it('refuses an empty key, because an unkeyed correction can double-post', async () => {
      const userId = await createUser();
      for (const bad of ['', '   ']) {
        await expect(tickets.adjust(userId, 5, bad)).rejects.toBeInstanceOf(
          TicketError,
        );
      }
      expect(await prisma.ticketEntry.count({ where: { userId } })).toBe(0);
    });

    it('rejects an adjustment for a user that does not exist', async () => {
      await expect(
        tickets.adjust(newTaskId(), 5, 'test:phantom'),
      ).rejects.toBeInstanceOf(TicketError);
    });

    it('leaves every earlier row exactly as it was — a correction is a new row', async () => {
      const userId = await createUser();
      const signup = await tickets.grantSignup(userId);
      await tickets.adjust(userId, 5, `test:untouched:${userId}`);
      const after = await prisma.ticketEntry.findUniqueOrThrow({
        where: { id: signup.id },
      });
      expect(after.delta).toBe(15);
      expect(after.balanceAfter).toBe(15);
      expect(after.reason).toBe('SIGNUP_GRANT');
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
