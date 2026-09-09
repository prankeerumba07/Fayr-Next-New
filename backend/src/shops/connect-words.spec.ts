import { readFileSync, readdirSync } from 'node:fs';
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
    expect(sentences.length).toBeGreaterThanOrEqual(6);
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

  /**
   * THE SENTENCE THAT ASKS, AND THE ONE THING IT MUST NEVER SAY.
   *
   * The owner signed in at Flipkart on a real phone and Flipkart left him on its
   * own home page. Flipkart's home page shows no greeting and no way out, and it
   * was measured on 6 September 2026 to show no way IN either when signed out. So
   * Fayr cannot tell a signed in Flipkart home page from a signed out one, and the
   * screen that comes up must say exactly that and never more.
   */
  it('the sentence that asks never claims anybody is signed in', () => {
    const asking = /export const NOT_SURE =\s*\n?\s*'([^']+)'/.exec(wordsFile);
    expect(asking).not.toBeNull();
    const said = asking![1];
    expect(said).not.toMatch(/you are signed in/i);
    expect(said).toMatch(/cannot tell/i);
    // And the answer somebody gives is plainly an answer they give.
    expect(wordsFile).toContain("export const I_HAVE_SIGNED_IN = 'Yes, I have signed in';");
  });

  /**
   * A NEW WORDS FILE THAT NOTHING READS.
   *
   * The whole arrangement here rests on the words living in ONE file that this
   * check opens from disk. A second file of sentences in the same folder would be
   * read by nobody and would never go through the plain language rule at all, so
   * this fails loudly the day one appears.
   */
  it('and no second file of sentences appears in that folder unread', () => {
    const folder = resolve(REPO, 'src/connect');
    const known = new Set([
      'gateWords.js',       // the sentences, walked above
      'sheetWords.js',      // the sign in sheet, walked by the app's own check
      'gate.js', 'pageQuestions.js', 'watchSignIn.js', 'accountName.js',
      'SignInSheet.js',
      'gate.test.mjs', 'connect.test.mjs',
      // TEMPORARY, AND IT LEAVES WHEN THE OWNER SAYS TEST 3 PASSES. It is allowed
      // here only because the next check proves it can never be a source of words
      // a person reads. Delete both together.
      'gateLog.js',
    ]);
    const unknown = readdirSync(folder).filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
  });

  /**
   * AND THE ONE FILE ADDED TO THAT LIST CANNOT PUT A WORD ON A SCREEN.
   *
   * gateLog.js holds sentences, so naming it above would ordinarily be exactly the
   * hole the check before this one exists to catch. It is safe for one structural
   * reason and not for a promise: THERE IS A SINGLE console.log IN IT, every line
   * goes through it, and every line begins with a tag in square brackets. A screen
   * cannot draw from it because nothing in it returns anything a screen renders,
   * and it pulls in neither React nor React Native to do so.
   *
   * If somebody ever adds a second way out of that file, this goes red, and the
   * choice is theirs to make in the open rather than by accident.
   */
  it('and the one temporary file in there can only ever reach a console', () => {
    const log = read('src/connect/gateLog.js');
    const code = withoutComments(log);

    const writes = code.match(/console\.[a-z]+\(/g) ?? [];
    expect(writes).toEqual(['console.log(']);

    // Every line it can emit carries the tag, because the one call site is handed
    // a line that was built with it.
    expect(code).toContain("export const TAG = '[fayr-gate]';");
    expect(code).toContain('${TAG} ');

    // ── AND NOBODY'S TELEPHONE NUMBER GOES OUT OF IT ─────────────────────────
    //
    // THIS FILE LEAKED THE OWNER'S OWN NUMBER, on 9 September 2026. The connect
    // screen hands the shop page's raw answer to logGate, and Amazon's sign in
    // page puts the person's mobile number in its greeting, so it went into a log
    // he then pasted. His standing rule is that his number reaches no file,
    // check, fixture, report or output.
    //
    // The masking is asserted on the ASSEMBLED LINE and not on one argument.
    // Masking `detail` alone was tried and mutation-proved: a caller can as
    // easily put a page's answer in `what`, and one did.
    expect(code).toMatch(/return maskNumbers\(`\$\{TAG\} /);

    // It is off in a build a person gets.
    expect(code).toContain("typeof __DEV__ !== 'undefined' && __DEV__ === true");
    expect(code).toContain('if (!gateLogIsOn()) return false;');

    // And it can draw nothing.
    expect(code).not.toMatch(/from 'react/);
    expect(code).not.toMatch(/from 'react-native'/);
    expect(code).not.toMatch(/<[A-Z]/);

    // AND A CONSOLE IS THE ONLY WAY OUT OF IT, WHICH IS WHAT THE NAME PROMISES.
    //
    // Until 8 September this check counted console calls and nothing else, so a
    // line added BESIDE them that put the same developer words onto a network or
    // into a file would have passed it green. That was found by breaking it on
    // purpose: one exported function calling fetch() went unnoticed.
    //
    // It matters more here than almost anywhere. These lines carry a shop's url
    // and the account name a shop printed for a real person, and a file that is
    // meant to be deleted is exactly where a second way out would live longest
    // without anybody looking at it again.
    for (const wayOut of [
      /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/,
      /AsyncStorage/, /SecureStore/, /writeFileSync/, /\bnew File\b/, /\bPaths\./,
      /\brequire\s*\(/, /process\.std(out|err)/,
    ]) {
      expect(code).not.toMatch(wayOut);
    }

    // ── EXACTLY ONE IMPORT, AND IT IS THE ONE THAT KEEPS A NUMBER IN ─────────
    //
    // `/^import /m` used to be in the list above, so this file could import
    // nothing at all. The reason given was right and still is: a file that is
    // meant to be deleted is where a second way OUT would live longest without
    // anybody looking at it again.
    //
    // But the mask is not a way out. It is a pure inbound function that takes a
    // string and returns a shorter one, and the alternative to importing it was
    // worse in both available directions: a second copy of the rule inside a file
    // scheduled for deletion, or masking at each call site, which was
    // mutation-proved to fail the moment a caller uses a different argument.
    //
    // So the rule is NARROWED rather than dropped. One import, named, from the
    // file that owns the rule — and that file gets the same sweep below, so
    // allowing this in opens nothing. The guarantee is stronger than it was: this
    // file could previously emit somebody's telephone number, and now it cannot.
    const imports = code.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual([
      "import { maskNumbers } from '../maskNumbers.js';",
    ]);

    // AND THE FILE IT IMPORTS HAS NO WAY OUT EITHER, or the sweep above is a
    // sweep of one half of a pair.
    const mask = withoutComments(read('src/maskNumbers.js'));
    for (const wayOut of [
      /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/,
      /AsyncStorage/, /SecureStore/, /writeFileSync/, /\bnew File\b/, /\bPaths\./,
      /\brequire\s*\(/, /^import /m, /process\.std(out|err)/, /console\./,
      /from 'react/, /<[A-Z]/,
    ]) {
      expect(mask).not.toMatch(wayOut);
    }
    // It masks the shape the owner named: eight or more digits, optional plus.
    expect(mask).toContain('/\\+?\\d{8,}/g');
  });
});

describe('Fayr never types anything into a shop’s page', () => {
  /** Every file in the path a person takes to sign in at a shop. */
  const IN_THIS_PATH = [
    'src/connect/gate.js',
    'src/connect/watchSignIn.js',
    'src/connect/pageQuestions.js',
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
    // BOTH FILES, because the questions the watcher asks now live next door and a
    // tap could be added there just as easily.
    for (const file of ['src/connect/watchSignIn.js', 'src/connect/pageQuestions.js']) {
      const code = withoutComments(read(file));
      // Not one tap of any kind, on anything, anywhere in it.
      expect({ file, taps: code.includes('.click(') }).toEqual({ file, taps: false });
      // And it never puts the cursor in a field either, which is the step before
      // typing and has no other reason to be there.
      expect({ file, focuses: code.includes('.focus()') }).toEqual({ file, focuses: false });
    }
  });

  it('the watcher stays away from a puzzle and from a paying page', () => {
    // The questions moved into one shared file on 6 September 2026, so this looks
    // where they live now AND checks the watcher really uses them.
    const questions = read('src/connect/pageQuestions.js');
    const watcher = read('src/connect/watchSignIn.js');
    // It knows what a puzzle looks like, in the shops' own words.
    expect(questions).toContain('captcha');
    expect(questions).toContain('not a robot');
    expect(questions).toContain('are you a human');
    expect(watcher).toContain('IS_A_PUZZLE');
    // And it leaves a checkout, a cart and a payment page completely alone.
    const leaveAlone = /PAYING_PATH[\s\S]{0,300}/.exec(questions)?.[0] ?? '';
    for (const page of ['checkout', 'cart', 'payment']) {
      expect(leaveAlone).toContain(page);
    }
    expect(watcher).toContain('PAYING_PATH');
    // On either of those it says NOTHING, rather than reporting a sign in it
    // cannot see. The person stays on our own screen.
    expect(watcher).toContain('say nothing at all');
  });

  /**
   * THE WATCHER DECIDES NOTHING, AND THAT IS THE POINT OF THE REWRITE.
   *
   * It used to work out for itself whether somebody was signed in, inside the
   * shop's page, where no check could ever reach it. Now it gathers facts and our
   * own side decides, so every combination of what a shop might show is walked
   * under node in src/connect/gate.test.mjs.
   */
  it('the watcher gathers facts and never reaches a verdict of its own', () => {
    const code = withoutComments(read('src/connect/watchSignIn.js'));
    // It may not name any of the three answers. Those are the gate's to give.
    for (const verdict of ['"in"', "'in'", '"up"', "'up'", '"gone"', "'gone'"]) {
      expect({ verdict, said: code.includes(verdict) }).toEqual({ verdict, said: false });
    }
    // What it sends is a bag of facts under one name, and nothing else.
    expect(code).toContain('__fayrPage');
    expect(code).toContain('signInControlIsThere');
    expect(code).toContain('signOutIsThere');
    expect(code).toContain('looksInARow');
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
  // THE QUESTIONS IT ASKS MOVED NEXT DOOR ON 6 SEPTEMBER 2026, into one shared
  // file, because they had been written out twice and had already drifted: this
  // script counted only a telephone box as a sign in and the watcher counted a
  // telephone box or a password box. So some of the rules below are read from
  // there, and each one also asserts that this script really uses that file.
  const questions = read('src/connect/pageQuestions.js');
  const questionsCode = withoutComments(questions);

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
      expect({ shape, next: questionsCode.includes(shape) }).toEqual({ shape, next: false });
    }
  });

  it('never reads what anybody typed, or the shop’s own sign in', () => {
    for (const shape of [
      '.value)', '.value;', 'document.cookie', 'localStorage', 'sessionStorage',
    ]) {
      expect({ shape, present: code.includes(shape) }).toEqual({ shape, present: false });
      expect({ shape, next: questionsCode.includes(shape) }).toEqual({ shape, next: false });
    }
  });

  /**
   * THE WORD PASSWORD IS ALLOWED IN EXACTLY ONE SHAPE.
   *
   * The shared question knows a password box is a sign in box, because Amazon's
   * second sign in page carries one and nothing else, and knowing that is what
   * makes the tap script STOP there. Knowing what a box IS and reading what is in
   * one are different things, and only the second is forbidden.
   */
  it('and where a password is named, it is a box’s type and never a thing read', () => {
    // The CODE, with the prose taken out. A comment may say the word; a line that
    // runs inside somebody's page may only ask a box what type it is.
    const every = [...questionsCode.matchAll(/password/g)];
    expect(every.length).toBeGreaterThan(0);
    for (const at of every) {
      const around = questionsCode.slice(Math.max(0, at.index - 40), at.index + 20);
      expect(around).toMatch(/type === "password"/);
    }
    expect(questionsCode.includes('.value')).toBe(false);
  });

  it('leaves a checkout, a cart and a payment page completely alone', () => {
    const leaveAlone = /PAYING_PATH[\s\S]{0,200}/.exec(questions)?.[0] ?? '';
    for (const page of ['checkout', 'cart', 'payment']) {
      expect(leaveAlone).toContain(page);
    }
    expect(code).toContain('PAYING_PATH');
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
    expect(questions).toContain('if (text !== words[w] && aria !== words[w]) continue;');
    // And a wrapper holding half the page cannot match the words of its children.
    expect(questions).toContain('if (el.children.length > 1) continue;');
    // And this script really uses that one matcher rather than a copy of its own.
    expect(code).toContain('WHOLE_LABEL');
    expect(code.includes('function fayrWholeLabel(')).toBe(false);
  });

  /**
   * ONE ANSWER TO "IS THIS A SIGN IN PAGE", AND THE OWNER NAMED THE REASON.
   *
   * "It is written out twice today, in watchSignIn.js and signinTap.js, and a
   * third copy in the screen is how they start disagreeing."
   */
  it('and the shop’s own sign in paths are written down exactly once', () => {
    const holdsIt: string[] = [];
    for (const file of [
      'src/connect/pageQuestions.js',
      'src/connect/gate.js',
      'src/connect/watchSignIn.js',
      'src/signinTap.js',
      'src/ConnectScreen.js',
    ]) {
      if (/login\|signin\|sign-in\|auth/.test(read(file))) holdsIt.push(file);
    }
    expect(holdsIt).toEqual(['src/connect/pageQuestions.js']);
  });

  /**
   * AND THAT ONE ANSWER COVERS AMAZON'S WHOLE SIGN IN, not only its first page.
   *
   * Amazon asks for the number on one page and the code or the password on the
   * next. Both are its own sign in pages, so the cover over the shop must not come
   * back on between them. Every step of an Amazon sign in is under /ap/, which was
   * opened and read in a real WebKit browser on 6 September 2026.
   */
  it('and that one answer knows Amazon’s sign in has more than one page', () => {
    const pattern = /export const SIGN_IN_PATH = String\.raw`([^`]+)`/.exec(questions);
    expect(pattern).not.toBeNull();
    const asked = new RegExp(pattern![1].replace(/\\\\/g, '\\'));
    for (const page of ['/ap/signin', '/ap/cvf/request', '/ap/challenge', '/ap/mfa']) {
      expect({ page, isASignIn: asked.test(page) }).toEqual({ page, isASignIn: true });
    }
    for (const page of ['/', '/my-account', '/apple-watch', '/gp/css/order-history']) {
      expect({ page, isASignIn: asked.test(page) }).toEqual({ page, isASignIn: false });
    }
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
