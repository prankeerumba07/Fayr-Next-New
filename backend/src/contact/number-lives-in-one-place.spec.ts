import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * THE SUPPORT NUMBER IS IN backend/.env AND IN NO OTHER FILE.
 *
 * THIS CHECK DOES NOT CONTAIN THE NUMBER. It reads it out of backend/.env at the
 * moment it runs, and then goes looking for it everywhere else. So the number can
 * change, and this keeps working, and nobody has to remember to update a check.
 *
 * WHY IT READS THE FILE RATHER THAN THE ENVIRONMENT. A unit run does not load
 * backend/.env, so `process.env.FAYR_SUPPORT_PHONE` would be empty here and this
 * check would pass by finding nothing to look for. Reading the file means it
 * really looks.
 *
 * WHAT IT SEARCHES FOR, and this is the part that matters: not just the number as
 * written, but the number with its plus sign gone, with its country code gone, and
 * with spaces or dashes between the digits. A number that has been "tidied up" on
 * the way into a file is still the number.
 */

const REPO = resolve(__dirname, '../../..');
const ENV_FILE = resolve(REPO, 'backend/.env');

/** Places whose contents are not ours, or are the one file allowed to hold it. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.expo',
  '_to_delete_stale_build',
]);

/** Only files we could actually have written it into. */
const LOOK_AT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|sql|yml|yaml|sh|html|prisma|txt)$/;

function readTheNumber(): string | null {
  if (!existsSync(ENV_FILE)) return null;
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = /^\s*FAYR_SUPPORT_PHONE\s*=\s*(.*)$/.exec(line);
    if (match == null) continue;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    return value === '' ? null : value;
  }
  return null;
}

/** Every shape the same number could have been written in. */
function shapesOf(number: string): string[] {
  const digits = number.replace(/\D/g, '');
  const withoutCountry = digits.length > 10 ? digits.slice(-10) : digits;
  const spaced = withoutCountry.replace(/(\d{5})(\d{5})/, '$1 $2');
  const dashed = withoutCountry.replace(/(\d{5})(\d{5})/, '$1-$2');
  return [...new Set([number, digits, withoutCountry, spaced, dashed])].filter(
    // A short run of digits would match half the codebase and prove nothing.
    (shape) => shape.replace(/\D/g, '').length >= 10,
  );
}

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) everyFile(full, out);
    else if (LOOK_AT.test(entry)) out.push(full);
  }
  return out;
}

describe('the support number', () => {
  const number = readTheNumber();

  it('is set in backend/.env, or genuinely is not set anywhere', () => {
    // Both are legitimate. What is not legitimate is a number in a second file,
    // which is what the check below is for. This one exists so the run says out
    // loud which of the two worlds it is checking.
    expect(number == null || /^\+[1-9]\d{7,14}$/.test(number)).toBe(true);
  });

  it('appears in no file in this project except backend/.env', () => {
    if (number == null) {
      // Nothing set, so nothing to leak. Said rather than skipped silently.
      expect(readTheNumber()).toBeNull();
      return;
    }
    const shapes = shapesOf(number);
    expect(shapes.length).toBeGreaterThan(0);

    const found: string[] = [];
    for (const file of everyFile(REPO)) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const shape of shapes) {
        if (text.includes(shape)) {
          found.push(`${file.slice(REPO.length + 1)} holds the number`);
          break;
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('really would find it, so an empty answer above means something', () => {
    // The whole check is worthless if the walk cannot see a file. Prove it can by
    // looking for something that IS in the tree.
    const files = everyFile(REPO);
    expect(files.length).toBeGreaterThan(200);
    const seen = files.some((f) => f.endsWith('backend/src/contact/contact.words.ts'));
    expect(seen).toBe(true);
    // And prove the search itself works, with a made-up number planted in a string.
    const planted = 'a file that said +919000000001 in it';
    expect(shapesOf('+919000000001').some((s) => planted.includes(s))).toBe(true);
  });
});
