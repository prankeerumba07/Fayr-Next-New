// Refunds are based on the amount ACTUALLY CHARGED, never a listed price.
// Cases built from the REAL live records, not invented numbers.
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
const heels = resolveChargedPaise({ itemPaise: 36700, orderTotalPaise: 32800, itemAmountAmbiguous: false });
ok(heels.paise === 32800, 'heels: pays the ₹328 charged, NOT the ₹367 listed');
ok(heels.basis === 'order-total-lower', 'basis records that the total won');
ok(heels.needsStaff === false, 'a normal discount is payable without staff');

console.log('=== AMAZON: a merged cart must NOT drag the refund up ===');
// Real example from the taskflow comment: order 408-1509645-3524313 totals
// 1326.00 across items of 388.00 and 938.00.
const merged = resolveChargedPaise({ itemPaise: 38800, orderTotalPaise: 132600 });
ok(merged.paise === 38800, 'merged cart: pays the ₹388 item, not the ₹1326 total');
ok(merged.basis === 'item-price', 'basis = item-price when the total is higher');
// The old rule (always itemPaise) got this same answer — proving the change is
// not a regression for Amazon, only a new floor for Flipkart-shaped data.
ok(merged.paise === 38800, 'unchanged from the previous itemPaise-only behaviour');

console.log('=== equal figures: single-item order, no discount ===');
const equal = resolveChargedPaise({ itemPaise: 14300, orderTotalPaise: 14300 });
ok(equal.paise === 14300 && equal.basis === 'item-price', 'total == item -> item price');

console.log('=== only an item price (no total to cross-check) ===');
const itemOnly = resolveChargedPaise({ itemPaise: 14300, orderTotalPaise: null });
ok(itemOnly.paise === 14300, 'item stands alone when there is no total');
ok(itemOnly.basis === 'item-price-only', 'basis says it was uncorroborated');

console.log('=== QUICK-COMMERCE: a bare order total is NEVER auto-paid ===');
// Blinkit flower pot: total ₹604 covering a multi-item order, no per-item price.
const blinkit = resolveChargedPaise({ itemPaise: null, orderTotalPaise: 60400, itemAmountAmbiguous: true });
ok(blinkit.paise === null, 'no item price -> no auto payout, even with a total present');
ok(blinkit.needsStaff === true && blinkit.reason === 'amount-unknown', 'routed to staff, reason preserved');
// Instamart razor: no amount at all.
const instamart = resolveChargedPaise({ itemPaise: null, orderTotalPaise: null });
ok(instamart.needsStaff === true, 'no amounts at all -> staff');

console.log('=== the two cases we refuse to guess ===');
const amb = resolveChargedPaise({ itemPaise: 36700, orderTotalPaise: 32800, itemAmountAmbiguous: true });
ok(amb.paise === null && amb.reason === 'item-price-above-total-and-ambiguous',
  'item above total AND flagged ambiguous -> staff, not a coin flip');
const wild = resolveChargedPaise({ itemPaise: 500000, orderTotalPaise: 20000 });
ok(wild.paise === null && wild.reason === 'amount-gap-implausible',
  '₹5000 item vs ₹200 charged is not a coupon -> staff');
// Boundary: exactly half is still implausible-adjacent but allowed through.
const half = resolveChargedPaise({ itemPaise: 20000, orderTotalPaise: 10000 });
ok(half.paise === 10000, 'exactly 50% off is payable (total*2 == item, not < item)');
const justUnder = resolveChargedPaise({ itemPaise: 20001, orderTotalPaise: 10000 });
ok(justUnder.paise === null, 'a hair past 50% off tips into staff review');

console.log('=== never returns a figure above what was charged ===');
for (const [item, total] of [[36700, 32800], [38800, 132600], [14300, 14300], [20000, 10000]]) {
  const r = resolveChargedPaise({ itemPaise: item, orderTotalPaise: total });
  ok(r.paise == null || r.paise <= Math.max(total, 0), `min-invariant holds for item=${item} total=${total}`);
  ok(r.paise == null || r.paise <= item, `never exceeds the item price either (item=${item})`);
}

console.log('=== defensive: missing/absent order ===');
ok(resolveChargedPaise(null).needsStaff === true, 'null order -> staff, never a crash');
ok(resolveChargedPaise(undefined).paise === null, 'undefined order -> null paise');
ok(resolveChargedPaise({}).reason === 'amount-unknown', 'empty order -> amount-unknown');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
