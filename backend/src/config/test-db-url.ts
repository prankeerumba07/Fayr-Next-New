/**
 * WHICH DATABASE THE E2E SUITE IS ALLOWED TO WIPE.
 *
 * The e2e suite truncates every table before each spec, so the question of which
 * database it points at is not a convenience — it is the difference between a
 * clean run and someone's afternoon.
 *
 * It used to answer that question with a hard-coded default. That was fine while
 * there was one checkout. There are now two on this machine sharing one Postgres
 * — the copy frozen for a demo, and the copy work continues on — and a
 * hard-coded default means a run started in either one reaches for the same
 * database, whatever that checkout's own configuration says.
 *
 * So the rule is: an explicit TEST_DATABASE_URL wins, otherwise the test
 * database is derived from THIS checkout's own dev database by renaming the
 * trailing `_dev` to `_test`. A name that cannot be turned into a `_test` name is
 * a hard stop rather than a guess, because the cost of guessing wrong is a wiped
 * database.
 */
export class TestDbError extends Error {}

const DB_IN_URL = /\/([^/?]+)(\?|$)/;

export function resolveTestDatabaseUrl(env: {
  TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
}): string {
  const explicit = env.TEST_DATABASE_URL?.trim();
  if (explicit) return assertTestDatabase(explicit, 'TEST_DATABASE_URL');

  const dev = env.DATABASE_URL?.trim();
  if (!dev) {
    throw new TestDbError(
      'E2E refuses to run: neither TEST_DATABASE_URL nor DATABASE_URL is set, '
        + 'so there is no way to know which database it would be wiping.',
    );
  }

  const name = DB_IN_URL.exec(dev)?.[1];
  if (!name) {
    throw new TestDbError(
      `E2E refuses to run: no database name could be read from DATABASE_URL ("${dev}").`,
    );
  }
  const testName = name.endsWith('_test')
    ? name
    : name.replace(/_dev$/, '_test');
  const derived = dev.replace(`/${name}`, `/${testName}`);
  return assertTestDatabase(derived, 'DATABASE_URL');
}

function assertTestDatabase(url: string, from: string): string {
  const name = DB_IN_URL.exec(url)?.[1];
  if (!name || !name.endsWith('_test')) {
    throw new TestDbError(
      `E2E refuses to run: ${from} resolves to "${name ?? url}", which is not a `
        + '_test database. The e2e suite truncates every table it can reach, so it '
        + 'only ever runs against a database whose name says it is disposable.',
    );
  }
  return url;
}
