// The order, field by field, without a phone.
//
// The thing worth proving hardest: a row we do not hold says so. The design writes
// an order number and an order date into the screen, and this file is why the app
// can never do that.
import {
  agreeCount, agreeLabel, comparisonRows, howManyKnown, money, orderDate,
  orderDetailRows, readFrom, orderDay,
} from './orderDetails.js';
// The device's own rebuild of a server response cannot be IMPORTED here — it
// reaches expo-file-system, which plain node will not load — so section 10 reads
// it the way src/chargedAmount.test.mjs already reads it: out of its own source.
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/** A moment in local time, so these checks read the same in every time zone. */
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0, 0).getTime();

/**
 * ONE ROW BY ITS LABEL, OR A SHAPE THAT FAILS INSTEAD OF THROWING.
 *
 * A row that has gone missing is a FAILURE, not a crash. Reading `.value` off
 * `undefined` throws, and a throw here kills every section after it and leaves
 * no summary — which is exactly how a mutation that deleted the bill row read as
 * "the checks crashed" instead of "the checks caught it". The repository has
 * been bitten by that shape before; see a-crash-is-not-a-failing-check.
 */
const rowNamed = (rows, label) =>
  rows.find((r) => r.label === label)
  || { label, value: `NO ROW LABELLED ${label}`, known: false, note: null };

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

console.log('=== 6. the day the shop printed, when that is all there is ===');
{
  // MEASURED ON THE OWNER'S OWN TASK, 16 September 2026. "Order date: Not
  // available" beside an order whose page says 2 June — a day that had been
  // read, written down and shown to staff, and withheld from the one person
  // whose order it actually was.
  //
  // THE SERVER'S RULE IS NOT WEAKENED TO FIX IT. A shop prints a DAY; the time
  // to buy after claiming is measured in minutes; so the instant is still left
  // off rather than invented. This shows the day that was always on the record.
  const dayOnly = orderDetailRows({
    order: { id: 'X', date: null, dateRaw: '2026-06-02' },
  }).find((r) => r.label === 'Order date');
  ok(dayOnly.value === '2 Jun 2026',
    `the day is shown, found ${JSON.stringify(dayOnly.value)}`);

  // A FALLBACK AND NEVER A REPLACEMENT. An order precise enough to have been
  // tested against the purchase window shows the thing that was tested.
  const precise = at(2026, 6, 2);
  const both = orderDetailRows({
    order: { id: 'X', date: precise, dateRaw: '2026-01-01' },
  }).find((r) => r.label === 'Order date');
  ok(both.value === orderDate(precise),
    `the instant wins, found ${JSON.stringify(both.value)}`);

  // AND AN ORDER THAT REALLY STATED NO DATE STILL SAYS SO. The whole point of
  // this file is that a row Fayr does not hold is not invented.
  const neither = orderDetailRows({
    order: { id: 'X', date: null, dateRaw: null },
  }).find((r) => r.label === 'Order date');
  ok(neither.known === false, 'no date read still reads as nothing');

  for (const bad of ['2026-13-02', 'yesterday', '02/06/2026', '', '2026-06', null, 7]) {
    ok(orderDay(bad) === null, `refused ${JSON.stringify(bad)}`);
  }
}

console.log('\n=== 9. THE AMOUNT ROW IS THE PRODUCT, NEVER THE BILL ===');
{
  // ── THE OWNER'S OWN ORDER, MEASURED 16 SEPTEMBER 2026 ────────────────────
  //
  //     Lukzer | Heavy-Duty Metal Garment Rack ...     ₹938.00
  //     SR 2 PES ... Bathroom Corner Shelf ...         ₹388.00
  //     Grand Total:                                 ₹1,331.00
  //
  // The offer is the garment rack. The screen printed ₹1,331.00. A figure on a
  // refund screen that is LARGER than what the product cost is the wrong
  // direction to be wrong in, and ₹1,331 is not the amount of anything Fayr pays.
  const TWO_PRODUCTS = {
    order: {
      id: '408-1509645-3524313',
      matchedPricePaise: 93800,
      orderTotalPaise: 133100,
      product: 'Lukzer | Heavy-Duty Metal Garment Rack',
    },
  };
  const rows = orderDetailRows(TWO_PRODUCTS);
  const by = (label) => rowNamed(rows, label);

  ok(by('Order amount').value === '₹938.00',
    `the product's own price is the amount, found ${JSON.stringify(by('Order amount').value)}`);
  ok(by('Order total').value === '₹1,331.00',
    `the bill is its own row, under its own name, found ${JSON.stringify(by('Order total').value)}`);

  // ── AND ITS NOTE CLAIMS ONLY WHAT IS ALWAYS TRUE ──────────────────────
  //
  // It said "not just the product this offer is for", which is right for an
  // order holding two products and WRONG for one holding three of the same
  // thing — there the shown figure is the PER-UNIT price and the bill differs
  // because of the count, not because of anything else in the basket.
  ok(!/not just the product/i.test(by('Order total').note || ''),
    'the bill row does not assert other products');
  ok(/Everything charged on this order/.test(by('Order total').note || ''),
    'it says what is always true instead');
  ok(/not from this/.test(by('Order total').note || ''),
    'and says the refund does not come from it');

  // THE MULTI-UNIT ORDER, which is where the old wording was a lie: one
  // product, three of it, so the bill is three times the per-unit price.
  const threeOfThem = orderDetailRows({
    order: {
      id: 'M', lineTotalPaise: 281400, quantity: 3, orderTotalPaise: 281400,
    },
  });
  const perUnitRow = rowNamed(threeOfThem, 'Order amount');
  const billOfThree = rowNamed(threeOfThem, 'Order total');
  ok(perUnitRow.value === '₹938.00',
    `the per-unit price is shown, found ${perUnitRow.value}`);
  ok(!/not just the product/i.test(billOfThree.note || ''),
    'and the bill row still asserts nothing about other products');
  ok(/still has to settle/.test(by('Order amount').note || ''),
    'and it says the refund amount is not settled by this figure');

  // ── THE CHECK THE OWNER ASKED FOR, STATED AS A RULE ─────────────────────
  //
  // NO ROW THAT NAMES AN AMOUNT MAY EVER CARRY THE BILL, on an order holding
  // more than one product. Written over every row rather than over the one we
  // happen to suspect, so a row added later is held to it without anybody
  // remembering to come back here.
  const bill = '₹1,331.00';
  for (const r of rows) {
    if (r.label === 'Order total') continue;
    ok(r.value !== bill,
      `"${r.label}" must never carry the whole bill, found ${JSON.stringify(r.value)}`);
  }

  // AND IT HOLDS WHATEVER ELSE IS ON THE ORDER. The same order with the amount
  // already settled shows the settled figure, still never the bill.
  const settled = orderDetailRows({
    order: { ...TWO_PRODUCTS.order, unitPricePaise: 93800 },
  });
  for (const r of settled) {
    if (r.label === 'Order total') continue;
    ok(r.value !== bill, `settled: "${r.label}" must never carry the whole bill`);
  }
  ok(rowNamed(settled, 'Order amount').value === '₹938.00',
    'a settled amount is still the product, not the bill');

  // ── AND A ONE-PRODUCT ORDER GAINS NOTHING IT DID NOT HAVE ──────────────
  //
  // The bill and the product are the same number, so there is nothing to
  // separate and no second row. Five rows, exactly as before.
  const single = orderDetailRows({
    order: { id: 'X', matchedPricePaise: 49900, orderTotalPaise: 49900 },
  });
  ok(single.length === 5, `one product, five rows, found ${single.length}`);
  ok(rowNamed(single, 'Order amount').value === '₹499.00',
    'and the one figure is shown once');

  // ── QUICK COMMERCE IS UNTOUCHED ────────────────────────────────────────
  //
  // A basket total and no per-product price anywhere. The resolver refuses it
  // and always did; nothing here invents a product price out of a basket.
  const basket = orderDetailRows({ order: { id: 'Z', orderTotalPaise: 36800 } });
  ok(rowNamed(basket, 'Order amount').known === false,
    'a basket total is still not a product price');
  ok(!/\d/.test(rowNamed(basket, 'Order amount').value),
    'and no number is shown for it');
}

console.log('\n=== 10. THE WHOLE CHAIN, FROM WHAT THE SERVER SENDS TO THE ROW ===');
{
  // ── WHY THIS IS CHECKED IN THREE PIECES AND NOT ONE ─────────────────────
  //
  // The chain crosses two runtimes and a module this file cannot load:
  //
  //   1. the stored row → the response          proved for real, against a real
  //                                             database, in the backend's own
  //                                             end-to-end checks (see
  //                                             orders-found.e2e-spec.ts, "the
  //                                             day and the product's price
  //                                             reach the screen").
  //   2. the response → the device's task       PROVED HERE, by reading
  //                                             taskStore.js. It cannot be
  //                                             imported — it reaches
  //                                             expo-file-system, which plain
  //                                             node will not load — and this is
  //                                             the same way chargedAmount's six
  //                                             inputs are already checked.
  //   3. the device's task → the rendered row   PROVED HERE, by running it.
  //
  // Piece 2 is the one that mattered: engineTaskFromResponse does NOT pass the
  // order through, it rebuilds it field by field, so a field nobody lists
  // silently does not exist on the device however well the server carries it.
  // `dateRaw` and `matchedPricePaise` both died exactly there, as `quantity`,
  // `match`, `image` and `statusText` each did before them.
  const store = readFileSync(new URL('../taskStore.js', import.meta.url), 'utf8');
  const kept = (store.match(/order: tr\.order\n[\s\S]*?\n\s*delivery:/) || [])[0] || '';
  ok(kept.length > 100, 'found the order block the device keeps');
  for (const f of ['dateRaw', 'matchedPricePaise']) {
    ok(new RegExp(`\\b${f}:`).test(kept),
      `the device keeps ${f} instead of dropping it on arrival`);
  }

  // ── AND THE SAME SHAPE, RENDERED ───────────────────────────────────────
  //
  // The owner's own task as the server sends it: no instant precise enough to
  // test against the purchase window, a day that was read, and two products.
  const onTheDevice = {
    id: '408-1509645-3524313',
    date: null,
    dateRaw: '2026-06-02',
    itemPaise: null,
    unitPricePaise: null,
    lineTotalPaise: null,
    quantity: null,
    orderTotalPaise: 133100,
    matchedPricePaise: 93800,
    itemAmountAmbiguous: false,
    product: 'Lukzer | Heavy-Duty Metal Garment Rack',
    source: 'order-history',
  };
  const rendered = orderDetailRows({ order: onTheDevice });
  const by = (label) => rowNamed(rendered, label);

  ok(by('Order date').value === '2 Jun 2026',
    `the date renders, found ${JSON.stringify(by('Order date').value)}`);
  ok(by('Order date').known === true, 'and reads as something we know');
  ok(by('Order amount').value === '₹938.00',
    `the amount renders as the product, found ${JSON.stringify(by('Order amount').value)}`);
  ok(by('Order total').value === '₹1,331.00',
    `and the bill is beside it, named, found ${JSON.stringify(by('Order total').value)}`);

  // AND THE ROW THE OWNER ACTUALLY SAW IS GONE. "Not available" for a date the
  // page stated, and the bill standing in for the product's price.
  ok(by('Order date').value !== null && by('Order date').known,
    'no "Not available" for an order whose page stated a date');
  ok(by('Order amount').value !== '₹1,331.00', 'and the bill is not the amount');

  // ── AND THE OTHER SCREEN, WHICH IS THE ONE HE WAS LOOKING AT ───────────
  //
  // TaskScreen does not use this module at all — it draws its own rows — so
  // everything above could be right while the screen the owner opened was still
  // wrong. It cannot be imported here either (it is React Native), so it is
  // read, the same way taskStore is read above.
  //
  // BOTH HALVES OF THE DATE FIX HAD TO LAND. taskStore dropping dateRaw and
  // TaskScreen having no fallback for it are two separate breaks, and fixing
  // either one alone leaves "Not available" on the screen.
  const screen = readFileSync(new URL('../TaskScreen.js', import.meta.url), 'utf8');
  ok(/fmtDate\(task\.order\.date\) \|\| orderDay\(task\.order\.dateRaw\)/.test(screen),
    'TaskScreen falls back to the day the shop printed');
  ok(/import \{ orderDay \} from '\.\/ui\/orderDetails'/.test(screen),
    'and it uses the one day formatter rather than growing a second');
  // AND ITS AMOUNT ROW IS NAMED BY THE HELPER, not hard-coded — the label is
  // what stops a bill reading as an amount, so it cannot be a literal.
  ok(!/label="Order amount"/.test(screen),
    'no row is hard-labelled "Order amount" any more');
  ok(/label=\{prices\.orderAmountLabel \|\| 'Order amount'\}/.test(screen),
    'the label comes from the helper that knows which figure it is');
  ok(/matchedPricePaise: task\.order \? task\.order\.matchedPricePaise : null/.test(screen),
    'and the product’s own price is handed to it');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
