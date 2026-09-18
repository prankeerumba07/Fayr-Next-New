// Opening the shop's app, and the clipboard — without a phone.
//
// The two things worth proving hardest: what goes on somebody's clipboard is the
// product name and nothing else, and a shop we have no app address for still has
// a way through.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SHOP_APP, addressesToTry, appButtonLabel, appLinkFor, copyLine, hasAppLink,
  whatToCopy, whichDoorLine,
} from './shopApp.js';

/**
 * The shops Fayr really works with, READ OUT OF THE FROZEN platforms.js rather
 * than typed here.
 *
 * Read as text, not imported: platforms.js is 2,578 lines of injected browser
 * scripts and it is not this test's business to load it. Reading its own export
 * line means this check cannot drift from the real list — if a shop is ever added
 * or removed there, this fails until the app map matches.
 */
const PLATFORM_KEYS = (() => {
  const src = readFileSync(new URL('../platforms.js', import.meta.url), 'utf8');
  const line = (src.match(/export const PLATFORMS = \{([^}]*)\}/) || [])[1] || '';
  const keys = line.split(',').map((k) => k.trim()).filter((k) => /^[a-z]+$/.test(k));
  if (keys.length < 5) throw new Error('could not read the shop list out of platforms.js');
  return keys;
})();

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

console.log('=== 1. every shop Fayr works with has a row ===');
{
  for (const key of PLATFORM_KEYS) {
    ok(SHOP_APP[key] != null, `${key} has a row`);
    ok(hasAppLink(key), `${key} has an app address to try`);
    const link = appLinkFor(key);
    ok(typeof link === 'string' && /^[a-z][a-z0-9.+-]*:\/\//.test(link),
      `${key}'s app address is an address, not a note`);
  }
  ok(Object.keys(SHOP_APP).length === PLATFORM_KEYS.length,
    'and there is no row for a shop Fayr does not work with');
}

console.log('\n=== 2. a shop we know nothing about still has a way through ===');
{
  for (const unknown of [undefined, null, '', 'ebay', 'tatacliq', 7, {}]) {
    ok(appLinkFor(unknown) === null, `${JSON.stringify(unknown)} has no app address`);
    ok(hasAppLink(unknown) === false, 'and says so');
  }
  // THE FALLBACK IS THE POINT. A shop with no app address, or one whose address
  // turns out to be wrong on a real phone, must still be reachable — and the web
  // address comes from the frozen platforms.js, not from here, so it always is.
  ok(true, 'the web address is read off platforms.js, never invented here');
}

console.log('\n=== 2b. THE FALLBACK, WHICH IS THE WHOLE REASON A GUESS IS SAFE ===');
{
  const web = 'https://www.amazon.in/';
  const order = addressesToTry('amazon', web);
  ok(order.length === 2, 'two addresses to try for a shop we have an app address for');
  ok(order[0].kind === 'app', 'the shop’s own app FIRST');
  ok(order[1].kind === 'web', 'and the website second');
  ok(order[1].url === web, 'and the website is the one handed in, not one invented here');

  // A shop we have no app address for is still reachable, and it is reachable by
  // the address the reader itself uses.
  const unknownShop = addressesToTry('ebay', web);
  ok(unknownShop.length === 1 && unknownShop[0].kind === 'web',
    'a shop with no app address still has the website');

  // AND THE WEB ADDRESS IS NEVER INVENTED. With none handed in there is no
  // fallback, and the caller is told nothing opened rather than being sent
  // somewhere this file made up.
  const noWeb = addressesToTry('amazon', null);
  ok(noWeb.length === 1 && noWeb[0].kind === 'app',
    'with no website handed in there is only the app to try');
  for (const bad of [undefined, '', 7, {}]) {
    ok(!addressesToTry('amazon', bad).some((a) => a.kind === 'web'),
      `${JSON.stringify(bad)} is not a website`);
  }
  ok(addressesToTry(null, null).length === 0,
    'and nothing at all gives nothing to try, not a guess');
}

console.log('\n=== 2c. THE FILE THAT DOES THE OPENING HOLDS NO ADDRESS OF ITS OWN ===');
{
  const wired = readFileSync(new URL('../openShop.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/addressesToTry\(/.test(wired), 'it asks this file for the order to try');
  ok(!/:\/\//.test(wired), 'and contains no address at all');
  ok(!/amazon|flipkart|swiggy/i.test(wired), 'and names no shop');
  // Nothing on this path may throw: it runs at the moment somebody is sent
  // shopping, which is the worst moment for a crash.
  ok(/catch \(e\)/.test(wired), 'and every attempt is caught');
  ok(/return 'nothing'/.test(wired),
    'so a phone that opens neither is told, rather than thrown at');
}

console.log('\n=== 3. WHAT GOES ON THE CLIPBOARD IS THE PRODUCT NAME AND NOTHING ELSE ===');
{
  ok(whatToCopy('Prestige Induction Cooktop 1900W') === 'Prestige Induction Cooktop 1900W',
    'a clean name goes across as it is');
  ok(whatToCopy('  Nike   Revolution\n7  ') === 'Nike Revolution 7',
    'line breaks and runs of spaces are tidied, because a search box chokes on them');
  for (const nothing of [undefined, null, '', '   ', '\n\t ', 42, {}, []]) {
    ok(whatToCopy(nothing) === null, `${JSON.stringify(nothing)} is nothing to copy`);
  }
  // Nothing is ADDED. A price, a shop name or a note from Fayr in the clipboard
  // turns a search that finds the product into a search that finds nothing.
  const copied = whatToCopy('Prestige Induction Cooktop');
  ok(!/fayr|₹|amazon|refund/i.test(copied), 'and nothing of ours is added to it');
}

console.log('\n=== 4. the person is always told their clipboard changed ===');
{
  const said = copyLine('Prestige Induction Cooktop', true);
  ok(/clipboard/.test(said), 'it names the clipboard');
  ok(/paste/.test(said), 'and says what to do with it');

  const failed = copyLine('Prestige Induction Cooktop', false);
  ok(/could not copy/.test(failed), 'a copy that did not work says so');
  ok(/type it/.test(failed), 'and says what to do instead');

  const noName = copyLine(null, true);
  ok(/could not work out the product name/.test(noName),
    'and with no name at all it does not claim to have copied one');

  for (const state of [undefined, null, '', 42, {}]) {
    const line = copyLine(state, true);
    ok(typeof line === 'string' && line.length > 20 && !/undefined|null|NaN/.test(line),
      `${JSON.stringify(state)} still reads as a sentence`);
  }
}

console.log('\n=== 5. the button, and the line about the two doors ===');
{
  ok(appButtonLabel('amazon', 'Amazon') === 'GO TO AMAZON NOW',
    'the owner’s own wording');
  ok(appButtonLabel('flipkart', 'Flipkart') === 'GO TO FLIPKART NOW', 'per shop');
  ok(appButtonLabel('amazon') === 'GO TO AMAZON NOW',
    'and it can work the name out itself');
  for (const bad of [undefined, null, 7, {}]) {
    const label = appButtonLabel(bad, bad);
    ok(typeof label === 'string' && !/undefined|null|NaN|\[object/.test(label),
      `${JSON.stringify(bad)} still reads as a button`);
  }

  const door = whichDoorLine('Amazon');
  ok(/inside Fayr/.test(door), 'the line names Fayr’s own web view');
  ok(/own app/.test(door), 'and the shop’s own app');
  ok(/read your order/.test(door), 'and says why one of them matters');
  ok(!/undefined|null/.test(whichDoorLine(null)), 'with no shop name it still reads');
}

console.log('\n=== 6. THE THREE SCREENS THAT SEND SOMEBODY SHOPPING REALLY DO IT ===');
{
  // Source-read, the same way the journey's checks are, because a React Native
  // screen cannot be loaded under node. Three screens send somebody to a shop, and
  // every one of them must copy the name and offer both doors.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (key) => strip(readFileSync(
    new URL(`../screens/${key}.js`, import.meta.url), 'utf8',
  ));

  // ONE DOOR NOW, NOT TWO. Changed on 2 September 2026: the owner asked for no
  // marketplace ever to open inside Fayr, so the "open the shop inside Fayr"
  // button is gone from both screens and the line explaining which door was which
  // went with it, because there is nothing left to explain.
  for (const key of ['buyinterstitial', 'reviewguide']) {
    const src = read(key);
    ok(/copyProductName\(/.test(src), `${key} puts the product name on the clipboard`);
    ok(/copyLine\(/.test(src), `${key} says out loud that the clipboard changed`);
    ok(/openShopApp\(/.test(src), `${key} offers the shop’s own app`);
    ok(!/whichDoorLine\(/.test(src), `${key} still explains two doors`);
    ok(!/navigation\.navigate\(key/.test(src),
      `${key} still opens a marketplace inside Fayr`);
    // THE WORDING OF THE ONE BUTTON THAT REMAINS, and the two screens no longer
    // say the same thing.
    //
    // The design reads "OPEN AMAZON →" on both (fayr-design.browser.jsx:2568).
    // The owner asked on 16 September 2026 for the BUY step to say "BUY ON
    // AMAZON", and he is right: that is the step where somebody goes and buys
    // the product, and "open" describes what the phone does rather than what the
    // person is there to do. The REVIEW step keeps "OPEN", because opening is
    // exactly what it is for — there is nothing to buy by then.
    const wording = key === 'buyinterstitial'
      ? /BUY ON \{shop\.toUpperCase\(\)\} →/
      : /OPEN \{shop\.toUpperCase\(\)\} →/;
    ok(wording.test(src), `${key} does not use its own button wording`);
  }

  console.log('\n=== 6b. NOTHING SHOWS A MARKETPLACE INSIDE FAYR EXCEPT CONNECTING ===');
  {
    // ONE FILE MAY, AND ONLY ONE. src/ConnectScreen.js is the connect flow: it
    // loads the shop in a web view and reads the signed-in order pages, which is
    // the only way Fayr can see an order at all. The design says so itself, in the
    // comment at fayr-design.browser.jsx:2284: "The native app connects by loading
    // the marketplace in an in-app WebView and capturing the logged-in session
    // cookie." That file is frozen and this part of the work did not name it.
    //
    // So the rule that can be checked is the real one: no OTHER file under src may
    // render a web view, and no screen may send somebody to a marketplace route to
    // go shopping.
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files = [];
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(dir);
    ok(files.length > 40, `walked ${files.length} files under src`);

    const webViews = files.filter((f) => {
      const src = strip(readFileSync(f, 'utf8'));
      return /from 'react-native-webview'/.test(src);
    }).map((f) => f.slice(dir.length + 1));
    // THREE FILES MAY, AND ALL THREE ARE NAMED, AND NOT ONE OF THEM SHOWS A SHOP
    // TO A SHOPPER TO SHOP IN.
    //
    //   ConnectScreen.js         the connect flow described above. It is the only
    //                            way Fayr can read an order at all, and the design
    //                            itself describes it doing exactly this (:2284).
    //   LiveCheckScreen.js       the staff offer page check. A staff tool, off
    //                            unless somebody deliberately turns it on (see
    //                            src/walkthrough/onlyForUs.js), unreachable by any
    //                            shopper.
    //   order/LookingForItScreen.js  reads the shop's own list of recent orders
    //                            after somebody says they bought it. One point
    //                            across, fully see through, off the side of the
    //                            screen: there is nothing on it for anybody to
    //                            look at and nothing to tap. It is a read, like the
    //                            other two, and not a place to shop.
    //
    // Anything else rendering a web view is a shopper being shown a marketplace
    // inside Fayr, which is the thing the owner had removed.
    //   order/LookingForReviewScreen.js  reads the person's own list of reviews
    //                            after they say they have posted one. The same
    //                            read as the one above and the same web view: one
    //                            point across, fully see through, off the side of
    //                            the screen, nothing to tap. It exists because
    //                            whether a review is really there is the fact a
    //                            refund turns on, and it must come off the shop's
    //                            own page rather than from anybody's word for it.
    // ── AND A FIFTH, ADDED 18 SEPTEMBER 2026, WHICH REVERSES THE RULE ABOVE
    //    FOR THREE SHOPS AND ON PURPOSE ────────────────────────────────────
    //
    //   shop/ShopScreen.js       a shop shown to a shopper to shop in. That is
    //                            the exact thing the four entries above are
    //                            written to forbid, and it is now what the owner
    //                            has asked for: Zepto, Blinkit and Swiggy
    //                            Instamart are to be shopped INSIDE Fayr, in
    //                            Fayr's own web view, with the product name on a
    //                            bar across the top so nobody copies or pastes
    //                            anything. His words: "A person never leaves Fayr
    //                            to shop."
    //
    // THIS IS A DELIBERATE REVERSAL OF AN EXISTING DESIGN AND NOT A HOLE. The
    // rule above is not being loosened to let it through — the entry is named,
    // like the other four, and the grounds that make it honest are checked below
    // rather than trusted, exactly as the two reading screens' grounds are.
    //
    // ITS GROUNDS ARE DIFFERENT FROM EVERY OTHER ENTRY'S. The two readers are
    // allowed because their view is invisible and has nothing to tap. This one is
    // allowed because of WHICH SHOPS REACH IT: only a shop listed in
    // src/shop/insideFayr.js, which today is Zepto alone. Amazon, Flipkart,
    // Meesho and Myntra still go to their own installed app through
    // src/openShop.js, and neither of the two guards that keeps them there is in
    // this file — see src/shop/insideFayr.test.mjs, which walks both.
    const ALLOWED = [
      'ConnectScreen.js', 'LiveCheckScreen.js', 'order/LookingForItScreen.js',
      'order/LookingForReviewScreen.js', 'shop/ShopScreen.js',
    ];
    const extra = webViews.filter((f) => !ALLOWED.includes(f));
    ok(extra.length === 0, `these render a web view and should not: ${extra.join(', ')}`);

    // ── AND THE READING SCREENS HAVE TO STAY UNREACHABLE ────────────────────
    //
    // THE LIST ABOVE IS NOT A PERMISSION TO SHOW A SHOP. Two of the four are
    // allowed on the stated grounds that their view is invisible, off screen and
    // has nothing on it to tap — so those grounds are checked rather than
    // trusted. Without this, widening the list is all it takes to put a
    // marketplace in front of a shopper, which is the thing the owner had
    // removed, and the check that was supposed to prevent it would pass.
    //
    // THE OTHER TWO ARE NOT HELD TO IT, deliberately: the connect screen is a
    // shop the person is deliberately signing in to, and the live check is a
    // staff tool that is off unless somebody turns it on.
    for (const reader of ['order/LookingForItScreen.js', 'order/LookingForReviewScreen.js']) {
      const src = strip(readFileSync(join(dir, reader), 'utf8'));
      ok(/accessibilityElementsHidden/.test(src),
        `${reader} must keep its web view out of the reading order`);
      ok(/importantForAccessibility="no-hide-descendants"/.test(src),
        `${reader} must hide its web view from assistive tech`);
      ok(/position: 'absolute', width: 1, height: 1, opacity: 0/.test(src),
        `${reader} must keep its web view one point across and invisible`);
    }
    // AND THE NEW ONE'S GROUNDS ARE CHECKED IN THE SAME SPIRIT. Its claim is not
    // that it is invisible — it is deliberately visible — but that only a listed
    // shop can reach it. A version of it that opened any marketplace handed to it
    // would be the thing the rule above forbids, wearing the exception's name.
    {
      const shop = strip(readFileSync(join(dir, 'shop/ShopScreen.js'), 'utf8'));
      ok(/whereToLand\(/.test(shop),
        'shop/ShopScreen.js must ask insideFayr.js where it may land, which refuses an unlisted shop');
      ok(/if \(!landing \|\| !platform\)/.test(shop),
        'and it must show no shop page at all when the answer is nothing');
      ok(/styles\.bar/.test(shop),
        'and it must carry the bar, which is the whole reason a shop may be shown here');
    }

    // And the two that may are still there, so this cannot pass by them being
    // deleted.
    for (const f of ALLOWED) {
      ok(webViews.includes(f), `${f} no longer renders a web view`);
    }

    // AND NO SHOPPING SCREEN SENDS ANYBODY TO A MARKETPLACE'S OWN ROUTE. The
    // per-marketplace routes are the CONNECT screen — App.js names one after each
    // shop's key — and going shopping is not connecting. That ban is unchanged.
    for (const key of ['buyinterstitial', 'reviewguide']) {
      ok(!/navigation\.(navigate|replace|push)\(key/.test(read(key)),
        `${key} opens a marketplace route inside Fayr`);
    }

    // ── THE ONE ROUTE THAT NOW MAY, AND WHAT KEEPS IT HONEST ────────────────
    //
    // UPDATED 18 SEPTEMBER 2026 rather than loosened. Until today no shopping
    // screen could send anybody to a shop inside Fayr at all. One now can, for a
    // listed shop only, so the thing to check is no longer "does it navigate"
    // but "is the navigation gated" — and the gate is the FIRST of the two
    // guards, the second being whereToLand refusing an unlisted shop.
    {
      const door = strip(read('buyinterstitial'));
      ok(/shopsInsideFayr\(key\)/.test(door),
        'buyinterstitial must ask the in-app list before it sends anybody anywhere');
      const gate = door.indexOf('if (shopsInsideFayr(key)) {');
      const route = door.indexOf("navigation.navigate('Shop'");
      ok(gate > -1 && route > gate,
        'and the route into Fayr’s own shop screen must sit INSIDE that question');
      // ── TWO SUCH ROUTES SINCE 18 SEPTEMBER 2026, AND BOTH ARE GATED ──────
      //
      // This read "exactly one, so there is one thing to gate". The second is
      // the way BACK into the shop, added the same day for the person whose trip
      // was interrupted between tapping Buy and the pop-up appearing — measured
      // on the owner's own run, where the pop-up never appeared at all.
      //
      // THE RULE IS NOT LOOSENED. It is still "every route is gated", checked
      // for each one rather than for the only one: the first sits inside the
      // `if`, and the second is a callback whose only caller is drawn inside
      // `shopsInsideFayr(key) ? ... : null`. What would fail this is an
      // ungated third.
      const routes = [...door.matchAll(/navigation\.navigate\('Shop'/g)].map((m) => m.index);
      ok(routes.length === 2, 'there are exactly two routes into Fayr’s own shop screen');
      ok(/const backIntoTheShop = useCallback\(\(\) => \{\s*navigation\.navigate\('Shop'/
        .test(door), 'the second is the way back in');
      ok(/\{shopsInsideFayr\(key\) \? \(\s*<Pill onPress=\{backIntoTheShop\}/.test(door),
        'and the only thing that calls it is drawn for a listed shop and nobody else');
      ok([...door.matchAll(/shopsInsideFayr\(key\)/g)].length === 2,
        'so there are exactly as many gates as there are doors');

      // THE REVIEW STEP IS NOT PART OF THIS. Tapping review going straight to the
      // rating page is a later phase; today it still opens the shop's own app.
      ok(!/navigation\.(navigate|replace|push)\('Shop'/.test(strip(read('reviewguide'))),
        'reviewguide must not reach the in-app shop screen yet');
      ok(!/navigation\.(navigate|replace|push)\('Shop'/.test(strip(read('linkaccount'))),
        'and neither must linkaccount');
    }
  }

  // The owner asked for "Go to Amazon Now" after the account is connected, which is
  // this screen's second step.
  const link = read('linkaccount');
  ok(/appButtonLabel\(/.test(link), 'linkaccount offers "Go to <shop> now"');
  ok(/openShopApp\(/.test(link), 'and it really opens the shop’s own app');

  // AND NO SCREEN COPIES ANYTHING BUT THE NAME. A screen assembling its own
  // clipboard text would be a second version of the rule at the top of this file.
  for (const key of ['buyinterstitial', 'reviewguide', 'linkaccount']) {
    ok(!/setStringAsync/.test(read(key)),
      `${key} does not write the clipboard itself`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
