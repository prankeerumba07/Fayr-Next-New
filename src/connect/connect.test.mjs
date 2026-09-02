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
import { accountNameFor } from './accountName.js';
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

t('the card never invents a name', () => {
  const card = verifiedCardWords('Amazon', accountNameFor('amazon'));
  assert.equal(card.name, null,
    'Fayr cannot read the name off a shop’s page yet, so the card must show none. '
    + 'See src/connect/accountName.js for the one line in the frozen connect screen '
    + 'that this is waiting on');
  assert.equal(card.showsName, false);
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

console.log(`  ${passed} checks passed`);
