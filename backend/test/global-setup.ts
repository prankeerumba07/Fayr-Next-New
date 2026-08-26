import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { config as loadEnvFile } from 'dotenv';
import { resolveTestDatabaseUrl } from '../src/config/test-db-url';

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

export default async function globalSetup(): Promise<void> {
  // Mark the environment as test BEFORE the app boots: this drives the pino
  // logger to silent and disables the rate limiter (see ThrottlerModule.skipIf).
  process.env.NODE_ENV = 'test';

  // Load this checkout's own .env before deciding anything. There are two
  // checkouts of this project on one machine now, sharing one Postgres, and a
  // run started in either must wipe only its own test database — see
  // src/config/test-db-url.ts. `override: false` so a variable already exported
  // in the shell still wins.
  loadEnvFile({ override: false });

  // An explicit TEST_DATABASE_URL wins; otherwise the name is derived from this
  // checkout's dev database. Either way it must end in _test, and the resolver
  // throws rather than guessing.
  const testUrl = resolveTestDatabaseUrl(process.env);
  const dbName = /\/([^/?]+)(\?|$)/.exec(testUrl)![1];
  process.env.DATABASE_URL = testUrl;
  console.log(`e2e database: ${dbName}`);

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
