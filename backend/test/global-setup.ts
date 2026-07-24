import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/**
 * Jest globalSetup for the e2e suite. Runs ONCE, before any spec, in the same
 * process as the tests (the suite runs --runInBand).
 *
 * It guarantees an isolated, migrated test database:
 *   1. Resolves the test DATABASE_URL (env override, else a local default) and
 *      REFUSES to proceed unless it targets a *_test database — so e2e can never
 *      wipe dev data.
 *   2. Creates that database if it doesn't exist (connecting to the maintenance
 *      DB), so no manual setup is needed locally.
 *   3. Applies all migrations with `prisma migrate deploy`.
 */
const DEFAULT_TEST_URL =
  'postgresql://fayr:fayr@localhost:5432/fayr_test?schema=public';

export default async function globalSetup(): Promise<void> {
  // Mark the environment as test BEFORE the app boots: this drives the pino
  // logger to silent and disables the rate limiter (see ThrottlerModule.skipIf).
  process.env.NODE_ENV = 'test';

  // Read a DEDICATED test var, not the ambient DATABASE_URL — so a dev shell
  // that happens to export DATABASE_URL (pointing at dev) can never divert the
  // e2e run onto the wrong database.
  const testUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_URL;

  // Hard safety rail: never run destructive e2e setup against a non-test DB.
  const dbName = /\/([^/?]+)(\?|$)/.exec(testUrl)?.[1];
  if (!dbName || !dbName.endsWith('_test')) {
    throw new Error(
      `E2E refuses to run: DATABASE_URL must target a *_test database (got "${dbName ?? testUrl}")`,
    );
  }
  process.env.DATABASE_URL = testUrl;

  // Ensure the database exists by connecting to the maintenance DB and creating
  // it if missing. CREATE DATABASE can't run in a transaction, so $executeRawUnsafe
  // (which issues a simple statement) is the right tool; an "already exists"
  // error is expected and ignored.
  const adminUrl = testUrl.replace(`/${dbName}`, '/postgres');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(message)) {
      await admin.$disconnect();
      throw err;
    }
  } finally {
    await admin.$disconnect();
  }

  // Apply migrations to the test database.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
