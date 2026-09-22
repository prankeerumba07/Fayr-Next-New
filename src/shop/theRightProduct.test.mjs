// IS THIS THE RIGHT PRODUCT? — WALKED AGAINST TITLES OF THE SHAPE SHOPS WRITE.
//
// The thing worth proving hardest is the DIRECTION the rules are wrong in. A
// title is written by a marketer, not by a database, so the matcher will be
// wrong about some pages whatever it does. What must never happen is a wrong
// green — somebody told the thing in their basket is the one that gets
// refunded when it is not — or a wrong red on a shop's own home page, which
// tells somebody standing on the front door that they picked the wrong product.
//
// So every fixture below is chosen to push at one of those two, and a rule that
// answers "we cannot tell" where it might have guessed is the rule passing, not
// failing.
//
// NONE OF THESE TITLES IS MEASURED. Nobody has read a product page on Zepto,
// Blinkit or Instamart, so these are titles of the shape e-commerce shops
// ordinarily write. That is said out loud here because it bounds what these
// checks prove: they prove the RULES behave as written, not that the rules are
// right about Zepto.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALMOST_NOTHING, BECAUSE, CANNOT_TELL, ENOUGH, ENOUGH_OF_ITS_OWN, RIGHT, WRONG,
  howMuchOverlaps, isAPageOfTheShopsOwn, tidy, whatThePageIs, wordsWorthMatching,
  whatThePageIsHere,
} from './theRightProduct.js';
import { theDeviceLimit, theProductIdInTheAddress } from './insideFayr.js';
import { BAR, TONE, theKeyword, whatTheBarSays } from './theBar.js';
import { verdictDetail } from './shopLog.js';

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

/** The campaign sitting in the practice data right now, so this is not invented. */
const BOLDFIT = 'Boldfit Strapless Sports Headband';
/** The other one, and it is the awkward case: a long catalogue name. */
const HOMESAKE =
  'Homesake Matt Black Twister Metal Bedside Lamp, Pleated Off-White Shade';
/** The owner's own example, where the keyword and the name differ most. */
const PERFORA = 'Perfora Purple Whitening Toothpaste, 75ml';

const said = (product, title) => whatThePageIs(product, title).verdict;
const why = (product, title) => whatThePageIs(product, title).because;

console.log('=== 1. the nine pages the owner named ===');
{
  ok(said(BOLDFIT, 'Boldfit Strapless Sports Headband - Buy Online at Best Price | Zepto') === RIGHT,
    'a product page is RIGHT');
  ok(said(BOLDFIT, 'Search results for headband | Zepto') === CANNOT_TELL,
    'a search results page is CANNOT TELL');
  ok(said(BOLDFIT, 'My Cart | Zepto') === CANNOT_TELL, 'a cart is CANNOT TELL');
  ok(said(BOLDFIT, 'Checkout - Zepto') === CANNOT_TELL, 'a checkout is CANNOT TELL');
  ok(said(BOLDFIT, 'Zepto - 10 Minute Grocery Delivery App') === CANNOT_TELL,
    'a home page is CANNOT TELL');
  ok(said(BOLDFIT, 'Amul Salted Butter 500 g Online | Zepto') === WRONG,
    'a DIFFERENT product’s page is WRONG');
  ok(said(BOLDFIT, '') === CANNOT_TELL, 'an empty title is CANNOT TELL');
  ok(said(BOLDFIT, 'Zepto') === CANNOT_TELL,
    'a title that is only the shop’s name is CANNOT TELL');
  ok(said(BOLDFIT, 'Headband Sports Strapless Boldfit') === RIGHT,
    'the product’s words in a different order is still RIGHT');
}

console.log('\n=== 2. and each of them says WHICH RULE, which is what makes it tunable ===');
{
  ok(why(BOLDFIT, '') === BECAUSE.NO_TITLE, 'no title says so');
  ok(why(BOLDFIT, 'My Cart | Zepto') === BECAUSE.SHOP_FURNITURE, 'a cart names the furniture rule');
  ok(why(BOLDFIT, 'Zepto') === BECAUSE.ONLY_THE_SHOP, 'the shop’s own name names its own rule');
  ok(why(BOLDFIT, 'Boldfit Strapless Sports Headband | Zepto') === BECAUSE.WHOLE_NAME,
    'a title carrying the whole name says so');
  ok(why(BOLDFIT, 'Headband Sports Strapless Boldfit') === BECAUSE.ENOUGH_WORDS,
    'a reordered title is the counting rule, not the whole-name one');
  ok(why(BOLDFIT, 'Amul Salted Butter 500 g Online | Zepto') === BECAUSE.NAMES_SOMETHING_ELSE,
    'a different product names the different-product rule');
  ok(why(BOLDFIT, 'Nivia Sports Headband Black | Zepto') === BECAUSE.NOT_ENOUGH_EITHER_WAY,
    'and a half-match says it could not tell either way');
  // EVERY RULE HAS A NAME AND EVERY NAME IS USED. A rule that can fire without
  // being nameable in the log is a rule that cannot be tuned from a real run.
  for (const name of Object.keys(BECAUSE)) {
    ok(typeof BECAUSE[name] === 'string' && BECAUSE[name].length > 8,
      `${name} is written out in words`);
  }
}

console.log('\n=== 3. the shop’s own pages are NEVER wrong, only unknown ===');
{
  // A person walking through their own cart has not opened the wrong product —
  // they have not opened a product at all. This rule runs FIRST, and the order
  // is load-bearing: a search results page carries the product's own words.
  for (const furniture of [
    'My Cart | Zepto', 'Checkout - Zepto', 'Payment | Zepto', 'My Account',
    'My Orders | Zepto', 'Order History', 'Login | Zepto', 'Sign up - Zepto',
    'Wishlist | Zepto', 'Search results for boldfit strapless sports headband | Zepto',
    'Categories | Zepto', 'Saved Addresses', 'Help & Support', 'Privacy Policy',
    'Track your order', 'Home | Zepto',
  ]) {
    const out = whatThePageIs(BOLDFIT, furniture);
    ok(out.verdict === CANNOT_TELL, `"${furniture}" is never a verdict about a product`);
    ok(out.verdict !== WRONG, `and "${furniture}" is certainly never WRONG`);
  }
  // THE ONE THAT PROVES THE ORDER MATTERS. This title carries every one of the
  // product's own words and would otherwise be a confident RIGHT.
  const results = whatThePageIs(BOLDFIT, 'Search results for boldfit strapless sports headband | Zepto');
  ok(results.verdict === CANNOT_TELL && results.because === BECAUSE.SHOP_FURNITURE,
    'a search results page carrying every product word is still not the product page');
  ok(results.share === 1, 'even though every word of the product is in it');

  // AND THE WORDS ARE WHOLE WORDS. As substrings, "home" strikes "Homesake",
  // which is the brand on one of the two Zepto campaigns in the practice data.
  ok(isAPageOfTheShopsOwn('Homesake Matt Black Bedside Lamp | Zepto') === false,
    '"Homesake" is not the home page');
  ok(said(HOMESAKE, 'Homesake Matt Black Twister Metal Bedside Lamp, Pleated Off-White Shade | Zepto') === RIGHT,
    'and that campaign’s own page is still RIGHT');
}

console.log('\n=== 4. a wrong green is the worst outcome, so the near misses stay grey ===');
{
  // THE SAME CATEGORY, A DIFFERENT BRAND. Half the words match. A title alone
  // genuinely does not settle this, and grey is the honest answer.
  ok(said(BOLDFIT, 'Nivia Sports Headband Black | Zepto') === CANNOT_TELL,
    'another brand’s headband is not called right, and not called wrong either');
  ok(said(BOLDFIT, 'Boldfit Yoga Mat 6mm Blue | Zepto') === CANNOT_TELL,
    'the same brand’s different product is not called right');
  // A DIFFERENT SIZE OF THE SAME THING reads RIGHT, and that is accepted: a
  // title cannot reliably carry a size, and the refund is matched on the ORDER
  // by name and amount on the server, which can.
  ok(said(PERFORA, 'Perfora Purple Whitening Toothpaste 150 ml | Zepto') === RIGHT,
    'a different size of the same product reads right, and the server settles size later');
}

console.log('\n=== 5. the honest limit, written down rather than hidden ===');
{
  // A SHOP THAT TITLES EVERY PAGE THE SAME ANSWERS GREY ALL SESSION, and that is
  // the correct behaviour. If this ever starts answering RIGHT, something has
  // begun guessing.
  for (const sameEveryPage of [
    'Zepto - 10 Minute Grocery Delivery App', 'Blinkit: India’s Last Minute App',
    'Swiggy Instamart - Online Grocery Delivery',
  ]) {
    ok(said(BOLDFIT, sameEveryPage) === CANNOT_TELL,
      `"${sameEveryPage}" answers grey, all session, on purpose`);
    ok(said(BOLDFIT, sameEveryPage) !== WRONG,
      'and never red, which would be a lie told on the front page');
  }
  // A LONG CATALOGUE NAME IS THE OTHER LIMIT. Ten words of adjectives, and a
  // real title carrying half of them reads grey on the right page. The cost is
  // accepted and recorded here so it is found by reading the checks rather than
  // by somebody wondering why the bar never turns green.
  const halfOfALongName = whatThePageIs(HOMESAKE, 'Homesake Twister Metal Bedside Lamp | Zepto');
  ok(halfOfALongName.verdict === CANNOT_TELL,
    'half of a ten-word catalogue name is not enough, and reads grey on the right page');
  ok(halfOfALongName.share < ENOUGH && halfOfALongName.share > ALMOST_NOTHING,
    'it lands in the band between the two thresholds, which is where grey lives');
}

console.log('\n=== 6. tidying, stop words, sizes and numbers ===');
{
  ok(tidy('Perfora  Purple — Toothpaste, 75ml!') === 'perfora purple toothpaste 75 ml',
    'a size written closed up is the same size written open');
  ok(tidy('boAt Airdopes141') === 'boat airdopes 141', 'and so is a model number');
  ok(tidy(null) === '' && tidy(7) === '' && tidy(undefined) === '',
    'anything that is not a string tidies to nothing, rather than throwing');

  const words = wordsWorthMatching('Buy the Best Boldfit Headband Online at Lowest Price in India | Zepto');
  ok(words.indexOf('boldfit') >= 0 && words.indexOf('headband') >= 0,
    'the product’s own words survive');
  for (const filler of ['buy', 'the', 'best', 'online', 'lowest', 'price', 'india', 'zepto']) {
    ok(words.indexOf(filler) === -1, `"${filler}" is marketing, not a product word`);
  }
  // A BARE NUMBER IS A PRICE AS OFTEN AS IT IS A SIZE.
  ok(wordsWorthMatching('Toothpaste 75 ml 199').indexOf('199') === -1,
    'a bare number never counts as a match');
  ok(wordsWorthMatching('Toothpaste 75 ml').indexOf('ml') === -1,
    'and two letters carry no meaning on their own');

  // PLURALS, THE ONE BENDING OF WHOLE-WORD MATCHING THERE IS.
  ok(howMuchOverlaps(['headband'], ['headbands']) === 1, 'a plural is the same word');
  ok(howMuchOverlaps(['headband'], ['headbandage']) === 0,
    'but a longer word that merely starts the same is NOT — that is the substring bug');

  // A PRODUCT WITH NOTHING TO MATCH ON SAYS SO RATHER THAN ANSWERING ANYWAY.
  ok(whatThePageIs('Pack of 2', 'Amul Butter | Zepto').because === BECAUSE.NOTHING_TO_MATCH,
    'a product name made only of filler cannot be judged, and says that');
}

console.log('\n=== 7. the thresholds are the numbers the rules actually use ===');
{
  ok(ENOUGH === 0.6, 'enough is 0.6 — the one threshold in this project that has met real pages');
  ok(ALMOST_NOTHING === 0.2, 'almost nothing is 0.2');
  ok(ENOUGH_OF_ITS_OWN === 3, 'and a title needs three words of its own before it may be called wrong');
  // THE GUARD THAT KEEPS A HOME PAGE OUT OF RED, walked at its own boundary.
  const twoOwnWords = whatThePageIs(BOLDFIT, 'Amul Butter | Zepto');
  ok(twoOwnWords.ofItsOwn < ENOUGH_OF_ITS_OWN && twoOwnWords.verdict === CANNOT_TELL,
    'a title with only two words of its own is grey, never red');
  const threeOwnWords = whatThePageIs(BOLDFIT, 'Amul Salted Butter | Zepto');
  ok(threeOwnWords.ofItsOwn >= ENOUGH_OF_ITS_OWN && threeOwnWords.verdict === WRONG,
    'and one more word of its own is enough to be sure it is something else');

  const code = withoutComments(read('src/shop/theRightProduct.js'));
  ok(/share >= ENOUGH/.test(code), 'the RIGHT rule really reads the ENOUGH constant');
  ok(/share <= ALMOST_NOTHING/.test(code), 'and the WRONG rule really reads ALMOST_NOTHING');
  ok(/titleWords\.length >= ENOUGH_OF_ITS_OWN/.test(code),
    'and the home-page guard really reads its own constant');
}

console.log('\n=== 8. the bar, in four states ===');
{
  const K = 'purple corrector toothpaste perfora, 75 ml';
  const at = (verdict) => whatTheBarSays({ keyword: K, verdict, shopName: 'Zepto' });

  ok(at(null).state === BAR.KEYWORD, 'no page looked at yet is the keyword state');
  ok(at(null).line === 'Type this into Zepto’s search box.',
    'and it tells them to type it, naming the shop');
  ok(at(CANNOT_TELL).state === BAR.CANNOT_TELL, 'a page we cannot read is its own state');
  ok(at(RIGHT).state === BAR.RIGHT && at(RIGHT).line === 'Yes, this is the right product.',
    'RIGHT is the design’s own words');
  ok(at(WRONG).state === BAR.WRONG
    && at(WRONG).line === 'No, this isn’t the correct product — go back & select another product.',
    'and so is WRONG');

  // THE KEYWORD IS ON THE BAR IN EVERY STATE. Somebody told they are on the
  // wrong product needs the phrase more than anybody, not less.
  for (const verdict of [null, CANNOT_TELL, RIGHT, WRONG]) {
    ok(at(verdict).keyword === K, `the keyword is still there in the ${at(verdict).state} state`);
  }

  // NEITHER A YES NOR A NO. The two states that claim nothing are drawn the same
  // as each other, which is the only way to guarantee it.
  ok(TONE[BAR.CANNOT_TELL] === TONE[BAR.KEYWORD],
    'CANNOT TELL looks like the state that claims nothing, not like a yes or a no');
  ok(TONE[BAR.RIGHT] === 'good' && TONE[BAR.WRONG] === 'bad',
    'and only the two real answers are coloured');
  ok(!/yes|right|correct/i.test(at(CANNOT_TELL).line)
    && !/\bno\b|wrong|incorrect/i.test(at(CANNOT_TELL).line),
    'and its words hint in neither direction');

  // AND NO COLOUR VALUE IS WRITTEN IN THE PURE FILE.
  ok(!/#[0-9a-f]{3,6}/i.test(read('src/shop/theBar.js')),
    'theBar.js names tones, never colours — the palette stays in ui/theme.js');
}

console.log('\n=== 9. a missing keyword is said out loud, and NEVER papered over ===');
{
  const none = (verdict) => whatTheBarSays({ keyword: null, verdict, shopName: 'Zepto' });
  for (const empty of [null, undefined, '', '   ', 7, {}]) {
    ok(theKeyword(empty) === null, `${JSON.stringify(empty)} is no keyword at all`);
  }
  ok(none(null).line === 'No search phrase has been written for this offer yet.',
    'with no keyword the bar says so plainly');
  ok(none(null).keyword === null, 'and draws no phrase, because there is none');

  // THE FALLBACK THAT MUST NOT EXIST. A keyword that finds the WRONG product is
  // worse than no keyword, and a silent fallback would hide from ops that the
  // field is empty — the bar would look right while sending people to the wrong
  // search.
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/keyword: searchKeyword,/.test(screen),
    'the screen hands the bar the keyword and only the keyword');
  ok(!/searchKeyword \|\| productName|productName \|\| searchKeyword/.test(screen),
    'and never falls back to the product name');
  // ── REVERSED 18 SEPTEMBER 2026, FROM A REAL RUN, AND THE OLD REASON KEPT ──
  //
  // These two checks used to read "the product name is not even in reach of the
  // bar" and "theBar.js has never heard of it", because Phase 2 carried the
  // search keyword INSTEAD of the product name and the design did not draw the
  // name. The owner, on his own phone, on a live Zepto purchase: "the headline
  // did not mention the name of the product ... it was not showing whether this
  // is the right product or the wrong product. That is why I haven't completed
  // the purchase yet." So the bar carries the name, always, and the keyword
  // stays under it, smaller.
  //
  // WHAT THE OLD CHECKS WERE REALLY GUARDING IS STILL GUARDED, in the two lines
  // above this note and the three below: the keyword is handed as the keyword,
  // the product as the product, and NEITHER IS EVER DERIVED FROM THE OTHER — a
  // keyword that falls back to the catalogue name sends people to the wrong
  // search, and that is the thing that must not happen.
  const theCall = screen.slice(screen.indexOf('whatTheBarSays({'),
    screen.indexOf('whatTheBarSays({') + 400);
  ok(/productName,/.test(theCall) && /keyword: searchKeyword,/.test(theCall),
    'the bar is handed BOTH the product name and the keyword, as two arguments');
  const bar = withoutComments(read('src/shop/theBar.js'));
  ok(/export function theProduct\(productName\)/.test(bar)
    && /export function theKeyword\(keyword\)/.test(bar),
    'and theBar.js tidies each with its own function, so neither is the other under a new name');
  const keywordFn = bar.slice(bar.indexOf('export function theKeyword('),
    bar.indexOf('export function theKeyword(') + 260);
  ok(!/product/i.test(keywordFn), 'and theKeyword never so much as reads the product');
  // ── COUNTED AGAINST THE STATES, NOT AGAINST A NUMBER — 22 SEPTEMBER 2026 ──
  //
  // This used to assert `=== 5`, and went red the day a sixth state was added
  // (TOO_MANY_DEVICES, for the shop refusing on device count). The rule it is
  // protecting is "EVERY state carries both", so it now counts the states and
  // cannot go stale again when a seventh arrives.
  const states = Object.keys(BAR).length;
  ok((bar.match(/product,\n\s+keyword: phrase,/g) || []).length === states,
    `and the product is carried in all ${states} states, beside the keyword, never instead of it`);

  // AND THERE IS NO COPY CONTROL ANYWHERE NEAR THIS SCREEN. The design draws
  // one; the owner took it away on purpose and the person types the keyword.
  for (const f of ['src/shop/ShopScreen.js', 'src/shop/theBar.js', 'src/shop/theRightProduct.js']) {
    ok(!/Clipboard|setStringAsync|copyProductName|copyLine/.test(read(f)),
      `${f.slice(10)} touches no clipboard`);
  }
}

console.log('\n=== 10. the bar is a HINT and never a GATE ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));

  // THE ONE CONDITION THE SHOP'S PAGE IS DRAWN FROM is whether the saved sign in
  // has been restored. No verdict can reach it.
  const view = screen.slice(screen.indexOf('<WebView'), screen.indexOf('startInLoadingState'));
  ok(view.length > 200, 'the web view block was found');
  for (const forbidden of ['bar.', 'verdict', 'WRONG', 'RIGHT', 'CANNOT_TELL', 'pageTitle']) {
    ok(view.indexOf(forbidden) === -1,
      `the shop’s page does not depend on ${forbidden} — a verdict cannot gate it`);
  }
  ok(/\{!sessionReady \?/.test(screen),
    'and the one thing it does depend on is the restored sign in');

  // NOTHING BLOCKS, DISABLES OR HIDES ON A VERDICT.
  ok(!/pointerEvents/.test(screen), 'nothing stops taps reaching the shop');
  ok(!/disabled=/.test(screen), 'nothing is disabled');
  ok(!/Alert\.|Modal/.test(screen), 'nothing is put in front of the page');
  ok(!/goBack\(\)[\s\S]{0,80}WRONG|WRONG[\s\S]{0,120}navigation\./.test(screen),
    'and a WRONG never navigates anybody anywhere');

  // THE VERDICT REACHES WHAT IS DRAWN ONLY THROUGH THE BAR. Nothing in the whole
  // of the rendering may read it directly, which is what makes a gate impossible
  // to add without deleting this check first.
  const drawn = screen.slice(screen.indexOf('  return (\n    <SafeAreaView style={styles.container}'),
    screen.indexOf('const styles = StyleSheet.create'));
  ok(drawn.length > 400, 'the rendering was found');
  ok(!/verdict/.test(drawn), 'nothing that is drawn reads the verdict directly');
  ok(/\{bar\.line\}/.test(drawn) && /\{bar\.keyword\}/.test(drawn),
    'it reaches the screen only as the bar’s own words');
  ok(/it is written twice|hint and it is never a gate|hint and never a gate/i
    .test(read('src/shop/theRightProduct.js')),
    'and the file says so in its own first paragraphs');
}

console.log('\n=== 11. the log line is what makes the rules tunable ===');
{
  const out = whatThePageIs(BOLDFIT, 'Nivia Sports Headband Black | Zepto');
  const line = verdictDetail({ title: 'Nivia Sports Headband Black | Zepto', ...out });
  ok(/said=CANNOT_TELL/.test(line), 'the line carries the answer');
  ok(/rule="not enough of the words either way"/.test(line), 'and which rule produced it');
  ok(/share=0\.5/.test(line), 'and the share, so a threshold can be tuned from real pages');
  ok(/words=2\/4/.test(line) && /own=4/.test(line), 'and the counts behind the share');
  ok(/title="Nivia Sports Headband Black \| Zepto"/.test(line), 'and the title it judged');

  // SAME RULES AS PHASE 1: a title, never a page.
  const log = withoutComments(read('src/shop/shopLog.js'));
  ok((log.match(/console\.log\(/g) || []).length === 1,
    'still exactly one console.log in the whole file');
  ok(!/innerHTML|outerHTML|textContent/.test(log),
    'and still no way to be handed a page’s text or markup');
  ok(/maskNumbers\(/.test(log), 'and every line still goes through the mask');

  // AND THE SCREEN REALLY WRITES IT.
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/logShop\('WHAT WE MAKE OF IT', verdictDetail\(/.test(screen),
    'the screen writes one line per page it judges');
  ok(/lastJudged\.current === pageTitle/.test(screen),
    'and one per TITLE, so a repeated page does not bury the page that changed');
}

console.log('\n=== 12. Phase 1 is not disturbed ===');
{
  const pure = read('src/shop/insideFayr.js');
  ok(/export const WE_LOAD = \['http', 'https'\];/.test(pure),
    'the whitelist is exactly as Phase 1 left it');
  ok(/Linking\.openURL\(url\)\.catch\(/.test(read('src/shop/ShopScreen.js')),
    'and the payment handoff still hands off and still never throws');
  ok(Object.keys(JSON.parse('{"zepto":1}')).length === 1, 'sanity');
  // ── AND THE IN-APP LIST GREW ON 18 SEPTEMBER 2026 ────────────────────────
  //
  // This line used to refuse Blinkit and Instamart, because Phase 2 said they
  // stayed out. The phase of 18 September puts all three quick-commerce shops
  // in. What this file is really guarding is that PHASE 2 was not disturbed, so
  // the check becomes the thing Phase 2 actually owns: the four shops that keep
  // their own app are still outside, and nothing about the product verdict knows
  // which shop it is looking at.
  const list = withoutComments(pure).slice(
    withoutComments(pure).indexOf('export const SHOPS_INSIDE_FAYR'),
    withoutComments(pure).indexOf('export const ANDROID_LIKE_A_PHONE'),
  );
  ok(!/\bamazon:|\bflipkart:|\bmeesho:|\bmyntra:/.test(list),
    'the four shops that keep their own app are still outside the in-app list');
  const verdict = withoutComments(read('src/shop/theRightProduct.js'));
  ok(/export function whatThePageIs\(productName, title\)/.test(verdict),
    'and the product verdict is still asked about a name and a title and nothing else');
  ok(!/SHOPS_INSIDE_FAYR|shopsInsideFayr|insideFayr/.test(verdict),
    'so it cannot have learned which shop it is reading');
}


console.log('\n=== THE ADDRESS DECIDES, WHERE THE TITLE CANNOT — 22 SEPTEMBER 2026 ===');
{
  // ── THE RUN THIS COMES FROM ───────────────────────────────────────────────
  //
  // The owner searched Swiggy Instamart, found the BLA BLI BLU perfume, opened
  // its own page, and the keyword bar never went green — not on the product
  // page, not after adding to the cart. The log says why: that page's title is
  //
  //   "Online Grocery Store | Buy Groceries at Best Prices - Instamart"
  //
  // which is the SAME string the home page and the search results report. The
  // name-against-title match scored words=0/6 on the RIGHT product. On that shop
  // a verdict from the title is impossible, in either direction, for ever.
  const GENERIC = 'Online Grocery Store | Buy Groceries at Best Prices - Instamart';
  const NAME = 'BLA BLI BLU Selfmade Perfume for Men';
  const WANTED = 'https://www.swiggy.com/instamart/item/SHU0ZB5M7P';

  // FIRST, THE MEASUREMENT ITSELF: the title genuinely cannot answer.
  ok(whatThePageIs(NAME, GENERIC).verdict === CANNOT_TELL,
    'the title on Instamart’s product page cannot tell — this is the defect, pinned');

  // AND THE ADDRESS CAN.
  const idOf = (u) => theProductIdInTheAddress('instamart', u);
  const onIt = whatThePageIsHere({
    productName: NAME, title: GENERIC, hereId: idOf(WANTED), wantedId: idOf(WANTED),
  });
  ok(onIt.verdict === RIGHT, 'THE RIGHT PRODUCT IS GREEN, decided by the id in the address');
  ok(onIt.because === BECAUSE.SAME_PRODUCT_ID, 'and says the address decided it');

  const elsewhere = whatThePageIsHere({
    productName: NAME, title: GENERIC,
    hereId: idOf('https://www.swiggy.com/instamart/item/ZZZ9OTHER1'), wantedId: idOf(WANTED),
  });
  ok(elsewhere.verdict === WRONG, 'A DIFFERENT PRODUCT IS RED — the red he asked for');
  ok(elsewhere.because === BECAUSE.DIFFERENT_PRODUCT_ID, 'and says which rule decided');

  // AND A PAGE THAT IS NOT A PRODUCT AT ALL STILL CLAIMS NOTHING.
  for (const url of [
    'https://www.swiggy.com/instamart',
    'https://www.swiggy.com/instamart/search?query=Bla+Bli+Blu',
    'https://www.swiggy.com/instamart/cart',
  ]) {
    ok(whatThePageIsHere({
      productName: NAME, title: GENERIC, hereId: idOf(url), wantedId: idOf(WANTED),
    }).verdict === CANNOT_TELL, `${url.slice(24)} names no product, so it says nothing`);
  }
}

console.log('\n=== AND ZEPTO, WHOSE GREEN ALREADY WORKS, IS UNTOUCHED ===');
{
  // The fallback is not a nicety. EVERY campaign in the database today has
  // productUrl null, so the title is still the only answer until somebody fills
  // one in — and Zepto's titles DO carry the product name.
  const ZNAME = 'Cadbury Celebrations Assorted Chocolate Gift Pack';
  const ZTITLE = 'Cadbury Celebrations Assorted Chocolate Gift Pack - Buy at ₹120 Online | Instant Delivery';
  const ZURL = 'https://www.zepto.com/pn/cadbury-celebrations-assorted-chocolate-gift-pack/pvid/90c33466-de17-436d-b6a0-7d67e025cc63';

  // WITH NO CAMPAIGN ADDRESS — which is every campaign today — it falls straight
  // back to the title, and answers exactly what it answered before.
  const zid = (u) => theProductIdInTheAddress('zepto', u);
  const byTitle = whatThePageIsHere({
    productName: ZNAME, title: ZTITLE, hereId: zid(ZURL), wantedId: zid(null),
  });
  ok(byTitle.verdict === RIGHT, 'Zepto is still green from its title alone');
  ok(byTitle.because === whatThePageIs(ZNAME, ZTITLE).because,
    'and by the very same rule it used before — the fallback is the old function, not a copy');

  // AND WITH ONE, the id agrees with the title rather than fighting it.
  ok(whatThePageIsHere({
    productName: ZNAME, title: ZTITLE, hereId: zid(ZURL), wantedId: zid(ZURL),
  }).verdict === RIGHT, 'and green by id too, when the campaign names its product');

  // THE SLUG IS NOT THE ID. Zepto's address carries the product's NAME as well;
  // matching on that would be the title's fuzzy guess wearing a different hat.
  ok(theProductIdInTheAddress('zepto', ZURL) === '90c33466-de17-436d-b6a0-7d67e025cc63',
    'the id is the pvid, never the slug');
}

console.log('\n=== AND IT REFUSES ANYTHING THAT IS NOT AN ID ===');
{
  ok(theProductIdInTheAddress('amazon', 'https://www.amazon.in/dp/B0C123') === null,
    'a shop with no measured product address yields nothing');
  ok(theProductIdInTheAddress('blinkit', 'https://blinkit.com/prn/x/prid/999') === null,
    'and Blinkit, which nobody has watched, yields nothing rather than a guess');
  for (const junk of [null, undefined, '', 42, {}, 'not a url']) {
    ok(theProductIdInTheAddress('instamart', junk) === null,
      `${JSON.stringify(junk)} is not an address`);
  }
  ok(theProductIdInTheAddress('instamart', 'https://www.swiggy.com/instamart/item/') === null,
    'and an empty id is no id');
  ok(theProductIdInTheAddress('instamart', 'https://www.swiggy.com/instamart/item/ab') === null,
    'and two characters is not an identifier');
}

console.log('\n=== THE SHOP REFUSING ON DEVICE COUNT — MEASURED 22 SEPTEMBER 2026 ===');
{
  // ── THE RUN THIS COMES FROM ───────────────────────────────────────────────
  //
  // The owner, signing in to Swiggy inside Fayr: "I was already logged in on
  // multiple devices, so I had to first log out from all the other devices."
  // Swiggy sent him to two pages, and the second states the limit itself:
  //
  //   /my-account/login-limit-exceeds
  //   /my-account/logout-options/?isFlowTypeAbuseManagement=true&abuseDeviceLimit=2
  //
  // FAYR RECOGNISED NEITHER and sat silent on both, so he was left working out
  // what had happened from a page that is not ours.
  const LOGOUT = 'https://www.swiggy.com/my-account/logout-options/?isFlowTypeAbuseManagement=true&abuseDeviceLimit=2';
  const EXCEEDS = 'https://www.swiggy.com/my-account/login-limit-exceeds';

  ok(theDeviceLimit('instamart', LOGOUT).hit === true, 'the logout-options page is recognised');
  ok(theDeviceLimit('instamart', LOGOUT).limit === 2,
    'AND THE NUMBER IS SWIGGY’S OWN, read out of its address rather than written into ours');
  ok(theDeviceLimit('instamart', EXCEEDS).hit === true, 'and so is login-limit-exceeds');
  ok(theDeviceLimit('instamart', EXCEEDS).limit === null,
    'which states no number, so none is invented');

  // AND AN ORDINARY PAGE IS NOT THIS.
  for (const u of [
    'https://www.swiggy.com/instamart',
    'https://www.swiggy.com/instamart/item/SHU0ZB5M7P',
    'https://www.swiggy.com/auth',
  ]) {
    ok(theDeviceLimit('instamart', u).hit === false, `${u.slice(24) || '/'} is not the device-limit page`);
  }
  // AND A SHOP NOBODY HAS MEASURED CLAIMS NOTHING — Zepto and Blinkit have no
  // table, so the same address answers no.
  for (const shop of ['zepto', 'blinkit', 'amazon', null]) {
    ok(theDeviceLimit(shop, LOGOUT).hit === false,
      `${JSON.stringify(shop)} has not been watched hitting a device limit, so it says nothing`);
  }
  for (const junk of [null, undefined, '', 42, {}]) {
    ok(theDeviceLimit('instamart', junk).hit === false, `${JSON.stringify(junk)} is not an address`);
  }
}

console.log('\n=== AND THE BAR SAYS WHAT HAPPENED, ABOVE EVERYTHING ELSE ===');
{
  const say = (deviceLimit, over = {}) => whatTheBarSays({
    productName: 'BLA BLI BLU Selfmade Perfume for Men',
    keyword: 'bla bli blu perfume',
    verdict: null, shopName: 'Instamart', deviceLimit, ...over,
  });

  const withNumber = say({ hit: true, limit: 2 });
  ok(withNumber.state === BAR.TOO_MANY_DEVICES, 'the bar takes the device-limit state');
  ok(/allows 2 devices/.test(withNumber.line), 'and says the shop’s own number');
  ok(/Sign out of one there/.test(withNumber.line), 'and the one thing to do about it');

  const withoutNumber = say({ hit: true, limit: null });
  ok(/too many devices/i.test(withoutNumber.line), 'and says it plainly when the shop stated no number');
  ok(!/\b2\b|\bnull\b|undefined/.test(withoutNumber.line), 'AND INVENTS NO NUMBER — the sentence drops it');

  // IT OUTRANKS EVERYTHING, because nothing else matters while somebody cannot
  // get in — including an order already seen.
  ok(say({ hit: true, limit: 2 }, { orderPlaced: true }).state === BAR.TOO_MANY_DEVICES,
    'and it outranks even "order placed", because nothing else matters while they are locked out');
  ok(say({ hit: true, limit: 2 }, { verdict: 'RIGHT' }).state === BAR.TOO_MANY_DEVICES,
    'and the product verdict too');

  // AND IT IS NOT RED. Red on this bar means "wrong product"; being signed in
  // elsewhere is the shop's rule, not a mistake the person made.
  ok(withNumber.tone !== 'bad', 'it is not drawn as a wrong product');

  // AND NOTHING CHANGES WHEN THE SHOP IS NOT REFUSING.
  for (const d of [null, undefined, { hit: false, limit: null }]) {
    ok(say(d).state !== BAR.TOO_MANY_DEVICES, `${JSON.stringify(d)} leaves the bar alone`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
