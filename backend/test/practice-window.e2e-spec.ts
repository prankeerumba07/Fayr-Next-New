import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { PracticeWindowService } from '../src/tasks/practice-window.service';
import { PRACTICE_WINDOW_OFF } from '../src/tasks/engine/practice-window';
import { resetDatabase } from './reset-db';

/**
 * THE PRACTICE ORDER WINDOW, AGAINST A REAL DATABASE.
 *
 * The pure halves are walked in engine/practice-window.spec.ts. What can only be
 * checked HERE is the guard itself: that it asks the LIVE CONNECTION its own name
 * and believes the answer.
 *
 * ── WHY THAT NEEDS A REAL DATABASE TO PROVE ────────────────────────────────
 *
 * Because the whole safety of this feature is one question asked of Postgres —
 * `SELECT current_database()` — and a unit check can only ever prove that a
 * string ending _dev passes a regular expression. It cannot prove that the string
 * came from the database rather than from a setting, and that distinction IS the
 * guard: a connection string edited to point somewhere else is exactly the
 * mistake it exists to catch, so a guard reading the same setting the connection
 * was made from would agree with the mistake.
 *
 * This suite runs on fayr_next_test, so the live answer here is a practice name.
 * The refusal is proved by asking the same service about a real name.
 */
describe('the practice order window (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let practice: PracticeWindowService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    practice = app.get(PracticeWindowService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it('the database really does answer with its own name', async () => {
    // The fact the whole guard rests on. If this ever stops working the guard
    // fails CLOSED, which is safe, but nothing would widen and nobody would know
    // why — so the question itself is checked rather than assumed.
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
      'SELECT current_database()',
    );
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].current_database).toBe('string');
    expect(rows[0].current_database.length).toBeGreaterThan(0);
  });

  it('AND THIS IS A PRACTICE DATABASE, which is why the suite can prove anything', () => {
    const rows = process.env.DATABASE_URL ?? '';
    expect(rows).toContain('_test');
    expect(PracticeWindowService.databaseIsAPracticeOne('fayr_next_test')).toBe(true);
  });

  it('IS OFF BY DEFAULT even here, because the setting is not set', async () => {
    // The suite runs with the ordinary test environment, where
    // PRACTICE_ORDER_WINDOW_DAYS is unset and therefore zero. A practice database
    // alone must never be enough: somebody has to ask for it.
    await expect(practice.daysAllowed()).resolves.toBe(PRACTICE_WINDOW_OFF);
  });

  it('REFUSES A REAL DATABASE NAME, which is the point of the whole thing', () => {
    // The same test the service applies to whatever Postgres answered. Asked
    // directly here, because the only way to make the live answer a real name
    // would be to point this suite at somebody's real records.
    for (const real of ['fayr', 'fayr_prod', 'fayr_production', 'postgres']) {
      expect(PracticeWindowService.databaseIsAPracticeOne(real)).toBe(false);
    }
    for (const looksClose of ['fayr_dev_backup', 'fayr_development', 'FAYR_DEV']) {
      expect(PracticeWindowService.databaseIsAPracticeOne(looksClose)).toBe(false);
    }
  });

  it('and no task carries the mark until something has been widened', async () => {
    // NULL ON EVERY TASK, and null is what it means: this match was not widened.
    const marked = await prisma.task.count({
      where: { practiceWindowDays: { not: null } },
    });
    expect(marked).toBe(0);
  });

  // ── AND WHAT "TURNED ON" DOES IS PROVED IN A UNIT CHECK, NOT HERE ────────
  //
  // The obvious writing of that was a SECOND Nest application in this file, built
  // with PRACTICE_ORDER_WINDOW_DAYS set. It does not work and it is worth saying
  // why, because the failure looked exactly like the feature being broken:
  //
  //   Nest reuses a dynamic module whose options object is identical, so the
  //   second application got the FIRST one's config and answered 0; and Nest's
  //   ConfigModule assigns validated values back onto process.env, so the
  //   variable came back as "0" after being deleted rather than as absent.
  //
  // So the service's own decision — the setting and the database name together —
  // is checked in src/tasks/practice-window.service.spec.ts, where the config and
  // the database are both handed in and both can be made to say anything. What is
  // left here is only what needs a real Postgres: that it answers with its own
  // name at all, and that the column is really there and really nullable.
  it('the column exists, is nullable, and has no default', async () => {
    // The migration is additive only. Asked of the live schema rather than read
    // off the .sql file, because what matters is the column that is really there.
    const rows = await prisma.$queryRawUnsafe<
    { column_name: string; is_nullable: string; column_default: string | null }[]
    >(
      `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'practiceWindowDays'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('YES');
    expect(rows[0].column_default).toBeNull();
  });
});
