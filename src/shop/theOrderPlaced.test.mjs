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

console.log('=== 1. the seven pages the owner named ===');
{
  ok(said('Order Placed | Zepto', 'https://www.zeptonow.com/order-confirmation/abc') === PLACED,
    'a confirmation page is PLACED');
  ok(said('My Cart | Zepto', 'https://www.zeptonow.com/cart') !== PLACED,
    'a cart is not a placed order');
  ok(said('Checkout - Zepto', 'https://www.zeptonow.com/checkout') !== PLACED,
    'a checkout is not a placed order');
  ok(said('Boldfit Strapless Sports Headband | Zepto', 'https://www.zeptonow.com/pn/x/pvid/y') !== PLACED,
    'a product page is not a placed order');

  // THE ORDER HISTORY IS NOT A FRESH ORDER, and it is called that in words
  // rather than merely being "not placed by accident".
  const history = at('My Orders | Zepto', 'https://www.zeptonow.com/account/orders');
  ok(history.said === NOT_PLACED, 'an order-history page is NOT_PLACED');
  ok(history.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN,
    'and it says so by name: an order already known, not a new one');

  ok(said('', 'https://www.zeptonow.com/') === CANNOT_TELL, 'an empty title is CANNOT TELL');
  ok(said('Order fresh groceries in 10 minutes | Zepto', 'https://www.zeptonow.com/') === CANNOT_TELL,
    'the word "order" in marketing is not an order');
}

console.log('\n=== 2. the rule order, which is load-bearing ===');
{
  // ZEPTO'S OWN ORDER PAGE PRINTS "Order Placed at". MEASURED, on the owner's
  // real order of 21 July 2026, and quoted in backend/src/ocr/order-text.ts. So
  // the words genuinely appear on a page that is NOT a purchase, and without the
  // already-known rule running first, browsing old orders would fire a read
  // every single time.
  const old = at('Order Placed at | Zepto', 'https://www.zeptonow.com/order/abc-123?isArchived=false');
  ok(old.said === NOT_PLACED, 'an OLD order’s own page is not a new order');
  ok(old.because === BECAUSE_ORDER.AN_ORDER_ALREADY_KNOWN,
    'and the already-known rule is what caught it, not the title rule');
  ok(/order placed/.test(tidyText('Order Placed at | Zepto')),
    'even though its title carries the very phrase the title rule looks for');

  // PROOF THE PHRASE WOULD OTHERWISE HAVE FIRED.
  ok(said('Order Placed at | Zepto', 'https://www.zeptonow.com/somewhere-else') === PLACED,
    'the same title anywhere else IS read as a placed order');

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
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra', 'blinkit', 'instamart',
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

  // THE MARKS ARE LABELLED A GUESS IN THE FILE THEY LIVE IN.
  const table = read('src/shop/insideFayr.js');
  ok(/NOBODY HAS MEASURED IT/.test(table),
    'insideFayr.js says plainly that the order marks are unmeasured');
  const marks = orderMarksFor('zepto');
  ok(marks != null && marks.titleSays.length > 0 && marks.pathSays.length > 0
    && marks.notAFreshOrder.length > 0, 'and zepto has all three lists');
  // ── AND THE TWO THAT JOINED ON 18 SEPTEMBER HAVE AN EMPTY TABLE, WHICH IS
  //    NOT THE SAME ANSWER AS NO TABLE ──────────────────────────────────────
  //
  // `null` means "this shop does not shop inside Fayr at all" — Amazon's answer.
  // `{}` means "it does, and nobody has ever watched it place an order". Those
  // two must not collapse into one, or the reason Blinkit says nothing becomes
  // invisible.
  for (const key of ['blinkit', 'instamart']) {
    const empty = orderMarksFor(key);
    ok(empty !== null, `${key} shops inside Fayr, so it has a table`);
    ok(Object.keys(empty).length === 0, `and ${key}'s table is empty`);
    ok(anybodyHasMeasured(key) === false, `and nobody has measured ${key}`);
  }
  ok(anybodyHasMeasured('zepto') === true, 'while zepto has marks, guessed though they are');
  for (const key of ['amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(orderMarksFor(key) === null, `${key} has no table, because it is not inside Fayr`);
    ok(anybodyHasMeasured(key) === false, `and ${key} is not "measured" either`);
  }

  // ── AN UNMEASURED SHOP CAN ONLY EVER SAY "CANNOT TELL" ───────────────────
  //
  // THE CHECK THE PHASE ASKED FOR, and it is the one that matters: NOT_PLACED is
  // a CLAIM about a page, and a claim about a page nobody has ever seen is not
  // something this app may make. Every page shape that makes zepto answer
  // something is walked against both new shops.
  for (const key of ['blinkit', 'instamart']) {
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
  // AND FOR EVERY SHOP, not only the ones outside the in-app list. Nothing in
  // this phase made that screen conditional on anything.
  ok(!/shopsInsideFayr|insideFayr/.test(tap),
    'it has not been made conditional on which shop this is');
}

console.log('\n=== 8. the log carries what corrects the guess ===');
{
  const out = at('Order Placed | Zepto', 'https://www.zeptonow.com/order-confirmation/abc');
  const line = orderDetail({ ...out, title: 'Order Placed | Zepto', url: 'https://www.zeptonow.com/order-confirmation/abc' });
  ok(/said=PLACED/.test(line), 'the line carries the answer');
  ok(/rule="the address says an order was placed"/.test(line), 'and which rule fired');
  ok(/title="Order Placed \| Zepto"/.test(line), 'and the exact title');
  ok(/url=https:\/\/www\.zeptonow\.com\/order-confirmation\/abc/.test(line),
    'and the exact address — which is what rewrites the table from a real purchase');

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
  ok((only.match(/orderPlaced: \{\}/g) || []).length === 2,
    'and each of them carries an EMPTY order table, written as one');
  ok((only.match(/titleSays:/g) || []).length === 1
    && (only.match(/pathSays:/g) || []).length === 1,
    'and there is still exactly one set of marks in the whole file, which is zepto\'s');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
