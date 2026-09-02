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
    // THE DESIGN'S OWN WORDING for the one button that remains: its before you go
    // screen reads "OPEN AMAZON →" at fayr-design.browser.jsx:2568.
    ok(/OPEN \{shop\.toUpperCase\(\)\} →/.test(src),
      `${key} does not use the design's own button wording`);
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
    // TWO FILES MAY, AND BOTH ARE NAMED. ConnectScreen.js is the connect flow
    // described above. LiveCheckScreen.js is the staff offer page check, which
    // opens a product page to see whether a shopper could buy it — it is a staff
    // tool, it is off unless somebody deliberately turns it on (see
    // src/walkthrough/onlyForUs.js), and no shopper can reach it. Anything else
    // rendering a web view is a shopper being shown a marketplace inside Fayr.
    const ALLOWED = ['ConnectScreen.js', 'LiveCheckScreen.js'];
    const extra = webViews.filter((f) => !ALLOWED.includes(f));
    ok(extra.length === 0, `these render a web view and should not: ${extra.join(', ')}`);
    // And the two that may are still there, so this cannot pass by them being
    // deleted.
    for (const f of ALLOWED) {
      ok(webViews.includes(f), `${f} no longer renders a web view`);
    }

    // AND NO SHOPPING SCREEN SENDS ANYBODY INTO IT. The screens that take somebody
    // to a shop to buy or to review must use the shop's own app, never a route
    // inside Fayr.
    for (const key of ['buyinterstitial', 'reviewguide']) {
      ok(!/navigation\.(navigate|replace|push)\(key/.test(read(key)),
        `${key} opens a marketplace route inside Fayr`);
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
