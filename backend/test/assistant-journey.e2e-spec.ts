import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantStore } from '../src/assistant/assistant.store';
import { UserJourneyService } from '../src/assistant/user-journey.service';
import { RECENT_STEP_LIMIT } from '../src/assistant/journey';
import { DEMO_MOBILE_DEFAULT, seedDemo } from '../prisma/demo-seed';
import { resetDatabase, tablesCovered } from './reset-db';

/**
 * WHAT THIS PERSON WAS DOING WHEN THEY ASKED — AGAINST REAL RECORDS.
 *
 * The sentences themselves are unit-tested next to the pure builder. What can only
 * be proved here is that the records it reads are the ones the app was already
 * writing, that a question gets its context without anybody remembering to ask
 * for it, and — the claim that matters most — that asking a question writes
 * NOTHING except the question. No new tracking means no new rows, and the only
 * honest way to say that is to count every table in the database before and after.
 *
 * The seeded accounts are the real demo catalogue: five journeys across Amazon,
 * Flipkart and Blinkit, with claims, refunds, held money and paid-out withdrawals.
 */
describe('Assistant journey (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: AssistantStore;
  let journey: UserJourneyService;

  const demoUser = async () => {
    const user = await prisma.user.findUnique({
      where: { mobile: process.env.DEMO_MOBILE ?? DEMO_MOBILE_DEFAULT },
    });
    if (!user) throw new Error('the demo seed did not create its own account');
    return user;
  };

  /** Every table and how many rows it holds, from the database's own catalogue. */
  async function rowCounts(): Promise<Record<string, number>> {
    const tables = await tablesCovered(prisma);
    const counts: Record<string, number> = {};
    for (const t of tables) {
      const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "${t}"`,
      );
      counts[t] = Number(row.n);
    }
    return counts;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    store = app.get(AssistantStore);
    journey = app.get(UserJourneyService);

    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    const db = rows[0]?.current_database;
    if (!db || !db.endsWith('_test')) {
      throw new Error(
        `Assistant journey e2e aborted: non-test database "${db}"`,
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedDemo(app, { quiet: true });
  });

  describe('reading records that already existed', () => {
    it('says what the person is in the middle of, in plain words', async () => {
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);

      expect(snapshot.nowDoing.length).toBeGreaterThan(0);
      const text = snapshot.nowDoing.join(' ');
      // A real offer, and a real stage — never the stored name of one.
      expect(text.length).toBeGreaterThan(20);
      for (const stateName of [
        'CLAIMED',
        'PURCHASED',
        'DELIVERED',
        'REVIEWED',
        'HOLDING',
        'REFUNDED',
      ]) {
        expect(text).not.toContain(stateName);
      }
    });

    it('finds the return-window wait the demo walks through', async () => {
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);
      expect(snapshot.nowDoing.join(' ')).toMatch(/return window/i);
    });

    it('carries the real balances', async () => {
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);

      const tickets = await prisma.ticketEntry.aggregate({
        where: { userId: user.id },
        _sum: { delta: true },
      });
      expect(snapshot.standing.ticketBalance).toBe(tickets._sum.delta ?? 0);
      // Money is always rupees on the way out. Never paise, never a bare number.
      expect(snapshot.standing.walletBalance).toMatch(/^₹|^-₹/);
    });

    it('shows steps from more than one record', async () => {
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);
      const sources = new Set(snapshot.recent.map((s) => s.from));
      expect(sources.size).toBeGreaterThan(1);
      expect(sources.has('task')).toBe(true);
    });

    it('says how many older steps it left out once there are too many', async () => {
      // This account has more history than a snapshot shows, so the oldest steps —
      // joining Fayr, the first tickets — are genuinely not in the list. Saying so
      // is the difference between a short list and a misleading one.
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);
      if (snapshot.recent.length === RECENT_STEP_LIMIT) {
        expect(snapshot.notIncluded.join(' ')).toMatch(
          /older steps are not shown/,
        );
      } else {
        expect(snapshot.recent.map((s) => s.from)).toContain('account');
      }
    });

    it('is honest about what it cannot see', async () => {
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);
      expect(snapshot.notIncluded.join(' ')).toMatch(/screens/i);
    });

    it('stays a readable length however much history there is', async () => {
      const user = await demoUser();
      const snapshot = await journey.snapshotFor(user.id);
      expect(snapshot.recent.length).toBeLessThanOrEqual(RECENT_STEP_LIMIT);
    });

    it('works for somebody who has done nothing at all', async () => {
      const fresh = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      const snapshot = await journey.snapshotFor(fresh.id);
      expect(snapshot.nowDoing).toEqual(['Nothing is in progress right now.']);
      expect(snapshot.recent).toHaveLength(1);
      expect(snapshot.recent[0].what).toMatch(/joined fayr/i);
      expect(snapshot.standing.hasWrittenInBefore).toBe(false);
    });

    it('refuses to invent a journey for an account that does not exist', async () => {
      await expect(
        journey.snapshotFor('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow();
    });
  });

  describe('keeping personal detail out of it', () => {
    it('never carries the mobile number or the PAN, even though the account has both', async () => {
      const user = await demoUser();
      // Proof the account really does hold them, so this is not a vacuous check.
      expect(user.mobile).toBeTruthy();
      expect(user.pan).toBeTruthy();

      const written = JSON.stringify(await journey.snapshotFor(user.id));
      expect(written).not.toContain(user.mobile);
      expect(written).not.toContain(user.mobile.replace('+91', ''));
      expect(written).not.toContain(user.pan!);
    });

    it('carries no long run of digits that could be an account or a card', async () => {
      const user = await demoUser();
      const written = JSON.stringify(await journey.snapshotFor(user.id));
      // Dates and identifiers are the only digits allowed, and neither runs long.
      const stripped = written.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '');
      expect(stripped).not.toMatch(/\d{9,}/);
    });
  });

  describe('asking a question writes nothing but the question', () => {
    /**
     * THE CLAIM. "Do not invent new tracking beyond what the app already knows" is
     * only true if asking a question leaves every other table exactly as it was.
     *
     * Run for an account with history AND for one with none, and the second is the
     * one with teeth: the wallet has a read path that CREATES an account as a side
     * effect, and an account that already has one would hide it completely. A test
     * that only used the demo account passed even when that method was swapped in.
     */
    async function onlyTheQuestionIsWritten(userId: string): Promise<void> {
      const before = await rowCounts();
      await store.recordQuestion({ userId, rawText: 'mera refund kab aayega' });
      const after = await rowCounts();
      const changed = Object.keys(after).filter((t) => after[t] !== before[t]);
      expect(changed).toEqual(['assistant_questions']);
      expect(after.assistant_questions - before.assistant_questions).toBe(1);
    }

    it('adds one row, to one table, and touches nothing else', async () => {
      await onlyTheQuestionIsWritten((await demoUser()).id);
    });

    it('and the same for an account that has no history to read', async () => {
      const fresh = await prisma.user.create({
        data: { mobile: `+9195${String(Date.now()).slice(-8)}` },
      });
      expect(
        await prisma.walletAccount.count({ where: { userId: fresh.id } }),
      ).toBe(0);
      await onlyTheQuestionIsWritten(fresh.id);
      // Still none. A read that quietly creates one would show up right here.
      expect(
        await prisma.walletAccount.count({ where: { userId: fresh.id } }),
      ).toBe(0);
    });

    it('captures the context without being asked to', async () => {
      const user = await demoUser();
      const q = await store.recordQuestion({
        userId: user.id,
        rawText: 'why is my money still not here',
      });

      const stored = q.journey as {
        nowDoing: string[];
        takenAt: string;
      } | null;
      expect(stored).not.toBeNull();
      expect(Array.isArray(stored!.nowDoing)).toBe(true);
      expect(stored!.nowDoing.length).toBeGreaterThan(0);
      expect(Date.parse(stored!.takenAt)).toBeGreaterThan(0);
    });

    it('uses a journey it is handed rather than taking its own', async () => {
      const user = await demoUser();
      const handed = { nowDoing: ['handed in by the caller'], recent: [] };
      const q = await store.recordQuestion({
        userId: user.id,
        rawText: 'anything',
        journey: handed,
      });
      expect(q.journey).toEqual(handed);
    });

    it('keeps the question even if the context cannot be read', async () => {
      // A question is what the whole thing learns from. Losing one because the
      // convenience attached to it failed would be the wrong trade every time.
      const user = await demoUser();
      const broken = jest
        .spyOn(journey, 'snapshotFor')
        .mockRejectedValue(new Error('pretend the read failed'));
      try {
        const q = await store.recordQuestion({
          userId: user.id,
          rawText: 'still has to be saved',
        });
        expect(q.id).toBeTruthy();
        expect(q.rawText).toBe('still has to be saved');
        expect(q.journey).toBeNull();
      } finally {
        broken.mockRestore();
      }
    });

    it('the stored snapshot is what the journey service would have produced', async () => {
      const user = await demoUser();
      const q = await store.recordQuestion({
        userId: user.id,
        rawText: 'test',
      });
      const live = await journey.snapshotFor(user.id);
      const stored = q.journey as { nowDoing: string[] };
      // takenAt differs by milliseconds; the substance must not.
      expect(stored.nowDoing).toEqual(live.nowDoing);
    });
  });
});
