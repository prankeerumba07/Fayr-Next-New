// SHOPPING INSIDE FAYR, WITHOUT A PHONE.
//
// Four things are worth proving hardest, and all four are things a phone cannot
// be made to do on demand:
//
//   a upi:// address is NEVER loaded by Fayr's own view, and neither is a scheme
//   nobody has seen before — because the list of payment apps in India is not a
//   list this project can be complete about;
//
//   https IS loaded, because a whitelist that refuses the shop is worse than no
//   whitelist at all;
//
//   a shop that is not on the in-app list cannot take the in-app path, by two
//   independent guards;
//
//   and the address a session lands on is the campaign's product when there is
//   one and the shop's own site when there is not — with no search address
//   invented for any shop, because nobody has measured one.
//
// THE STRUCTURAL HALF reads the files off disk WITH THEIR COMMENTS STRIPPED.
// That is not tidiness: checks in this project have passed five separate times
// by matching a sentence in a comment that describes the very thing the code no
// longer did.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_LIKE_A_PHONE, SHOPS_INSIDE_FAYR, WE_LOAD, comingBackFromPaying,
  originOf, schemeOf, shopsInsideFayr, userAgentFor, whereToLand, whoOpensThis,
} from './insideFayr.js';
import {
  TAG, cameBackDetail, navigationDetail, refusedDetail, sessionDetail, shopLine,
  shopLogIsOn, logShop,
} from './shopLog.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * THE CODE, WITHOUT THE PROSE. Block comments, line comments and JSX comments,
 * so a structural check can only ever match something that runs.
 */
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/** The seven shops, read out of the frozen platforms.js rather than typed here. */
const PLATFORM_KEYS = (() => {
  const src = read('src/platforms.js');
  const line = (src.match(/export const PLATFORMS = \{([^}]*)\}/) || [])[1] || '';
  const keys = line.split(',').map((k) => k.trim()).filter((k) => /^[a-z]+$/.test(k));
  if (keys.length < 5) throw new Error('could not read the shop list out of platforms.js');
  return keys;
})();

console.log('=== 1. which shops are shopped inside Fayr ===');
{
  // ── THAT HAPPENED, ON 18 SEPTEMBER 2026, AND THIS IS THE UPDATE ──────────
  //
  // This check used to read "today the in-app list is zepto alone", and said in
  // writing what would have to happen before it changed: this screen run against
  // the other two, and the log saying what they do. The owner ran it. What his
  // log says is that the screen was never reached at all, for any shop, and that
  // the only web view he saw was the connect one on a page he cannot buy from.
  // His words: "we are opening a web view inside the Fayr app for all the
  // marketplaces ... so the user is not out of our vision for a single time."
  //
  // SO THE LIST IS THE THREE QUICK-COMMERCE SHOPS, AND NOT ONE SHOP MORE. The
  // check is not loosened into "at least zepto": it is still an exact list, and
  // Amazon, Flipkart, Meesho and Myntra are still named as staying out.
  //
  // AND BEING IN THE LIST IS NOT THE SAME AS HAVING BEEN MEASURED. The section
  // below this one pins that: the two new shops have EMPTY order tables and can
  // never answer NOT_PLACED.
  const QUICK_COMMERCE = ['zepto', 'blinkit', 'instamart'];
  ok(Object.keys(SHOPS_INSIDE_FAYR).sort().join(',') === QUICK_COMMERCE.slice().sort().join(','),
    'the in-app list is the three quick-commerce shops exactly');
  for (const key of QUICK_COMMERCE) {
    ok(shopsInsideFayr(key) === true, `${key} shops inside Fayr`);
  }

  // AND EVERY OTHER SHOP KEEPS ITS OWN APP. This is the check that an unlisted
  // shop cannot be swept into the new path.
  for (const key of PLATFORM_KEYS.filter((k) => !QUICK_COMMERCE.includes(k))) {
    ok(shopsInsideFayr(key) === false, `${key} does not shop inside Fayr`);
  }
  ok(PLATFORM_KEYS.filter((k) => !QUICK_COMMERCE.includes(k)).sort().join(',')
    === 'amazon,flipkart,meesho,myntra',
    'and the four that stay outside are named, so a seventh shop cannot join by accident');
  ok(shopsInsideFayr('amazon') === false,
    'amazon in particular does not, and it must not: it keeps its own app');

  for (const junk of [undefined, null, '', 'ebay', 7, {}, 'ZEPTO']) {
    ok(shopsInsideFayr(junk) === false, `${JSON.stringify(junk)} is not a shop we open`);
  }

  // Every shop in the list must be a shop platforms.js knows, or the two files
  // have already disagreed about something.
  for (const key of Object.keys(SHOPS_INSIDE_FAYR)) {
    ok(PLATFORM_KEYS.indexOf(key) >= 0, `${key} is a shop platforms.js knows about`);
  }
}

console.log('\n=== 2. what Fayr’s own view may load, and what the phone gets ===');
{
  ok(WE_LOAD.slice().sort().join(',') === 'http,https',
    'the list of what we load is http and https, and nothing else');

  // OURS. A whitelist that refuses the shop is worse than no whitelist.
  for (const mine of [
    'https://www.zeptonow.com/', 'http://example.in/x', 'HTTPS://WWW.ZEPTONOW.COM/',
    'https://www.zeptonow.com/cn/x?y=1#z',
  ]) {
    ok(whoOpensThis(mine) === 'us', `${mine} is ours to load`);
  }

  // THE PAYMENT APPS, WHICH IS THE WHOLE REASON THIS EXISTS. Every one of these
  // is an address the web view cannot load, and before this a person tapping Pay
  // landed nowhere.
  for (const theirs of [
    'upi://pay?pa=someone@okaxis&am=199.00', 'intent://pay#Intent;scheme=upi;end',
    'phonepe://pay?x=1', 'tez://upi/pay?x=1', 'paytmmp://pay?x=1',
    'gpay://upi/pay', 'bhim://pay', 'credpay://pay',
  ]) {
    ok(whoOpensThis(theirs) === 'phone', `${theirs.slice(0, 28)} is not ours to load`);
  }

  // AND A SCHEME NOBODY HAS SEEN BEFORE IS THE PHONE'S. This is the direction
  // the rule is written in on purpose: a bank can ship an app next month and no
  // file here can know its name in advance.
  for (const unknown of [
    'somebanknobodyhasheardof://pay?x=1', 'zz9://x', 'newupiapp2027://pay',
  ]) {
    ok(whoOpensThis(unknown) === 'phone',
      `${unknown.slice(0, 24)} — a scheme nobody has seen before — is the phone’s`);
  }

  // The odd shapes, all of them on the phone's side of the line because the list
  // of what we load is closed.
  for (const odd of ['about:blank', 'data:text/html,<b>x', 'file:///etc/passwd',
    'javascript:alert(1)', 'mailto:a@b.in', 'tel:+911234', 'blob:https://x/y',
    '/cart', 'www.zeptonow.com', '', null, undefined, 7, {}]) {
    ok(whoOpensThis(odd) === 'phone',
      `${JSON.stringify(odd)} is not ours to load, because it is not on the list`);
  }

  ok(schemeOf('upi://pay') === 'upi', 'the scheme is read off the address');
  ok(schemeOf('UPI://pay') === 'upi', 'and a shouted scheme is the same scheme');
  ok(schemeOf('/cart') === null, 'an address with no scheme has none to report');
}

console.log('\n=== 3. where a shopping session lands ===');
{
  // READ OUT OF THE FROZEN platforms.js, exactly as the screen hands it in.
  const ZEPTO_START = (() => {
    const src = read('src/platforms.js');
    const at = src.indexOf('const zepto = {');
    const found = src.slice(at, at + 1400).match(/startUrl: '([^']+)'/);
    if (!found) throw new Error('could not read zepto’s startUrl out of platforms.js');
    return found[1];
  })();
  ok(/^https:\/\//.test(ZEPTO_START), 'zepto’s startUrl was read off platforms.js');
  ok(/\/account\/orders/.test(ZEPTO_START),
    'and it points at the order history, which is exactly why the path is dropped');

  // THE CAMPAIGN'S OWN PRODUCT ADDRESS WINS WHEN THERE IS ONE.
  const onProduct = whereToLand('zepto', {
    productUrl: 'https://www.zeptonow.com/pn/x/pvid/abc',
    startUrl: ZEPTO_START,
  });
  ok(onProduct != null && onProduct.kind === 'product',
    'a campaign with a product address lands on the product');
  ok(onProduct.url === 'https://www.zeptonow.com/pn/x/pvid/abc',
    'and on that exact address, not one built here');

  // AND WITH NONE — WHICH IS ALL FIFTEEN CAMPAIGNS TODAY — THE SHOP'S OWN SITE.
  for (const nothing of [null, undefined, '', '   ']) {
    const onShop = whereToLand('zepto', { productUrl: nothing, startUrl: ZEPTO_START });
    ok(onShop != null && onShop.kind === 'shop',
      `a campaign whose product address is ${JSON.stringify(nothing)} lands on the shop`);
    ok(onShop.url === `${originOf(ZEPTO_START)}/`,
      'on the root of the shop’s own site, and the domain is platforms.js’s');
    ok(!/account|orders/.test(onShop.url),
      'and NOT on their order history, which is where startUrl points');
  }

  // NO SEARCH ADDRESS IS INVENTED FOR ANY SHOP. Nobody has measured one, and a
  // guess would drop somebody on a dead page as they try to spend money.
  const landed = whereToLand('zepto', { productUrl: null, startUrl: ZEPTO_START });
  ok(!/search|\?q=|\/s\?/.test(landed.url),
    'no search-results address is invented for a shop nobody has measured');

  // A PRODUCT ADDRESS THE VIEW WOULD NOT LOAD IS NOT A PRODUCT ADDRESS.
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'zepto://p/1',
    'about:blank']) {
    const out = whereToLand('zepto', { productUrl: bad, startUrl: ZEPTO_START });
    ok(out != null && out.kind === 'shop',
      `a campaign carrying ${bad.slice(0, 18)} has no product address, so it lands on the shop`);
  }

  // AND THE FIELD REALLY REACHES THE APP, which it did not until today.
  //
  // THIS CHECK EXISTS BECAUSE THE BRANCH ABOVE WAS DEAD. src/backend/
  // campaignsApi.js normalizes the backend campaign through a hand-written field
  // list, and productUrl was not in it — so `campaign.productUrl` was undefined
  // on every screen, and the product branch could not have fired even after ops
  // filled the field in. All fifteen campaigns carry null, so nothing would ever
  // have said so.
  {
    const api = withoutComments(read('src/backend/campaignsApi.js'));
    ok(/productUrl: c\.productUrl \|\| null,/.test(api),
      'the app’s campaign really carries productUrl, or the product branch is dead code');
    const back = read('backend/src/campaigns/campaign.response.ts');
    ok(/productUrl: c\.productUrl,/.test(back),
      'and the backend really sends it, so the two ends agree about the field');

    // AND THE SAME PIN ON searchKeyword, FOR THE SAME REASON AND AT THE SAME
    // PLACE. Phase 2 adds a second field down the same path that swallowed the
    // first one, and a hand-written field list will swallow a second field
    // exactly as quietly as it swallowed the first. Every campaign carries null
    // today, so nothing on a screen would ever say it had gone missing.
    ok(/searchKeyword: c\.searchKeyword \|\| null,/.test(api),
      'the app’s campaign really carries searchKeyword, or the bar is dead code');
    ok(/searchKeyword: c\.searchKeyword,/.test(back),
      'and the backend really sends it too');
    ok(/searchKeyword String\?/.test(read('backend/prisma/schema.prisma')),
      'and the column it comes from really exists');
    ok(/searchKeyword\?: string;/.test(read('backend/src/campaigns/dto/create-campaign.dto.ts')),
      'and ops can set it when creating a campaign');
    ok(/searchKeyword\?: string;/.test(read('backend/src/campaigns/dto/update-campaign.dto.ts')),
      'and change it afterwards');
  }

  // THE SECOND GUARD. An unlisted shop has nowhere to go, so even a call site
  // that branched wrongly could not put Amazon inside a web view.
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(whereToLand(key, { productUrl: 'https://x.in/p', startUrl: 'https://x.in/o' }) === null,
      `${key} has no in-app address at all, even with one handed in`);
  }
  ok(whereToLand('zepto', { productUrl: null, startUrl: null }) === null,
    'and with no address to work from, nothing is invented — the answer is nothing');
  ok(whereToLand('zepto', undefined) === null, 'nor does it throw when handed nothing');

  ok(originOf('https://www.zeptonow.com/account/orders?x=1') === 'https://www.zeptonow.com',
    'the origin is the scheme and the host, and nothing after it');
  for (const bad of ['upi://pay', 'about:blank', '/cart', null, 7]) {
    ok(originOf(bad) === null, `${JSON.stringify(bad)} has no origin to land on`);
  }
}

console.log('\n=== 4. what we tell the shop we are ===');
{
  ok(userAgentFor('zepto', 'ios') === null,
    'on iOS zepto gets the view’s own user agent, which is the truest one');
  ok(userAgentFor('zepto', 'android') === ANDROID_LIKE_A_PHONE,
    'on Android it gets the phone-like one ConnectScreen has always used');
  ok(/Mobile Safari/.test(ANDROID_LIKE_A_PHONE),
    'and that one asks for the mobile site, not the desktop one');
  for (const key of ['blinkit', 'instamart']) {
    ok(userAgentFor(key, 'android') === ANDROID_LIKE_A_PHONE,
      `${key} gets the same phone-like string zepto does on Android`);
    ok(userAgentFor(key, 'ios') === null, `and ${key} gets the view's own on iOS`);
  }
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(userAgentFor(key, 'android') === null,
      `${key} is asked nothing, because it never opens here`);
  }
}

console.log('\n=== 5. going to pay, and coming back ===');
{
  const T = Date.UTC(2026, 8, 18, 10, 0);
  // NOTHING WITHOUT A HAND-OFF. This is what keeps the notification shade, the
  // app switcher and a dismissed call out of the log: every one of them is an
  // "active" event, and none of them is somebody coming back from GPay.
  for (const nothing of [null, undefined, 'x', NaN, Infinity]) {
    ok(comingBackFromPaying({ nextState: 'active', wentToPayAt: nothing, now: T }) === null,
      `an "active" with ${JSON.stringify(nothing)} recorded is not a return from paying`);
  }
  // AND NO OTHER EVENT COUNTS, even with a hand-off recorded.
  for (const state of ['background', 'inactive', 'unknown', '', null, undefined]) {
    ok(comingBackFromPaying({ nextState: state, wentToPayAt: T - 5000, now: T }) === null,
      `${JSON.stringify(state)} is not coming back`);
  }
  const back = comingBackFromPaying({ nextState: 'active', wentToPayAt: T - 42000, now: T });
  ok(back != null && back.awayMs === 42000, 'coming back says how long they were gone');
  // A CLOCK THAT WENT BACKWARDS IS NOT A REASON TO LOSE THE RETURN, and it is
  // not a reason to make a number up either.
  const odd = comingBackFromPaying({ nextState: 'active', wentToPayAt: T + 1000, now: T });
  ok(odd != null && odd.awayMs === null,
    'a backwards clock still records the return, and says it cannot say how long');
  ok(cameBackDetail({ awayMs: null }) === 'away=unknown (the clock could not say)',
    'and the log says so in words rather than printing a zero');
  ok(cameBackDetail({ awayMs: 42000 }) === 'away=42s', 'a real gap is said in seconds');
  // AND A CANCELLED PAYMENT LOOKS EXACTLY LIKE A COMPLETED ONE, because from
  // inside this phase they are the same event.
  ok(!/paid|success|failed|cancel/i.test(cameBackDetail({ awayMs: 42000 })),
    'coming back claims nothing about whether they paid');
}

console.log('\n=== 6. the log, which is as much the deliverable as the screen ===');
{
  // OFF UNDER NODE, because __DEV__ is the phone's word and this is not a phone.
  ok(shopLogIsOn() === false, 'the commentary is off where __DEV__ does not exist');
  ok(logShop('ANYTHING', 'at all') === false, 'so nothing is said, and it says so');

  // EVERY LINE BEGINS WITH THE BRACKET. That is structural, not a promise: there
  // is one console.log in shopLog.js and it is inside say().
  const line = shopLine('WENT TO', 'url=https://x.in/ title="X"', Date.UTC(2026, 8, 18, 9, 8, 7));
  ok(line.startsWith(TAG), 'every line begins with the one searchable prefix');
  ok(/\d\d:\d\d:\d\d\.\d\d\d/.test(line), 'and carries the clock to the millisecond');
  const src = read('src/shop/shopLog.js');
  ok((src.match(/console\.log\(/g) || []).length === 1,
    'there is exactly one console.log in the whole file');
  ok(/function say\(line\) \{[\s\S]{0,120}console\.log\(line\)/.test(src),
    'and it is inside say(), which is the only thing that writes anywhere');

  // NOBODY'S NUMBER LEAVES IT. This already happened once in this project, out
  // of a shop's own sign-in greeting — see src/maskNumbers.js.
  const leak = shopLine('WENT TO', 'url=https://x.in/?phone=919876543210 title="Hi"');
  ok(!/919876543210/.test(leak), 'a long run of digits never reaches a line');
  ok(/\[number removed\]/.test(leak), 'and the line says something was taken out');

  // THE FOUR KINDS OF LINE, each carrying what the later phases need and nothing
  // more than an address and a title.
  const session = sessionDetail({
    shop: 'zepto', campaignId: 'c1', productName: 'Amul  Butter\n500g',
    land: 'shop', url: 'https://www.zeptonow.com/',
  });
  ok(/shop=zepto/.test(session) && /campaign=c1/.test(session),
    'the session line says which shop and which campaign');
  ok(/product="Amul Butter 500g"/.test(session),
    'and the product name, tidied, because a log of addresses is unreadable without it');
  ok(/landed=shop/.test(session), 'and whether it landed on the product or the shop');

  const nav = navigationDetail({ url: 'https://www.zeptonow.com/cn/x', title: 'Zepto — Cart' });
  ok(/url=https:\/\/www\.zeptonow\.com\/cn\/x/.test(nav),
    'a navigation line carries the FULL address, which is the point of collecting it');
  ok(/title="Zepto — Cart"/.test(nav),
    'and the page’s own title, which is what tells a cart from a checkout');

  const refused = refusedDetail({
    url: 'upi://pay?pa=x@okaxis', scheme: 'upi', topFrame: true,
  });
  ok(/^scheme=upi /.test(refused),
    'a refusal line puts the scheme first, because the scheme is the answer being collected');
  ok(/url=upi:\/\/pay/.test(refused), 'and the whole address after it');
  ok(/topFrame=yes/.test(refused),
    'and whether it came from the page itself or from a frame inside it');
  ok(/topFrame=no/.test(refusedDetail({ url: 'upi://x', scheme: 'upi', topFrame: false })),
    'and says no when it did not');

  // A MISSING VALUE SAYS SO, rather than printing "undefined" at somebody.
  ok(/campaign=none/.test(sessionDetail({ shop: 'zepto' })),
    'a value that is not there reads as none, not as undefined');

  // NO PAGE TEXT AND NO PAGE MARKUP, EVER. The rule at the call sites is that a
  // page's bytes are never an argument here, and there is no function to take
  // them: the only inputs are addresses, a title, a scheme and a duration.
  const logCode = withoutComments(src);
  ok(!/innerHTML|outerHTML|textContent|\bhtml\b/.test(logCode),
    'the log has no way to be handed a page’s text or markup');
  ok(!/orderId|orderNumber/.test(logCode), 'and no way to be handed an order number');
}

console.log('\n=== 7. the two shop-knowing files cannot disagree about an address ===');
{
  const code = withoutComments(read('src/shop/insideFayr.js'));

  // THE MECHANISM, ENFORCED RATHER THAN TRUSTED. Not one shop address is written
  // in this file; the caller reads startUrl off the frozen platforms.js and hands
  // it in. So there is no second copy of a domain anywhere to drift.
  ok(!/https?:\/\//.test(code),
    'insideFayr.js contains no web address at all — that is how it cannot disagree');
  ok(!/zeptonow|blinkit\.com|swiggy|amazon\.in|flipkart\.com/.test(code),
    'and no shop’s domain by name either');
  ok(!/from '\.\.\/platforms/.test(code) && !/require\('\.\.\/platforms/.test(code),
    'and it does not read platforms.js, which is frozen');

  // AND THE SCREEN IS WHERE THE FROZEN FILE IS READ, once, and handed in.
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/startUrl: platform \? platform\.startUrl : null/.test(screen),
    'the screen hands the frozen file’s own startUrl to whereToLand');
  ok(!/https?:\/\//.test(screen),
    'and the screen holds no web address of its own either');
  ok(!/zeptonow|blinkit\.com|swiggy\.com/.test(screen),
    'the screen names no shop domain either');
}

console.log('\n=== 8. only a listed shop can take this path, and it is one line ===');
{
  const door = withoutComments(read('src/screens/buyinterstitial.js'));
  // THE FIRST GUARD: the branch at the call site.
  ok(/import \{ shopsInsideFayr \} from '\.\.\/shop\/insideFayr'/.test(door),
    'the buy screen asks the list itself, rather than keeping its own');
  ok(/if \(shopsInsideFayr\(key\)\) \{/.test(door),
    'and the one line that chooses the door is that question');
  ok(/navigation\.navigate\('Shop', \{ campaignId, marketplace: key \}\)/.test(door),
    'a listed shop goes to Fayr’s own screen');

  // AND EVERY OTHER SHOP KEEPS EXACTLY WHAT IT HAD. This is the check that the
  // old path is still there and still reached.
  ok(/await openShopApp\(key, opens\)/.test(door),
    'an unlisted shop still opens its own installed app through openShop.js');
  const after = door.slice(door.indexOf('if (shopsInsideFayr(key)) {'));
  ok(after.indexOf('openShopApp(key, opens)') > after.indexOf('return;'),
    'and that path is what is left after the branch, not before it');

  // THE POP-UP ORDER, which is the opposite way round on the two paths and was
  // measured on a real phone. A dismissal in flight swallows a request to leave
  // the app, so the shop is asked for FIRST there; nothing is in flight when we
  // go to our own screen, so the notice comes down first here.
  const branch = door.slice(door.indexOf('if (shopsInsideFayr(key)) {'),
    door.indexOf('await openShopApp'));
  ok(branch.indexOf('setNotice(null)') < branch.indexOf('navigation.navigate'),
    'the notice comes down before we push our own screen');

  // openShop.js AND ui/shopApp.js STAY, AND KEEP WORKING. Amazon, Flipkart,
  // Meesho and Myntra are not touched by any of this.
  ok(/export async function openShopApp/.test(read('src/openShop.js')),
    'openShop.js is still there and still exports the old door');
  ok(/export const SHOP_APP/.test(read('src/ui/shopApp.js')),
    'and ui/shopApp.js still holds every shop’s own app address');
}

console.log('\n=== 9. the screen wires the decisions and decides nothing itself ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));

  ok(/onShouldStartLoadWithRequest=\{whoLoadsIt\}/.test(screen),
    'the view asks before it loads anything');
  ok(/whoOpensThis\(url\) === 'us'/.test(screen),
    'and the answer comes from the whitelist next door, not from here');
  ok(/Linking\.openURL\(url\)/.test(screen), 'an address that is not ours goes to the phone');
  ok(/Linking\.openURL\(url\)\.catch\(/.test(screen),
    'and a phone that cannot open it does not throw at anybody');
  ok(/return false;/.test(screen), 'the view is told not to load it');

  // THE SESSION IS RESTORED BEFORE THE VIEW EXISTS, and saved on the way out.
  ok(/restoreSession\(platform\.key, platform\.startUrl\)/.test(screen),
    'the saved sign in is restored');
  ok(/sessionReady \?/.test(screen),
    'and the view is not built until it has been — a view that has made its cookie '
    + 'store cannot be signed in afterwards');
  ok(/persistSession\(platform\.key, platform\.startUrl\)/.test(screen),
    'and it is saved again, so a sign in that happens here is not lost');
  ok(!/clearSession|logoutPlatform/.test(screen),
    'and leaving the screen never clears it');

  // THE WEB VIEW PROPS ConnectScreen PROVED, each one for a measured reason.
  for (const prop of ['sharedCookiesEnabled', 'thirdPartyCookiesEnabled',
    'domStorageEnabled', 'cacheEnabled', 'originWhitelist', 'onError', 'onHttpError',
    'containerStyle', 'userAgent']) {
    ok(new RegExp(prop).test(screen), `the view keeps ${prop}`);
  }

  // THE BAR, ALL SESSION — AND FROM PHASE 2 IT CARRIES THE SEARCH KEYWORD.
  //
  // CORRECTED 18 SEPTEMBER 2026, and not loosened. Phase 1 put the campaign's
  // productName here; the design has always shown a separate hand-written search
  // phrase, and the two are different strings on purpose. The check follows the
  // correction rather than being deleted.
  ok(/styles\.bar/.test(screen) && /\{bar\.keyword\}/.test(screen),
    'the bar carries the search keyword');
  ok(!/\{productName \|\|/.test(screen),
    'and it never draws the product name, which is the catalogue’s and not a search phrase');
  ok(!/sessionReady[\s\S]{0,400}styles\.bar/.test(screen),
    'and it is drawn outside the loading branch, so it is there for the whole session');

  // AND THE WAY OUT.
  ok(/goBackOrHome\(navigation\)/.test(screen), 'there is a way off the screen');

  // UPDATED 18 SEPTEMBER 2026. The bar DOES judge the page now — that is Phase 2
  // — so the old form of this check would be a sentence that is no longer true.
  // What is still not this screen's business is everything downstream of the
  // page: reading an order, matching one, moving a task, touching money.
  ok(/whatThePageIs\(/.test(screen),
    'the screen asks theRightProduct.js what the page is');
  ok(!/matchOrder|readEvidence|parseOrderText|orderCandidates/.test(screen),
    'but it reads no order and matches none');
  // ── NARROWED 18 SEPTEMBER 2026, AND ONLY BY ONE NOTE ─────────────────────
  //
  // The screen now signs people in to the shop, in this same view, which is Task
  // 3 of the phase. Signing in writes the SIGNED_IN note — the same one the
  // connect flow writes, for the same reason and with the same meaning — so a
  // blanket refusal of markVisitedShop would refuse the thing the sign in is.
  //
  // WHAT IS STILL REFUSED IS EVERY OTHER NOTE, and those are the ones that move
  // the journey past the shop: a note saying somebody went to buy, or said they
  // bought, or said a parcel arrived. The screen may record that a shop greeted
  // them and nothing else about what they did.
  ok(!/dispatch\(|postEvidence|applyAuthoritative/.test(screen),
    'and this screen moves no task and applies no record itself');
  // ── ONE FACT, AND ONLY ONE, GOES TO OUR SIDE FROM HERE — 19 SEPTEMBER 2026 ─
  //
  // This label used to say "sends no evidence", and it was true. Phase 8A
  // gives the screen one thing to tell our side: the key in the address of the
  // order it watched being placed. It goes by syncEvidence — the existing
  // route with its outbox and its retry — and the body is built next door by
  // whatToTellOurSide, which puts NOTHING the engine reads in it: no order, no
  // delivery, no review, no blocker. It is a place to look, not a fact about
  // money, and the checks in theWatchedOrder.test.mjs hold it to that.
  ok((screen.match(/syncEvidence\(/g) || []).length === 1,
    'the screen tells our side through the evidence route exactly once');
  ok(/syncEvidence\(taskId, tell\.body\)/.test(screen) && /whatToTellOurSide\(\{/.test(screen),
    'and what it tells is decided by theWatchedOrder.js, not written here');
  ok(/markVisitedShop\(campaignId, SIGNED_IN\)/.test(screen),
    'one note it may write is that the shop greeted them');
  // ── AND ONE MORE SINCE 18 SEPTEMBER 2026: THAT A READ HAS RUN ───────────
  //
  // Phase 7 took "Did you buy it?" off the journey for a shop inside Fayr, so
  // the screen hands over to the order read by itself — when the page looks like
  // an order was placed and when they leave — and writes LOOKED_FOR_THE_ORDER
  // as it does. That note is about a thing FAYR did and moves the journey only
  // as far as the screenshot fallback after a fruitless read; it never says a
  // purchase happened. The four notes that would — a person's word that they
  // went, bought, or saw it arrive — are still refused by name.
  ok(/markVisitedShop\(campaignId, LOOKED_FOR_THE_ORDER\)/.test(screen),
    'and the other is that a read has run');
  const notes = [...screen.matchAll(/markVisitedShop\(campaignId, ([A-Z_]+)\)/g)].map((m) => m[1]);
  ok(new Set(notes).size === 2 && notes.every((n) => n === 'SIGNED_IN' || n === 'LOOKED_FOR_THE_ORDER'),
    'and those two are the only notes this screen writes at all');
  for (const note of ['WENT_TO_BUY', 'SAID_THEY_BOUGHT', 'SAID_IT_ARRIVED', 'WENT_TO_REVIEW']) {
    ok(!screen.includes(note), `it never writes ${note}, which would put words in somebody's mouth`);
  }
  ok(!/refund|wallet|paise/i.test(screen), 'and decides nothing about money');

  // IT DOES NOT TOUCH THE FROZEN FILES — AND SINCE 18 SEPTEMBER 2026 IT READS
  // ONE THING OFF ONE OF THEM. The review step's one tap opens THIS order's own
  // page, and where a shop keeps that page is measured in the frozen
  // detailLook.js. So exactly one named export is imported from it, read-only,
  // and handed to theOrderPage.js; nothing that READS an order is reached for.
  ok(!/ConnectScreen|connect\/gate|drawnList|orderhistory/.test(screen),
    'it reads none of the frozen connect files and none of the order readers');
  ok(/import \{ howThisShopNamesAnOrder \} from '\.\.\/order\/detailLook';/.test(screen),
    'and from detailLook.js it imports the one shape it needs, by name');
  ok((screen.match(/from '\.\.\/order\//g) || []).length === 1,
    'and nothing else from src/order/');
  ok(!/openOneOrderWith|readDetailOutcome|harvestOrderNumbers|buildDrawn/.test(screen),
    'so no order is read from this screen, and none ever will be');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
