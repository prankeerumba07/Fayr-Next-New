// CLAIM GOES STRAIGHT INTO THE SHOP, AND THE CONSENT GOES WITH IT.
//
// Phase 7, Task 1, 18 September 2026. The owner's flow: "accept terms -> CLAIM
// -> STRAIGHT to the shop's own LOGIN page, inside Fayr. No screen between." And
// the rule that does not bend with it: "THE CONSENT IS STILL RECORDED ... with
// the same server call the pop-up used to make. A purchase our side has no
// consent for cannot be paid."
//
// Neither the door nor the screens that use it can be imported under node — they
// reach for the task store and the navigator — so every check here reads the
// files off disk WITH THEIR COMMENTS STRIPPED and holds the code to the rule.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const door = withoutComments(read('src/shop/enterTheShop.js'));
const detail = withoutComments(read('src/DetailScreen.js'));
const step = withoutComments(read('src/screens/shop.js'));

console.log('=== 1. THE CONSENT IS RECORDED, FIRST, AND THE SHOP DOES NOT OPEN WITHOUT IT ===');
{
  ok(/import \{ goingToTheShop \} from '\.\.\/backend\/tasksApi';/.test(door),
    'the door makes the same server call the pop-up used to make');
  const recorded = door.indexOf('await goingToTheShop(taskId)');
  const opened = door.indexOf("'Shop'");
  ok(recorded > -1 && opened > recorded, 'THE CONSENT IS RECORDED BEFORE THE SHOP OPENS');
  ok(/if \(!answer \|\| !answer\.ok \|\| !answer\.task\) \{\s*return \{ ok: false, refusal: theSentenceTheyGaveUs\(answer\) \};/.test(door),
    'and a refused consent means the shop is NOT opened, in our own side’s words');
  ok(/applyAuthoritative\(answer\.task\);/.test(door),
    'and the record is applied to the store before anything is drawn');
  // THE SECOND GUARD, the same one ShopScreen keeps.
  ok(/if \(!shopsInsideFayr\(marketplace\)\)/.test(door),
    'and a shop that is not inside Fayr is refused here too, whatever the caller thought');
}

console.log('\n=== 2. CLAIM -> THE SIGN IN, OR THE SHOP IF THEY ARE ALREADY IN ===');
{
  // CORRECTED 20 SEPTEMBER 2026, BY THE OWNER, ABOUT HIS OWN WORDS. This section
  // used to say "CLAIM -> SHOP, NOTHING BETWEEN" and held the claim to going
  // through the door and nowhere else. That was half of what he asked for. The
  // screen he wanted removed was "Connect your {shop} account" — the page with a
  // button on it — and NOT the sign in behind it:
  //
  //   "I wanted that connect my marketplace screen to be removed, not the sign
  //    in thing. Once user taps on claim the campaign they are redirected to the
  //    sign in page of that particular marketplace."
  //
  // Held to the old rule, a claim made signed-out opened Zepto's FRONT PAGE,
  // which carries no sign in at all — measured on a real claim the same day. So
  // the rule is now: the sign in when we do not know they are in, the door when
  // we do, and still no screen of Fayr's own in between either way.
  const claim = detail.slice(detail.indexOf('const doClaim = useCallback'),
    detail.indexOf('}, [navigation, campaignId, accepted, claiming, campaign]);'));
  ok(claim.length > 100, 'the claim callback is where expected');
  const decided = claim.indexOf('whereAClaimGoes({');
  const toSignIn = claim.indexOf('navigation.navigate(goes.route, signInParams(campaignId))');
  const enter = claim.indexOf('await enterTheShop({');
  const returns = claim.indexOf('if (went.ok) return;');
  const claimed = claim.indexOf("navigation.navigate('Claimed'");
  ok(decided > -1, 'the claim asks one place where it goes');
  ok(toSignIn > decided, 'and a person we cannot call signed in goes to the SHOP’S OWN SIGN IN');
  ok(enter > toSignIn && returns > enter,
    'a person who IS signed in still goes through the door and RETURNS');
  ok(claimed > returns, 'so the slot-reserved moment is reached only when the door did not open');
  // AND NOTHING OF FAYR'S OWN IS NAVIGATED TO BETWEEN THE CLAIM AND EITHER ONE.
  // The shop's sign in is the shop's own page, not a screen of ours, so the one
  // navigate that is allowed here is the one that opens it.
  const between = claim.slice(claim.indexOf('if (!res.ok)'), enter);
  const betweenOk = between.slice(between.indexOf('return;\n    }') + 12);
  const strays = betweenOk.replace('navigation.navigate(goes.route, signInParams(campaignId));', '');
  ok(!/navigate\(|replace\(/.test(strays),
    'and nothing but the shop’s own sign in is navigated to between the claim and the door');
  ok(!/'linkaccount'|'buyinterstitial'|'returncatch'|'Journey'/.test(claim),
    'and no connect, before-you-go or did-you-buy-it screen is named by the claim at all');
}

console.log('\n=== 3. THE JOURNEY STEP IS A DOOR THAT RECORDS THE SAME CONSENT ===');
{
  ok(/import \{ enterTheShop \} from '\.\.\/shop\/enterTheShop';/.test(step),
    'src/screens/shop.js goes through the one door');
  ok(/await enterTheShop\(\{ campaignId, marketplace, navigation \}\)/.test(step),
    'with the same three things');
  ok(/if \(!went\.ok\) setRefusal\(went\.refusal\);/.test(step),
    'and draws the refusal when the visit could not be recorded');
  ok(!/goingToTheShop|WebView|whereToLand/.test(step),
    'and neither records the consent itself nor draws a shop — it is a door');
}

console.log('\n=== 3b. THE SCREENSHOT FALLBACK STILL OFFERS THE SHOP, FOR A SHOP INSIDE FAYR ===');
{
  // A person who only looked around gets a read that finds nothing and lands
  // here. Without a door back they were stuck — found by review, fixed the same
  // day. The door goes through the ONE door, and only for a listed shop.
  const primer = withoutComments(read('src/screens/proofprimer.js'));
  ok(/import \{ enterTheShop \} from '\.\.\/shop\/enterTheShop';/.test(primer),
    'the screenshot fallback knows the one door');
  ok(/\{shopsInsideFayr\(key\) \? \(\s*<Ghost onPress=\{\(\) => enterTheShop\(\{ campaignId, marketplace: key, navigation \}\)\}>/.test(primer),
    'and offers it back into the shop, for a shop inside Fayr and nobody else');
  ok((primer.match(/enterTheShop\(/g) || []).length === 1, 'exactly once');
  ok(/navigation\.navigate\('ProofUpload'/.test(primer), 'and the screenshot itself is still offered above it');
}

console.log('\n=== 4. THE FOUR OTHER SHOPS STILL SHOW EVERYTHING THEY SHOW TODAY ===');
{
  // Their claim still lands on the slot-reserved moment, and every screen of the
  // old path is still registered and still a journey step.
  ok(/navigation\.navigate\('Claimed', \{ campaignId \}\);/.test(detail),
    'a claim on one of the four still lands on the slot-reserved moment');
  const app = withoutComments(read('App.js'));
  for (const route of ['Claimed', 'linkaccount', 'buyinterstitial', 'returncatch', 'delivery']) {
    ok(new RegExp(`name="${route}"`).test(app), `the ${route} route is still registered`);
  }
  const journey = withoutComments(read('src/ui/journey.js'));
  for (const key of ["key: 'connect'", "key: 'buy'", "key: 'returncatch'", "key: 'delivered'"]) {
    ok(journey.includes(key), `${key} is still a step`);
  }
  // AND THE MEASURED MODAL ORDERING IN THE BUY SCREEN IS UNTOUCHED, which
  // theNotice.test.mjs pins line by line; here only that the file still holds it.
  const buy = withoutComments(read('src/screens/buyinterstitial.js'));
  ok(/try \{\s*await openShopApp\(key, opens\);\s*\} finally \{\s*setNotice\(null\);/.test(buy),
    'and the buy screen still opens the shop before it dismisses its pop-up');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
