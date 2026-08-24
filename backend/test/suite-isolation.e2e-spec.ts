import fs from 'node:fs';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase, tablesCovered } from './reset-db';

/**
 * THE SUITE MUST NOT DEPEND ON THE ORDER IT RUNS IN.
 *
 * Every e2e spec used to carry its own TRUNCATE list. The lists had drifted from
 * two tables to fourteen — of nineteen — and one suite cleaned nothing at all, so
 * each spec tidied its own corner and inherited whatever the others had left.
 * The victims were always the suites that assert GLOBAL aggregates, because a
 * stray row from an unrelated spec lands straight in a count.
 *
 * Re-running or reordering would have hidden that rather than fixed it. This is
 * the guard that keeps it fixed: the reset is derived from the database's own
 * catalogue, and no spec is allowed to write its own list again.
 */
describe('e2e suite isolation', () => {
  const dir = __dirname;
  const specs = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.e2e-spec.ts'))
    .filter((f) => f !== path.basename(__filename));

  it('has specs to check', () => {
    expect(specs.length).toBeGreaterThanOrEqual(19);
  });

  it('leaves the table list in ONE place — no spec writes its own', () => {
    // The defect, stated as a rule. A spec that truncates by hand is a spec whose
    // list will drift, and the drift is invisible until an unrelated suite starts
    // failing in a way that looks like a flake.
    // Matches the STATEMENT, not the word: two specs mention TRUNCATE in a
    // comment explaining the safety rail, and flagging those would train whoever
    // hits it to delete the comment rather than the list.
    const writesOwnList = /\$executeRawUnsafe\(\s*[`'"]\s*TRUNCATE|RESTART IDENTITY/i;
    const offenders = specs.filter((f) =>
      writesOwnList.test(fs.readFileSync(path.join(dir, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('resets between tests — every spec, not most of them', () => {
    // consent.e2e-spec.ts had no beforeEach at all, which is how a spec ends up
    // depending on the leftovers of whichever suite ran before it.
    const missing = specs.filter((f) => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      return !/beforeEach\([\s\S]*?resetDatabase\(/.test(src);
    });
    expect(missing).toEqual([]);
  });

  it('covers every table the database actually has', async () => {
    // Derived, not written down: this asserts the DERIVATION is complete rather
    // than asserting a list, so a table added by tomorrow's migration is covered
    // without this test being touched.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    try {
      const all = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      );
      const covered = await tablesCovered(prisma);
      const uncovered = all
        .map((r) => r.tablename)
        .filter((t) => t !== '_prisma_migrations')
        .filter((t) => !covered.includes(t));
      expect(uncovered).toEqual([]);
      // And the one table that must survive, because it is how Prisma knows the
      // schema is applied.
      expect(covered).not.toContain('_prisma_migrations');
      expect(covered.length).toBeGreaterThanOrEqual(19);
    } finally {
      await app.close();
    }
  });

  it('actually empties a table that no hand-written list ever cleaned', async () => {
    // otp_challenges was truncated by exactly ONE spec out of twenty. A row left
    // in it is a real leak: the OTP flow rate-limits and locks on prior
    // challenges, so a stale one can make a later suite's login behave
    // differently for reasons nothing in that suite can see.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const prisma = app.get(PrismaService);
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO otp_challenges ("id","mobile","codeHash","expiresAt","attempts","createdAt")
         VALUES (gen_random_uuid(), '+919999999999', 'x', now() + interval '5 minutes', 0, now())`,
      );
      const before = await prisma.otpChallenge.count();
      expect(before).toBeGreaterThan(0);
      await resetDatabase(prisma);
      expect(await prisma.otpChallenge.count()).toBe(0);
      // And the migration record survived, or the next run would try to replay
      // every migration against a database that already has the tables.
      const migrations = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        'SELECT count(*) AS n FROM _prisma_migrations',
      );
      expect(Number(migrations[0].n)).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('pins serial execution in the CONFIG, not only in the npm script', () => {
    // There is exactly one test database. Run two suites in parallel workers
    // against it and each one truncates the other's rows mid-test — which would
    // look like flakiness and be nothing of the kind. `--runInBand` in the npm
    // script gives that today, but a flag in a script is a flag somebody drops;
    // the config is what a stray `npx jest --config ...` also obeys.
    const config = JSON.parse(
      fs.readFileSync(path.join(dir, 'jest-e2e.json'), 'utf8'),
    ) as { maxWorkers?: number };
    expect(config.maxWorkers).toBe(1);
  });

  it('refuses to run against a database that is not a test database', async () => {
    // The rail lives INSIDE the reset, so it cannot be the line somebody forgets.
    const fake = {
      $queryRawUnsafe: () =>
        Promise.resolve([{ current_database: 'fayr_dev' }]),
      $executeRawUnsafe: () => {
        throw new Error('should never be reached');
      },
    } as unknown as PrismaService;
    await expect(resetDatabase(fake)).rejects.toThrow(/non-test database/i);
  });
});
