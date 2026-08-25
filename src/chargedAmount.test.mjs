// Refunds are based on the amount ACTUALLY CHARGED, never a listed price.
// Cases built from the REAL live records, not invented numbers.
import fs from 'node:fs';
import path from 'node:path';
import { resolveChargedPaise } from './chargedAmount.js';

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  PASS ' + m); }
  else { fail++; console.log('  FAIL ' + m); }
};

console.log('=== FLIPKART: the live overpay this policy exists to stop ===');
// Real: heels order OD337767552058345100, campaign ₹328. itemSellingPrice is the
// LISTED price and sat ₹39 above the order total actually charged.
const heels = resolveChargedPaise({ quantity: 1, itemPaise: 36700, orderTotalPaise: 32800, itemAmountAmbiguous: false });
ok(heels.paise === 32800, 'heels: pays the ₹328 charged, NOT the ₹367 listed');
ok(heels.basis === 'order-total-lower', 'basis records that the total won');
ok(heels.needsStaff === false, 'a normal discount is payable without staff');

console.log('=== AMAZON: a merged cart must NOT drag the refund up ===');
// Real example from the taskflow comment: order 408-1509645-3524313 totals
// 1326.00 across items of 388.00 and 938.00.
const merged = resolveChargedPaise({ quantity: 1, itemPaise: 38800, orderTotalPaise: 132600 });
ok(merged.paise === 38800, 'merged cart: pays the ₹388 item, not the ₹1326 total');
ok(merged.basis === 'item-price', 'basis = item-price when the total is higher');
// The old rule (always itemPaise) got this same answer — proving the change is
// not a regression for Amazon, only a new floor for Flipkart-shaped data.
ok(merged.paise === 38800, 'unchanged from the previous itemPaise-only behaviour');

console.log('=== equal figures: single-item order, no discount ===');
const equal = resolveChargedPaise({ quantity: 1, itemPaise: 14300, orderTotalPaise: 14300 });
ok(equal.paise === 14300 && equal.basis === 'item-price', 'total == item -> item price');

console.log('=== only an item price (no total to cross-check) ===');
const itemOnly = resolveChargedPaise({ quantity: 1, itemPaise: 14300, orderTotalPaise: null });
ok(itemOnly.paise === 14300, 'item stands alone when there is no total');
ok(itemOnly.basis === 'item-price-only', 'basis says it was uncorroborated');

console.log('=== QUICK-COMMERCE: a bare order total is NEVER auto-paid ===');
// Blinkit flower pot: total ₹604 covering a multi-item order, no per-item price.
const blinkit = resolveChargedPaise({ quantity: 1, itemPaise: null, orderTotalPaise: 60400, itemAmountAmbiguous: true });
ok(blinkit.paise === null, 'no item price -> no auto payout, even with a total present');
ok(blinkit.needsStaff === true && blinkit.reason === 'amount-unknown', 'routed to staff, reason preserved');
// Instamart razor: no amount at all.
const instamart = resolveChargedPaise({ quantity: 1, itemPaise: null, orderTotalPaise: null });
ok(instamart.needsStaff === true, 'no amounts at all -> staff');

console.log('=== the two cases we refuse to guess ===');
const amb = resolveChargedPaise({ quantity: 1, itemPaise: 36700, orderTotalPaise: 32800, itemAmountAmbiguous: true });
ok(amb.paise === null && amb.reason === 'item-price-above-total-and-ambiguous',
  'item above total AND flagged ambiguous -> staff, not a coin flip');
const wild = resolveChargedPaise({ quantity: 1, itemPaise: 500000, orderTotalPaise: 20000 });
ok(wild.paise === null && wild.reason === 'amount-gap-implausible',
  '₹5000 item vs ₹200 charged is not a coupon -> staff');
// Boundary: exactly half is still implausible-adjacent but allowed through.
const half = resolveChargedPaise({ quantity: 1, itemPaise: 20000, orderTotalPaise: 10000 });
ok(half.paise === 10000, 'exactly 50% off is payable (total*2 == item, not < item)');
const justUnder = resolveChargedPaise({ quantity: 1, itemPaise: 20001, orderTotalPaise: 10000 });
ok(justUnder.paise === null, 'a hair past 50% off tips into staff review');

console.log('=== never returns a figure above what was charged ===');
for (const [item, total] of [[36700, 32800], [38800, 132600], [14300, 14300], [20000, 10000]]) {
  const r = resolveChargedPaise({ quantity: 1, itemPaise: item, orderTotalPaise: total });
  ok(r.paise == null || r.paise <= Math.max(total, 0), `min-invariant holds for item=${item} total=${total}`);
  ok(r.paise == null || r.paise <= item, `never exceeds the item price either (item=${item})`);
}

console.log('=== defensive: missing/absent order ===');
ok(resolveChargedPaise(null).needsStaff === true, 'null order -> staff, never a crash');
ok(resolveChargedPaise(undefined).paise === null, 'undefined order -> null paise');
ok(resolveChargedPaise({ quantity: 1,}).reason === 'amount-unknown', 'empty order -> amount-unknown');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

console.log('\n=== QUANTITY — never assume one unit (mirrors the backend rule) ===');
{
  // Most orders still do not state a quantity — a labelled one IS now read (see
  // quantity.js), but Amazon prints no label on a single-unit order. So on a bare
  // line total we cannot tell one unit at this price from three at a third of it,
  // and refunding a percentage of the line pays a multiple of what the campaign
  // intended.
  const unknown = resolveChargedPaise({ itemPaise: 93800 });
  ok(unknown.paise === null && unknown.needsStaff === true,
    'a line total with an unknown quantity pays nothing automatically');
  ok(unknown.reason === 'quantity-unknown', 'and says which question is unanswered');

  ok(resolveChargedPaise({ itemPaise: 32800, quantity: 1 }).paise === 32800,
    'a genuine single unit still pays');

  const three = resolveChargedPaise({ lineTotalPaise: 98400, quantity: 3 });
  ok(three.paise === 32800, 'a known quantity divides the line total exactly');
  ok(three.basis === 'unit-from-line-total', 'and records that it was divided, not stated');

  const stated = resolveChargedPaise({ unitPricePaise: 32800, lineTotalPaise: 98400, quantity: 3 });
  ok(stated.paise === 32800 && stated.basis === 'unit-price',
    'a STATED per-unit price wins over dividing — evidence beats inference');

  ok(resolveChargedPaise({ unitPricePaise: 32800 }).needsStaff === false,
    'and a stated unit price needs no quantity at all');

  const odd = resolveChargedPaise({ lineTotalPaise: 100, quantity: 3 });
  ok(odd.paise === null && odd.reason === 'quantity-not-divisible',
    'money that does not divide evenly is not rounded silently');

  for (const q of [0, -1, 1.5, 1000]) {
    ok(resolveChargedPaise({ itemPaise: 32800, quantity: q }).paise === null,
      `a nonsense quantity (${q}) pays nothing`);
  }

  ok(resolveChargedPaise({ quantity: 1 }).reason === 'amount-unknown',
    'an unknown AMOUNT is still reported as an amount problem, not a quantity one');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== THE SECOND ROUTE: this resolver runs on the device too ===');
// The device holds its own copy of the payout resolver, because it has to answer
// "what will this pay" before any backend response exists. That is legitimate.
// What is NOT legitimate is the two copies working from DIFFERENT INPUTS — and
// they were:
//
//   resolveChargedPaise reads six fields off the order. The backend's
//   TaskResponse sent three of them, and the device's own response mapper then
//   dropped a fourth. So the device resolver was deciding money questions with
//   half its evidence missing, and the two routes could not agree by construction.
//   The refund NUMBER survived only because displayRefundPaise prefers the
//   backend's figure — a guard added for an unrelated reason.
//
// This test needs no maintenance and that is the point: it reads the resolver's
// own inputs out of the source, so the next field added to it is checked
// automatically instead of being noticed a release later.
{
  const here = import.meta.dirname;
  const read = (...p) => fs.readFileSync(path.join(here, ...p), 'utf8');

  const resolver = read('chargedAmount.js');
  // Every `order.<field>` the resolver actually reads. Comments are stripped
  // first, so a field only MENTIONED in prose is not mistaken for an input.
  const code = resolver.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const inputs = [...new Set(
    [...code.matchAll(/\border\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]),
  )];
  ok(inputs.length >= 6, `the resolver reads ${inputs.length} fields off the order`);
  for (const f of ['unitPricePaise', 'lineTotalPaise', 'itemPaise', 'orderTotalPaise', 'quantity', 'itemAmountAmbiguous']) {
    ok(inputs.includes(f), `  input: ${f}`);
  }

  // What the BACKEND actually sends. Read from the mapper, not the interface: a
  // field declared and never assigned is a field that never arrives.
  const backend = read('..', 'backend', 'src', 'tasks', 'task.response.ts');
  // Anchored on the NEXT key rather than on a bare `: null,` — the block is full
  // of inner ternaries whose own `: null,` would end the match early and let a
  // dropped field pass. That very thing happened while writing this test.
  const sent = (backend.match(/order: task\.order\n[\s\S]*?\n\s*delivery:/) || [])[0] || '';
  ok(sent.length > 100, 'found the order block the backend actually sends');
  for (const f of inputs) {
    ok(new RegExp(`\\b${f}:`).test(sent),
      `the backend sends ${f}, which its own resolver's twin reads`);
  }

  // And what the device keeps when the authoritative response lands.
  const store = read('taskStore.js');
  const kept = (store.match(/order: tr\.order\n[\s\S]*?\n\s*delivery:/) || [])[0] || '';
  ok(kept.length > 100, 'found the order block the device keeps');
  for (const f of inputs) {
    ok(new RegExp(`\\b${f}:`).test(kept),
      `the device keeps ${f} instead of dropping it on arrival`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
