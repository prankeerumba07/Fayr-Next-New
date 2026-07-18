// Proves the name+amount matcher picks the campaign product out of a real order
// history, when Fayr has ONLY the campaign's short name + expected amount (no
// product id — the user searches and buys the product themselves). Covers: the
// short-campaign-name vs long-marketplace-title shape, amount disambiguation of
// two same-family products, price-drift tolerance, ambiguity flagging, and the
// no-name-available (id-less) miss.

import { matchOrderByNameAmount } from './verify.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// Marketplace order history: long verbose titles, real-ish prices.
const history = [
  { product: 'boAt Airdopes 141 Bluetooth Truly Wireless in Ear Earbuds with 42H Playtime, Beast Mode', itemAmount: 1299, orderId: 'A' },
  { product: 'Roadster Men Blue Slim Fit Solid Casual Shirt Pure Cotton', itemAmount: 799, orderId: 'B' },
  { product: 'Prestige Iris 750W Mixer Grinder with 3 Stainless Steel Jars', itemAmount: 2499, orderId: 'C' },
];

console.log('=== short campaign name matches the long marketplace title ===');
{
  const r = matchOrderByNameAmount({ product: 'boAt Airdopes 141', amount: 1299 }, history);
  ok(r.order && r.order.orderId === 'A', 'picks the Airdopes order');
  ok(r.amountOk === true, 'amount corroborates (1299 == 1299)');
  ok(r.ambiguous === false, 'unambiguous');
}

console.log('\n=== amount disambiguates two same-family products ===');
{
  const twoBoats = [
    { product: 'boAt Airdopes 141 Wireless Earbuds', itemAmount: 1299, orderId: 'A1' },
    { product: 'boAt Airdopes 161 Wireless Earbuds', itemAmount: 1499, orderId: 'A2' },
  ];
  // Campaign is the 141 at 1299 — amount separates it from the 161 at 1499.
  const r = matchOrderByNameAmount({ product: 'boAt Airdopes 141', amount: 1299 }, twoBoats);
  ok(r.order.orderId === 'A1', 'amount + the "141" token pick the right one');
}

console.log('\n=== small price drift is tolerated (marketplace prices move) ===');
{
  const r = matchOrderByNameAmount({ product: 'Roadster Blue Casual Shirt', amount: 799 }, [
    { product: 'Roadster Men Blue Slim Fit Solid Casual Shirt', itemAmount: 819, orderId: 'B' }, // +20, within 5%
  ]);
  ok(r.order && r.order.orderId === 'B', 'still matches on name');
  ok(r.amountOk === true, '₹20 drift on ₹799 (5% = ₹40) is within tolerance');
}

console.log('\n=== a cheaper look-alike variant is flagged, not silently accepted ===');
{
  const r = matchOrderByNameAmount({ product: 'Prestige Iris 750W Mixer Grinder', amount: 2499 }, [
    { product: 'Prestige Iris 500W Mixer Grinder 2 Jars', itemAmount: 1599, orderId: 'C2' }, // wrong variant, ₹900 off
  ]);
  ok(r.order && r.order.orderId === 'C2', 'name still matches (same family)…');
  ok(r.amountOk === false, '…but amount FAILS — the "is this your order?" screen must warn');
}

console.log('\n=== two indistinguishable candidates -> ambiguous (send to the human) ===');
{
  const dupes = [
    { product: 'boAt Airdopes 141 Wireless Earbuds', itemAmount: 1299, orderId: 'D1', orderDate: 100 },
    { product: 'boAt Airdopes 141 Wireless Earbuds TWS', itemAmount: 1299, orderId: 'D2', orderDate: 200 },
  ];
  const r = matchOrderByNameAmount({ product: 'boAt Airdopes 141', amount: 1299 }, dupes);
  ok(r.ambiguous === true, 'both match name AND amount -> ambiguous flag set');
  ok(r.order.orderId === 'D2', 'tie-breaks to the most recent, but flagged for confirmation');
}

console.log('\n=== no name in the order (id-less) -> no match, honest miss ===');
{
  const r = matchOrderByNameAmount({ product: 'boAt Airdopes 141', amount: 1299 }, [
    { itemAmount: 1299, orderId: 'X' }, // amount matches but nothing to match the name on
  ]);
  ok(r.order == null && r.candidateCount === 0, 'amount alone is not enough to claim a match');
}

console.log('\n=== name matches but no amount on the campaign -> matches on name alone ===');
{
  const r = matchOrderByNameAmount({ product: 'Prestige Iris 750W Mixer Grinder' }, history);
  ok(r.order && r.order.orderId === 'C', 'matches on name');
  ok(r.amountOk === null, 'amountOk null when there is no amount to check (Myntra paid-price gap)');
}

console.log('\n=== unrelated product -> no false positive ===');
{
  const r = matchOrderByNameAmount({ product: 'Sony WH-1000XM5 Headphones', amount: 29990 }, history);
  ok(r.order == null, 'nothing in history is this product');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
