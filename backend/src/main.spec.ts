import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A BOOT FAILURE THAT PRINTS NOTHING.
 *
 * main.ts promises the opposite in its own comment — "never a silent half-start"
 * — and it was not true. It boots with `bufferLogs: true`, swaps the logger for
 * pino, and pino writes through an asynchronous transport; `process.exit(1)` in
 * the catch then kills the process before that transport flushes. The message is
 * composed, logged, and lost.
 *
 * Found the hard way: the database was down, the backend exited 1, and there was
 * not one line of output anywhere to say why. Ten minutes went on a silent exit
 * code. On the morning of a demo that is the difference between "start Postgres"
 * and a room watching someone guess.
 *
 * So the fatal path also writes straight to stderr, synchronously, which nothing
 * can buffer or drop. A guard rather than a behaviour test because the failure
 * only happens in a real process at exit — a unit test cannot observe a lost
 * transport flush, but it can insist the synchronous channel is still there.
 */
describe('main.ts bootstrap failure path', () => {
  const src = readFileSync(join(__dirname, 'main.ts'), 'utf8');
  const fatal = src.slice(src.indexOf('bootstrap().catch('));

  it('writes the failure straight to stderr, not only through the logger', () => {
    expect(fatal).toMatch(/process\.stderr\.write/);
  });

  it('includes the reason and the stack in what it writes', () => {
    // A bare "Fatal error during bootstrap" with no cause is the same dead end as
    // no output at all.
    const write = /process\.stderr\.write\([\s\S]*?\);/.exec(fatal)?.[0] ?? '';
    // Whatever the local names are, both the cause and the stack have to reach the
    // stream — and both have to be DERIVED from the error, not hard-coded prose.
    expect(write).toMatch(/\$\{\s*reason\s*\}|\$\{[^}]*message[^}]*\}/);
    expect(write).toMatch(/stack/);
    expect(fatal).toMatch(/const reason = err instanceof Error \? err\.message/);
    expect(fatal).toMatch(/const stack = err instanceof Error \? err\.stack/);
  });

  it('still exits non-zero, so a supervisor sees the failure', () => {
    expect(fatal).toMatch(/process\.exit\(1\)/);
  });

  it('writes before it exits — the order is the whole point', () => {
    expect(fatal.indexOf('process.stderr.write')).toBeLessThan(
      fatal.indexOf('process.exit(1)'),
    );
  });
});
