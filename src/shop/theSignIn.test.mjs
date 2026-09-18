// SIGNING IN WHERE THEY ARE SHOPPING, AND THE SHOP OPENING WHERE PEOPLE SHOP.
//
// Task 3 of 18 September 2026. Two things are proved here and the second is the
// one the owner's run actually asked for:
//
//   the detection is the connect flow's, IMPORTED and not copied — there is not
//   one question about a shop's page written in src/shop/;
//
//   and the address a shopping session lands on is the shop's own site or the
//   campaign's product page, and NEVER an order list. His whole run happened in
//   a web view pointed at https://www.zepto.com/account/orders, which is the one
//   page on the shop he cannot buy anything from.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HOW_WE_KNEW_INSIDE_THE_SHOP, nowRememberTheSignInWasUp, shouldRecordTheSignIn,
  watchSignInScript, whatTheShopShowed,
} from './theSignIn.js';
import { shopsInsideFayr, whereToLand } from './insideFayr.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/** Each shop's own front door, read off the frozen platforms.js and not typed here. */
const START_URLS = (() => {
  const src = read('src/platforms.js');
  const out = {};
  for (const key of ['zepto', 'blinkit', 'instamart', 'amazon', 'flipkart', 'meesho', 'myntra']) {
    const found = src.match(new RegExp(`\\n(?:const |let )?${key}\\s*=\\s*\\{[\\s\\S]*?startUrl:\\s*'([^']+)'`));
    if (found) out[key] = found[1];
  }
  return out;
})();

console.log('=== 1. THE SHOP OPENS WHERE PEOPLE SHOP, AND NEVER ON AN ORDER LIST ===');
{
  ok(Object.keys(START_URLS).length >= 3, 'the front doors were read off platforms.js');
  for (const key of ['zepto', 'blinkit', 'instamart']) {
    ok(shopsInsideFayr(key) === true, `${key} shops inside Fayr`);
    const land = whereToLand(key, { productUrl: null, startUrl: START_URLS[key] });
    ok(land != null, `${key} has somewhere to land`);
    ok(land.kind === 'shop', `and for ${key} it is the shop's own site`);
    ok(/^https?:\/\/[^/]+\/$/.test(land.url),
      `and ${key} lands on the root of it and nothing deeper: ${land.url}`);
    // THE CHECK THE PHASE ASKED FOR, IN ITS OWN WORDS.
    ok(!/\/account\/orders/.test(land.url),
      `${key} NEVER lands on an order list`);
    ok(!/order/i.test(new URL(land.url).pathname),
      `and there is no order path of any shape in ${key}'s landing address`);
  }
  // AND THE ONE SHOP WHOSE FRONT DOOR REALLY IS AN ORDER LIST PROVES IT.
  //
  // zepto's startUrl in the frozen platforms.js points at /account/orders,
  // because the READER needs it to. That is exactly the address the owner spent
  // his whole run on, and whereToLand drops the path rather than following it.
  ok(/\/account\/orders/.test(START_URLS.zepto),
    'zepto’s own startUrl really is its order list, which is what makes this worth checking');
  ok(whereToLand('zepto', { productUrl: null, startUrl: START_URLS.zepto }).url
    === 'https://www.zepto.com/',
    'and a shopping session lands on the front of the shop instead');

  // A CAMPAIGN'S PRODUCT PAGE STILL WINS WHEN THERE IS ONE.
  const onTheProduct = whereToLand('blinkit', {
    productUrl: 'https://blinkit.com/prn/boldfit/prid/12345',
    startUrl: START_URLS.blinkit,
  });
  ok(onTheProduct.kind === 'product', 'a campaign productUrl is where it lands');
  ok(onTheProduct.url === 'https://blinkit.com/prn/boldfit/prid/12345', 'exactly as written');
  // AND A PRODUCT ADDRESS FAYR'S OWN VIEW WOULD NOT LOAD IS NOT ONE.
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'upi://pay']) {
    ok(whereToLand('zepto', { productUrl: bad, startUrl: START_URLS.zepto }).kind === 'shop',
      `${bad} is not a product page, it is a campaign with none`);
  }
  // AND THE FOUR THAT KEEP THEIR OWN APP HAVE NOWHERE HERE AT ALL.
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(whereToLand(key, { productUrl: null, startUrl: START_URLS[key] }) === null,
      `${key} has no in-app landing address`);
  }
}

console.log('\n=== 2. the reading is the connect flow’s, imported and not rewritten ===');
{
  const mine = withoutComments(read('src/shop/theSignIn.js'));
  ok(/import \{ isForTheGate, whatTheShopSaid \} from '\.\.\/connect\/gate\.js'/.test(mine),
    'the two questions come from the frozen gate');
  ok(/import \{ watchSignInScript \} from '\.\.\/connect\/watchSignIn\.js'/.test(mine),
    'and the script put into the page comes from the frozen watcher');
  // NOT ONE PATTERN OF ITS OWN. This is what "reuse it, do not reimplement it"
  // has to mean in a file rather than in a promise, and it is checked on the
  // file's STRING LITERALS rather than on its text: the words "sign in" are all
  // over its names and its prose, and neither of those can ask a page anything.
  const literals = (mine.match(/'[^']*'/g) || []).map((q) => q.slice(1, -1));
  const allowed = new Set([
    '../connect/gate.js',
    '../connect/watchSignIn.js',
    'the shop greeted them inside the Fayr shopping view',
  ]);
  for (const lit of literals) {
    ok(allowed.has(lit), `theSignIn.js holds only known strings, not "${lit}"`);
  }
  for (const ownIdea of ['querySelector', 'document.', 'location.', 'RegExp', 'innerText']) {
    ok(!mine.includes(ownIdea), `theSignIn.js has no "${ownIdea}" of its own`);
  }
  ok(!/\/[^/\s][^/\n]*\/[gimsuy]*\.test\(/.test(mine),
    'and there is no pattern in it that could ask a shop’s page anything');

  // AND THE FROZEN FILES ARE UNTOUCHED BY THIS, which is checked by the phase's
  // own git diff. What is checked here is that the script really is the same one.
  ok(watchSignInScript().includes('__fayrWatching'),
    'the script handed out here is the connect flow’s own watcher');
  ok(watchSignInScript().includes('__fayrPage'),
    'and it speaks the same language the gate reads');
}

console.log('\n=== 3. what it does with what the page said ===');
{
  const page = (o) => ({ __fayrPage: { looksInARow: 2, path: '/', ...o } });
  const theyAreIn = whatTheShopShowed(page({
    fieldIsThere: false, signInControlIsThere: false, signOutIsThere: true,
    looksLikeAGreeting: true, greeting: 'Hello, Prakash',
  }), false);
  ok(theyAreIn != null && theyAreIn.theyAreIn === true, 'a greeted page reads as signed in');

  const signInUp = whatTheShopShowed(page({
    fieldIsThere: true, signInControlIsThere: true, signOutIsThere: false,
    looksLikeAGreeting: false, greeting: 'Please Login',
  }), false);
  ok(signInUp != null && signInUp.signInIsUp === true, 'and a login box reads as one');

  for (const notOurs of [null, undefined, {}, { ok: true }, 'a string', 7, []]) {
    ok(whatTheShopShowed(notOurs, false) === null, 'anything that is not the gate’s is nothing');
  }

  // ── RECORDED ONCE PER SESSION, AND ONLY ON "THEY ARE IN" ────────────────
  ok(shouldRecordTheSignIn(theyAreIn, false) === true, 'a greeting is recorded');
  ok(shouldRecordTheSignIn(theyAreIn, true) === false, 'and never twice in one session');
  ok(shouldRecordTheSignIn(signInUp, false) === false,
    'a login box is the OPPOSITE of being signed in and records nothing');
  ok(shouldRecordTheSignIn(null, false) === false, 'and nothing records nothing');
  const gone = whatTheShopShowed(page({
    fieldIsThere: false, signInControlIsThere: false, signOutIsThere: false,
    looksLikeAGreeting: false, greeting: '',
  }), true);
  ok(gone != null && gone.signInIsGone === true, 'a sign in that went is read as gone');
  ok(shouldRecordTheSignIn(gone, false) === false,
    'and a sign in box merely DISAPPEARING is not somebody signing in');

  // ── OUR SIDE'S MEMORY IS ONLY EVER TURNED ON ────────────────────────────
  ok(nowRememberTheSignInWasUp(signInUp, false) === true, 'a box that is up is remembered');
  ok(nowRememberTheSignInWasUp(gone, true) === true, 'and is not forgotten when it goes');
  ok(nowRememberTheSignInWasUp(null, true) === true, 'nor by a page that said nothing');
  ok(nowRememberTheSignInWasUp(theyAreIn, false) === false,
    'and a page that never had one does not invent the memory');

  ok(typeof HOW_WE_KNEW_INSIDE_THE_SHOP === 'string'
    && HOW_WE_KNEW_INSIDE_THE_SHOP.length <= 200
    && /shopping view/.test(HOW_WE_KNEW_INSIDE_THE_SHOP),
    'how we knew names this screen, and fits in what our side stores');
}

console.log('\n=== 4. the screen does the same three things the connect screen does ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  // TWO WATCHERS SINCE 18 SEPTEMBER 2026, and the sign-in one is still the
  // connect flow's, still first. The second reports the title and the address
  // on a shop that changes page without navigating — see watchTheTitle.js.
  ok(/injectedJavaScript=\{watchSignInScript\(\) \+ watchTheTitleScript\(\)\}/.test(screen),
    'the watcher goes into the shopping view');
  ok(/onMessage=\{onShopMessage\}/.test(screen), 'and its messages are listened for');
  ok(/markConnected\(platform\.key\)/.test(screen), 'the shop is marked connected on our side');
  ok(/reportShopSignIn\(platform\.key, HOW_WE_KNEW_INSIDE_THE_SHOP\)/.test(screen),
    'and reported to the server, exactly as the connect screen reports it');
  ok(/markVisitedShop\(campaignId, SIGNED_IN\)/.test(screen), 'and the note is written');
  ok(/saveSession\(\)/.test(screen), 'and the cookies, which are the sign in itself, are saved');
  ok(/toldOurSide\.current = true;/.test(screen), 'once, and not once a page');

  // ── AND NONE OF IT DECIDES WHAT IS DRAWN ────────────────────────────────
  //
  // The connect screen covers the shop until its gate is sure, because a person
  // there is signing in and nothing else. A person here is buying something, so
  // this watches and records and never once gates.
  const web = screen.slice(screen.indexOf('<WebView'));
  ok(!/signInWasUp|toldOurSide|showed|whatTheShopShowed/.test(web),
    'nothing the sign in knows reaches the rendering of the shop’s page');
  ok(/\{!sessionReady \?/.test(screen),
    'the page is drawn from one condition and it is the restored session');
  ok(!/shopMayBeSeen|whatWeSay|theyAskedToSee|<Cover|cover/i.test(screen),
    'and there is no cover over the shop on this screen at all');
  ok(!/navigation\.(navigate|replace)\('linkaccount'/.test(screen),
    'and nobody is bounced out to the connect step from here');
}

console.log('\n=== 5. the frozen files are read and not written ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  // Imports are reading. What would be a change is a copy of what is in them.
  ok(!/from '\.\.\/ConnectScreen'/.test(screen), 'the connect screen itself is not reached for');
  ok(/from '\.\.\/session'/.test(screen), 'the session keeper is called, as it always was');
  const mine = withoutComments(read('src/shop/theSignIn.js'));
  ok((mine.match(/from '\.\.\/connect\//g) || []).length === 2,
    'and exactly two frozen connect files are imported, both of them read-only');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
