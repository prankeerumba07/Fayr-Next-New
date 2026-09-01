// The order, field by field, without a phone.
//
// The thing worth proving hardest: a row we do not hold says so. The design writes
// an order number and an order date into the screen, and this file is why the app
// can never do that.
import {
  agreeCount, agreeLabel, comparisonRows, howManyKnown, money, orderDate,
  orderDetailRows, readFrom,
} from './orderDetails.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/** A moment in local time, so these checks read the same in every time zone. */
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0, 0).getTime();

console.log('=== 1. the five rows, in the design’s order ===');
{
  const rows = orderDetailRows({});
  ok(rows.length === 5, `five rows, found ${rows.length}`);
  ok(JSON.stringify(rows.map((r) => r.label)) === JSON.stringify([
    'Order ID', 'Order amount', 'Order date', 'Product name', 'Marketplace',
  ]), 'the design’s four, then the marketplace the owner asked for');
}

console.log('\n=== 2. NOTHING IS EVER INVENTED ===');
{
  for (const nothing of [undefined, null, {}, { order: null }, { order: 'nope' },
                         { order: {} }, 'rubbish', 42]) {
    const rows = orderDetailRows(nothing);
    ok(rows.length === 5, `five rows for ${JSON.stringify(nothing)}`);
    for (const r of rows) {
      ok(typeof r.value === 'string' && r.value.length > 0,
        `${r.label}: says something`);
      ok(!/undefined|null|NaN|\[object/.test(r.value),
        `${r.label}: and nothing missing reaches the screen`);
    }
    ok(howManyKnown(rows) === 0, 'and none of them claims to be known');
  }
  ok(howManyKnown(null) === 0, 'a list that is not a list counts nothing');
}

console.log('\n=== 3. a real order fills every row ===');
{
  const rows = orderDetailRows({
    order: {
      id: '402-3925017-7784521',
      unitPricePaise: 132600,
      date: at(2026, 7, 2),
      product: 'Prestige induction cooktop',
    },
    shopName: 'Amazon',
  });
  const by = {};
  for (const r of rows) by[r.label] = r;
  ok(by['Order ID'].value === '402-3925017-7784521', 'the order number, as it is');
  ok(by['Order amount'].value === '₹1,326.00', 'the amount, grouped the Indian way');
  ok(by['Order date'].value === '2 Jul 2026', 'the date, in plain words');
  ok(by['Product name'].value === 'Prestige induction cooktop', 'the product');
  ok(by['Marketplace'].value === 'Amazon', 'and the shop');
  ok(howManyKnown(rows) === 5, 'all five known');
  for (const r of rows) ok(r.known === true, `${r.label} is marked known`);
}

console.log('\n=== 4. THE AMOUNT GOES THROUGH THE ONE RESOLVER ===');
{
  // A stated per-unit price wins. This is the resolver's rule, not this file's.
  const unit = orderDetailRows({ order: { unitPricePaise: 29520, lineTotalPaise: 59040 } });
  ok(unit[1].value === '₹295.20', 'a stated unit price is the figure shown');

  // Flipkart's listed line above the order total: the total is what was charged.
  // A line figure needs a stated count as well, because a line carries as many
  // units as were bought — the resolver's rule, and the reason this row is empty
  // far more often than it is full.
  const discounted = orderDetailRows({
    order: { lineTotalPaise: 36700, orderTotalPaise: 32800, quantity: 1 },
  });
  ok(discounted[1].value === '₹328.00',
    'a line above the order total shows the total, which is what was paid');

  // The same order with no stated count shows NO figure. This is the resolver
  // refusing to guess, and the row has to refuse with it.
  const noCount = orderDetailRows({
    order: { lineTotalPaise: 36700, orderTotalPaise: 32800 },
  });
  ok(noCount[1].known === false, 'a line total with no count shows no figure');

  // And where the resolver refuses, the row refuses too rather than guessing.
  const refused = orderDetailRows({
    order: {
      lineTotalPaise: 100000, orderTotalPaise: 10000, itemAmountAmbiguous: true,
    },
  });
  ok(refused[1].known === false, 'where a person has to decide, no figure is shown');
  ok(/person at Fayr/.test(String(refused[1].note)),
    'and the row says who decides');
  ok(!/\d/.test(refused[1].value), 'with no number anywhere in it');

  // Two units on one line: the refund is for ONE of them.
  const two = orderDetailRows({
    order: { lineTotalPaise: 59040, orderTotalPaise: 59040, quantity: 2 },
  });
  ok(two[1].value === '₹295.20', 'two on a line shows the price of one');
}

console.log('\n=== 5. the product name falls back to the offer, never to nothing ===');
{
  const rows = orderDetailRows({ order: { id: 'o1' }, productName: 'Nike Revolution 7' });
  ok(rows[3].value === 'Nike Revolution 7',
    'an order with no product name uses the offer’s');
  const both = orderDetailRows({
    order: { id: 'o1', product: 'What the shop calls it' },
    productName: 'What the offer calls it',
  });
  ok(both[3].value === 'What the shop calls it',
    'and the SHOP’s name wins when there is one, because that is what was bought');
}

console.log('\n=== 6. money and dates on their own ===');
{
  ok(money(0) === '₹0.00', 'nothing is ₹0.00, not blank');
  ok(money(5) === '₹0.05', 'five paise');
  ok(money(100000) === '₹1,000.00', 'a thousand rupees is grouped');
  ok(money(12345678) === '₹1,23,456.78', 'and a big number is grouped the Indian way');
  for (const bad of [null, undefined, 1.5, '100', NaN, {}]) {
    ok(money(bad) === null, `${JSON.stringify(bad)} is not money`);
  }
  ok(orderDate(at(2026, 1, 1)) === '1 Jan 2026', 'the first of January');
  for (const bad of [null, undefined, 'yesterday', NaN, {}]) {
    ok(orderDate(bad) === null, `${JSON.stringify(bad)} is not a date`);
  }
}

console.log('\n=== 7. where the details came from ===');
{
  ok(readFrom('email').label === 'Read from your order email', 'the inbox');
  ok(/screenshot/.test(readFrom('ocr').label), 'a screenshot');
  ok(/screenshot/.test(readFrom('screenshot').label), 'and its other name');
  ok(/on the shop/.test(readFrom('scrape').label), 'the reader on this device');
  for (const unknown of [undefined, null, '', 'something-new', 7]) {
    const r = readFrom(unknown);
    ok(typeof r.label === 'string' && r.label.length > 5 && !/undefined/.test(r.label),
      `${JSON.stringify(unknown)} still reads as a sentence`);
    ok(typeof r.icon === 'string' && r.icon.length > 0, 'and still has an icon');
  }
}

console.log('\n=== 8. THE FIELD BY FIELD COMPARISON, PASSED THROUGH UNTOUCHED ===');
{
  const fromServer = [
    { field: 'orderId', label: 'Order ID', fromScreenshot: '402-1', fromOrder: '402-1', agree: true },
    { field: 'amount', label: 'Order amount', fromScreenshot: '₹999.00', fromOrder: '₹1,299.00', agree: false },
    { field: 'orderDate', label: 'Order date', fromScreenshot: null, fromOrder: '2026-07-02', agree: null },
  ];
  const rows = comparisonRows(fromServer);
  ok(rows.length === 3, 'three rows in, three rows out');
  ok(rows[0].agree === true && rows[1].agree === false && rows[2].agree === null,
    'and the verdicts are the server’s, not recomputed');
  ok(rows[1].fromScreenshot === '₹999.00' && rows[1].fromOrder === '₹1,299.00',
    'both values come through');
  ok(rows[2].fromScreenshot === null, 'and a missing side stays missing');

  // NOTHING IS RECOMPUTED. A second opinion about whether two values agree is how
  // a screen ends up contradicting the server, so a row that says "agree" while
  // showing two different values is passed through exactly as sent.
  const contradictory = comparisonRows([
    { field: 'amount', label: 'Order amount', fromScreenshot: '₹1.00', fromOrder: '₹2.00', agree: true },
  ]);
  ok(contradictory[0].agree === true,
    'the server’s verdict wins even when it looks odd, because it is the server’s');

  for (const nothing of [undefined, null, [], 'rows', 42, {}, [null], [{}], [7]]) {
    ok(comparisonRows(nothing) === null,
      `${JSON.stringify(nothing)} is no comparison at all`);
  }
  // A row with an odd verdict is read as "could not compare", never as agreement.
  const odd = comparisonRows([
    { field: 'amount', label: 'Order amount', fromScreenshot: 'x', fromOrder: 'y', agree: 'yes' },
  ]);
  ok(odd[0].agree === null, 'a verdict that is not true or false is not agreement');

  const counted = agreeCount(rows);
  ok(counted.agree === 1 && counted.compared === 2 && counted.total === 3,
    'the counts are honest: one agrees, two could be compared, three rows');
  ok(agreeCount(null).total === 0, 'and nothing counts as nothing');

  ok(agreeLabel(true) === 'These match', 'a match is said in words');
  ok(agreeLabel(false) === 'These do not match', 'and so is a mismatch');
  ok(/Nothing to compare/.test(agreeLabel(null)),
    'and a row we could not compare says exactly that, not that it failed');
  for (const odd2 of [undefined, 'yes', 1, {}]) {
    ok(agreeLabel(odd2) === 'Nothing to compare',
      `${JSON.stringify(odd2)} reads as nothing to compare`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
