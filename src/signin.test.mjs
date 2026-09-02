// WHERE SOMEBODY SIGNS IN TO A SHOP, AND THAT IT IS REALLY WHAT OPENS.
//
// THE FAILURE THIS EXISTS TO STOP HAPPENING TWICE. On 2 September 2026 a sign in
// address was added to every shop, and the owner's phone did exactly what it did
// before: every shop opened on its shopping page. Nothing in the app read the new
// field. A check that had read the field would have passed happily while the app
// was wrong.
//
// SO THIS CHECK NEVER READS THE FIELD. It calls the same function App.js calls to
// work out which shop it hands the connect screen, and reads the address off the
// answer. If the wiring is taken out, these fail.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PLATFORMS, PLATFORM_LIST } from './platforms.js';
import { shopsThatTapToSignIn, signInTapScript } from './signinTap.js';
import {
  everyShopsSignIn, readAccountName, shopForSigningIn, shopHandedToConnectScreen,
  whereTheySignIn,
} from './signin.js';

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
const app = readFileSync(join(here, '..', 'App.js'), 'utf8');
const linkaccount = readFileSync(join(here, 'screens/linkaccount.js'), 'utf8');

console.log('\nWhere somebody signs in to a shop');

// ── 1. THE ADDRESS THAT REALLY OPENS ────────────────────────────────────────
// Read off the value handed to the connect screen, never off the field.

/** The address the connect screen would really open for this visit. */
function addressOpened(key, params) {
  const shop = shopHandedToConnectScreen(key, params);
  return shop ? shop.startUrl : null;
}

const SIGN_IN_VISIT = { toSignIn: true };

t('a shop with its own sign in page really opens on it', () => {
  const own = everyShopsSignIn().filter((s) => s.onItsOwnPage);
  ok(own.length >= 1, 'at least one shop must have its own sign in page established');
  for (const shop of own) {
    assert.equal(addressOpened(shop.key, SIGN_IN_VISIT), shop.url,
      `${shop.key} must open on its own sign in page when somebody goes there to `
      + 'sign in, and this is read off the value the connect screen is handed');
    assert.notEqual(addressOpened(shop.key, SIGN_IN_VISIT), PLATFORMS[shop.key].startUrl,
      `${shop.key} must no longer open on its shopping page, which is the whole `
      + 'complaint: "it is taking me to the homepage of every marketplace"');
  }
});

t('and going there to read somebody’s orders still opens the page reading needs', () => {
  for (const shop of PLATFORM_LIST) {
    assert.equal(addressOpened(shop.key, undefined), shop.startUrl,
      `${shop.key} must keep its own landing page when the visit is not a sign in; `
      + 'Myntra and Meesho and Zepto land straight on somebody’s order list and '
      + 'sending that visit to a sign in page would read nobody’s orders');
  }
});

t('a shop whose sign in address is not established keeps its own site', () => {
  const notKnown = everyShopsSignIn().filter((s) => !s.onItsOwnPage);
  for (const shop of notKnown) {
    assert.equal(addressOpened(shop.key, SIGN_IN_VISIT), PLATFORMS[shop.key].startUrl,
      `${shop.key} has no established sign in address, so it opens its own site and `
      + 'nothing is guessed');
    ok(typeof shop.why === 'string' && shop.why.length > 20,
      `${shop.key} must say in words why it has no sign in address of its own`);
  }
});

t('a shop Fayr does not know answers nothing rather than something invented', () => {
  assert.equal(shopHandedToConnectScreen('bigbasket', SIGN_IN_VISIT), null);
  assert.equal(shopHandedToConnectScreen('', SIGN_IN_VISIT), null);
  assert.equal(shopHandedToConnectScreen(null, SIGN_IN_VISIT), null);
});

t('the app really is wired to this, so the field cannot be dead again', () => {
  ok(app.includes("import { shopHandedToConnectScreen } from './src/signin'"),
    'App.js must import the one function that decides which page of a shop opens');
  ok(/shopHandedToConnectScreen\(platform\.key, params\)/.test(app),
    'and makeConnectScreen must call it for every shop');
  ok(/platform=\{shop\}/.test(app),
    'and hand the answer to the connect screen as the shop it is opening');
  ok(!/platform=\{platform\}/.test(app),
    'and must not hand over the untouched shop, which is the bug being fixed');
});

t('the screen that sends somebody to sign in says that is why', () => {
  ok(/navigation\.navigate\(key, \{ campaignId, toSignIn: true \}\)/.test(linkaccount),
    'the connect button on src/screens/linkaccount.js must say the visit is a sign '
    + 'in, because that one word is what opens the shop’s sign in page');
});

// ── 2. THE SAME HOST RULE ───────────────────────────────────────────────────
// Not a matter of taste. The frozen connect screen uses one address for the page
// it opens AND for the origin it saves and restores this shop's sign in against.

t('a sign in address on another host is refused, out loud', () => {
  for (const shop of everyShopsSignIn()) {
    if (!shop.onItsOwnPage) continue;
    const home = new URL(PLATFORMS[shop.key].startUrl).host;
    assert.equal(new URL(shop.url).host, home,
      `${shop.key}: the sign in address must be on the same host as the shop’s own `
      + 'site, because the connect screen saves this shop’s sign in against that '
      + 'address’s own origin and another host would save it against the wrong place');
  }
});

t('and that rule really refuses, rather than being true by luck', () => {
  // Prove the rule bites, without touching platforms.js: hand whereTheySignIn a
  // shop of our own whose sign in is somewhere else entirely.
  const saved = PLATFORMS.__test_other_host;
  PLATFORMS.__test_other_host = {
    key: '__test_other_host', name: 'Somewhere',
    startUrl: 'https://www.example.com/', signInUrl: 'https://login.somewhere-else.com/',
  };
  try {
    const answer = whereTheySignIn('__test_other_host');
    assert.equal(answer.onItsOwnPage, false, 'another host must be refused');
    assert.equal(answer.url, 'https://www.example.com/', 'and the shop’s own site opens');
    ok(/another host/.test(answer.why), 'and it must say why in words');
  } finally {
    if (saved === undefined) delete PLATFORMS.__test_other_host;
    else PLATFORMS.__test_other_host = saved;
  }
});

t('nothing is added to a shop’s address — no tracking, no source, no affiliate', () => {
  for (const shop of everyShopsSignIn()) {
    if (!shop.url) continue;
    const url = new URL(shop.url);
    assert.deepEqual([...url.searchParams.keys()], [],
      `${shop.key}: a shop’s address carries no question mark parameters at all, so `
      + 'no tracking marker, no source and no affiliate tag can hide in one');
    ok(url.protocol === 'https:', `${shop.key} must be opened over https`);
  }
});

// ── 3. FAYR NEVER SEES WHAT SOMEBODY TYPES ──────────────────────────────────

t('there is no imitation of any shop’s sign in anywhere in this file', () => {
  const signin = readFileSync(join(here, 'signin.js'), 'utf8');
  for (const word of ['password', 'TextInput', 'secret', 'credential']) {
    ok(!new RegExp('\\b' + word + '\\b').test(signin.replace(/\/\/[^\n]*/g, '')),
      `src/signin.js must not so much as mention ${word} in its code: the person `
      + 'signs in on the shop’s own page and Fayr never sees what they type');
  }
});

// ── 4. THE NAME ON THE SHOP ACCOUNT ─────────────────────────────────────────
// Read off the shop's own page, or not shown at all. Never invented.

t('a real name is read off a real greeting', () => {
  assert.equal(readAccountName('Hi Ravi Your Orders'), 'Ravi');
  assert.equal(readAccountName('Hello, Ravi Kumar Sharma Your Orders'), 'Ravi Kumar Sharma');
  assert.equal(readAccountName('Hey Priya Cart'), 'Priya');
});

t('page words that run into a name are not taken as part of it', () => {
  // Real page text has no separator between a greeting and the next heading.
  assert.equal(readAccountName('Your Account Hello, Manisha Dahiya Orders'), 'Manisha Dahiya');
  assert.equal(readAccountName('Hello, Ravi Your Orders Cart Lists'), 'Ravi');
});

t('a shop saying nobody is signed in gives no name at all', () => {
  assert.equal(readAccountName('Hello, sign in Account & Lists'), null);
  assert.equal(readAccountName('Hello, Guest'), null);
  assert.equal(readAccountName('Hello, there'), null);
  assert.equal(readAccountName('Hello, Sign in'), null);
});

t('and nothing at all gives no name, rather than an invented one', () => {
  assert.equal(readAccountName('nothing here at all'), null);
  assert.equal(readAccountName(''), null);
  assert.equal(readAccountName(null), null);
  assert.equal(readAccountName(undefined), null);
  assert.equal(readAccountName(12345), null);
});

t('a name is never longer than a name', () => {
  const long = 'Hello, Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll';
  const name = readAccountName(long);
  ok(name && name.split(' ').length <= 3,
    `a name read off a page is at most three words, got "${name}"`);
});

// ── 5. EVERY SHOP, BECAUSE THE OWNER ASKED FOR EVERY MARKETPLACE ────────────
//
// A shop's sign in is one of two things and never a third: a PAGE with an address
// of its own, or a PANEL on the shop's own site with no address at all. A shop
// with neither is a shop somebody cannot connect, and that is what this refuses.

t('every single shop can reach its own sign in, one way or the other', () => {
  const stuck = [];
  for (const key of Object.keys(PLATFORMS)) {
    const where = whereTheySignIn(key);
    const hasPage = where.onItsOwnPage === true;
    const taps = signInTapScript(key) != null;
    if (!hasPage && !taps) stuck.push(key);
  }
  assert.deepEqual(stuck, [],
    'these shops have neither a sign in page of their own nor a script that finds '
    + 'and taps their own sign in control, so nobody can connect them: '
    + stuck.join(', '));
});

t('and it is one or the other, never both, so there is one way per shop', () => {
  for (const key of Object.keys(PLATFORMS)) {
    const hasPage = whereTheySignIn(key).onItsOwnPage === true;
    const taps = signInTapScript(key) != null;
    ok(hasPage !== taps,
      `${key}: a shop with a sign in page of its own has nothing to hunt for, and a `
      + 'shop being hunted has no page. Both at once means two answers to one question');
  }
});

t('all seven shops are accounted for, so none was quietly left out', () => {
  assert.equal(Object.keys(PLATFORMS).length, 7, 'Fayr targets seven shops');
  assert.equal(PLATFORM_LIST.length, 7, 'and the list the app walks holds all seven');
  const pages = Object.keys(PLATFORMS).filter((k) => whereTheySignIn(k).onItsOwnPage);
  const taps = shopsThatTapToSignIn();
  assert.equal(pages.length + taps.length, 7,
    `${pages.length} shops have their own page and ${taps.length} are tapped; `
    + 'together that must be all seven');
});

// ── 6. THE FIND AND TAP SCRIPT MAY ONLY DO ONE THING ────────────────────────

t('a script is only ever handed to the shop it was written for', () => {
  for (const key of shopsThatTapToSignIn()) {
    const script = signInTapScript(key);
    const host = new URL(PLATFORMS[key].startUrl).host.replace(/^www\./, '');
    ok(script.includes(host.replace('.', '\\.')),
      `${key}'s script must check it is on ${host} before it does anything, so a `
      + 'sign in that hands off to another company is left completely alone');
  }
});

t('it never matches part of a word, only a whole label', () => {
  for (const key of shopsThatTapToSignIn()) {
    const script = signInTapScript(key);
    ok(/text !== words\[w\] && aria !== words\[w\]/.test(script),
      `${key}'s script must compare a control's WHOLE label, so "log out" and `
      + '"reorder" can never be tapped by accident');
    ok(/el\.children\.length > 1/.test(script),
      `${key}'s script must refuse a control holding more than one thing, so a `
      + 'wrapper around the whole page cannot match the words its children contain');
    ok(!/indexOf\(|includes\(|\.search\(/.test(script),
      `${key}'s script must not look for a label INSIDE a longer piece of text`);
  }
});

t('it stops for good once the shop’s own sign in is up', () => {
  for (const key of shopsThatTapToSignIn()) {
    const script = signInTapScript(key);
    ok(/if \(done\) return;/.test(script), `${key}: it must be able to stop`);
    ok(/fayrSignInIsUp\(\)\) \{ done = true; return; \}/.test(script),
      `${key}: the shop’s own sign in field being on screen must stop it for good`);
    ok(script.includes('|signin|sign-in|auth')
      && /\.test\(path\)\) \{ done = true; return; \}/.test(script),
      `${key}: being on the shop’s own sign in page must stop it too — that is the `
      + 'signal that works for a shop whose own field carries no words, which is '
      + 'true of Flipkart');
    ok(/signInTries >= 3/.test(script), `${key}: it must be bounded as well`);
  }
});

t('it never touches a paying flow', () => {
  for (const key of shopsThatTapToSignIn()) {
    ok(/checkout\|cart\|payment\|pay/.test(signInTapScript(key)),
      `${key}: a checkout, a cart and a payment page must be left completely alone`);
  }
});

t('it never reads a password, a cookie, a token or anything stored', () => {
  const FORBIDDEN = [
    'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB',
    'XMLHttpRequest', 'fetch(', 'postMessage', 'ReactNativeWebView',
    '.value', 'password', 'authorization', 'token',
  ];
  for (const key of shopsThatTapToSignIn()) {
    const script = signInTapScript(key);
    for (const word of FORBIDDEN) {
      ok(!script.includes(word),
        `${key}'s script must not contain "${word}". It asks whether a field EXISTS `
        + 'and never looks at a value, and it sends nothing anywhere. The person '
        + 'signs in on the shop’s own page and Fayr never sees what they type');
    }
  }
});

t('it draws nothing, so nothing on screen is ever an imitation of the shop', () => {
  const DRAWING = ['createElement', 'innerHTML', 'appendChild', 'insertAdjacent',
    'style.cssText', 'document.write'];
  for (const key of shopsThatTapToSignIn()) {
    const script = signInTapScript(key);
    for (const word of DRAWING) {
      ok(!script.includes(word),
        `${key}'s script must not contain "${word}". Every pixel the person sees is `
        + 'the shop’s own: no imitation of a shop’s sign in, no imitation of its '
        + 'consent page, no imitation of the phone’s own boxes');
    }
  }
});

t('it is silent when it finds nothing, and never shouts at anybody', () => {
  for (const key of shopsThatTapToSignIn()) {
    const script = signInTapScript(key);
    ok(!/alert\(|confirm\(|console\./.test(script),
      `${key}: if no control matches it must do nothing at all and leave the person `
      + 'on the shop’s own site exactly as they are today');
    ok(/catch\(e\)\{\}/.test(script),
      `${key}: anything going wrong must be swallowed, never thrown at the page`);
  }
});

// ── 7. THE SCRAPER'S OWN SCRIPTS ARE UNTOUCHED ──────────────────────────────

t('the shop’s own script is still there, and the new one is added after it', () => {
  for (const key of shopsThatTapToSignIn()) {
    const own = PLATFORMS[key].beforeLoadScript;
    const handed = shopHandedToConnectScreen(key, SIGN_IN_VISIT).beforeLoadScript;
    if (typeof own === 'string' && own.length > 0) {
      ok(handed.startsWith(own),
        `${key}: the scraper’s own script must still be there, first and unchanged`);
    }
    ok(handed.includes(signInTapScript(key)),
      `${key}: and the sign in script must be added after it`);
  }
});

t('and a reading visit gets the shop’s own script and nothing added', () => {
  for (const shop of PLATFORM_LIST) {
    const handed = shopHandedToConnectScreen(shop.key, undefined);
    assert.equal(handed.beforeLoadScript, shop.beforeLoadScript,
      `${shop.key}: a visit made to read somebody’s orders must get exactly the `
      + 'scraper’s own script, with nothing added to it');
  }
});

t('a shop with its own sign in page has nothing added to its script either', () => {
  for (const key of Object.keys(PLATFORMS)) {
    if (!whereTheySignIn(key).onItsOwnPage) continue;
    assert.equal(shopHandedToConnectScreen(key, SIGN_IN_VISIT).beforeLoadScript,
      PLATFORMS[key].beforeLoadScript,
      `${key} opens its own sign in page directly, so there is nothing to hunt for`);
  }
});

console.log(`  ${passed} checks passed`);
