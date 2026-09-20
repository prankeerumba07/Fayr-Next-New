// A CLAIM LANDS ON THE SHOP'S OWN SIGN IN, NOT ITS SHOPPING PAGE.
//
// 20 September 2026. The owner's flow has said the same thing since 18
// September — "accept terms -> CLAIM -> STRAIGHT to the shop's own LOGIN page,
// inside Fayr. No screen between." The screen went and the LOGIN page went with
// it, so a claim made by somebody signed out of Zepto opened Zepto's front page,
// which carries no sign in at all. Measured on a real claim the same day.
//
// The decision is pure and is imported and run here. The two screens that use it
// cannot be imported under node — they reach for the navigator and the task
// store — so those are read off disk WITH THEIR COMMENTS STRIPPED, the same way
// enterTheShop.test.mjs does it, and held to the rule.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whereAClaimGoes, signInParams } from './afterClaim.js';
import { shopsInsideFayr } from '../shop/insideFayr.js';

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

const detail = withoutComments(read('src/DetailScreen.js'));
const link = withoutComments(read('src/screens/linkaccount.js'));

// Every shop Fayr knows, by the key App.js registers its screen under.
const EVERY_SHOP = ['amazon', 'flipkart', 'meesho', 'myntra', 'zepto', 'blinkit', 'instamart'];

console.log('=== 1. SIGNED OUT GOES TO THAT SHOP\'S OWN SIGN IN, FOR EVERY SHOP ===');
{
  for (const key of EVERY_SHOP) {
    const goes = whereAClaimGoes({ marketplace: key, connected: false });
    ok(goes.kind === 'signin' && goes.route === key,
      `${key}: a signed-out claim goes to the ${key} sign in, not a shopping page`);
  }
  // The owner asked for this "for other marketplaces as well", so the shops that
  // are NOT shopped inside Fayr must answer the same way. If this ever narrows
  // to the in-Fayr list, four shops go back to the screen he removed.
  const outside = EVERY_SHOP.filter((k) => !shopsInsideFayr(k));
  ok(outside.length > 0, 'there really are shops outside Fayr to speak for');
  for (const key of outside) {
    ok(whereAClaimGoes({ marketplace: key, connected: false }).kind === 'signin',
      `${key} is shopped OUTSIDE Fayr and still goes to its sign in`);
  }
}

console.log('=== 2. NOT KNOWING GOES THE SAME WAY AS BEING SIGNED OUT ===');
{
  // A wrong `true` is the expensive one: it drops somebody into a shop they are
  // signed out of with the sign in step already skipped. Only `true` may skip it.
  for (const notTrue of [undefined, null, false, 0, '', 'true', 1, {}]) {
    const goes = whereAClaimGoes({ marketplace: 'zepto', connected: notTrue });
    ok(goes.kind === 'signin',
      `connected=${JSON.stringify(notTrue)} is not a signed-in claim`);
  }
  ok(whereAClaimGoes({ marketplace: 'zepto', connected: true }).kind !== 'signin',
    'and an actual true DOES skip the sign in');
}

console.log('=== 3. ALREADY SIGNED IN KEEPS EXACTLY WHAT IT HAD ===');
{
  ok(whereAClaimGoes({ marketplace: 'zepto', connected: true }).route === 'Shop',
    'a signed-in claim on a shop inside Fayr still goes straight into the shop');
  ok(whereAClaimGoes({ marketplace: 'amazon', connected: true }).route === 'Claimed',
    'a signed-in claim on a shop outside Fayr still lands on the slot reserved moment');
  ok(whereAClaimGoes({ marketplace: '', connected: false }).route === 'Claimed',
    'no shop is not a sign in: there is no screen to open, so it does not invent one');
  ok(whereAClaimGoes({ marketplace: null, connected: false }).route === 'Claimed',
    'and a missing shop is the same');
  ok(whereAClaimGoes().route === 'Claimed', 'called with nothing at all, it still answers');
}

console.log('=== 4. THE ONE WORD THAT DOES THE WORK IS CARRIED ===');
{
  // Without `toSignIn` the frozen connect screen opens the shop's SHOPPING page
  // and this whole change has done nothing. src/signin.js reads exactly this word.
  const p = signInParams('c1');
  ok(p.toSignIn === true, 'signInParams carries toSignIn: true');
  ok(p.campaignId === 'c1', 'and the claim it belongs to');
}

console.log('=== 5. THE CLAIM SCREEN ACTUALLY USES IT ===');
{
  ok(/import \{ whereAClaimGoes, signInParams \} from '\.\/journey\/afterClaim\.js';/.test(detail),
    'DetailScreen imports the decision rather than making its own');
  ok(/import \{ isConnected \} from '\.\/backend\/connectedShops';/.test(detail),
    'and asks our own record whether they are signed in at this shop');

  const decided = detail.indexOf('whereAClaimGoes({');
  const navigated = detail.indexOf('navigation.navigate(goes.route, signInParams(campaignId))');
  const enters = detail.indexOf('await enterTheShop({');
  ok(decided > -1, 'the decision is made on the claim path');
  ok(navigated > decided, 'and a signin answer navigates to the shop route it named');
  ok(enters > decided, 'the shop is only entered AFTER the decision, never before it');

  // The slice is printed so a shape that matches the wrong thing is visible
  // rather than quietly green. See the note in the memory on dead check shapes.
  const slice = detail.slice(decided, decided + 420);
  console.log('    ---- the claim path, as it stands ----');
  console.log(slice.split('\n').map((l) => `    | ${l}`).join('\n'));
  ok(/kind === 'signin'/.test(slice), 'the signin answer is the one that returns early');
  ok(/return;/.test(slice.slice(slice.indexOf("kind === 'signin'"))),
    'and it RETURNS, so a sign in cannot fall through into the shop');
}

console.log('=== 6. THE REMOVED SCREEN NEVER STOPS ANYBODY AGAIN ===');
{
  // ConnectScreen is frozen and navigates back to linkaccount after a sign in.
  // The screen therefore still exists; what it must not do is be a dead end.
  ok(/if \(params\.onJourneyMoved\) \{ params\.onJourneyMoved\(\); return; \}/.test(link),
    'when the journey drew it, the journey is still the thing that moves on');
  // AND THE GUARD KEEPS THE SHAPE connect.test.mjs HOLDS IT TO. A bare `return`,
  // so that check and this one are describing the same line and not two.
  ok(/if \(params\.justSignedIn !== true\) return;/.test(link),
    'and nothing at all happens unless it really was Fayr that saw the sign in');
  ok(/enterTheShop\(\{ campaignId, marketplace: key, navigation \}\)/.test(link),
    'and when nobody drew it, it carries on into the shop by itself');
  ok(/navigation\.navigate\('buyinterstitial', \{ campaignId \}\)/.test(link),
    'or to the buy step for a shop that is not shopped inside Fayr');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
