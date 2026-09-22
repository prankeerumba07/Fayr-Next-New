// NOTICING THE PURCHASE — WITHOUT A PHONE, AND WITHOUT A PURCHASE.
//
// The thing worth proving hardest is that this LEANS SHY, because the two
// mistakes do not cost the same:
//
//   a MISSED order costs one extra tap. "Did you buy it?" is still on the
//   journey, still works, and has not been touched for any shop;
//
//   a FALSE order sends somebody into a read for a purchase that never
//   happened, which ends in "we could not find it" and looks broken.
//
// So most of what follows pushes at the false direction: an order's own page,
// the order list, a checkout, a marketing line with the word "order" in it. A
// rule answering "cannot tell" where it might have guessed is passing.
//
// AND EVERY MARK IT READS IS A GUESS. Nobody has placed an order inside this
// screen, so not one phrase or path in insideFayr.js's order table came off a
// real page. These checks prove the RULES behave as written — not that the
// table is right about Zepto. One real purchase settles that, and the log is
// what carries it back.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { anybodyHasMeasured, orderMarksFor } from './insideFayr.js';
import {
  BECAUSE_ORDER, CANNOT_TELL, NOT_PLACED, PLACED, pathOfAddress, tidyText,
  whatTheOrderPageSays,
} from './theOrderPlaced.js';
import { BAR, TONE, whatTheBarSays } from './theBar.js';
import { handoffDetail, orderDetail } from './shopLog.js';

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

const at = (title, url) => whatTheOrderPageSays('zepto', { title, url });
const said = (title, url) => at(title, url).said;

console.log('=== 1. the pages the owner’s own purchase really showed — MEASURED 18 SEPTEMBER 2026 ===');
{
  // Every address below is off .local-logs/run.log, in the order the web view
  // reported them while the owner bought a Lakme cream inside this screen.
  const UUID = '01a0b4d7-870c-7dca-b701-e038477c5106';
  const CONFIRMATION = `https://www.zepto.com/order/status/${UUID}?referrer=home&from=ProcessOrder`;

  const live = at('Everything delivered in minutes* | Zepto', CONFIRMATION);
  ok(live.said === PLACED, 'THE LIVE ORDER PAGE IS THE CONFIRMATION: /order/status/<key> is PLACED');
  ok(live.because === BECAUSE_ORDER.THE_ADDRESS_SAYS_SO, 'by the address, which is the only signal this shop gives');
  ok(live.orderKey === UUID, 'AND THE KEY IN THE ADDRESS COMES OUT WITH IT');
  ok(at('none', CONFIRMATION).said === PLACED && at('', CONFIRMATION).said === PLACED,
    'whatever the title says, because Zepto’s titles say nothing');

  ok(said('Everything delivered in minutes* | Zepto', `https://www.zepto.com/ProcessOrder?order_id=${UUID}`) === CANNOT_TELL,
    'the payment-processing page four seconds earlier is NOT a placed order — a page that processes is not yet an order');

  const own = at('none', `https://www.zepto.com/order/${UUID}?child=true`);
  ok(own.said === NOT_PLACED, 'the order’s OWN page is not a new order');
  ok(own.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN, 'and it says so by name');
  ok(own.orderKey === null, 'and gives out no key, because it placed nothing');

  const history = at('My Orders | Zepto', 'https://www.zepto.com/account/orders');
  ok(history.said === NOT_PLACED, 'an order-history page is NOT_PLACED');
  ok(history.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN,
    'and it says so by name: an order already known, not a new one');

  ok(said('none', `https://www.zepto.com/FaqList?orderId=${UUID}&orderCode=OGGHJGSNO04081`) === CANNOT_TELL,
    'the help page that carries both identifiers is not a purchase');
  ok(said('Zepto | Everything delivered in minutes*', 'https://www.zepto.com/search?query=Lakme') !== PLACED,
    'a search is not a placed order');
  ok(said('Lakme 9 To 5 Cc Cream - Buy at ₹366 Online | Zepto', 'https://www.zepto.com/pn/lakme/pvid/8dedc522?cart=open&payment=open') !== PLACED,
    'a product page with the cart and the payment sheet open is not a placed order');
  ok(said('My Cart | Zepto', 'https://www.zepto.com/cart') !== PLACED, 'a cart is not a placed order');
  ok(said('Zepto: Online Grocery Delivery App', 'https://www.zepto.com/') === CANNOT_TELL,
    'the shop’s front page is CANNOT TELL');
  ok(said('', 'https://www.zepto.com/') === CANNOT_TELL, 'an empty title is CANNOT TELL');

  // THE TITLE IS NOT A SIGNAL ON THIS SHOP, and a title that SAYS "order placed"
  // proves nothing: Zepto's never do, so the phrase on a page here is marketing.
  ok(said('Order Placed | Zepto', 'https://www.zepto.com/somewhere') === CANNOT_TELL,
    'a title saying "Order Placed" is not a placed order on a shop whose titles were measured never to say it');
  ok(said('Order fresh groceries in 10 minutes | Zepto', 'https://www.zepto.com/') === CANNOT_TELL,
    'the word "order" in marketing is not an order');
}

console.log('\n=== 2. the rule order, which is load-bearing ===');
{
  // ZEPTO'S OWN ORDER PAGE PRINTS "Order Placed at". MEASURED, on the owner's
  // real order of 21 July 2026, and quoted in backend/src/ocr/order-text.ts. So
  // the words genuinely appear on a page that is NOT a purchase, and without the
  // already-known rule running first, browsing old orders would fire a read
  // every single time.
  const old = at('Order Placed at | Zepto', 'https://www.zepto.com/order/abc-123?isArchived=false');
  ok(old.said === NOT_PLACED, 'an OLD order’s own page is not a new order');
  ok(old.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN,
    'and the already-known rule is what caught it, not any title rule');
  ok(/order placed/.test(tidyText('Order Placed at | Zepto')),
    'even though its title carries the very phrase a title rule would look for');

  // ── AND THE ALREADY-KNOWN RULE NO LONGER SWALLOWS THE CONFIRMATION ──────
  //
  // THE BUG OF 18 SEPTEMBER 2026, in the log's own words: "ORDER? said=
  // NOT_PLACED rule='an order's own page or the order list, not a new order'
  // url=.../order/status/01a0b4d7-…". The old mark was the bare '/order/',
  // which is also the start of '/order/status/'. The rule ORDER is unchanged
  // — already-known is still asked first — and the mark is now a shape that
  // cannot match the live order page.
  const sameKey = 'abc-123';
  ok(said('none', `https://www.zepto.com/order/${sameKey}?isArchived=false`) === NOT_PLACED,
    'the bare order page for a key is already known');
  ok(said('none', `https://www.zepto.com/order/status/${sameKey}`) === PLACED,
    'AND THE LIVE ORDER PAGE FOR THE SAME KEY IS PLACED — the first rule no longer eats the second');
  const code = withoutComments(read('src/shop/theOrderPlaced.js'));
  const body = code.slice(code.indexOf('export function whatTheOrderPageSays'));
  ok(body.indexOf('notAFreshOrder') > -1 && body.indexOf('pathSays') > -1
    && body.indexOf('notAFreshOrder') < body.indexOf('pathSays'),
  'and already-known is still asked BEFORE the address rule, in the code');

  // AND THE MEASURED FACT IS REALLY THERE, so this check cannot rot quietly if
  // somebody edits the server's reader.
  // READ OFF THE READER'S CODE, NOT ITS PROSE — CORRECTED 18 SEPTEMBER 2026.
  // The first writing tested the unstripped file for the literal "Order Placed
  // at", and the only places that phrase appears in order-text.ts are three doc
  // comments quoting the owner's real order pages; the reader itself holds the
  // rule as a regex alternative. Deleting that alternative left this check
  // green. Found by an adversarial review of Phase 7, the eleventh time this
  // project has matched prose by mistake.
  const reader = withoutComments(read('backend/src/ocr/order-text.ts'));
  ok(/order\\s\+placed\(\?:\\s\+\(\?:on\|at\)\)\?/.test(reader),
    'the server\u2019s reader really recognises "order placed at" as an order-date label, in code');
}

console.log('\n=== 3. it leans shy: nothing is guessed upward ===');
{
  // A SHOP THAT HAS NOT BEEN TAUGHT CAN NEVER HAVE PLACED AN ORDER, however
  // loudly its page says so. Blinkit and Instamart are not in the list, and
  // neither is Amazon.
  // INSTAMART LEFT THIS LIST ON 22 SEPTEMBER 2026, because the owner bought
  // through it and the purchase was measured. Blinkit is still here, and stays
  // until somebody watches one.
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra', 'blinkit',
    null, undefined, '', 'ebay']) {
    const out = whatTheOrderPageSays(key, {
      title: 'Order Placed', url: 'https://x.in/order-success',
    });
    ok(out.said === CANNOT_TELL, `${JSON.stringify(key)} has not been taught, so it cannot say`);
  }
  ok(whatTheOrderPageSays('amazon', { title: 'Order Placed', url: 'https://x.in/order-success' })
    .because === BECAUSE_ORDER.SHOP_NOT_TAUGHT, 'and it says which rule refused');

  // A WORDING NOBODY LISTED ANSWERS CANNOT TELL, rather than being guessed at.
  for (const unknown of [
    'Woohoo! We are on it | Zepto', 'All set | Zepto', 'Delivery in 8 minutes | Zepto',
  ]) {
    ok(said(unknown, 'https://www.zeptonow.com/live') === CANNOT_TELL,
      `"${unknown}" is not recognised, and is not guessed at either`);
  }

  // NOTHING AT ALL TO READ.
  ok(whatTheOrderPageSays('zepto', {}).said === CANNOT_TELL, 'no page at all cannot say');
  ok(whatTheOrderPageSays('zepto', undefined).said === CANNOT_TELL, 'and it does not throw');
  ok(whatTheOrderPageSays('zepto', { title: null, url: null }).because
    === BECAUSE_ORDER.NOTHING_TO_READ, 'and says there was nothing to read');

  // THE MARKS ARE MEASURED NOW — 18 SEPTEMBER 2026 — AND PINNED AS DATA.
  //
  // This used to read the word "NOBODY HAS MEASURED IT" out of insideFayr.js,
  // which was a check on prose. The table itself is what matters, so the table
  // is what is read: the owner named three shapes, and these are they.
  const marks = orderMarksFor('zepto');
  ok(marks != null && JSON.stringify(marks.pathSays) === JSON.stringify(['/order/status/']),
    'zepto’s ONE confirmation mark is the live order address, and nothing else');
  ok(Array.isArray(marks.titleSays) && marks.titleSays.length === 0,
    'and NO title phrase at all: Zepto’s titles were measured never to say it');
  ok(Array.isArray(marks.notAFreshOrder) && marks.notAFreshOrder.length === 2
    && marks.notAFreshOrder[0] === '/account/orders' && marks.notAFreshOrder[1] instanceof RegExp,
  'and two already-known marks: the list as a fragment, and the bare order page as a shape');
  ok(marks.orderKeyFollows === '/order/status/', 'and where the key sits in the address');
  ok(anybodyHasMeasured('zepto') === true, 'so zepto counts as measured, on the address alone');
  // ── AND THE TWO THAT JOINED ON 18 SEPTEMBER HAVE AN EMPTY TABLE, WHICH IS
  //    NOT THE SAME ANSWER AS NO TABLE ──────────────────────────────────────
  //
  // `null` means "this shop does not shop inside Fayr at all" — Amazon's answer.
  // `{}` means "it does, and nobody has ever watched it place an order". Those
  // two must not collapse into one, or the reason Blinkit says nothing becomes
  // invisible.
  for (const key of ['blinkit']) {
    const empty = orderMarksFor(key);
    ok(empty !== null, `${key} shops inside Fayr, so it has a table`);
    ok(Object.keys(empty).length === 0, `and ${key}'s table is empty`);
    ok(anybodyHasMeasured(key) === false, `and nobody has measured ${key}`);
  }
  ok(anybodyHasMeasured('zepto') === true, 'while zepto has marks, and they are measured');
  // ── AND INSTAMART JOINED IT ON 22 SEPTEMBER 2026 ────────────────────────
  //
  // The owner bought the perfume through this screen and the whole purchase was
  // in the log: /instamart/item/<id>, /instamart/cart, /instamart/payment, then
  // /instamart/timeline?orderId=<n>. Until that run the table was `{}` and the
  // log said so on every page — which is why he was never brought back to Fayr.
  ok(anybodyHasMeasured('instamart') === true, 'and instamart is measured now, from a real purchase');
  ok(orderMarksFor('instamart').pathSays.includes('/instamart/timeline'),
    'the confirmation is the timeline page, which is only reached by paying');
  ok(orderMarksFor('instamart').titleSays.length === 0,
    'AND ITS TITLE LIST IS MEASURED EMPTY: every page on this shop, the product page included, reports the same generic title');
  ok(orderMarksFor('instamart').orderKeyFollows === 'orderId=',
    'and the key is in a QUERY PARAMETER, which is the one structural difference from zepto');
  ok(orderMarksFor('instamart').notAFreshOrder.some((m) => String(m).includes('/support/')),
    'and a support page carrying an orderId is not a purchase — he reached two of them');
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(orderMarksFor(key) === null, `${key} has no table, because it is not inside Fayr`);
    ok(anybodyHasMeasured(key) === false, `and ${key} is not "measured" either`);
  }

  // ── AN UNMEASURED SHOP CAN ONLY EVER SAY "CANNOT TELL" ───────────────────
  //
  // THE CHECK THE PHASE ASKED FOR, and it is the one that matters: NOT_PLACED is
  // a CLAIM about a page, and a claim about a page nobody has ever seen is not
  // something this app may make. Every page shape that makes zepto answer
  // something is walked against the shop nobody has watched.
  //
  // INSTAMART LEFT THIS WALK ON 22 SEPTEMBER 2026 — it has been watched now, and
  // asserting it still says nothing would be asserting the bug. Its own measured
  // behaviour is pinned in the section above and in the block below this one.
  // BLINKIT REMAINS, and remains until somebody buys through it.
  for (const key of ['blinkit']) {
    for (const page of [
      { title: 'Order Placed', url: 'https://x.in/order-confirmation' },
      { title: 'Order Confirmed', url: 'https://x.in/checkout/success' },
      { title: 'Orders', url: 'https://x.in/account/orders' },
      { title: 'Order Placed at 21 Jul 2026', url: 'https://x.in/order/abc' },
      { title: 'Thank you for your order', url: 'https://x.in/thank-you' },
      { title: '', url: 'https://x.in/' },
      { title: 'anything at all', url: null },
      { title: null, url: null },
    ]) {
      const out = whatTheOrderPageSays(key, page);
      ok(out.said === CANNOT_TELL, `${key} cannot tell from ${JSON.stringify(page.title)}`);
      ok(out.said !== NOT_PLACED, `and ${key} NEVER says not placed, which would be a claim`);
    }
    ok(whatTheOrderPageSays(key, { title: 'Order Placed', url: 'https://x.in/order-success' })
      .because === BECAUSE_ORDER.NOTHING_MEASURED_YET,
      `and ${key} says WHY: nobody has watched it place an order`);
  }

  // ── AND INSTAMART NOW ANSWERS FROM ITS OWN MEASUREMENT ──────────────────
  //
  // The addresses are the owner's, off his own purchase on 22 September 2026.
  ok(whatTheOrderPageSays('instamart', {
    title: 'Instamart', url: 'https://www.swiggy.com/instamart/timeline?orderId=123456',
  }).said === PLACED, 'the timeline page IS the confirmation, and it is only reached by paying');
  // AND THE PAGES THAT CARRY AN ORDER ID AND ARE NOT PURCHASES.
  for (const url of [
    'https://www.swiggy.com/support/issues/dash_order?orderId=123456&orderType=INSTAMART',
    'https://www.swiggy.com/support/chat?redirectURI=%2Fsupport%3ForderId%3D123456',
    'https://www.swiggy.com/my-account',
  ]) {
    ok(whatTheOrderPageSays('instamart', { title: 'Instamart', url }).said !== PLACED,
      `and ${url.slice(24, 52)} is not a purchase, however many order ids it carries`);
  }
  // AND THE ORDINARY SHOPPING PAGES SAY NOTHING EITHER WAY.
  for (const url of [
    'https://www.swiggy.com/instamart',
    'https://www.swiggy.com/instamart/search?query=Bla+Bli+Blu',
    'https://www.swiggy.com/instamart/item/SHU0ZB5M7P',
    'https://www.swiggy.com/instamart/cart',
    'https://www.swiggy.com/instamart/payment',
  ]) {
    ok(whatTheOrderPageSays('instamart', {
      title: 'Online Grocery Store | Buy Groceries at Best Prices - Instamart', url,
    }).said !== PLACED, `and ${url.slice(24)} is not a purchase`);
  }

  // AND THE RULE RUNS BEFORE THE ONE THAT COULD ANSWER NOT_PLACED, rather than
  // being reached by matching nothing — which is what stops one future line in
  // an empty table from starting to make that claim.
  const decides = withoutComments(read('src/shop/theOrderPlaced.js'));
  const body = decides.slice(decides.indexOf('export function whatTheOrderPageSays'));
  const asksFirst = body.indexOf('anybodyHasMeasured(key)');
  const claimsLater = body.indexOf('notAFreshOrder');
  // BOTH ANCHORS MUST BE FOUND: -1 < n is true when the first is missing.
  ok(asksFirst > -1 && claimsLater > -1 && asksFirst < claimsLater,
    'the nothing-measured rule is asked before the only rule that answers NOT_PLACED');
}

console.log('\n=== 4. addresses are read, not invented ===');
{
  ok(pathOfAddress('https://www.zeptonow.com/checkout/success?x=1') === '/checkout/success?x=1',
    'the query is kept — a shop is as likely to say ?status=success as /success');
  ok(pathOfAddress('https://www.zeptonow.com') === '/', 'a bare origin is the root');
  ok(pathOfAddress('HTTPS://WWW.ZEPTONOW.COM/Order-Confirmation') === '/order-confirmation',
    'and a shouted address is the same address');
  for (const bad of ['upi://pay', 'about:blank', '/cart', null, 7]) {
    ok(pathOfAddress(bad) === null, `${JSON.stringify(bad)} has no path to read`);
  }
  // A path mark is not an address, so Phase 1's rule that no shop ADDRESS is
  // written in insideFayr.js still holds — checked there, and re-stated here so
  // the two phases cannot be read as contradicting each other.
  ok(!/https?:\/\//.test(withoutComments(read('src/shop/insideFayr.js'))),
    'insideFayr.js still holds no web address at all');
}

console.log('\n=== 5. the bar’s fifth state, and it sticks ===');
{
  const bar = (over) => whatTheBarSays({
    keyword: 'boldfit sports headband', verdict: null, shopName: 'Zepto', ...over,
  });
  ok(bar({ orderPlaced: true }).state === BAR.ORDER_PLACED, 'a placed order is its own state');
  ok(bar({ orderPlaced: true }).line === 'Order placed.', 'in the design’s own words');
  ok(TONE[BAR.ORDER_PLACED] === 'good', 'drawn as a yes');
  ok(bar({ orderPlaced: true }).keyword === 'boldfit sports headband',
    'and the keyword is still on the bar');

  // IT OUTRANKS EVERY PRODUCT VERDICT. The shop navigates on after a
  // confirmation page — to the order's own page, to tracking, to its home page —
  // and the bar must not flick back. An order that happened does not un-happen.
  for (const verdict of ['RIGHT', 'WRONG', 'CANNOT_TELL', null]) {
    ok(bar({ orderPlaced: true, verdict }).state === BAR.ORDER_PLACED,
      `a later "${verdict}" cannot take a placed order back`);
  }
  // AND WITHOUT IT, THE FOUR FROM PHASE 2 ARE EXACTLY AS THEY WERE.
  ok(bar({ orderPlaced: false, verdict: 'WRONG' }).state === BAR.WRONG,
    'with no order, WRONG is still WRONG');
  ok(bar({ verdict: 'RIGHT' }).state === BAR.RIGHT, 'and RIGHT is still RIGHT');
  ok(bar({ verdict: null }).state === BAR.KEYWORD, 'and the keyword state still starts it');
  ok(bar({ orderPlaced: 'yes', verdict: 'RIGHT' }).state === BAR.RIGHT,
    'and only a real true counts, never a truthy string');

  // THE STICKING IS DONE BY THE CALLER, WITH A FLAG THAT ONLY GOES ONE WAY.
  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/if \(out\.said === PLACED\) setOrderSeen\(true\);/.test(screen),
    'the screen sets the flag only when a page really said so');
  ok(!/setOrderSeen\(false\)/.test(screen), 'and never unsets it');
  ok(/orderPlaced: orderSeen,/.test(screen), 'and hands it to the bar');
}

console.log('\n=== 6. the hand-off: once, and to the read that already exists ===');
{
  const screen = withoutComments(read('src/shop/ShopScreen.js'));

  ok(/navigation\.replace\('LookingForIt', \{ campaignId \}\)/.test(screen),
    'it hands over to LookingForIt, which already does the whole job');
  // `replace`, NOT `navigate`: coming back to a shop screen whose session has
  // already been handed on is a way to run the read twice.
  ok(!/navigation\.navigate\('LookingForIt'/.test(screen),
    'by replace and never navigate, so there is no shop screen to come back to');
  ok(!/navigation\.push\(/.test(screen), 'and nothing is pushed on top of it');

  // AND IT RUNS ONCE. A shop that navigates twice through a confirmation page
  // cannot fire two reads.
  ok(/const handedOver = useRef\(false\)/.test(screen),
    'a once-only flag guards the hand-off');
  ok(/if \(!orderSeen \|\| handedOver\.current\) return/.test(screen),
    'and it is checked before anything happens');
  ok(/handedOver\.current = true;/.test(screen), 'and set before the timer is started');
  const guard = screen.indexOf('handedOver.current = true;');
  const go = screen.indexOf("navigation.replace('LookingForIt'");
  ok(guard > -1 && go > guard, 'the flag is set BEFORE the navigation, not after it');
  ok(/if \(!campaignId\) return/.test(screen),
    'and nothing is handed over without a campaign for the read to be about');

  // NOTHING IN src/shop/ READS AN ORDER. The read is navigated to, never copied.
  //
  // COMMENTS STRIPPED, AND IMPORTS CHECKED RATHER THAN MENTIONS. Half of these
  // files EXPLAIN in prose that the read is built elsewhere and must not be
  // rebuilt — naming drawnList.js and parseOrderText while doing so. Reading
  // that sentence as evidence of the opposite is the prose-instead-of-code
  // mistake this project has now made seven times.
  for (const f of ['ShopScreen.js', 'insideFayr.js', 'theOrderPlaced.js', 'theBar.js',
    'theRightProduct.js', 'shopLog.js']) {
    const src = withoutComments(read(`src/shop/${f}`));
    // ── ONE EXCEPTION SINCE 18 SEPTEMBER 2026, AND IT IS NOT A READ ────────
    //
    // ShopScreen imports howThisShopNamesAnOrder from detailLook.js — the
    // measured SHAPE of an order's page address — so the review step's one tap
    // can land on that order's own page. That is a look-up of a string pattern,
    // not a call into the reader, and the next assertion still refuses every
    // function that reads an order for every file here including that one.
    if (f === 'ShopScreen.js') {
      ok(!/from '[^']*(drawnList|orderhistory|lookLog)/.test(src),
        `${f} imports nothing from the order reader`);
      ok(/import \{ howThisShopNamesAnOrder \} from '\.\.\/order\/detailLook';/.test(src),
        `${f} imports one measured shape from detailLook.js, by name, and nothing else`);
    } else {
      ok(!/from '[^']*(drawnList|detailLook|orderhistory|lookLog)/.test(src),
        `${f} imports nothing from the order reader`);
    }
    ok(!/harvestRendered|openTheListWith|openOneOrderWith|parseOrderText|judgeFoundOrders|readDetailOutcome/.test(src),
      `${f} calls nothing in the order reader`);
  }

  // AND THE READ ITSELF IS UNTOUCHED — it still takes exactly what is handed to it.
  const look = read('src/order/LookingForItScreen.js');
  ok(/const campaignId = params\.campaignId \|\| null;/.test(look),
    'LookingForItScreen still reads campaignId out of its params');
}

console.log('\n=== 7. "Did you buy it?" is NOT deleted ===');
{
  // A missed detection, a shop that changed its wording, somebody who paid and
  // came back another way — every one of those ends with a person who bought
  // something and no way to say so. Leaving it costs one button on a screen most
  // people will never see.
  const tap = read('src/screens/returncatch.js');
  ok(/Did you buy it\?/.test(tap), 'the screen is still there');
  ok(/YES, I HAVE BOUGHT IT/.test(tap), 'and its button still is');
  ok(/navigation\.navigate\('LookingForIt', \{ campaignId \}\)/.test(withoutComments(tap)),
    'and it still starts the same read');
  // AND FOR EVERY SHOP, not only the ones outside the in-app list. What this
  // protects is that the CARD and its YES are unconditional — the way to say "I
  // bought it" must never depend on which shop it was.
  //
  // ── NARROWED 21 SEPTEMBER 2026, and what it may not be narrowed past ────
  //
  // It used to refuse the file any mention of shopsInsideFayr at all. That was
  // the rule standing in for the intent, and it caught the wrong thing: the
  // card gained ONE EXTRA door — "Go back to <shop> and try again" — that only a
  // shop shopped inside Fayr can have, because the other four are reached by
  // leaving Fayr entirely. The door is an addition for some, never a condition
  // on the question or the answer.
  //
  // So the intent is checked directly instead: the question and the Yes are
  // outside every conditional.
  const code = withoutComments(tap);
  const yesAt = code.indexOf('YES, I HAVE BOUGHT IT');
  const questionAt = code.indexOf('Did you buy it?');
  const doorAt = code.indexOf('shopsInsideFayr(key)');
  ok(yesAt !== -1 && questionAt !== -1, 'the question and the answer are both drawn');
  ok(doorAt === -1 || doorAt > yesAt,
    'AND NEITHER SITS INSIDE THE SHOP-SPECIFIC DOOR, which comes after them');
  ok(!/shopsInsideFayr\(key\) \?[\s\S]{0,400}YES, I HAVE BOUGHT IT/.test(code),
    'and the way to say "I bought it" never depends on which shop it was');
}

console.log('\n=== 8. the log carries what corrects the guess ===');
{
  const REAL = 'https://www.zepto.com/order/status/01a0b4d7-870c-7dca-b701-e038477c5106?referrer=home&from=ProcessOrder';
  const out = at('Everything delivered in minutes* | Zepto', REAL);
  const line = orderDetail({ ...out, title: 'Everything delivered in minutes* | Zepto', url: REAL });
  ok(/said=PLACED/.test(line), 'the line carries the answer');
  ok(/rule="the address says an order was placed"/.test(line), 'and which rule fired');
  ok(/title="Everything delivered in minutes\* \| Zepto"/.test(line), 'and the exact title');
  ok(/url=https:\/\/www\.zepto\.com\/order\/status\/01a0b4d7/.test(line),
    'and the exact address — which is what rewrote the table from the real purchase');

  ok(handoffDetail({ to: 'LookingForIt', campaignId: 'c1' }) === 'to=LookingForIt campaign=c1',
    'the hand-off writes its own line, so two reads for one purchase would be visible');

  const screen = withoutComments(read('src/shop/ShopScreen.js'));
  ok(/logShop\('ORDER\?', orderDetail\(/.test(screen), 'the screen writes one line per page judged');
  ok(/logShop\('HANDING OVER', handoffDetail\(/.test(screen), 'and one when it hands over');

  // SAME RULES AS PHASES 1 AND 2.
  const log = withoutComments(read('src/shop/shopLog.js'));
  ok((log.match(/console\.log\(/g) || []).length === 1, 'still one console.log in the file');
  ok(!/innerHTML|outerHTML|textContent/.test(log), 'and still no way to be handed a page');
}

console.log('\n=== 9. the one field a LIVE campaign may change, and only that one ===');
{
  const svc = withoutComments(read('backend/src/campaigns/admin-campaign.service.ts'));
  ok(/const EDITABLE_WHILE_LIVE: readonly string\[\] = \['searchKeyword'\];/.test(svc),
    'exactly one field may be changed while a campaign is live, and it is named');
  ok(/campaign\.status === 'ACTIVE' && onlyTheOneAllowedWhileLive\(dto\)/.test(svc),
    'and the exemption applies only to an ACTIVE campaign, never an ENDED one');
  ok(/given\.length > 0 && given\.every\(\(k\) => EDITABLE_WHILE_LIVE\.includes\(k\)\)/.test(svc),
    'and a body carrying anything ELSE beside it is refused, so it cannot carry a passenger');
  // THE REASONING IS WRITTEN WHERE THE LOCK IS, which is what the owner asked
  // for — the next person to read that guard must find out why it has a hole.
  const whole = read('backend/src/campaigns/admin-campaign.service.ts');
  ok(/cannot change what anybody is owed/.test(whole),
    'and the reasoning sits beside the lock rather than in a commit message');
  // EVERY OTHER FIELD IS STILL SHUT. If one of these ever joins the list it must
  // be a decision somebody made on purpose, not a widening nobody noticed.
  //
  // THE LIST IS SLICED OUT AND READ, rather than pattern-matched around. The
  // first writing of this asked for `EDITABLE_WHILE_LIVE[^\]]*<field>`, which can
  // never match anything: the declaration contains `string[]`, so the character
  // class stops at that bracket before it reaches a single entry. Ten checks
  // that could not fail.
  const declared = (svc.match(/EDITABLE_WHILE_LIVE[^=]*=\s*\[([^\]]*)\]/) || [])[1];
  ok(typeof declared === 'string', 'the list of live-editable fields was found');
  const allowed = String(declared).split(',').map((w) => w.trim().replace(/['"]/g, ''))
    .filter((w) => w !== '');
  ok(allowed.length === 1 && allowed[0] === 'searchKeyword',
    'and it holds exactly one field, which is the search keyword');
  for (const locked of ['productPricePaise', 'payoutPercent', 'payoutCapPaise', 'terms',
    'ticketCost', 'returnWindowDays', 'minRating', 'totalSlots', 'title', 'productName',
    'platform', 'asin', 'productUrl', 'imageUrl', 'category']) {
    ok(allowed.indexOf(locked) === -1,
      `${locked} is still locked while a campaign is live`);
  }
}

console.log('\n=== 10. nothing this phase touches was supposed to be frozen ===');
{
  // The order reader answers the same way it did, and the shop flow reaches it
  // by navigating rather than by knowing anything about it.
  ok(/SHOPS_WHOSE_ORDER_PAGES_ARE_DRAWN = \['zepto'\]/.test(read('src/order/drawnList.js')),
    'drawnList.js still draws zepto’s order pages');
  ok(/ZEPTO_ORDER_DETAIL_PAGE = 'https:\/\/www\.zepto\.com\/order\/'/.test(read('src/order/detailLook.js')),
    'detailLook.js still knows where a zepto order lives');
  // Phase 1 and Phase 2 are untouched.
  ok(/export const WE_LOAD = \['http', 'https'\];/.test(read('src/shop/insideFayr.js')),
    'Phase 1’s whitelist is exactly as it was');
  ok(/'No, this isn’t the correct product — go back & select another product\.'/
    .test(read('src/shop/theBar.js')), 'and Phase 2’s wording is exactly as it was');
  // ── AND BLINKIT AND INSTAMART ARE IN THE LIST NOW, WITH NOTHING GUESSED ──
  //
  // This check used to refuse them. The phase of 18 September 2026 puts them in
  // deliberately; what it does NOT do is give either of them a mark, and that is
  // the half worth pinning, because copying zepto's guessed phrases across would
  // have turned one unmeasured table into three and made them look measured by
  // weight of numbers.
  const list = withoutComments(read('src/shop/insideFayr.js'));
  const only = list.slice(list.indexOf('export const SHOPS_INSIDE_FAYR'),
    list.indexOf('export const ANDROID_LIKE_A_PHONE'));
  ok(/blinkit:/.test(only) && /instamart:/.test(only),
    'Blinkit and Instamart are in the in-app list');
  // ── AND INSTAMART EARNED ITS MARKS ON 22 SEPTEMBER 2026 ─────────────────
  //
  // The half this check exists to protect is unchanged: an unmeasured shop must
  // not be given marks copied from a measured one, because three tables that
  // look alike read as three measurements. What changed is that Instamart is no
  // longer unmeasured — the owner bought through it and the whole purchase is in
  // the log. BLINKIT IS STILL EMPTY, and stays empty until somebody watches one.
  ok((only.match(/orderPlaced: \{\}/g) || []).length === 1,
    'exactly ONE empty order table is left, and it is Blinkit\'s');
  ok(/blinkit: \{[^}]*orderPlaced: \{\}/s.test(only),
    'and it is Blinkit that carries it, not a shop somebody has since watched');
  // titleSays counts the ORDER tables only. pathSays also appears in Instamart's
  // tooManyDevices marks (22 September 2026), so counting it alone would drift
  // every time a shop learns a new page shape — count the order tables by their
  // own key instead.
  ok((only.match(/titleSays:/g) || []).length === 2,
    'and there are two sets of order marks now — zepto\'s and instamart\'s, both from real purchases');
  ok((only.match(/orderKeyFollows:/g) || []).length === 2,
    'each with its own place for the order key');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
