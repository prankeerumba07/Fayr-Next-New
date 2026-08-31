// The root type-check must cover the DEVICE APP, and only the device app.
//
// "tsc --noEmit is clean" is one of the green lights this project ships on, and
// at the repo root it had never once been green: the root config inherited
// expo/tsconfig.base, which excludes node_modules/android/ios and nothing else,
// so the check swept into backend/ and died on NestJS's decorators before it ever
// looked at a device file. The backend has its own tsconfig with its own
// decorator settings and its own clean check; that one is the authority for
// backend code.
//
// The failure mode this guards against is subtler than the one it fixes. A config
// scoped by `include` can be narrowed to NOTHING by a single typo'd path — and
// tsc then exits 0, reporting a green light for a check that read no files at
// all. So these tests do not assert the config's text; they run the compiler and
// assert what it actually looked at.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    process.exitCode = 1;
  }
};

/** tsconfig.json is JSONC — tsc allows comments, so strip them before parsing. */
function readTsconfig() {
  const raw = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(stripped);
}

/** Every file the root program actually reads, excluding library typings. */
function programFiles() {
  const out = execFileSync(
    'npx',
    ['tsc', '--listFilesOnly', '-p', 'tsconfig.json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => !f.includes('/node_modules/'))
    .map((f) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f));
}

const config = readTsconfig();
const files = programFiles();

console.log('the root type-check scope');

t('every path it says it checks actually exists', () => {
  // The whole point. A typo here does not fail — it silently empties the program
  // and leaves tsc exiting 0 on nothing at all.
  const include = config.include || [];
  assert.ok(include.length > 0, 'the root config must name what it checks');
  for (const pattern of include) {
    const base = pattern.split('*')[0].replace(/\/$/, '');
    if (!base) continue;
    assert.ok(
      existsSync(join(ROOT, base)),
      `tsconfig includes "${pattern}" but ${base} does not exist`,
    );
  }
});

t('it really reads the device app — not zero files', () => {
  assert.ok(
    files.length > 50,
    `expected the whole device app, got ${files.length} files`,
  );
  for (const f of ['App.js', 'index.js', 'src/taskflow.js', 'src/TaskScreen.js']) {
    assert.ok(files.includes(f), `${f} is not being type-checked`);
  }
});

t('it does NOT read the NestJS backend', () => {
  // backend/ has its own tsconfig (experimentalDecorators, its own lib set) and
  // its own check. Compiling it under the device config fails on every @Get().
  const leaked = files.filter((f) => f.startsWith('backend/'));
  assert.deepEqual(leaked, [], `backend files leaked into the root check: ${leaked.slice(0, 3)}`);
});

t('it does not read the staff panel or the web prototypes either', () => {
  // admin-panel is a single static HTML file with inline vanilla JS; the two
  // root .jsx prototypes are React-DOM design references that cannot run in the
  // app. None of them is device code, and none is what this green light is about.
  const strays = files.filter(
    (f) =>
      f.startsWith('admin-panel/') ||
      f.startsWith('web-preview/') ||
      f.startsWith('dist/') ||
      f === 'fayr-design.browser.jsx' ||
      f === 'FayrAppV3.jsx',
  );
  assert.deepEqual(strays, [], `not device code: ${strays.slice(0, 3)}`);
});

t('and it passes', () => {
  // Run it for real. This is the assertion the green light IS.
  execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
});

t('is honest about what it can and cannot catch', () => {
  // checkJs is OFF (the Expo base leaves it off), so the device app's .js files
  // are PARSED but not type-checked: this catches a syntax error and does NOT
  // catch a broken import — both verified by experiment, not assumed. Turning
  // checkJs on today surfaces 139 errors across the device app, every one of them
  // inference noise from un-annotated JS (component props read as all-required,
  // option objects inferred from their narrowest call). None was a real defect.
  // The gate that does resolve every import is `npx expo export --platform ios`.
  assert.equal(config.compilerOptions?.checkJs, undefined);
});

t('the config is IN THE REPOSITORY, not just on one laptop', () => {
  // FOUND BY CLONING. The root tsconfig.json was gitignored — a leftover rule
  // from a template that treats it as generated — so a fresh checkout had no
  // root config at all, and both `npm run typecheck` and this very test file
  // failed on a repository that was otherwise complete.
  //
  // It is not generated. It is hand-written, documented, and load-bearing: the
  // typecheck gate reads it, and so does everything below. A file the gate
  // depends on cannot live in one working directory.
  const ignored = (() => {
    try {
      execFileSync('git', ['check-ignore', '-q', 'tsconfig.json'], { cwd: ROOT });
      return true;
    } catch {
      return false;
    }
  })();
  assert.equal(ignored, false, 'tsconfig.json is gitignored, so a clone has no root config');

  const tracked = (() => {
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', 'tsconfig.json'], {
        cwd: ROOT,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  })();
  assert.equal(tracked, true, 'tsconfig.json is not tracked by git');
});

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
