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

  const onError = /onError=\{([A-Za-z0-9_.]+)\}/.exec(webview);
  const onHttpError = /onHttpError=\{([A-Za-z0-9_.]+)\}/.exec(webview);
  ok(onError, 'the web view must be told what to do when the shop cannot be reached');
  ok(onHttpError, 'and what to do when the shop answers with an error of its own');
  assert.equal(onError[1], onHttpError[1],
    'and both must go to the same handler, because to the person waiting they are '
    + 'the same thing: the shop did not open');

  // And the handler really does something, so the two props above are not wired
  // to a function that shrugs.
  const declaredAt = connectScreen.indexOf(`const ${onError[1]} = useCallback`);
  ok(declaredAt > 0, `${onError[1]} must be a real handler on this screen`);
  const handler = connectScreen.slice(declaredAt, connectScreen.indexOf('}, [', declaredAt));
  ok(/if \(!toSignIn\) return;/.test(handler),
    'it must do nothing at all on a reading visit, which is not gated and works today');
  ok(/theyAreIn \|\| signInIsUp/.test(handler),
    'and a stray failure from some small thing on the page must not throw away '
    + 'somebody who is already signed in');
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

// ── 5b. THE ONE CONTROL ON THE FAILURE REALLY WORKS ─────────────────────────
//
// FOUND BY A MUTATION. Pointing the button at an empty function passed every
// check in this file. A button that does nothing when tapped is the worst thing
// on a failure screen: the person taps it, nothing happens, and they tap it
// again, and Fayr has told them their only way forward is a lie.
t('the try again button really asks the shop again', () => {
  ok(/onPress=\{tryAgain\}/.test(connectScreen),
    'the only control on the failure screen is wired to tryAgain, and not to '
    + 'nothing and not to something else');

  // And tryAgain really does all four things it has to do: forget what the last
  // attempt saw, start the clock again, and ask the shop again.
  const fn = connectScreen.slice(
    connectScreen.indexOf('const tryAgain = useCallback('),
    connectScreen.indexOf('// Restore any saved login cookies'),
  );
  ok(fn.length > 50, 'and tryAgain is really in this file');
  ok(fn.includes('setSignInIsUp(false)'),
    'it forgets that a sign in was ever seen, so the cover goes back on');
  ok(fn.includes('setTheyAreIn(false)'), 'it forgets that anybody was in');
  ok(fn.includes('setItWillNotOpen(false)'), 'it forgets the failure itself');
  ok(/setAskedAt\(at\)/.test(fn) && /setNowIs\(at\)/.test(fn),
    'it starts the wait again from now, so the fifteen seconds are a fresh '
    + 'fifteen and not already spent');
  ok(/webRef\.current\?\.reload\(\)/.test(fn),
    'and it really asks the shop for the page again');

  // THE CLOCK MUST BE ABLE TO FIRE AGAIN. Without askedAt among the things the
  // waiting effect watches, a second attempt would never time out: the person
  // would be left on our loading screen for ever with nothing to tap.
  const waiter = connectScreen.slice(
    connectScreen.indexOf('// THE ONE CLOCK THAT MAKES THE WAIT REAL'),
    connectScreen.indexOf('const gate = toSignIn'),
  );
  ok(waiter.includes('askedAt'),
    'and the waiting clock watches askedAt, so a second attempt can time out too');
  ok(/SHOP_HAS_THIS_LONG_MS/.test(waiter),
    'and it waits the one wait, never a number written into the screen');
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

console.log(`  ${passed} checks passed`);
