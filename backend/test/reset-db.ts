import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * ONE RESET, FOR EVERY SUITE, COVERING EVERY TABLE.
 *
 * Each e2e spec used to carry its own hand-written TRUNCATE list, and the lists
 * had drifted badly — which is the whole reason the suite was intermittently
 * failing depending on the order it ran in:
 *
 *   consent            cleaned NOTHING at all
 *   campaign           2 tables
 *   ticket.ledger      2 tables
 *   auth               3 tables
 *   admin-audit/auth   4 tables
 *   wallet.ledger      4 tables
 *   me                 5 tables
 *   the widest list    14 tables — of NINETEEN
 *
 * So every suite tidied its own corner and then inherited whatever the others
 * had left behind. Five tables — otp_challenges, screenshot_uploads,
 * evidence_submissions, support_questions, support_replies — were cleaned by at
 * most one suite each, and the suites that assert GLOBAL aggregates (the admin
 * reports, the withdrawals queue) are the ones that noticed, because a stray row
 * from another spec lands directly in a count.
 *
 * The list is DERIVED, not written down. It comes from the database's own
 * catalogue at run time, so a table added by a migration tomorrow is covered the
 * moment that migration lands rather than the next time somebody remembers. A
 * hand-maintained list is exactly what produced the mess above — replacing it
 * with a longer hand-maintained list would only delay the next one.
 */

/** Discovered once per test process. Migrations run in globalSetup, before this. */
let cachedTables: string[] | null = null;

/**
 * The one table that must NEVER be truncated: it is how Prisma knows the schema
 * is applied. Wiping it would make the next `migrate deploy` try to replay every
 * migration against a database that already has the tables.
 */
const NEVER_TRUNCATE = new Set(['_prisma_migrations']);

/**
 * Refuse to touch anything that is not a test database.
 *
 * Inside the reset rather than beside it, so it cannot be the line somebody
 * forgets: every path that truncates goes through here first. Each suite keeps
 * its own rail as well — those also guard the direct writes a spec makes of its
 * own accord, which this function never sees.
 */
export async function assertTestDatabase(
  prisma: PrismaService,
): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    'SELECT current_database()',
  );
  const db = rows[0]?.current_database;
  if (!db || !db.endsWith('_test')) {
    throw new Error(
      `Refusing to reset: connected to non-test database "${db ?? 'unknown'}"`,
    );
  }
  return db;
}

/** Every table in the public schema, from the database's own catalogue. */
async function discoverTables(prisma: PrismaService): Promise<string[]> {
  if (cachedTables) return cachedTables;
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const tables = rows
    .map((r) => r.tablename)
    .filter((t) => !NEVER_TRUNCATE.has(t));
  if (tables.length === 0) {
    // A silent empty list would make every reset a no-op and every suite look
    // like it was leaking, which is a far worse failure than an error here.
    throw new Error(
      'Refusing to reset: no tables found in the public schema. Did globalSetup run the migrations?',
    );
  }
  cachedTables = tables;
  return tables;
}

/**
 * Truncate every table, in ONE statement.
 *
 * One statement matters: TRUNCATE across a set of tables with CASCADE resolves
 * their foreign keys together, so there is no ordering to get right and no
 * partially-reset state in between. RESTART IDENTITY resets sequences so a spec
 * asserting on a generated id sees the same numbers whatever ran before it.
 *
 * TRUNCATE, not DELETE, deliberately: the wallet ledger carries an append-only
 * DELETE trigger, and TRUNCATE fires ON TRUNCATE instead — it is the only way to
 * reset the ledger at all.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await assertTestDatabase(prisma);
  const tables = await discoverTables(prisma);
  const quoted = tables.map((t) => `"${t}"`).join(',');
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${quoted} RESTART IDENTITY CASCADE`,
  );
}

/** Exposed for the isolation guard, which asserts the list really is complete. */
export async function tablesCovered(prisma: PrismaService): Promise<string[]> {
  return discoverTables(prisma);
}
