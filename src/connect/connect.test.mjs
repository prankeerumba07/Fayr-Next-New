// THE CONNECT JOURNEY: THE SHEET, AND THE CARD AFTERWARDS.
//
// FOR EVERY SHOP, because the owner asked for every marketplace and because a
// journey that works for Amazon and quietly does nothing for Zepto is the failure
// this project keeps finding.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PLATFORMS, PLATFORM_LIST } from '../platforms.js';
import { SHEET, sheetWords, verifiedCardWords } from './sheetWords.js';
import { accountNameFor, forgetAccountNames, rememberAccountName } from './accountName.js';
import { whereTheySignIn } from '../signin.js';
import { signInTapScript } from '../signinTap.js';
import { isTheShopsOwnSignInPage } from './gate.js';
import { watchSignInScript } from './watchSignIn.js';
import { I_HAVE_SIGNED_IN, NOT_SURE } from './gateWords.js';

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
const ok = (cond, why) => assert.ok(cond, why);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const design = readFileSync(join(ROOT, 'fayr-design.browser.jsx'), 'utf8');
const sheet = readFileSync(join(here, 'SignInSheet.js'), 'utf8');
const link = readFileSync(join(ROOT, 'src/screens/linkaccount.js'), 'utf8');
// THE TWO SCREENS AND THE GATE, READ AS TEXT. Neither screen can be run under
// node: both are React Native and one of them needs a real web view with a real
// shop's page in it. The decisions are all in src/connect/gate.js, which is pure
// and is checked by really running it. What is left is the wiring between the
// two, and every bit of that is a line of source, so every bit of it can be read
// off disk. See section 5.
const connectScreen = readFileSync(join(ROOT, 'src/ConnectScreen.js'), 'utf8');
const gateSource = readFileSync(join(here, 'gate.js'), 'utf8');
const theme = readFileSync(join(ROOT, 'src/ui/theme.js'), 'utf8');
// THE FOUR FILES THE SIGN IN PATH RUNS THROUGH, read as text, because the one
// place rule below is a rule about where things are WRITTEN and can only be
// checked by going and looking.
const gate = readFileSync(join(here, 'gate.js'), 'utf8');
const watcher = readFileSync(join(here, 'watchSignIn.js'), 'utf8');
const pageQuestions = readFileSync(join(here, 'pageQuestions.js'), 'utf8');
const tapScript = readFileSync(join(ROOT, 'src/signinTap.js'), 'utf8');

/**
 * ONE PIECE OF SOURCE, CUT OUT BY COUNTING ITS BRACKETS.
 *
 * Not by counting lines and not by a regular expression that stops at the first
 * closing bracket it meets, because every block below has brackets inside it and
 * a check that reads the wrong half of a block is worse than no check: it passes
 * on source it never saw.
 */
function blockAt(source, opensAt) {
  if (opensAt < 0) return null;
  let depth = 0;
  for (let i = source.indexOf('{', opensAt); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(opensAt, i + 1);
    }
  }
  return null;
}

/** Every piece of the screen that is drawn ONLY when this is not a sign in visit. */
function onlyWhenNotSigningIn(source) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf('{!toSignIn ? (', from);
    if (at < 0) return out;
    const block = blockAt(source, at);
    if (block == null) return out;
    out.push(block);
    from = at + block.length;
  }
}

/** One named style, out of a StyleSheet. */
function styleNamed(source, name) {
  return blockAt(source, source.indexOf(`\n  ${name}: {`));
}

console.log('\nThe connect journey: the sheet, and the card afterwards');

// ── 1. THE SHEET IS THE DESIGN'S OWN SHEET ──────────────────────────────────
// Read out of the design file itself, by finding the sheet rather than trusting a
// line number, so moving a line in the design cannot make this pass wrongly.

const at = design.indexOf('function TruecallerSheet');
const truecaller = design.slice(at, design.indexOf('\nfunction ', at + 10));

t('the design still has the sheet this one was copied from', () => {
  ok(at > 0, 'fayr-design.browser.jsx must still hold TruecallerSheet');
  ok(truecaller.length > 400 && truecaller.length < 4000,
    'and it must be one sheet, not the whole file');
});

t('every number in the sheet is the design’s own number', () => {
  const wanted = [
    ['the dark layer over the page behind', 'rgba(20,20,20,.45)', SHEET.backdrop.replace('0.45', '.45')],
    ['the sheet’s top left corner', 'borderTopLeftRadius: 26', `${SHEET.topRadius}`],
    ['the sheet’s top right corner', 'borderTopRightRadius: 26', `${SHEET.topRadius}`],
    ['the sheet’s own padding', 'padding: "24px 24px 26px"',
      `${SHEET.padTop} ${SHEET.padSide} ${SHEET.padBottom}`],
  ];
  for (const [what, inDesign] of wanted) {
    ok(truecaller.includes(inDesign),
      `the design must still say ${inDesign} for ${what}; if the design changed, `
      + 'change src/connect/sheetWords.js to match it and not the other way round');
  }
  assert.equal(SHEET.topRadius, 26, 'the corners are the design’s 26');
  assert.equal(SHEET.padTop, 24, 'the top padding is the design’s 24');
  assert.equal(SHEET.padSide, 24, 'the side padding is the design’s 24');
  assert.equal(SHEET.padBottom, 26, 'the bottom padding is the design’s 26');
  assert.equal(SHEET.backdrop, 'rgba(20,20,20,0.45)', 'and the dark layer is its own');
});

t('the little bar at the top is the design’s own bar', () => {
  ok(/width: 44, height: 4, background: "#e2e2d6", borderRadius: 4/.test(truecaller),
    'the design must still draw a 44 by 4 bar in #e2e2d6 with a 4 point corner');
  assert.equal(SHEET.grabberWidth, 44);
  assert.equal(SHEET.grabberHeight, 4);
  assert.equal(SHEET.grabberColor, '#e2e2d6');
  assert.equal(SHEET.grabberRadius, 4);
  ok(/margin: "0 auto 18px"/.test(truecaller),
    'and it must still sit 18 points above what follows it');
  assert.equal(SHEET.grabberGapBelow, 18);
});

t('the round tile, the name and the small print are the design’s sizes', () => {
  ok(/width: 70, height: 70/.test(truecaller), 'the design’s tile is 70 across');
  assert.equal(SHEET.markSize, 70);
  ok(/margin: "16px auto 10px"/.test(truecaller), 'with 16 above it and 10 below');
  assert.equal(SHEET.markGapAbove, 16);
  assert.equal(SHEET.markGapBelow, 10);
  ok(/fontSize: 20, color: C\.ink2/.test(truecaller), 'the design’s name is 20');
  assert.equal(SHEET.nameSize, 20);
  ok(/fontSize: 10\.5, color: "#a3a49a"/.test(truecaller),
    'and its small print is 10.5 in #a3a49a');
  assert.equal(SHEET.noteSize, 10.5);
  assert.equal(SHEET.noteColor, '#a3a49a');
});

t('and the sheet really uses those numbers rather than its own', () => {
  for (const key of Object.keys(SHEET)) {
    ok(sheet.includes(`SHEET.${key}`),
      `the drawing must take ${key} from the design’s numbers, not write its own`);
  }
});

t('it rises from the bottom, at the design’s own speed', () => {
  ok(/animation: "fayr-rise \.35s/.test(truecaller),
    'the design’s sheet rises over a third of a second');
  assert.equal(SHEET.riseMs, 350, 'which is 350 milliseconds');
  ok(/translateY\(14px\)/.test(design),
    'and the design’s own rise starts 14 points below where it lands');
  assert.equal(SHEET.riseFrom, 14);
  ok(sheet.includes('translateY'), 'so the sheet must move, not just appear');
});

// ── 2. WHAT THE SHEET SAYS, FOR EVERY SHOP ──────────────────────────────────

t('every shop gets a sheet, with that shop’s own name on the button', () => {
  for (const shop of PLATFORM_LIST) {
    const words = sheetWords(shop.name);
    assert.equal(words.button, `CONTINUE WITH ${shop.name.toUpperCase()}`,
      `${shop.key}: the button must read CONTINUE WITH ${shop.name.toUpperCase()}`);
    ok(words.used.includes(shop.name),
      `${shop.key}: the line about what the sign in is for must name the shop`);
    ok(words.never.includes(shop.name),
      `${shop.key}: and so must the line about what Fayr can never see`);
  }
});

t('the sheet carries the one line about what the sign in is used for', () => {
  const words = sheetWords('Amazon');
  ok(words.used.length > 40, 'there must be a real sentence, not a label');
  ok(/own Amazon order/.test(words.used) && /own Amazon review/.test(words.used),
    'and it must say what Fayr actually needs to see: that person’s own order and '
    + 'their own review');
  ok(/Nothing else is read/.test(words.used),
    'and that nothing else is read, which is the part somebody signing in cares about');
});

t('and it links to the terms and the privacy policy', () => {
  assert.equal(sheetWords('Amazon').agree,
    'By continuing you agree to our Terms & Privacy Policy.',
    'the design’s own sentence, from its own sign in page');
  ok(design.includes('By continuing you agree to our <u>Terms</u> &amp; <u>Privacy Policy</u>.')
    || design.includes('By continuing you agree to our <u>Terms</u> & <u>Privacy Policy</u>.'),
    'and the design must still say it that way');
  ok(/onPress=\{onTerms\}/.test(sheet) && /onPress=\{onPrivacy\}/.test(sheet),
    'both words must be tappable on the sheet itself');
  ok(/navigation\.navigate\('Policy', \{ doc: 'terms' \}\)/.test(link)
    && /navigation\.navigate\('Policy', \{ doc: 'privacy' \}\)/.test(link),
    'and each one must really open its own document');
});

t('tapping connect opens the sheet, and only the sheet’s button opens the shop', () => {
  // THE CONNECT BUTTON ITSELF, not just some control on the page. This was
  // written loosely first and a deliberate break slipped past it, because the
  // MANAGE control on the verified card also opens the sheet.
  ok(/<Pill onPress=\{askFirst\} color=\{COLOR\.ink\}>\s*\n\s*CONNECT MY /.test(link),
    'the CONNECT MY {SHOP} ACCOUNT button must open the sheet and nothing else');
  ok(!/<Pill onPress=\{openShop\}/.test(link),
    'and no button on this page may open the shop directly, skipping the sheet');
  ok(/const askFirst = useCallback\(\(\) => setSheetUp\(true\)/.test(link),
    'and opening the sheet must be all it does');
  ok(/onContinue=\{openShop\}/.test(link),
    'the sheet’s own button is the thing that opens the shop');
  ok(/navigation\.navigate\(key, \{ campaignId, toSignIn: true \}\)/.test(link),
    'and it opens it as a sign in visit, so the shop’s own sign in is what appears');
});

t('the sheet is not a sign in, and imitates nothing', () => {
  for (const word of ['TextInput', 'password', 'otp', 'secure', 'placeholder']) {
    ok(!new RegExp(word, 'i').test(sheet.replace(/\/\/[^\n]*/g, '')),
      `the sheet must not so much as mention ${word}: it is Fayr saying what is `
      + 'about to happen, and then the person signs in on the shop’s own real page');
  }
});

// ── 3. THE CARD AFTERWARDS, FOR EVERY SHOP ──────────────────────────────────

t('every shop gets a verified card with that shop’s own name on it', () => {
  for (const shop of PLATFORM_LIST) {
    const card = verifiedCardWords(shop.name, 'Manisha Dahiya');
    assert.equal(card.title, `VERIFIED ${shop.name.toUpperCase()} ACCOUNT`,
      `${shop.key}: the card must read VERIFIED ${shop.name.toUpperCase()} ACCOUNT`);
    assert.equal(card.manage, 'MANAGE', `${shop.key}: and carry a MANAGE control`);
  }
});

t('when the name is known, the card carries it', () => {
  const card = verifiedCardWords('Amazon', 'Manisha Dahiya');
  assert.equal(card.name, 'Manisha Dahiya');
  assert.equal(card.showsName, true);
  assert.equal(card.under, 'Signed in on Amazon');
});

t('when it is not known, the card says connected and shows NO name', () => {
  for (const nothing of [null, undefined, '', '   ', 0, false]) {
    const card = verifiedCardWords('Blinkit', nothing);
    assert.equal(card.name, null,
      'a name that was not read is nothing at all, never an empty string');
    assert.equal(card.showsName, false,
      'so the row where a name goes is not drawn, rather than drawn empty');
    ok(/Signed in on Blinkit/.test(card.under),
      'and the card still says the account is connected');
    ok(/could not read the name/.test(card.under),
      'and says plainly why no name is shown');
  }
});

// THIS CHECK USED TO PIN A HOLE OPEN, and that is worth writing down where the
// next person will read it. Until 5 September 2026 src/connect/accountName.js
// remembered nothing at all, because the only thing in Fayr that can see inside a
// shop's page is the connect screen and the connect screen was frozen. So this
// check called accountNameFor('amazon'), got nothing back, and asserted that
// nothing was the correct answer. It was not checking a rule. It was writing down
// which half was missing, and it would have gone on passing on the day a name
// started arriving, and gone on passing if the name had started arriving wrong.
//
// THE GATE UNFROZE THAT SCREEN AND THE NAME IS REAL NOW. So this checks the real
// rule instead: where a name is allowed to come from, what is refused, that one
// shop's name is never another's, that forgetting really empties it, and that the
// card still has only its two shapes.
t('the name on the card is the shop’s own, and it is never invented', () => {
  forgetAccountNames();
  assert.equal(accountNameFor('amazon'), null,
    'with nothing remembered there is no name at all, and the answer is nothing '
    + 'rather than an empty piece of text, because the card draws the row a name '
    + 'goes in only when there is a name to put in it');
  const nothingYet = verifiedCardWords('Amazon', accountNameFor('amazon'));
  assert.equal(nothingYet.showsName, false);
  ok(/could not read the name/.test(nothingYet.under),
    'and the card says plainly that the name could not be read');

  rememberAccountName('amazon', 'Prakash');
  assert.equal(accountNameFor('amazon'), 'Prakash',
    'the name the shop itself printed at the top of its own page is the name that '
    + 'comes back, and it is the only place a name ever comes from');
  const known = verifiedCardWords('Amazon', accountNameFor('amazon'));
  assert.equal(known.name, 'Prakash');
  assert.equal(known.showsName, true);
  assert.equal(known.under, 'Signed in on Amazon',
    'and the card then says only that, with no sentence about a name it could not read');

  assert.equal(accountNameFor('flipkart'), null,
    'one shop’s name is never another shop’s: a name read off Amazon says '
    + 'nothing whatever about Flipkart');

  // NOT A NAME IS NOT REMEMBERED, and it does not push out the real name either.
  // A shop's own page is what sends these words, so anything at all can arrive.
  for (const [what, value] of [
    ['nothing at all', null],
    ['not set', undefined],
    ['empty', ''],
    ['spaces', '   '],
    ['a number', 12345],
    ['true', true],
    ['an object', { name: 'Prakash' }],
    ['a list', ['Prakash']],
  ]) {
    rememberAccountName('amazon', value);
    assert.equal(accountNameFor('amazon'), 'Prakash',
      `${what} is refused outright, and it does not throw away the real name either`);
  }

  forgetAccountNames();
  assert.equal(accountNameFor('amazon'), null,
    'and forgetting really empties it, so no check can carry a name into the next '
    + 'one and no shop can be greeted by a name read off another');

  // TWO SHAPES AND NO THIRD. Either the card carries a name, or it carries no
  // name and the sentence saying the name could not be read. Never both, never
  // neither, and never a blank where a name goes.
  const shapes = new Set();
  for (const value of [
    'Prakash', 'Manisha Dahiya', '  Prakash  ',
    null, undefined, '', '   ', 0, false, 12345, {},
  ]) {
    const card = verifiedCardWords('Amazon', value);
    if (card.showsName) {
      ok(typeof card.name === 'string' && card.name.trim() !== '',
        'a card that shows a name must have a real name to show');
      ok(!/could not read the name/.test(card.under),
        'and it must not also say the name could not be read');
      shapes.add('a name on the card');
    } else {
      assert.equal(card.name, null,
        'a name that was not read is nothing at all, never an empty piece of text');
      ok(/could not read the name/.test(card.under),
        'and the card says the account is connected and why no name is shown');
      shapes.add('no name, and the sentence saying so');
    }
  }
  assert.equal(shapes.size, 2,
    `the card must have exactly two shapes; these were ${JSON.stringify([...shapes])}`);
});

t('and the drawing never leaves a blank where a name goes', () => {
  ok(/card\.showsName \? \(/.test(link),
    'the name row must be drawn only when there is a name to put in it');
  ok(!/\{card\.name\}<\/Text>\s*\n\s*<Text style=\{styles\.verifiedUnder/.test(link)
    || /card\.showsName/.test(link),
    'it must never be drawn unconditionally');
});

t('the card appears once the person says they have signed in', () => {
  ok(/setConnected\(true\)/.test(link),
    'saying "I have signed in" must bring the card up');
  ok(/hasVisitedShop\(campaignId, SIGNED_IN\)/.test(link),
    'and coming back to the screen must show the card rather than the button again, '
    + 'read from the note that was already written');
  ok(/\{connected \? \(/.test(link), 'and the card is drawn on that answer');
});

t('and the journey still carries on by itself afterwards', () => {
  ok(/markVisitedShop\(campaignId, SIGNED_IN\)/.test(link),
    'the note that moves the journey on must still be written');
  ok(/params\.onJourneyMoved/.test(link),
    'and the journey must still be asked to look again, exactly as before');
});

// ── 4. ALL SEVEN SHOPS WALK THE WHOLE JOURNEY ───────────────────────────────

t('every shop in PLATFORMS walks the whole journey with nothing missing', () => {
  const broken = [];
  for (const key of Object.keys(PLATFORMS)) {
    const shop = PLATFORMS[key];
    const where = whereTheySignIn(key);
    const words = sheetWords(shop.name);
    const card = verifiedCardWords(shop.name, accountNameFor(key));
    const reasons = [];
    if (!shop.name) reasons.push('no name to put on anything');
    if (!words.button.includes(shop.name.toUpperCase())) reasons.push('no button');
    if (!words.used.includes(shop.name)) reasons.push('no line saying what it is for');
    if (!words.agree.includes('Terms')) reasons.push('no link to the terms');
    if (!card.title.includes(shop.name.toUpperCase())) reasons.push('no verified card');
    if (card.manage !== 'MANAGE') reasons.push('nothing to manage it with');
    if (!where.url) reasons.push('nowhere to send them');
    if (!where.onItsOwnPage && signInTapScript(key) == null) {
      reasons.push('no sign in page and no way to reach one');
    }
    if (reasons.length) broken.push(`${key}: ${reasons.join('; ')}`);
  }
  assert.deepEqual(broken, [], '\n  ' + broken.join('\n  '));
  assert.equal(Object.keys(PLATFORMS).length, 7, 'and all seven were walked');
});

// ── 5. THE SCREEN THE SHOP'S PAGE OPENS IN, READ AS TEXT ────────────────────
//
// WHAT IS BEING CHECKED HERE IS THE WIRING, and only the wiring. Every decision
// about what is on screen lives in src/connect/gate.js, which is pure and is
// checked by really running it, failures included. What that leaves is whether
// the screen hands the gate the things it needs and leaves off the things that
// must not be on a sign in visit, and every one of those is a single line of
// source in src/ConnectScreen.js.
//
// AND EVERY LINE BELOW WAS MISSING AT SOME POINT. A person who tapped "connect my
// account" got the shop's shopping page, or its captcha, or the web view
// library's own untranslated "Error loading page / Domain: NSURLErrorDomain /
// Error Code: -1009", with Fayr's own hint bar above it telling them to tap a
// button about reading their reviews. So each of these is a hole that was open.
//
// WHY IT IS READ AND NOT RUN. That screen is React Native and it needs a phone, a
// web view and a shop's real page. Nothing under node can run it. Reading it is
// what can be done without a phone, and it catches the failure that actually
// happens: a prop quietly dropped.

t('the screen takes every decision from the gate, and invents none of its own', () => {
  const importEnds = connectScreen.indexOf("} from './connect/gate'");
  ok(importEnds > 0,
    'src/ConnectScreen.js must take its decisions from src/connect/gate.js, which '
    + 'is the pure file every one of those decisions is checked in');
  const importBegins = connectScreen.lastIndexOf('import {', importEnds);
  const imported = connectScreen
    .slice(importBegins + 'import {'.length, importEnds)
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);
  ok(imported.length >= 5,
    'and it must take the real decisions from it, not one constant');
  for (const name of imported) {
    ok(new RegExp(`export (function|const) ${name}\\b`).test(gateSource),
      `${name} must really be the gate's own, so the check that runs the gate is `
      + 'checking the thing the screen uses');
  }
  for (const needed of ['isForTheGate', 'whatIsOnScreen', 'whatWeSay', 'shopMayBeSeen']) {
    ok(imported.includes(needed),
      `the screen must ask the gate ${needed} rather than working it out again`);
  }
});

t('a shop that will not open is heard, both of the ways it can say so', () => {
  // The web view element itself, cut out so a prop written somewhere else on the
  // screen cannot make this pass. Both of these were missing, which is why the
  // library's own error panel was what a person saw. The app's two other web view
  // screens have had them all along.
  const from = connectScreen.indexOf('<WebView');
  ok(from > 0, 'the screen must still draw a web view');
  const closes = /\/>\s*\n\s*\)/.exec(connectScreen.slice(from));
  ok(closes, 'and that web view must close');
  const webview = connectScreen.slice(from, from + closes.index);

  // EITHER SHAPE COUNTS: the handler named on its own, or called in place so the
  // attempt this view was built with can be handed over with the event. The second
  // is what it became on 7 September 2026, and the check asks for the STAMP
  // separately below rather than pinning one spelling of the wiring.
  const goesTo = (prop) => {
    const m = new RegExp(`${prop}=\\{\\s*(?:\\([a-z]*\\)\\s*=>\\s*)?([A-Za-z0-9_.]+)`).exec(webview);
    return m ? m[1] : null;
  };
  const onError = goesTo('onError');
  const onHttpError = goesTo('onHttpError');
  ok(onError, 'the web view must be told what to do when the shop cannot be reached');
  ok(onHttpError, 'and what to do when the shop answers with an error of its own');
  assert.equal(onError, onHttpError,
    'and both must go to the same handler, because to the person waiting they are '
    + 'the same thing: the shop did not open');

  // And the handler really does something, so the two props above are not wired
  // to a function that shrugs.
  const declaredAt = connectScreen.indexOf(`const ${onError} = useCallback`);
  ok(declaredAt > 0, `${onError} must be a real handler on this screen`);
  const handler = connectScreen.slice(declaredAt, connectScreen.indexOf('}, [', declaredAt));
  ok(handler.includes('shouldActOnFailure({'),
    'and whether to act on a failure must be asked of the gate, not decided here: '
    + 'a phone cannot be made to produce a dying view’s last word on demand, and in '
    + 'gate.js every combination of these facts is checked under node');
  ok(handler.includes('setItWillNotOpen(true)'),
    'and otherwise it must tell the gate the shop did not open');
});

t('the watcher is added on a sign in visit and on no other kind of visit', () => {
  const injected = /injectedJavaScript=\{([^}]*)\}/.exec(connectScreen);
  ok(injected, 'the screen must say what it puts into the shop’s page');
  assert.equal(injected[1].trim(), 'toSignIn ? watchSignInScript() : undefined',
    'the watcher only ever goes in on a visit made to sign in. A reading visit '
    + 'works today and putting anything new into its page risks it for nothing');
  ok(connectScreen.includes('injectedJavaScriptBeforeContentLoaded={platform.beforeLoadScript}'),
    'and the shop’s own script the reader has always injected is left exactly as '
    + 'it was, byte for byte, because that is the part that works');
});

t('nothing of the reader’s is on screen on a sign in visit', () => {
  // THE HINT BAR AND THE FETCH BUTTON ARE THE READER'S, not the sign in's. The
  // hint bar tells somebody to tap a button about reading their reviews and the
  // button offers to read them, and a person who tapped "connect my account" is
  // there to sign in. Both were on screen over a shop's sign in page.
  const branches = onlyWhenNotSigningIn(connectScreen);
  ok(branches.length >= 2,
    'at least the hint bar and the fetch button must be left off a sign in visit');
  const hintBar = branches.filter((piece) => piece.includes('styles.hintBar'));
  const fetchButton = branches.filter((piece) => /styles\.fetchBtn\b/.test(piece));
  assert.equal(hintBar.length, 1,
    'the hint bar must be drawn inside a piece that only appears when this is not '
    + 'a sign in visit');
  assert.equal(fetchButton.length, 1, 'and so must the fetch button');
  assert.equal((connectScreen.match(/styles\.hintBar/g) || []).length, 1,
    'and the hint bar must be drawn in that one place and nowhere else, or it is '
    + 'back on screen by the other door');
  assert.equal((connectScreen.match(/styles\.fetchBtn\b/g) || []).length, 1,
    'and the fetch button in that one place and nowhere else');
  ok(/onPress=\{fetchReviews\}/.test(fetchButton[0]),
    'and the button left off is really the one that reads the reviews');
});

t('a message from the shop’s page reaches the gate before the reader’s handler', () => {
  const gateAt = connectScreen.indexOf('isForTheGate(msg)');
  const readerAt = connectScreen.indexOf('if (!msg.ok)');
  ok(gateAt > 0, 'the screen must ask whether a message is the gate’s business');
  ok(readerAt > 0, 'and the reader’s own handler must still be there');
  ok(gateAt < readerAt,
    'the gate must be asked FIRST. The reader’s handler treats anything without '
    + 'ok as a failed read, so a sign in signal falling into it puts the words '
    + '"Fetch failed" on a screen where nothing has failed. This is the one thing '
    + 'src/connect/accountName.js asked for in writing for weeks');
});

t('and the shop’s page cannot unstick the reader’s fetch button', () => {
  const block = blockAt(connectScreen, connectScreen.indexOf('if (isForTheGate(msg))'));
  ok(block, 'the gate’s own messages must be handled in a block of their own');
  ok(!block.includes('setBusy'),
    'and that block must not touch setBusy. It belongs to the reader’s fetch '
    + 'button and a gate message is not an answer to a fetch, so clearing it here '
    + 'would let a shop’s own page unstick that button by posting something we '
    + 'never asked for');
  ok(connectScreen.includes('setBusy(false)'),
    'while the reader’s own handler still clears it, so the check above is about '
    + 'where it is and not about whether it exists');
  ok(/return;\s*\}$/.test(block.trim()),
    'and the block ends by returning, so a gate message goes no further');
});

t('our own screen over the shop’s really covers it', () => {
  // A GAP ANYWHERE IN IT IS THE SHOP'S PAGE SHOWING THROUGH, and the whole point
  // is that the shop's shopping page, its captcha, its "install our app" and the
  // library's error panel are shown to nobody.
  const cover = styleNamed(connectScreen, 'gate');
  ok(cover, 'the cover must be a style of its own, named so it can be read');
  ok(/position: 'absolute'/.test(cover), 'it must be laid over the page, not beside it');
  for (const edge of ['top', 'left', 'right', 'bottom']) {
    ok(new RegExp(`\\b${edge}: 0\\b`).test(cover),
      `and pinned to the ${edge} of the screen, because a gap on one side is `
      + 'enough to see the shop’s page through');
  }
  const ground = /backgroundColor: (COLOR\.[A-Za-z0-9]+|'[^']+')/.exec(cover);
  ok(ground, 'and it must paint a ground of its own');
  ok(ground[1] !== "'transparent'", 'a see through cover covers nothing');
  ok(!/rgba|hsla/.test(ground[1]),
    'and a colour with any amount of see through in it covers nothing either');
  if (ground[1].startsWith('COLOR.')) {
    const token = ground[1].slice('COLOR.'.length);
    const value = new RegExp(`\\b${token}: '([^']+)'`).exec(theme);
    ok(value, `${ground[1]} must be a real colour in src/ui/theme.js`);
    ok(/^#[0-9a-fA-F]{6}$/.test(value[1]),
      `${ground[1]} is ${value ? value[1] : 'nothing'}, and it has to be a solid `
      + 'colour with nothing see through about it');
  }
  ok(/const ourOwnWords = gate != null && !shopMayBeSeen\(gate\) \? whatWeSay\(gate\) : null;/
    .test(connectScreen),
    'and the cover lifts on one question asked in one place, so it cannot be '
    + 'right in one branch and wrong in another');
});

t('and then the shop’s page closes itself, back to the screen that sent them', () => {
  ok(/navigation\.navigate\('linkaccount', \{[^}]*justSignedIn: true[^}]*\}\)/
    .test(connectScreen),
    'a person who has signed in goes back to the offer they claimed, and Fayr says '
    + 'it saw the sign in, so nobody has to tell it what it just watched happen');
  ok(connectScreen.includes('SIGNED_IN_SHOWS_FOR_MS'),
    'and the line saying they are signed in stays up for the gate’s own breath '
    + 'first, so the screen does not vanish before it has been read');
});

// ── 5b. BUG ONE. TRY AGAIN REALLY ASKS THE SHOP AGAIN ──────────────────────
//
// THE OWNER FOUND THIS ON A REAL PHONE, 5 September 2026. Airplane mode on, tap
// connect, wait, get the failure with its button. Airplane mode off, wait for the
// network, tap Try again: "IT STAYED ON THE FAILURE SCREEN. He tapped it several
// more times. Nothing ever happened."
//
// AND THE CHECK THAT WAS HERE COULD NOT HAVE CAUGHT IT. It asked whether the
// button was wired to tryAgain and whether tryAgain called reload, and both were
// true. The bug was that reload does nothing at all on a view whose load failed:
// there is no page committed, so there is nothing to fetch again, and the failure
// the view is still holding is handed straight back.
//
// SO THIS ASKS THE ONLY QUESTION THAT SETTLES IT: is the view really thrown away
// and rebuilt. That is a key on the web view that changes, and the thing it is
// built from being the very thing the button moves.
t('the try again button is wired to something that really runs', () => {
  ok(/onPress=\{whatEachControlDoes\[control\.does\]\}/.test(connectScreen),
    'every control our own screen draws is wired to the one thing the gate said '
    + 'it does, and never to nothing and never to a guess made while drawing');
  const map = connectScreen.slice(
    connectScreen.indexOf('const whatEachControlDoes = {'),
    connectScreen.indexOf('};', connectScreen.indexOf('const whatEachControlDoes = {')),
  );
  ok(/\[ASK_THE_SHOP_AGAIN\]: tryAgain/.test(map),
    'asking the shop again really runs tryAgain');
  ok(/\[THEY_SAY_THEY_ARE_IN\]: theySayTheyAreIn/.test(map),
    'and saying they signed in really runs theySayTheyAreIn');
  ok(gate.includes('ASK_THE_SHOP_AGAIN') && gate.includes('THEY_SAY_THEY_ARE_IN'),
    'and both of those are the gate’s own names, so a control the gate adds later '
    + 'cannot quietly land on the wrong one');
});

t('and tryAgain throws the view away rather than asking it to reload', () => {
  const fn = connectScreen.slice(
    connectScreen.indexOf('const tryAgain = useCallback('),
    connectScreen.indexOf('const theySayTheyAreIn = useCallback('),
  );
  ok(fn.length > 50, 'tryAgain is really in this file');
  ok(fn.includes('setSignInIsUp(false)'),
    'it forgets that a sign in was ever seen, so the cover goes back on');
  ok(fn.includes('setSignInIsGone(false)'), 'it forgets that a sign in had gone away');
  ok(fn.includes('setTheyAreIn(false)'), 'it forgets that anybody was in');
  ok(fn.includes('setItWillNotOpen(false)'), 'it forgets the failure itself');
  ok(/setAskedAt\(at\)/.test(fn) && /setNowIs\(at\)/.test(fn),
    'it starts the wait again from now, so the fifteen seconds are a fresh '
    + 'fifteen and not already spent');

  // THE ONE THAT MATTERS, AND THE ONE THE OLD CHECK DID NOT ASK.
  const counted = /set([A-Za-z]+)\(\(([a-z]+)\) => \2 \+ 1\)/.exec(fn);
  ok(counted,
    'IT MUST COUNT SOMETHING UP. A view whose load failed holds no page, so asking '
    + 'it to reload does nothing at all and the person is left tapping a button '
    + 'that cannot work. The only thing that really asks the shop again is a NEW '
    + 'view, and a new view is a changed key');
  const held = counted[1].charAt(0).toLowerCase() + counted[1].slice(1);

  // And the count really is what the web view is built from.
  const view = connectScreen.slice(
    connectScreen.indexOf('<WebView'),
    connectScreen.indexOf('startInLoadingState'),
  );
  const key = /\n\s*key=\{([^}]+)\}/.exec(view);
  ok(key, 'the web view must carry a key of its own, or nothing can rebuild it');
  ok(key[1].includes(held),
    `the web view’s key must be built from ${held}, which is the very thing the `
    + 'button moves. A key built from anything else is a button that counts up '
    + 'and changes nothing');
  ok(/shopViewKey\(/.test(key[1]),
    'and it goes through the gate’s own shopViewKey, which is checked under node '
    + 'to give a different answer every time');

  // AND NOT THE OLD WAY. Reload on its own is the bug, and it must not come back.
  ok(!/webRef\.current\?\.reload\(\)/.test(fn),
    'and it must NOT be asking the old view to reload, which is what did nothing');

  // THE CLOCK MUST BE ABLE TO FIRE AGAIN. Without the count among the things the
  // waiting effect watches, two taps inside one millisecond leave askedAt
  // unchanged, React skips the render, and the second attempt gets no wait at all.
  // THE END ANCHOR WAS DEAD AND NOBODY KNEW, found on 15 September 2026. The
  // screen says `const gateSays = toSignIn`, never `const gate = toSignIn`, so
  // indexOf answered -1, and slice(start, -1) is not "up to nothing" — it is "up
  // to the last character of the file". This check had been reading twenty
  // kilobytes of screen and passing on the first two-space `}, [...]);` it met,
  // which happened to still be the right one. It is the same class as the
  // sendFoundOrders regex that matched a different function further down its
  // file. So the anchor is asserted before it is used, and a dead one now fails
  // here instead of quietly widening the thing it was meant to narrow.
  const clockEndsAt = connectScreen.indexOf('const gateSays = toSignIn');
  ok(clockEndsAt > 0,
    'the slice that holds the waiting clock must really end where it says it does, '
    + 'or this check silently reads the whole screen and proves nothing');
  const waiter = connectScreen.slice(
    connectScreen.indexOf('// THE ONE CLOCK THAT MAKES THE WAIT REAL'),
    clockEndsAt,
  );
  // THE DEPENDENCY LIST ITSELF, and not the effect around it. A first attempt at
  // this check read the whole effect, and the comment inside it names the very
  // thing the list must hold, so taking it out of the LIST still passed.
  const watches = /\n  \}, \[([^\]]*)\]\);/.exec(waiter);
  ok(watches, 'the waiting clock must say what it watches');
  const watched = watches[1].split(',').map((one) => one.trim());
  ok(watched.includes('askedAt'),
    'the waiting clock watches askedAt, so a second attempt can time out too');
  ok(watched.includes(held),
    `and it watches ${held} as well, so two taps in the same millisecond still `
    + `give the second one a wait of its own. It watches: ${watched.join(', ')}`);
  ok(/SHOP_HAS_THIS_LONG_MS/.test(waiter),
    'and it waits the one wait, never a number written into the screen');
});

t('and the shop answering with an error fails the same way as no answer at all', () => {
  // THE OTHER WAY IN. The owner asked for both: the shop not answering, and the
  // shop answering with an error. The web view library reports them separately.
  ok(/onError=\{[^}]*shopWillNotOpen\(/.test(connectScreen),
    'a shop that cannot be reached is handled');
  ok(/onHttpError=\{[^}]*shopWillNotOpen\(/.test(connectScreen),
    'and so is a shop that answers with an error, which is a different report '
    + 'from the library and used to reach nobody');
  const fn = connectScreen.slice(
    connectScreen.indexOf('const shopWillNotOpen = useCallback('),
    connectScreen.indexOf('// When a target product is set'),
  );
  ok(fn.includes('shouldActOnFailure({'),
    'and it must ask the gate whether to act rather than deciding for itself');
  for (const fact of ['toSignIn', 'fromAttempt', 'attemptNow: attemptNow.current',
    'theyAreIn', 'signInIsUp', 'signInIsGone']) {
    ok(fn.includes(fact),
      `and it must hand the gate ${fact}, or the gate is deciding on half the facts`);
  }
  ok(/if \(!act\)/.test(fn),
    'and when the gate says no it must stop there: a stray failure from some small '
    + 'thing on the page cannot throw away somebody who is already in, and a dead '
    + 'view’s last word cannot put the failure back over a shop that is loading');
  ok(fn.includes('setItWillNotOpen(true)'), 'and otherwise the failure screen comes up');
  ok(fn.includes('itWillNotOpenNow.current = true'),
    'and it says so somewhere the save handler can read AT ONCE, because the two '
    + 'run in one batch for the same failed load');
});

t('and a failed load never writes a signed out snapshot over a good one', () => {
  // THE FIX FOR THIS WAS A RACE. The library calls the failure handler and the
  // save handler for the SAME failed load, in one batch, so a state set in the
  // first was not visible in the second: it read the value from before the
  // failure, decided nothing had gone wrong, and wrote the empty snapshot anyway.
  // Somebody whose network dropped once came back to a shop they were no longer
  // signed in to, and nothing said why.
  const fn = connectScreen.slice(
    connectScreen.indexOf('const onLoadEnd = useCallback('),
    connectScreen.indexOf('const shopWillNotOpen = useCallback('),
  );
  ok(fn.includes('if (itWillNotOpenNow.current) return;'),
    'the save handler reads the failure from a ref, which is true the instant the '
    + 'failure arrives, and not from state, which is not');
  ok(!/if \(itWillNotOpen\) return;/.test(fn),
    'and never from the state, which is the version that did not work');
  const tryAgainFn = connectScreen.slice(
    connectScreen.indexOf('const tryAgain = useCallback('),
    connectScreen.indexOf('const theySayTheyAreIn = useCallback('),
  );
  ok(tryAgainFn.includes('itWillNotOpenNow.current = false'),
    'and a new attempt clears it, or the new view could never save a thing');
});

// ── 5c. BUG THREE. THE COVER GOES BACK ON THE MOMENT THE SIGN IN GOES ───────
//
// "Signed in to Amazon. For a split second Amazon's home page was on screen, and
// then Fayr came back." The cover came off correctly when the sign in appeared,
// and nothing put it back until the watcher's next look.
t('the cover goes back on the moment the shop leaves its own sign in page', () => {
  const fn = connectScreen.slice(
    connectScreen.indexOf('const onNav = useCallback('),
    connectScreen.indexOf('const onLoadEnd = useCallback('),
  );
  ok(fn.includes('isTheShopsOwnSignInPage'),
    'the screen must ask, on every navigation, whether the shop is still on its '
    + 'own sign in page');
  ok(fn.includes('pathOf('),
    'and it must take the path out of the address through the one function that '
    + 'is checked under node, not by pulling the address apart here');
  ok(/!isTheShopsOwnSignInPage\(path\)\) \{\s*\n\s*setSignInIsUp\(false\);/.test(fn),
    'and when it is NOT, the cover goes straight back on, without waiting for a '
    + 'look. This is the split second of Amazon’s home page the owner saw');
  ok(fn.includes('toSignIn &&'),
    'and only on a visit made to sign in, because a reading visit is not gated');
  ok(/toSignIn && signInIsUp &&/.test(fn),
    'and only on the one moment the cover really goes back on, so an ordinary '
    + 'navigation cannot push the wait out for ever and stop it timing out');
  ok(/setAskedAt\(at\);\s*\n\s*setNowIs\(at\);/.test(fn),
    'and the wait starts again from that moment, because signing in takes a person '
    + 'longer than fifteen seconds and the first fifteen are long gone by then');
});

t('and the multi step sign in cannot make the cover flash', () => {
  // AMAZON ASKS FOR THE NUMBER ON ONE PAGE AND THE CODE ON THE NEXT, and both are
  // its own sign in pages. The one question above is what decides, so it is the
  // one that has to know that.
  ok(isTheShopsOwnSignInPage('/ap/signin'), 'Amazon’s first sign in page is one');
  ok(isTheShopsOwnSignInPage('/ap/cvf/request'), 'and its second one is too');
  ok(isTheShopsOwnSignInPage('/ap/challenge'), 'and so is its challenge page');
  ok(!isTheShopsOwnSignInPage('/'), 'while its home page is not, so the cover goes back on there');
});

t('the script that goes inside the shop’s page is real, working javascript', () => {
  // A HOLE IN THESE CHECKS, FOUND BY READING THEM RATHER THAN BY A MUTATION. The
  // watcher is built by joining strings together, and nothing here had ever asked
  // whether the result even PARSES. A stray bracket in any one of the pieces
  // would silence the whole thing on every shop, on a real phone, with every
  // check in this project still green: the screen would cover the shop, wait
  // fifteen seconds and say it did not open, for ever.
  const script = watchSignInScript();
  ok(script.length > 500, 'there is really a script');
  // eslint-disable-next-line no-new-func
  new Function(script);   // throws on a syntax error, which fails this check

  // And every question it asks is really defined in it, so a renamed helper next
  // door cannot leave a call to something that does not exist.
  for (const asked of ['fayrIsAPuzzle', 'fayrSignInIsUp', 'fayrWholeLabel', 'fayrGreeting']) {
    ok(new RegExp(`function ${asked}\\(`).test(script),
      `${asked} is defined inside the script`);
    ok(new RegExp(`${asked}\\(`).test(script.replace(new RegExp(`function ${asked}\\(`, 'g'), '')),
      `and ${asked} is really called`);
  }
  // It says something exactly one way, and that way is the one the gate reads.
  ok(/postMessage\(JSON\.stringify\(\{ __fayrPage: o \}\)\)/.test(script),
    'and the only thing it can ever send is a bag of facts under one name');
  ok((script.match(/postMessage/g) || []).length === 1,
    'said in exactly one place, so there is one thing to read and one to check');
});

t('and so is every script that finds a shop’s own sign in control', () => {
  for (const key of ['flipkart', 'zepto', 'blinkit']) {
    const script = signInTapScript(key);
    ok(script && script.length > 500, `${key} really has a script`);
    // eslint-disable-next-line no-new-func
    new Function(script);
    ok(/function fayrSignInIsUp\(/.test(script), `${key}: it can tell a sign in is up`);
    ok(/function fayrWholeLabel\(/.test(script), `${key}: it can find a whole label`);
  }
});

t('and the question "is this a sign in page" is written down exactly once', () => {
  // THE OWNER NAMED THIS: it was written out twice, in the watcher and in the tap
  // script, "and a third copy in the screen is how they start disagreeing".
  const files = {
    'src/connect/pageQuestions.js': pageQuestions,
    'src/connect/gate.js': gate,
    'src/connect/watchSignIn.js': watcher,
    'src/signinTap.js': tapScript,
    'src/ConnectScreen.js': connectScreen,
  };
  let holdsThePattern = [];
  for (const [name, source] of Object.entries(files)) {
    if (/login\|signin\|sign-in\|auth/.test(source)) holdsThePattern.push(name);
  }
  assert.deepEqual(holdsThePattern, ['src/connect/pageQuestions.js'],
    'the shop’s own sign in paths are written out in ONE file and read from there '
    + 'by everything that needs them');
  ok(watcher.includes('SIGN_IN_PATH'), 'the watcher reads it from that file');
  ok(tapScript.includes('SIGN_IN_PATH'), 'the tap script reads it from that file');
  ok(gate.includes('SIGN_IN_PATH'), 'and the gate reads it from that file');
});

t('and the whole label matcher and the sign in box question are one copy too', () => {
  ok(pageQuestions.includes('function fayrWholeLabel(') && pageQuestions.includes('function fayrSignInIsUp('),
    'both live in the one file of page questions');
  for (const [name, source] of [['the watcher', watcher], ['the tap script', tapScript]]) {
    ok(!source.includes('function fayrWholeLabel('),
      `${name} must not write its own whole label matcher`);
    ok(!source.includes('function fayrSignInIsUp('),
      `${name} must not write its own sign in box question`);
    ok(source.includes('WHOLE_LABEL') && source.includes('SIGN_IN_IS_UP'),
      `${name} must take both from the one file`);
  }
});

// ── 5d. BUG TWO. THE SIGN IN WENT AWAY AND FAYR ASKS RATHER THAN CLAIMS ─────
//
// "FLIPKART SIGNED HIM IN AND TOOK HIM TO ITS HOME PAGE, and Fayr left him
// there." Flipkart's own home page shows no greeting and no way out, and it was
// measured on 6 September 2026 to show no way IN either, signed out. So the
// absence of a way in cannot mean somebody is signed in, and this screen asks.
t('the screen hears the sign in going away, and covers the shop again', () => {
  const block = blockAt(connectScreen, connectScreen.indexOf('if (isForTheGate(msg))'));
  ok(block, 'the gate’s own messages must be handled in a block of their own');
  ok(/if \(said\.signInIsGone\) \{ setSignInIsUp\(false\); setSignInIsGone\(true\); \}/.test(block),
    'a sign in that has gone puts the cover back on and starts the question');
  ok(/if \(said\.signInIsUp\) \{[^}]*setSignInIsUp\(true\); setSignInIsGone\(false\); \}/.test(block),
    'and a sign in coming back takes the question away again, so a shop that '
    + 'rebuilds its own panel does not leave a stale question on screen');
});

t('and our own side remembers the sign in, because the shop’s page cannot', () => {
  // A SHOP THAT RELOADS THE WHOLE PAGE ON SIGNING IN hands the watching script a
  // brand new life with no memory of the page before it. A memory kept in there
  // would read false exactly when it matters, and the sign in going away could
  // never be noticed at all on that shop.
  ok(!watcher.includes('signInWasUp'),
    'the script inside the shop’s page keeps no such memory');
  ok(/const signInWasUp = useRef\(false\);/.test(connectScreen),
    'our own side keeps it instead');
  ok(/whatTheShopSaid\(msg, signInWasUp\.current\)/.test(connectScreen),
    'and hands it to the gate with every set of facts that arrives');
  ok(/signInWasUp\.current = true; setSignInIsUp\(true\)/.test(connectScreen),
    'it is set the moment a sign in is really seen');
  const fn = connectScreen.slice(
    connectScreen.indexOf('const tryAgain = useCallback('),
    connectScreen.indexOf('const theySayTheyAreIn = useCallback('),
  );
  ok(fn.includes('signInWasUp.current = false'),
    'and a new attempt forgets what the last one saw, or a fresh view would start '
    + 'believing a sign in it has never shown');
});

// ── 5e. BUG FOUR. THE FAILURE SENTENCE LANDED IN THE MIDDLE OF A SIGN IN ────
//
// Simulator, 15 September 2026. Amazon's own sign in appeared, he typed his
// mobile number, tapped Continue, and "The shop did not open. Please try again."
// arrived before Amazon's password or code step ever did. The fifteen seconds
// run from the start of the attempt and typing a number takes longer than that,
// so the clock had expired while he typed; it only failed to bite while the box
// was on screen, and bit the instant anything took it off for one look.
//
// THE RULE ITSELF IS IN src/connect/gate.js AND WALKED UNDER NODE. What can only
// be checked here is that this screen actually HANDS the gate the memory. A rule
// nobody passes an input to is a rule that is switched off, and the gate's own
// default is false — which is exactly the value that brings the bug back.
t('the screen tells the gate the shop has answered, or the fifteen seconds bite again', () => {
  // THE SCREEN THE GATE DECIDES. Anchored to this one call: the same words
  // appear in the log line below it, and a check that matched either would pass
  // with the one that matters missing.
  const decides = blockAt(connectScreen, connectScreen.indexOf('const gateSays = toSignIn'));
  ok(decides, 'the screen must work out what the gate says in one place');
  ok(/whatIsOnScreen\(\{/.test(decides), 'and it is the gate that works it out, not the screen');
  ok(/shopHasAnswered: signInWasUp\.current/.test(decides),
    'AND THE MEMORY IS HANDED IN. Without it the gate falls back to its own false, '
    + 'the clock is live again, and "The shop did not open" lands on a working sign in');

  // AND THE LOG MUST BE HANDED THE SAME THING, or the line on a phone would name
  // a reason the screen never acted on — which is worse than no line at all.
  const named = blockAt(connectScreen, connectScreen.indexOf('const why = whatDecidedIt('));
  ok(named, 'the log works out which input decided, in a block of its own');
  ok(/shopHasAnswered: signInWasUp\.current/.test(named),
    'and it is given the same memory, so the reason it names is the one that decided');

  // THE MEMORY IS PER ATTEMPT, AND THE FORGETTING LIVES WITH THE COUNTING UP.
  // A new view has been shown nothing, so it must get its own fresh fifteen
  // seconds; a memory that survived the tap would leave a second attempt at a
  // silent shop waiting for ever, with no failure and no control.
  const fn = connectScreen.slice(
    connectScreen.indexOf('const tryAgain = useCallback('),
    connectScreen.indexOf('const theySayTheyAreIn = useCallback('),
  );
  ok(fn.includes('setAttempt((n) => n + 1)'), 'Try again is what counts the attempt up');
  ok(fn.includes('signInWasUp.current = false'),
    'AND THE SAME FUNCTION FORGETS THE SIGN IN, so the count and the memory cannot '
    + 'be moved apart and a new attempt can never inherit an answer it was not given');

  // ── AND IT IS ONE SWITCH, WITH ONE HAND ON EACH END ─────────────────────
  //
  // EVERY ONE OF THESE HOLDS TODAY AND NOTHING WAS MAKING IT HOLD. Being inside
  // tryAgain is not the property that matters; being the ONLY one is. A second
  // reset dropped anywhere else — the likeliest place being onNav, which already
  // clears signInIsUp when the cover goes back on — would disarm the latch on a
  // page change and put "The shop did not open" back over a working sign in,
  // with every check in this file still green.
  const times = (what) => (connectScreen.match(what) || []).length;
  ok(times(/signInWasUp\.current = false/g) === 1,
    'THE MEMORY IS FORGOTTEN IN EXACTLY ONE PLACE, and a second one anywhere would '
    + 'switch the fifteen seconds back on in the middle of somebody signing in');
  ok(times(/signInWasUp\.current = true/g) === 1,
    'and it is remembered in exactly one place too');
  ok(times(/setSignInIsUp\(true\)/g) === 1,
    'THE SIGN IN IS DECLARED UP IN EXACTLY ONE PLACE. A second one that forgot to '
    + 'set the memory beside it would leave the clock live on the attempt that '
    + 'needed it dead, which is the whole bug');
  ok(/signInWasUp\.current = true; setSignInIsUp\(true\)/.test(connectScreen),
    'and that one place sets the memory FIRST, in the same statement, so no render '
    + 'can ever see the sign in up with the shop not yet counted as having answered');
  ok(times(/setAttempt\(/g) === 1,
    'AND THE ATTEMPT IS COUNTED UP IN EXACTLY ONE PLACE, which is what makes '
    + '"the memory is forgotten when the attempt changes" true rather than merely '
    + 'true today. A second setAttempt would build a new view on a stale answer');

  // AND NOBODY LENGTHENED THE TIMEOUT INSTEAD. The latch is the fix; a bigger
  // number would only move the same failure onto whoever types slowest, and would
  // make a shop that really never answers keep somebody waiting longer for a
  // sentence they could have had at fifteen seconds.
  ok(/export const SHOP_HAS_THIS_LONG_MS = 15000;/.test(gate),
    'the fifteen seconds are still fifteen seconds');
  ok(/export const HOLD_CANNOT_TELL_MS = 3000;/.test(gate),
    'and the three second hold on "we cannot tell" is untouched');
});

t('and saying they signed in is recorded as their word, not as ours', () => {
  const fn = connectScreen.slice(
    connectScreen.indexOf('const theySayTheyAreIn = useCallback('),
    connectScreen.indexOf('// Restore any saved login cookies'),
  );
  ok(fn.includes('setHowWeKnew(THEY_SAID_SO)'),
    'their own answer is written down as their own answer');
  ok(fn.includes('setTheyAreIn(true)'), 'and it moves the journey on, which is the point of it');

  const sawIt = /const SAW_IT = '([^']+)'/.exec(connectScreen);
  const saidSo = /const THEY_SAID_SO = '([^']+)'/.exec(connectScreen);
  ok(sawIt && saidSo, 'both reasons must be written down in words');
  ok(sawIt[1] !== saidSo[1],
    'AND THEY MUST BE DIFFERENT. One is the shop’s own page showing us and the '
    + 'other is somebody’s word, and a count built on the row must never be able '
    + 'to turn one into the other');
  ok(/reportShopSignIn\(platform\.key, howWeKnew\)/.test(connectScreen),
    'and the row carries whichever it really was, not a sentence written at the '
    + 'place the row is sent');
  ok(!/reportShopSignIn\(platform\.key, '/.test(connectScreen),
    'so the reason can never be a fixed sentence that says the shop showed us '
    + 'when it did not');
});

t('and nothing on the asking screen claims they are signed in', () => {
  ok(!/signed in\.|you are signed in/i.test(NOT_SURE),
    'the sentence says what is known and what is not, and never that they are in');
  ok(/^Yes,/.test(I_HAVE_SIGNED_IN),
    'and the control that says so is plainly an answer somebody gives');
});

// ── 6. AND THE SCREEN THAT SENT THEM, WHICH NOW HEARS BACK ──────────────────

t('opening the shop’s own app no longer counts as signing in', () => {
  // IT MARKED THE SHOP CONNECTED BEFORE IT HAD EVEN OPENED, and openShopApp can
  // come back having opened nothing at all, so somebody who tapped this and went
  // nowhere was moved on to "buy the product" having signed in to nothing.
  const at = link.indexOf('const openTheirApp');
  ok(at > 0, 'the button that opens the shop’s own app must still be there');
  const body = link.slice(at, link.indexOf('}, [', at));
  ok(body.includes('openShopApp'), 'and it must still really open that app');
  ok(!body.includes('markVisitedShop'),
    'but opening an app is not signing in to it, so it must write nothing down');
  ok(!body.includes('setConnected'),
    'and it must not bring the connected card up either');
});

t('Fayr seeing the sign in is what moves the journey on', () => {
  const at = link.indexOf('params.justSignedIn');
  ok(at > 0,
    'this screen must hear the gate say the shop treated this person as signed in');
  const from = link.lastIndexOf('useEffect', at);
  ok(from > 0 && from < at, 'and hear it as the screen comes back up');
  const effect = link.slice(from, link.indexOf('}, [', at));
  ok(/params\.justSignedIn !== true\) return;/.test(effect),
    'and nothing happens unless it really was Fayr that saw it');
  ok(effect.includes('markVisitedShop(campaignId, SIGNED_IN)'),
    'then the note that moves the journey on is written, once, at the moment it '
    + 'really happened');
  ok(effect.includes('setConnected(true)'),
    'and the connected card is what the person lands on');
  ok(/I HAVE SIGNED IN/.test(link),
    'and the button is still there for a shop that greets nobody by name and '
    + 'shows no sign out of its own, because otherwise that person has no way on');
});

// ── SECTION 5e. TEST THREE, THE SECOND TIME. Try again after the wifi comes back
//
// THE OWNER RAN IT AGAIN ON A REAL PHONE ON 7 SEPTEMBER 2026, with the
// 5 September fix already in, and it still failed: airplane mode on, tap connect,
// get the failure, airplane mode off, wait, tap Try again ONCE, and the same
// sentence came back.
//
// THE DECISIONS ARE ALL IN gate.js AND ARE REALLY RUN THERE. What is left, and
// what is below, is the wiring: does this screen hand the gate the facts it needs,
// and does it act on the answer.

t('the failure handler is stamped with the attempt the view was built under', () => {
  // WITHOUT THE STAMP there is no way to tell a dying view's last word from a word
  // about the attempt happening now. It has to be taken at RENDER time, from the
  // same render that made the view, which means it is closed over in place rather
  // than carried in a dependency list — a dependency list is exactly what failed
  // on 5 September.
  const view = connectScreen.slice(
    connectScreen.indexOf('<WebView'),
    connectScreen.indexOf('startInLoadingState'),
  );
  for (const prop of ['onError', 'onHttpError']) {
    const wired = new RegExp(`${prop}=\\{\\([a-z]*\\) => shopWillNotOpen\\(attempt,`).exec(view);
    ok(wired,
      `${prop} must hand over the attempt this view was built with. Without it the `
      + 'screen cannot tell a dead view complaining about a network that no longer '
      + 'exists from a real failure happening now');
  }
});

t('and the count it compares against is a ref, never a dependency list', () => {
  ok(/const attemptNow = useRef\(0\);/.test(connectScreen),
    'the attempt on screen now must be readable as a ref');
  ok(/useEffect\(\(\) => \{ attemptNow\.current = attempt; \}, \[attempt\]\);/.test(connectScreen),
    'and an effect must keep it from ever drifting from the state it mirrors');
  const fn = connectScreen.slice(
    connectScreen.indexOf('const shopWillNotOpen = useCallback('),
    connectScreen.indexOf('// When a target product is set'),
  );
  ok(/attemptNow: attemptNow\.current/.test(fn),
    'AND THE HANDLER MUST READ THE REF, not the state. A handler built by '
    + 'useCallback holds whatever its dependencies were when it was built, and the '
    + 'dying view underneath is holding the handler from the render that built IT — '
    + 'so the count has to be readable as it is NOW');
  // THE CODE ONLY, not the words it prints: the log line says "attempt=" on
  // purpose, and that is text rather than a read of the state.
  const code = fn
    .replace(/`[^`]*`/g, '``')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/fromAttempt/g, 'STAMP')
    .replace(/attemptNow/g, 'REF');
  ok(!/\battempt\b/.test(code),
    'and it must not read the attempt state directly anywhere, because that value '
    + 'is as old as the handler holding it');
});

t('and the shop view is thrown away while the failure is up, not merely covered', () => {
  // A COVERED VIEW IS STILL ALIVE AND CAN STILL SPEAK. Whether it may exist is the
  // gate's answer, so the screen cannot get it right in one branch and wrong in
  // another.
  ok(/shopViewMayExist\(toSignIn, gate\)/.test(connectScreen),
    'whether the shop view exists at all must be the gate’s answer, given both the '
    + 'kind of visit and what is on screen');
  const from = connectScreen.indexOf('shopViewMayExist(toSignIn, gate)');
  const after = connectScreen.slice(from, from + 60);
  ok(/\?\s*\(/.test(after),
    'and it must gate the drawing of the view itself, so on a failure there is '
    + 'nothing left to deliver one last error into the next attempt');
  ok(/\) : null\}/.test(connectScreen.slice(connectScreen.indexOf('startInLoadingState'))),
    'and when it says no, nothing is drawn in its place');
});

t('and tryAgain says so before it touches a single piece of state', () => {
  const fn = connectScreen.slice(
    connectScreen.indexOf('const tryAgain = useCallback('),
    connectScreen.indexOf('}, []);', connectScreen.indexOf('const tryAgain = useCallback(')),
  );
  const logAt = fn.indexOf("logGate(attemptNow.current, 'TRY AGAIN TAPPED'");
  ok(logAt > 0,
    'TRY AGAIN MUST SAY IT WAS TAPPED. It is the one line that tells "the tap never '
    + 'arrived" apart from "the tap arrived and something else went wrong", and '
    + 'without it that question cannot be answered from a phone at all');
  const firstSet = fn.indexOf('set');
  ok(logAt < firstSet,
    'and it must say so BEFORE any state is set, or a tap that arrives and then '
    + 'throws leaves no trace of having arrived');
  ok(fn.indexOf('attemptNow.current = next') > logAt,
    'and it must move the count by hand as well as through state, because an effect '
    + 'does not run until the screen has been drawn and a dying view can speak '
    + 'inside that gap');
});

t('and every one of the five things worth knowing is written down', () => {
  // THE OWNER ASKED FOR THIS ONE BY NAME: "it must be impossible to run test 3 and
  // not know which of A, B or C happened". Each line below is the one that answers
  // one of those questions.
  const mustSay = [
    ['TRY AGAIN TAPPED', 'whether the tap arrived at all'],
    ['SHOP WILL NOT OPEN', 'whether a failure was acted on or ignored, and why'],
    ['GATE', 'every change of what is on screen, and which input decided it'],
    ['PAGE SAID', 'what the shop’s own page really sent, before we read anything into it'],
    ['LOAD STARTED', 'whether the new view ever asked the shop anything'],
    ['LOAD ENDED', 'and whether the shop ever answered'],
  ];
  for (const [line, why] of mustSay) {
    ok(connectScreen.includes(`'${line}`), `the window must show ${why} (${line})`);
  }
  ok(/logGate\(attempt, 'GATE'/.test(connectScreen),
    'and the gate line must carry the attempt, or two attempts read as one');
  ok(/whatDecidedIt\(\{/.test(connectScreen),
    'and it must name which input decided, from the gate’s own ordered questions '
    + 'rather than a second copy of them');
  ok(/logGate\(attemptNow\.current, 'PAGE SAID', event\.nativeEvent\.data\)/.test(connectScreen),
    'and the page’s message must be written down RAW, because if our reading of it '
    + 'is the thing that is wrong, a line showing only the reading cannot say so');
});

t('and the running commentary is development only, and says so', () => {
  const log = readFileSync(join(here, 'gateLog.js'), 'utf8');
  ok(/typeof __DEV__ !== 'undefined' && __DEV__ === true/.test(log),
    'it must be off in a build a person gets, and read defensively so the checks '
    + 'for it can run under node where __DEV__ does not exist');
  ok(/if \(!gateLogIsOn\(\)\) return false;/.test(log),
    'and nothing may be printed when it is off');
  const writes = log.match(/console\.[a-z]+\(/g) || [];
  assert.deepEqual(writes, ['console.log('],
    'and there must be exactly ONE way out of that file, because that is what makes '
    + '"every line carries the tag" structurally true rather than a promise');
  ok(log.includes("export const TAG = '[fayr-gate]';"),
    'and the tag must be the one the owner searches the window for');
  ok(!/from 'react/.test(log),
    'and it must not be able to draw anything, so no word of it can reach a screen');
  ok(connectScreen.includes('TEMPORARY, AND IT COMES OUT WHEN THE OWNER SAYS TEST 3 PASSES'),
    'and the screen must say out loud that this is temporary, because nothing else '
    + 'in the app is built to be deleted and this is');
});

console.log(`  ${passed} checks passed`);
