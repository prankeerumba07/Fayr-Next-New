// The displayed refund and the paid refund must be one number.
//
// Written after finding two defects of this exact shape on this exact figure:
// the backend computing the display from a listed price while paying the charged
// one, and the Task screen applying the percentage without the cap. Each of
// these cases is one of those going wrong again.

import { displayChargedPaise, displayRefundPaise, orderPriceLines } from './refund.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== 1. the backend\'s own number always wins ===');
{
  ok(displayRefundPaise({
    authoritativePaise: '32800', chargedPaise: 36700, percent: 100, capPaise: null,
  }) === 32800, 'the authoritative figure beats a local calculation that disagrees');
  ok(displayRefundPaise({ authoritativePaise: 0, chargedPaise: 36700, percent: 100 }) === 0,
    'a genuine ZERO from the backend is honoured, not treated as absent');
  ok(displayRefundPaise({ authoritativePaise: '0' }) === 0, 'as a string too');
}

console.log('\n=== 2. the fallback follows the backend arithmetic exactly ===');
{
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100 }) === 129900, '100% of the charged amount');
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 90 }) === 116910, '90%');
  // The backend floors: (itemPaise * pct) / 100n in bigint maths.
  ok(displayRefundPaise({ chargedPaise: 333, percent: 90 }) === 299,
    'the division FLOORS, matching the backend — 299, never 300');
}

console.log('\n=== 3. THE CAP — the defect this file was written for ===');
{
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100, capPaise: 50000 }) === 50000,
    'a cap below the percentage wins, exactly as min(base, cap) does backend-side');
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100, capPaise: '50000' }) === 50000,
    'a cap arriving as a paise STRING is still a cap');
  ok(displayRefundPaise({ chargedPaise: 40000, percent: 100, capPaise: 50000 }) === 40000,
    'a cap above the percentage changes nothing');
  // The zero-cap trap: typing 0 in the admin cap field stores a REAL zero cap,
  // so the backend pays nothing. The screen must say so rather than promise the
  // full percentage of an order that would pay ₹0.00.
  ok(displayRefundPaise({ chargedPaise: 129900, percent: 100, capPaise: 0 }) === 0,
    'a cap of ZERO is a real cap and the screen shows what would actually be paid');
}

console.log('\n=== 4. nothing is shown when nothing can honestly be shown ===');
{
  ok(displayRefundPaise({ chargedPaise: null, percent: 100 }) === null,
    'no charged amount (the quantity hold) -> no number, so the screen says a person will check');
  ok(displayRefundPaise({ chargedPaise: 1000, percent: null }) === null, 'no percentage');
  ok(displayRefundPaise({ chargedPaise: 1000, percent: 101 }) === null, 'an impossible percentage');
  ok(displayRefundPaise({}) === null, 'nothing at all');
  ok(displayRefundPaise(null) === null, 'null options');
  ok(displayRefundPaise({ authoritativePaise: 'not-a-number', chargedPaise: 1000, percent: 100 }) === 1000,
    'a malformed authoritative value falls back rather than showing garbage');
  ok(displayRefundPaise({ authoritativePaise: -5, chargedPaise: 1000, percent: 100 }) === 1000,
    'so does a negative one — money is never negative here');
  ok(displayRefundPaise({ chargedPaise: 1000.5, percent: 100 }) === null, 'a fractional paise amount');
}

console.log('\n=== 5. WHICH price the refund was worked out from ===');
{
  // The same rule, one level down. A staff-confirmed per-unit price is stored,
  // pays the refund, and was never sent to any client — so a user looking at a
  // staff-decided refund saw an amount with no price beside it, and the screen
  // had no way to say which figure it came from.
  //
  // The backend now answers that directly, and its answer wins, for exactly the
  // reason the refund figure's does: it is by definition the number the payout
  // used. The local resolver is the fallback for the moment before it arrives.
  ok(displayChargedPaise({ authoritativePaise: '49900', localPaise: 36700 }) === 49900,
    'the backend\'s basis beats a local one that disagrees');
  ok(displayChargedPaise({ authoritativePaise: '49900' }) === 49900,
    'and stands alone when the device could not work one out — the staff-amount case');
  ok(displayChargedPaise({ localPaise: 32800 }) === 32800,
    'the local figure shows before the first response lands');
  ok(displayChargedPaise({ authoritativePaise: 0, localPaise: 32800 }) === 0,
    'a genuine zero is honoured, not read as absent');
  ok(displayChargedPaise({}) === null, 'and nothing is shown when nothing is known');
  ok(displayChargedPaise(null) === null, 'null options');
  ok(displayChargedPaise({ authoritativePaise: 'junk', localPaise: 32800 }) === 32800,
    'a malformed authoritative value falls back rather than showing garbage');
  ok(displayChargedPaise({ localPaise: 1000.5 }) === null, 'a fractional paise amount is not a price');
  ok(displayChargedPaise({ localPaise: -1 }) === null, 'nor is a negative one');
}

console.log('\n=== 6. the price lines the order card shows ===');
{
  // A single unit: unchanged from what the screen always said.
  const one = orderPriceLines({ itemPaise: 32800, quantity: 1, basisPaise: 32800, orderTotalPaise: 32800 });
  ok(one.lineLabel === 'Item price' && one.linePaise === 32800, 'one unit is an item price');
  ok(one.perUnitPaise === null, 'and there is nothing extra to say about it');
  ok(one.cannotCompute === false, 'and it is computable');

  // THREE units. The line total used to be labelled "Item price" while the
  // refund was based on a third of it — the screen showing one number and the
  // payout using another.
  const three = orderPriceLines({ itemPaise: 129900, quantity: 3, basisPaise: 43300 });
  ok(three.lineLabel === 'Price for 3 units', 'a multi-unit line says how many units it covers');
  ok(three.linePaise === 129900, 'and shows the line as the line');
  ok(three.perUnitPaise === 43300, 'with the figure the refund is actually based on beside it');

  // THE STAFF-CONFIRMED AMOUNT. No item line exists at all — this is the Blinkit
  // and Meesho shape — and the card used to say the refund could not be computed.
  const staff = orderPriceLines({ itemPaise: null, quantity: null, basisPaise: 49900, orderTotalPaise: 60000 });
  ok(staff.cannotCompute === false,
    'a confirmed price means the refund CAN be computed, whatever the order page showed');
  ok(staff.linePaise === 49900, 'the price the refund comes from is shown');
  ok(staff.lineLabel === 'Price we refund from', 'labelled as what it is, not as an item price');
  ok(staff.orderAmountPaise === 60000, 'and the basket total is still shown, because it is real and different');

  // Quick-commerce before anyone has decided: a total only.
  const totalOnly = orderPriceLines({ orderTotalPaise: 60000 });
  ok(totalOnly.linePaise === null && totalOnly.orderAmountPaise === 60000,
    'a total on its own is shown as the order amount, never as a price to refund');
  ok(totalOnly.cannotCompute === false, 'and that is not a failure — nothing is claimed either way');

  // Nothing readable at all: the one case where the old sentence was true.
  const nothing = orderPriceLines({});
  ok(nothing.cannotCompute === true, 'with no figure anywhere, the card says so');
  ok(nothing.linePaise === null && nothing.orderAmountPaise === null, 'and shows no number');

  // A basis that equals the line is not printed twice.
  const same = orderPriceLines({ itemPaise: 43300, quantity: 3, basisPaise: 43300 });
  ok(same.perUnitPaise === null, 'the same figure is never shown twice on one card');

  ok(orderPriceLines({ itemPaise: 129900, quantity: 0, basisPaise: 1 }).lineLabel === 'Item price',
    'a nonsense quantity does not produce "Price for 0 units"');
  ok(orderPriceLines(null).cannotCompute === true, 'null options');
}

console.log('\n=== THE BILL IS NEVER THE PRODUCT’S PRICE ===');
{
  // ── THE OWNER'S OWN ORDER, MEASURED 16 SEPTEMBER 2026 ────────────────────
  //
  //     Lukzer | Heavy-Duty Metal Garment Rack ...     ₹938.00
  //     SR 2 PES ... Bathroom Corner Shelf ...         ₹388.00
  //     Grand Total:                                 ₹1,331.00
  //
  // This is the function that produced "Order amount ₹1,331.00" on the refund
  // screen for a product that cost ₹938.00: with no item line and no basis, the
  // last branch handed the BILL back as the order amount and the card printed it.
  const TWO = { matchedPricePaise: 93800, orderTotalPaise: 133100 };
  const two = orderPriceLines(TWO);

  ok(two.linePaise === 93800, `the product's own price is the line, found ${two.linePaise}`);
  ok(two.lineLabel === 'Item price', 'labelled as the item price');
  ok(two.orderAmountPaise === 133100, 'the bill is still shown, because it is real');
  ok(two.orderAmountLabel === 'Order total',
    `and named "Order total", never "Order amount" — found ${JSON.stringify(two.orderAmountLabel)}`);

  // ── THE RULE, WRITTEN OVER EVERY FIGURE THE CARD CAN SHOW ───────────────
  //
  // NO FIGURE THIS FUNCTION OFFERS AS A PRICE MAY EVER BE THE BILL on an order
  // holding more than one product. Written over the whole answer rather than
  // over the field we happen to suspect, so a field added later is held to it
  // without anybody remembering to come back here.
  for (const [field, value] of Object.entries(two)) {
    if (field === 'orderAmountPaise' || field === 'orderAmountLabel') continue;
    ok(value !== 133100, `${field} must never carry the whole bill, found ${value}`);
  }

  // AND A LABEL THAT SOUNDS LIKE THE AMOUNT MAY NEVER SIT ON THE BILL.
  ok(!/amount/i.test(String(two.orderAmountLabel)),
    'the bill is not labelled as an amount on a multi-product order');

  // ── THE BASIS STILL OUTRANKS IT, because the basis is what the money uses ──
  const settled = orderPriceLines({ ...TWO, basisPaise: 93800 });
  ok(settled.linePaise === 93800 && settled.lineLabel === 'Price we refund from',
    'a settled basis is what the card leads with');
  ok(settled.orderAmountPaise === 133100 && settled.orderAmountLabel === 'Order total',
    'and the bill is still beside it, named');

  // ── AND A REAL ITEM LINE STILL OUTRANKS BOTH ───────────────────────────
  const withLine = orderPriceLines({ ...TWO, itemPaise: 93800, quantity: 1 });
  ok(withLine.linePaise === 93800, 'a real item line is used as it always was');

  // ── ONE PRODUCT: NOTHING IS SEPARATED, BECAUSE THERE IS NOTHING TO ─────
  const one = orderPriceLines({ matchedPricePaise: 49900, orderTotalPaise: 49900 });
  ok(one.linePaise === 49900, 'the product price is shown');
  ok(one.orderAmountPaise === null,
    'and the identical bill is not printed a second time');
  ok(one.orderAmountLabel === null, 'with no label for a row that is not there');

  // ── QUICK COMMERCE IS UNTOUCHED, AND THAT IS DELIBERATE ────────────────
  //
  // Blinkit and Instamart publish a basket total and no per-item price at all,
  // so the total really IS the only amount there is and calling it the order
  // amount is honest. The pin above in this file asserts that shape; this says
  // it is still reached, which is only true because the new branch is keyed on a
  // product price that quick commerce never has.
  const basket = orderPriceLines({ orderTotalPaise: 60000 });
  ok(basket.orderAmountPaise === 60000 && basket.linePaise === null,
    'a basket total is still the order amount');
  ok(basket.orderAmountLabel === 'Order amount',
    'and is still called one, because on that shape it is one');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
