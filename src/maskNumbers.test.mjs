// HIS TELEPHONE NUMBER NEVER REACHES ANY FILE, CHECK, FIXTURE, REPORT OR OUTPUT.
//
// Three halves, and the last two are the ones that matter tomorrow.
//
// THE PURE HALF puts the rule through the shape MEASURED IN HIS OWN LOG and
// through every way an Indian mobile number gets written down.
//
// THE OTHER DIRECTION checks what must SURVIVE. A privacy rule that also eats the
// Amazon order number is a privacy rule somebody switches off, and the order
// number is the one fact today's work exists to read.
//
// THE STRUCTURAL HALF reads the two files that leaked, off disk, and proves the
// masking sits at the one place every line and every file passes through. A mask
// applied at a call site is a mask the next call site forgets.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MASK, holdsANumber, maskNumbers } from './maskNumbers.js';
import { gateLine, describeFailure, TAG } from './connect/gateLog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/**
 * THE REAL SHAPE, COPIED FROM WHAT AMAZON'S SIGN IN PAGE ACTUALLY SENT.
 *
 * His own number is NOT in this file and never will be. The digits below are a
 * made up number of the same shape, which is the whole point: the check has to
 * exercise the shape, and it must not become one more place the real one is
 * written down.
 */
const A_MADE_UP_NUMBER = '+919876543210';
const WHAT_AMAZONS_PAGE_SENT =
  `{"greeting":" \\nSign in\\n${A_MADE_UP_NUMBER} Change\\nPassword\\n","url":"/ap/signin"}`;

console.log('=== 1. THE SHAPE THAT ACTUALLY LEAKED ===');
{
  const out = maskNumbers(WHAT_AMAZONS_PAGE_SENT);
  ok(!out.includes('9876543210'), 'the number is gone from the page own answer');
  ok(out.includes(MASK), 'and something says a number was taken out');
  ok(holdsANumber(WHAT_AMAZONS_PAGE_SENT), 'the unmasked text is recognised as holding one');
  ok(!holdsANumber(out), 'and the masked text is not');
  ok(out.includes('"greeting"') && out.includes('Sign in') && out.includes('/ap/signin'),
    'AND EVERYTHING ELSE SURVIVES, so the log is still worth reading');
}

console.log('\n=== 2. EVERY WAY THE SAME NUMBER GETS WRITTEN ===');
{
  const shapes = [
    ['+919876543210', 'the shape from his log, plus and all'],
    ['919876543210', 'the country code with no plus'],
    ['9876543210', 'the bare ten digits'],
    ['+91 9876543210', 'a space after the country code'],
    ['+91 98765 43210', 'held apart in three pieces'],
    ['+91-98765-43210', 'the same with dashes'],
    ['+91-9876543210', 'a dash after the country code'],
    ['98765 43210', 'two halves, no country code'],
    ['98765-43210', 'two halves with a dash'],
    ['+9198765 43210', 'run together then split'],
    ['12345678', 'EIGHT DIGITS EXACTLY, which is the floor the owner named'],
    ['123456789012345', 'and far more than eight'],
  ];
  for (const [text, why] of shapes) {
    ok(maskNumbers(text) === MASK, `${why}: ${JSON.stringify(text)} is masked whole`);
  }
  // NOT HALF MASKED. "+91 [number removed]" would still say which country and
  // still read as a leak of part of something.
  for (const text of ['+91 98765 43210', '+91-98765-43210', '+91 9876543210']) {
    ok(!maskNumbers(text).includes('91'),
      `no piece of ${JSON.stringify(text)} is left behind`);
  }
}

console.log('\n=== 3. AND WHAT MUST SURVIVE, BECAUSE TODAY DEPENDS ON IT ===');
{
  // FOUND BY WRITING THE RULE THE OBVIOUS WAY FIRST. One keen pattern — eight or
  // more digits with separators allowed inside the run — masked the telephone
  // number correctly AND masked 403-1234567-8901234, which is the shape of an
  // Amazon order number. That is the one fact this whole day exists to read and
  // put on a screen, so the rule was narrowed to name the mobile shape instead of
  // a length.
  const mustSurvive = [
    ['403-1234567-8901234', 'AN AMAZON ORDER NUMBER, which the read must show'],
    ['171-2345678-1234567', 'and another of them'],
    ['1234567', 'seven digits, one under the floor'],
    ['2026-09-09', 'a date'],
    ['12:34:56.789', 'the log own clock reading'],
    ['attempt=1 code=-1009 status=503', 'the codes the gate log exists to show'],
    ['B0F16X1NQ7', 'a product number'],
    ['1,299.00', 'an amount'],
    ['/errors_page/validateCaptcha', 'the address that says we were taken for a robot'],
  ];
  for (const [text, why] of mustSurvive) {
    ok(maskNumbers(text) === text, `${why}: ${JSON.stringify(text)} is untouched`);
  }
  ok(maskNumbers(`order 403-1234567-8901234 for ${A_MADE_UP_NUMBER}`)
    === `order 403-1234567-8901234 for ${MASK}`,
  'AND BOTH AT ONCE: the order number stays and the telephone number goes');
}

console.log('\n=== 4. it refuses to guess at things that are not text ===');
{
  for (const junk of [null, undefined, 42, {}, [], true]) {
    ok(maskNumbers(junk) === '',
      `${JSON.stringify(junk) ?? String(junk)} answers the empty string, not "[object Object]"`);
    ok(holdsANumber(junk) === false, 'and holds no number');
  }
  ok(maskNumbers('') === '', 'and so does the empty string');
}

console.log('\n=== 5. THE GLOBAL FLAG TRAP ===');
{
  // A regular expression carrying /g REMEMBERS WHERE IT STOPPED. Sharing one
  // between a test and a replace is how the second caller silently gets a wrong
  // answer, and it would show up as a number masked on one line and printed on
  // the next.
  for (let i = 0; i < 3; i += 1) {
    ok(maskNumbers(A_MADE_UP_NUMBER) === MASK, `masked the same on call ${i + 1}`);
    ok(holdsANumber(A_MADE_UP_NUMBER) === true, `and recognised on call ${i + 1}`);
  }
  // FOUND BY BREAKING THE CODE ON PURPOSE, AND THE FIRST WRITING OF THIS CHECK
  // WAS WORTHLESS. Sharing the global patterns between test and replace was
  // mutated in, and every check above still passed — because each holdsANumber
  // call had a maskNumbers call in front of it, and replace RESETS lastIndex, so
  // the loop quietly repaired the fault it was meant to expose.
  //
  // Asked TWICE IN A ROW with nothing in between, the shared version answers
  // "there is no number in here" the second time. That is the worst possible
  // direction for this particular lie: a check that asks whether a number
  // survived would be told no, and pass.
  for (const text of ['98765 43210', '12345678', 'a +919876543210 b']) {
    const answers = [
      holdsANumber(text), holdsANumber(text), holdsANumber(text), holdsANumber(text),
    ];
    ok(answers.every((a) => a === true),
      `ASKED FOUR TIMES RUNNING, ${JSON.stringify(text)} holds a number every time`);
  }
  ok(maskNumbers(`${A_MADE_UP_NUMBER} and ${A_MADE_UP_NUMBER}`) === `${MASK} and ${MASK}`,
    'and TWO numbers on one line are both taken, not just the first');
}

console.log('\n=== 6. THE GATE LOG CANNOT EMIT ONE, WHATEVER IT IS HANDED ===');
{
  // EVERY ARGUMENT, not just the one that leaked. The line that leaked put the
  // page's raw answer in `detail`, but a future caller could as easily put it in
  // `what`, so the masking is applied to the ASSEMBLED LINE.
  const inDetail = gateLine(2, 'PAGE SAID', WHAT_AMAZONS_PAGE_SENT, 0);
  ok(!inDetail.includes('9876543210'), 'a number in `detail` never reaches the line');
  const inWhat = gateLine(2, `PAGE SAID ${A_MADE_UP_NUMBER}`, '', 0);
  ok(!inWhat.includes('9876543210'), 'and neither does one in `what`');
  ok(!holdsANumber(gateLine(2, A_MADE_UP_NUMBER, A_MADE_UP_NUMBER, 0)),
    'and not one in both at once');
  // AND THE LINE IS STILL A GATE LINE.
  ok(inDetail.startsWith(TAG), 'the line still begins with the one prefix');
  ok(/attempt=2/.test(inDetail), 'and still carries the attempt, which is why it exists');

  // THE FAILURE DESCRIBER FEEDS THE SAME LINE. Amazon's own description of an
  // error can quote the address it was refusing, and an address can carry a
  // number, so this path is checked too rather than assumed.
  const said = describeFailure('main', {
    domain: 'NSURLErrorDomain', code: -1009,
    url: `https://www.amazon.in/ap/signin?u=${A_MADE_UP_NUMBER}`,
    description: `could not sign in ${A_MADE_UP_NUMBER}`,
  });
  ok(!holdsANumber(gateLine(1, 'SHOP WILL NOT OPEN', said, 0)),
    'a number inside what the web view said never reaches the line either');
  ok(/code=-1009/.test(gateLine(1, 'SHOP WILL NOT OPEN', said, 0)),
    'and the error code, which is the point of that line, still comes through');
}

console.log('\n=== 7. AND THE MASK IS AT THE CHOKE POINT, NOT AT A CALL SITE ===');
{
  const log = read('src/connect/gateLog.js');
  const code = log.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/import \{ maskNumbers \} from '\.\.\/maskNumbers\.js'/.test(code),
    'the gate log takes the rule from the one file that owns it');
  ok(/return maskNumbers\(`\$\{TAG\}/.test(code),
    'AND APPLIES IT TO THE WHOLE ASSEMBLED LINE inside gateLine');
  // THE STRUCTURAL ARGUMENT THIS FILE ALREADY MAKES ABOUT ITS BRACKET, NOW ABOUT
  // THE NUMBER: one console.log, inside say(), fed only by gateLine.
  ok((code.match(/console\.log/g) || []).length === 1,
    'there is still exactly one console.log in the file');
  ok(/function say\(line\) \{\s*console\.log\(line\);/.test(code),
    'and it prints only what it was handed');
  ok(/say\(gateLine\(attempt, what, detail, at\)\);/.test(code),
    'and the only thing handed to it comes out of gateLine');

  // THE FILE THAT OWNS THE RULE MUST NOT BE THE ONE MARKED FOR DELETION.
  ok(/COMES OUT AFTER/.test(log),
    'the gate log still says out loud that it gets deleted');
  ok(!/COMES OUT AFTER/.test(read('src/maskNumbers.js')),
    'and the rule itself does NOT, so it survives that deletion');
}

console.log('\n=== 8. THE SECOND LEAK: A FILE THAT LEAVES THE PHONE ===');
{
  // FOUND WHILE FIXING THE FIRST. The reader's raw capture is written to a file
  // and then handed to the phone's own share sheet, which sends it off the device.
  // His rule names files and outputs, and that is both.
  const screen = read('src/ConnectScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/import \{ maskNumbers \} from '\.\/maskNumbers'/.test(code),
    'the connect screen takes the same one rule');
  ok(/file\.write\(rawJsonToShare\(\)\)/.test(code),
    'THE WRITTEN AND SHARED FILE IS MASKED');
  ok(/rawJsonToShare = useCallback\(\s*\(\) => maskNumbers\(JSON\.stringify\(raw/.test(code),
    'by one builder, so the file and the screen cannot be two different texts');
  ok(/const s = maskNumbers\(JSON\.stringify\(raw, null, 2\) \|\| ''\);/.test(code),
    'and the dump shown on screen is masked as well');
  // NO UNMASKED WRITE LEFT ANYWHERE IN THE FILE.
  ok(!/file\.write\(JSON\.stringify\(raw/.test(code),
    'and there is no unmasked write left in the file');
  const writes = code.match(/\bfile\.write\(/g) || [];
  ok(writes.length === 1, 'there is exactly one write, so there is one thing to check');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
