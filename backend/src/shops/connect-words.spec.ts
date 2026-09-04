import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkPlainLanguage } from '../assistant/plain-language';
import { shopsThatTapToSignIn } from './tap-boundary';

/**
 * THE WORDS ON THE SHOP CONNECT SCREEN, AND THE PROMISE THAT FAYR TYPES NOTHING.
 *
 * ── WHY THE WORDS LIVE IN THE APP AND OUR SIDE READS THEM FROM DISK ─────────
 *
 * The owner's rule is that Fayr's own words live on our side, where the plain
 * language check reads them. The connect gate is the one place that cannot follow
 * it, and the reason is the screen itself: its loading sentence is the FIRST thing
 * drawn, before anything has loaded, and it has to be drawn when the phone has no
 * connection at all. Asking our side for that sentence would mean a blank screen
 * exactly when the network is the thing that is broken.
 *
 * SO THE RULE IS KEPT THE OTHER WAY ROUND. The words live in ONE file in the app,
 * and this check opens that file from disk and puts every sentence in it through
 * the same checkPlainLanguage that reads the assistant's answers. The same rule
 * really does read them, and they are still there when the network is not. Same
 * shape as contact/number-lives-in-one-place.spec.ts, which proves the support
 * number is in one file by going and looking.
 *
 * ── AND THE SECOND JOB, WHICH MATTERS MORE ──────────────────────────────────
 *
 * The owner's rule 4: Fayr never types anything into the shop's page. Not a
 * number, not a password, not a code. Do not fill a field, do not store a
 * password, do not automate a sign in, and do not go near anything that looks
 * like a puzzle asking whether they are a person.
 *
 * A promise in a comment is not a promise. So this reads the four files in that
 * path and refuses every shape that could write into a page or read what somebody
 * typed. It is the same kind of check as the one that proves the support number
 * lives in one file: it goes and looks rather than trusting the reading.
 */

const REPO = resolve(__dirname, '../../..');

const read = (relative: string): string =>
  readFileSync(resolve(REPO, relative), 'utf8');

/**
 * The file with the comment lines taken out.
 *
 * IT DROPS THREE SHAPES AND NOT ONE. A line starting with two slashes, a line
 * starting a block comment, and a line inside one, which starts with a star. The
 * app's other check of this kind dropped only the first, and on a file written in
 * block comments that leaves the prose in and reads its apostrophes as string
 * ends.
 */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
    })
    .join('\n');
}

describe('the words on the shop connect screen', () => {
  const wordsFile = read('src/connect/gateWords.js');

  /** Every sentence in the words file: a single-line literal of four or more words. */
  function everySentence(): string[] {
    const code = withoutComments(wordsFile);
    const found = code.match(/'[^'\n]*'/g) ?? [];
    return found
      .map((raw) => raw.slice(1, -1))
      // TWO WORDS AND NOT THREE, because "Try again" is a whole sentence to
      // somebody reading a failure and it is two words long. A three word floor
      // silently dropped the one control on the screen from the walk.
      .filter((text) => (text.match(/[A-Za-z]+/g) ?? []).length >= 2);
  }

  it('really found the sentences, so an empty walk cannot pass', () => {
    const sentences = everySentence();
    expect(sentences.length).toBeGreaterThanOrEqual(4);
    // The loading sentence the owner asked for, by name, so a rename shows here.
    expect(sentences.join(' ')).toContain('Opening the shop so you can sign in');
  });

  it('reads plainly, every sentence, by the same rule as the assistant', () => {
    const bad: string[] = [];
    for (const sentence of everySentence()) {
      const result = checkPlainLanguage(sentence, 'en');
      if (!result.ok) {
        bad.push(`"${sentence}": ${result.problems.map((p) => p.detail).join(' ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no long dash anywhere', () => {
    for (const sentence of everySentence()) {
      expect({ sentence, hasALongDash: /--|—|–/.test(sentence) }).toEqual({
        sentence,
        hasALongDash: false,
      });
    }
  });

  it('offers one control on the failure and no more', () => {
    // One plain sentence saying it did not open, and one button to try again.
    expect(wordsFile).toContain('The shop did not open. Please try again.');
    expect(wordsFile).toContain("export const TRY_AGAIN = 'Try again';");
  });
});

describe('Fayr never types anything into a shop’s page', () => {
  /** Every file in the path a person takes to sign in at a shop. */
  const IN_THIS_PATH = [
    'src/connect/gate.js',
    'src/connect/watchSignIn.js',
    'src/connect/gateWords.js',
    'src/ConnectScreen.js',
  ] as const;

  /**
   * WRITING INTO A PAGE. Every shape that could put a character into a field, or
   * make a page behave as though somebody had.
   */
  const CANNOT_WRITE = [
    ['.value =', 'assigns into a field'],
    ['.value=', 'assigns into a field'],
    ['HTMLInputElement.prototype', 'reaches into every field on the page'],
    ['setAttribute("value"', 'sets a field by attribute'],
    ["setAttribute('value'", 'sets a field by attribute'],
    ['dispatchEvent', 'pretends somebody typed'],
    ['.submit()', 'submits the shop’s own form'],
    ['requestSubmit', 'submits the shop’s own form'],
    ['document.forms', 'reaches the shop’s own forms'],
  ] as const;

  /**
   * READING WHAT SOMEBODY TYPED. Not the same rule and not a smaller one: a thing
   * that can read a code out of a field is a thing that can send it somewhere.
   */
  const CANNOT_READ = [
    ['.value)', 'reads what was typed'],
    ['.value;', 'reads what was typed'],
    ['.value ', 'reads what was typed'],
    ['document.cookie', 'reads the shop’s own sign in'],
    ['localStorage.getItem', 'reads the shop’s own stored sign in'],
    ['sessionStorage.getItem', 'reads the shop’s own stored sign in'],
  ] as const;

  for (const file of IN_THIS_PATH) {
    describe(file, () => {
      const code = withoutComments(read(file));

      for (const [shape, why] of CANNOT_WRITE) {
        it(`never ${why} (${shape})`, () => {
          expect(code.includes(shape)).toBe(false);
        });
      }

      for (const [shape, why] of CANNOT_READ) {
        it(`never ${why} (${shape.trim()})`, () => {
          expect(code.includes(shape)).toBe(false);
        });
      }
    });
  }

  it('the watcher only ever LOOKS: it never taps and never takes a field', () => {
    const code = withoutComments(read('src/connect/watchSignIn.js'));
    // Not one tap of any kind, on anything, anywhere in it.
    expect(code.includes('.click(')).toBe(false);
    // And it never puts the cursor in a field either, which is the step before
    // typing and has no other reason to be there.
    expect(code.includes('.focus()')).toBe(false);
  });

  it('the watcher stays away from a puzzle and from a paying page', () => {
    const source = read('src/connect/watchSignIn.js');
    // It knows what a puzzle looks like, in the shops' own words.
    expect(source).toContain('captcha');
    expect(source).toContain('not a robot');
    expect(source).toContain('are you a human');
    // And it leaves a checkout, a cart and a payment page completely alone.
    const leaveAlone = /LEAVE_ALONE[\s\S]{0,300}/.exec(source)?.[0] ?? '';
    for (const page of ['checkout', 'cart', 'payment']) {
      expect(leaveAlone).toContain(page);
    }
    // On either of those it says NOTHING, rather than reporting a sign in it
    // cannot see. The person stays on our own screen.
    expect(source).toContain('say nothing at all');
  });

  it('the gate writes no sentence of its own', () => {
    // Every word a person reads comes from the words file, where the rule above
    // reads it. A sentence written in the gate would never be read by anybody.
    const code = withoutComments(read('src/connect/gate.js'));
    const literals = (code.match(/'[^'\n]*'|"[^"\n]*"/g) ?? [])
      .map((raw) => raw.slice(1, -1))
      .filter((text) => (text.match(/\b[a-z]+\b/g) ?? []).length >= 4);
    expect(literals).toEqual([]);
  });
});

/**
 * THE ONE PLACE FAYR DOES TAP, AND THE BOUNDARY AROUND IT.
 *
 * ── SAID PLAINLY, BECAUSE IT IS A READING OF THE OWNER'S RULE AND NOT A GAP ──
 *
 * Rule 4 says "not a tap on their sign-in button". src/signinTap.js taps the
 * shop's own sign in control for three of the seven shops, and it was built on
 * 2 September 2026 at the owner's own instruction, because those three have NO
 * sign in page with an address of its own: flipkart.com/login bounces to the
 * shopping page, zepto.com/login answers "page could not be found", and
 * blinkit.com/login answers 404. Their sign in is a panel behind a control, and
 * Blinkit's control carries no words at all.
 *
 * SO WITHOUT THE TAP, THREE OF THE SEVEN SHOPS LAND A PERSON ON A SHOPPING PAGE,
 * which is the exact thing this whole step exists to stop.
 *
 * THE READING: the rule's own words name four things, and the tap does none of
 * them. It does not fill a field. It does not store a password. It does not
 * automate a sign in: it stops the instant a sign in field appears, which is
 * BEFORE anybody has typed anything. And it stays away from a puzzle. What it
 * does is open the shop's own panel, which is navigation.
 *
 * IT IS ONE LINE TO REVERSE. Take the tap out of shopHandedToConnectScreen in
 * src/signin.js and those three shops keep the shop's own site, exactly as they
 * were before 2 September. The checks below pin the boundary so the reading
 * cannot quietly widen.
 */
describe('the one place Fayr taps, and its boundary', () => {
  const source = read('src/signinTap.js');
  const code = withoutComments(source);

  it('taps for exactly three shops, and they are the three with no sign in page', () => {
    expect(shopsThatTapToSignIn()).toEqual(['flipkart', 'zepto', 'blinkit']);
  });

  it('and that list is really the app’s own list, read from the app’s own file', () => {
    // Our side cannot import app code, so the list is written down twice. This is
    // what stops the two drifting: the app's own file is read from disk and the
    // shops it really taps for are pulled out of it.
    const inTheApp = [...source.matchAll(/^ {2}([a-z]+): scriptFor\(\{/gm)].map((m) => m[1]);
    expect(inTheApp).toEqual(shopsThatTapToSignIn());
  });

  it('never writes into a field and never pretends somebody typed', () => {
    for (const shape of [
      '.value =', '.value=', 'dispatchEvent', '.submit()', 'requestSubmit',
      'HTMLInputElement.prototype', 'document.forms',
    ]) {
      expect({ shape, present: code.includes(shape) }).toEqual({ shape, present: false });
    }
  });

  it('never reads what anybody typed, or the shop’s own sign in', () => {
    for (const shape of [
      '.value)', '.value;', 'document.cookie', 'localStorage', 'sessionStorage',
    ]) {
      expect({ shape, present: code.includes(shape) }).toEqual({ shape, present: false });
    }
  });

  it('leaves a checkout, a cart and a payment page completely alone', () => {
    const leaveAlone = /LEAVE_ALONE[\s\S]{0,200}/.exec(source)?.[0] ?? '';
    for (const page of ['checkout', 'cart', 'payment']) {
      expect(leaveAlone).toContain(page);
    }
  });

  it('stops for good the moment the shop’s own sign in is up', () => {
    // BEFORE anybody has typed a character. That is what makes it navigation and
    // not an automated sign in.
    expect(code).toContain('if (fayrSignInIsUp()) { done = true; return; }');
    expect(code).toContain('if (done) return;');
  });

  it('tries a few times and then gives up rather than tapping for ever', () => {
    expect(code).toContain('if (signInTries >= 3) return;');
    expect(code).toContain('if (doorTries < 2)');
  });

  it('matches a whole label and never part of one', () => {
    // So "log out" and "reorder" can never be hit by a rule looking for "log".
    expect(code).toContain('if (text !== words[w] && aria !== words[w]) continue;');
    // And a wrapper holding half the page cannot match the words of its children.
    expect(code).toContain('if (el.children.length > 1) continue;');
  });

  it('reaches Zepto at the address Zepto really redirects to', () => {
    // THE GUARD WAS DEAD. It read zepto\.com, and zepto.com redirects to
    // ZEPTONOW.com, which does not contain the letters "zepto.com" anywhere. Two
    // other files in this project already recorded that redirect in writing, so
    // the one place that needed to know it was the one place that did not. The
    // old check only asked whether a script EXISTED, so a dead guard passed.
    const zeptoScript = /zepto: scriptFor\(\{[\s\S]{0,200}/.exec(source)?.[0] ?? '';
    expect(zeptoScript).toContain('zepto(now)?');
    // And it really matches both hosts.
    const host = /zepto\(now\)\?\\\.com/.test(zeptoScript) ? /zepto(now)?\.com/ : null;
    expect(host).not.toBeNull();
    expect(host!.test('www.zeptonow.com')).toBe(true);
    expect(host!.test('www.zepto.com')).toBe(true);
    expect(host!.test('www.amazon.in')).toBe(false);
  });
});
