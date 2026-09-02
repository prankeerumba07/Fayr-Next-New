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

console.log(`  ${passed} checks passed`);
