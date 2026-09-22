// THE JOURNEY IS ONE JOURNEY, WHATEVER SHOP IT IS ON.
//
// ── THE OWNER'S ASK, 22 SEPTEMBER 2026 ──────────────────────────────────────
//
//   "All marketplaces should follow the same basic user flow that we already
//    created for ZEPTO. There can be some small differences because every
//    marketplace works differently. That is fine. However, the main structure,
//    order of steps, and user journey should remain the same... Do not create a
//    completely different journey for Swiggy Instamart or Blinkit."
//
// ── AND IT ALREADY IS, WHICH IS WORTH PROVING RATHER THAN ASSERTING ─────────
//
// He reported the Instamart journey behaving differently from Zepto's — stuck on
// "Opening the shop", never brought back after paying. It is natural to read
// that as two journeys, and to answer it by writing a third. It was not two
// journeys. src/ui/journey.js contains no per-shop branch at all: no
// `platform ===`, no `marketplace ===`, no shop name anywhere in its routing.
// Every in-Fayr shop runs the identical machine.
//
// What differed was ONE FACT reaching that machine. `watched` is
// theWatchedOrderKey(task) != null, and the key is captured by recognising the
// shop's order-placed page. Instamart's table in insideFayr.js was `{}`, so no
// page was ever recognised, so no key was ever captured, so `watched` stayed
// false and the router returned 'shop' for ever. Filling that table — from his
// own purchase, 22 September — is the whole of the fix.
//
// SO THIS FILE PINS THE SHARED STRUCTURE, so that the next shop cannot quietly
// grow a journey of its own, and so the next person reading a stuck screen looks
// for the missing FACT rather than writing a second machine.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOPS_INSIDE_FAYR } from '../shop/insideFayr.js';
import { whatTheBarSays } from '../shop/theBar.js';
import { JOURNEY, journeyStepFor } from '../ui/journey.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const INSIDE = Object.keys(SHOPS_INSIDE_FAYR);

console.log('=== 1. THE ROUTER KNOWS NO SHOP BY NAME ===');
{
  const router = strip(read('src/ui/journey.js'));
  for (const name of ['zepto', 'blinkit', 'instamart', 'amazon', 'flipkart', 'meesho', 'myntra']) {
    ok(!new RegExp(`['"\`]${name}['"\`]`, 'i').test(router),
      `the journey never names ${name}, so it cannot branch on it`);
  }
  ok(!/platform\s*===|marketplace\s*===/.test(router),
    'and it compares no platform or marketplace anywhere');
  // THE ONE DISTINCTION IT DOES MAKE, and it is about a CAPABILITY rather than
  // a shop: does this shop open inside Fayr at all?
  ok(/inFayrShop/.test(router), 'the only distinction is whether the shop opens inside Fayr');
}

console.log('\n=== 2. EVERY IN-FAYR SHOP WALKS THE SAME STEPS, IN THE SAME ORDER ===');
{
  // The same facts, shop by shop, must produce the same step. If Instamart ever
  // answers differently from Zepto for identical input, the journeys have forked.
  const facts = [
    { name: 'nothing yet', s: {} },
    { name: 'claimed, not connected', s: { task: { state: 'CLAIMED' }, connected: false } },
    { name: 'in the shop, nothing watched', s: { task: { state: 'CLAIMED' }, inFayrShop: true } },
    { name: 'in the shop, looked and found nothing', s: { task: { state: 'CLAIMED' }, inFayrShop: true, lookedForTheOrder: true } },
    { name: 'purchased', s: { task: { state: 'PURCHASED', order: { id: 'X' } }, inFayrShop: true } },
    { name: 'delivered', s: { task: { state: 'DELIVERED', order: { id: 'X' } }, inFayrShop: true } },
    { name: 'reviewed', s: { task: { state: 'REVIEWED', order: { id: 'X' } }, inFayrShop: true } },
    { name: 'holding', s: { task: { state: 'HOLDING', order: { id: 'X' } }, inFayrShop: true } },
    { name: 'refunded', s: { task: { state: 'REFUNDED', order: { id: 'X' } }, inFayrShop: true } },
    { name: 'the order went back', s: { task: { state: 'DELIVERED', order: { id: 'X' }, returned: true }, inFayrShop: true } },
  ];
  for (const f of facts) {
    const answers = INSIDE.map((shop) => journeyStepFor({ ...f.s, shop }));
    const first = answers[0];
    ok(answers.every((a) => a === first),
      `"${f.name}" answers ${JSON.stringify(first)} on every in-Fayr shop (${INSIDE.join(', ')})`);
  }
}

console.log('\n=== 3. AND WHAT ACTUALLY DIFFERED WAS ONE FACT, NOT A JOURNEY ===');
{
  // The stuck screen he reported, reproduced from the two states that produce it.
  const stuck = journeyStepFor({ task: { state: 'CLAIMED' }, inFayrShop: true });
  ok(stuck === 'shop', 'with no watched order the router answers "shop" — the screen he was stuck on');

  const moving = journeyStepFor({
    task: { state: 'CLAIMED', watchedOrderKey: '01a0c86c-b802-7d06-936d-4197420f87f8' },
    inFayrShop: true,
  });
  ok(moving === 'shop', 'and with one it still answers "shop" — but as the WATCHED face, which reads by itself');

  // THE FACT ITSELF. A shop whose order-placed table is empty can never capture
  // a key, so `watched` can never become true, so that second face is
  // unreachable. This is the line that would have explained his stuck screen.
  const table = SHOPS_INSIDE_FAYR;
  for (const shop of INSIDE) {
    const marks = table[shop].orderPlaced || {};
    const measured = Object.keys(marks).length > 0;
    console.log(`       ${shop}: order-placed table ${measured ? 'MEASURED' : 'EMPTY — its watched face is unreachable'}`);
  }
  ok(Object.keys(table.zepto.orderPlaced).length > 0, 'zepto is measured');
  ok(Object.keys(table.instamart.orderPlaced).length > 0,
    'AND SO IS INSTAMART NOW — which is what unsticks the journey he reported');
}

console.log('\n=== 4. NOTHING FORCES A PRODUCT PAGE BEFORE BUYING ===');
{
  // ── THE OWNER, 22 SEPTEMBER 2026 ────────────────────────────────────────
  //
  //   "On Swiggy Instamart, ZEPTO, and Blinkit, users can add a product to the
  //    cart directly from the product list... The user should not be forced to
  //    open the full product page before adding the product to the cart."
  //
  // They are not, and this is what keeps it that way. The bar above the shop is
  // a HINT AND NEVER A GATE — it blocks nothing, hides nothing and disables
  // nothing, and theRightProduct.js says so at length in its own words. A person
  // who taps + on a list card and pays has done nothing wrong.
  const screen = strip(read('src/shop/ShopScreen.js'));
  ok(!/disabled=\{[^}]*verdict|verdict[^)]*\?\s*null\s*:\s*<WebView/.test(screen),
    'the verdict disables nothing on the shop screen');
  // AND THE BAR ALWAYS DRAWS SOMETHING, whatever it makes of the page — tested
  // by asking it rather than by grepping for `return null`, which its own tidy
  // helpers use legitimately for bad input.
  for (const verdict of [null, 'RIGHT', 'WRONG', 'CANNOT_TELL']) {
    const said = whatTheBarSays({
      productName: 'A Product', keyword: 'a product', verdict, shopName: 'the shop',
    });
    ok(said != null && typeof said.state === 'string',
      `the bar still speaks when the verdict is ${JSON.stringify(verdict)} — it never withholds itself`);
  }
  // AND THE VERDICT ON A LIST PAGE IS HONEST RATHER THAN OBSTRUCTIVE: it cannot
  // tell which of several products somebody is about to add, and says so.
  ok(journeyStepFor({ task: { state: 'CLAIMED' }, inFayrShop: true }) === 'shop',
    'and the journey does not require a product page to have been seen');
  // WHAT ACTUALLY CHECKS THE PRODUCT IS THE ORDER, AFTER THE FACT, on the
  // server, from the shop's own pages — which is unaffected by how the thing
  // reached the cart.
  const candidates = strip(read('backend/src/tasks/order-candidates.service.ts'));
  ok(/theDeliveryFragment|submitEvidence/.test(candidates),
    'the product is verified from the ORDER the server reads, not from the route taken to the cart');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
