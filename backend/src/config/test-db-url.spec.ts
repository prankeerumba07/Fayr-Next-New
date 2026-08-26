import { resolveTestDatabaseUrl, TestDbError } from './test-db-url';

/**
 * WHICH DATABASE THE E2E SUITE WIPES.
 *
 * This rule exists because there are now two checkouts of this project on one
 * machine — the frozen demo copy and the copy work continues on — sharing one
 * Postgres. The e2e suite truncates every table before each spec, so a run
 * started in one checkout must never be able to reach for the other's database.
 *
 * The old rule was a hard-coded default, which meant both checkouts pointed at
 * the same test database no matter what either one's configuration said.
 */
describe('resolveTestDatabaseUrl', () => {
  const url = (db: string): string =>
    `postgresql://fayr:fayr@localhost:5432/${db}?schema=public`;

  it('prefers an explicit TEST_DATABASE_URL over everything else', () => {
    expect(
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: url('one_test'),
        DATABASE_URL: url('two_dev'),
      }),
    ).toBe(url('one_test'));
  });

  it('otherwise derives the test database from this checkout\'s own dev one', () => {
    // The point of the whole exercise: a checkout configured for fayr_next_dev
    // gets fayr_next_test, not the other checkout's fayr_test.
    expect(resolveTestDatabaseUrl({ DATABASE_URL: url('fayr_next_dev') })).toBe(
      url('fayr_next_test'),
    );
    expect(resolveTestDatabaseUrl({ DATABASE_URL: url('fayr_dev') })).toBe(
      url('fayr_test'),
    );
  });

  it('leaves a dev URL that is already a test one alone', () => {
    expect(resolveTestDatabaseUrl({ DATABASE_URL: url('fayr_test') })).toBe(
      url('fayr_test'),
    );
  });

  it('keeps everything else about the URL — host, port, user, query', () => {
    const odd =
      'postgresql://someone:secret@10.0.0.9:6543/proj_dev?schema=public&connection_limit=1';
    expect(resolveTestDatabaseUrl({ DATABASE_URL: odd })).toBe(
      'postgresql://someone:secret@10.0.0.9:6543/proj_test?schema=public&connection_limit=1',
    );
  });

  it('REFUSES anything that would not end up on a _test database', () => {
    // The rail that matters. A name the rule cannot turn into a test database is
    // a stop, not a guess — the cost of guessing wrong is a wiped database.
    for (const bad of ['fayr_prod', 'production', 'fayr']) {
      expect(() => resolveTestDatabaseUrl({ DATABASE_URL: url(bad) })).toThrow(
        TestDbError,
      );
    }
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: url('live') }),
    ).toThrow(TestDbError);
  });

  it('refuses when there is nothing to work from at all', () => {
    expect(() => resolveTestDatabaseUrl({})).toThrow(TestDbError);
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: 'not-a-url' })).toThrow(
      TestDbError,
    );
  });
});
