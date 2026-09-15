// The four facts on an "is this your order?" card.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  amountInWords, dayInWords, orderCardRows, productInWords,
} from './orderCard.js';

let checks = 0;
const eq = (a, b, what) => { checks += 1; assert.deepStrictEqual(a, b, what); };
const ok = (c, what) => { checks += 1; assert.ok(c, what); };

// ── 1. the owner's four rows, in his own order ───────────────────────────────
const ORDER = {
  orderNumber: 'SOSIJGGRL26770',
  orderDate: '2026-08-21',
  totalPaise: '36800',
  items: [
    { name: 'Boldfit Strapless Sports Headband', pricePaise: '14900' },
    { name: 'Hammer Nova earphones', pricePaise: '21900' },
  ],
};
const rows = orderCardRows(ORDER);
eq(rows.map((r) => r.label), ['Order number', 'Order date', 'Amount', 'Product'],
  'four rows, in the order the owner listed them');
eq(rows.length, 4, 'four and no more');
eq(rows[0].value, 'SOSIJGGRL26770', 'the order number as the shop wrote it');
eq(rows[1].value, '21 August 2026', 'the day in words a person says out loud');
eq(rows[2].value, '₹368', 'the amount in rupees');
eq(rows[3].value, 'Boldfit Strapless Sports Headband and 1 more thing',
  'the first product and how many more');
for (const r of rows) eq(r.known, true, 'every row was really read');

// ── 2. a day, written out and never as a code ────────────────────────────────
eq(dayInWords('2026-08-21'), '21 August 2026', 'a day in words');
eq(dayInWords('2026-01-01'), '1 January 2026', 'no leading zero on the day');
eq(dayInWords('2026-12-31'), '31 December 2026', 'the last day of the year');
// No short codes. The owner's rule about words applies to dates too.
for (const day of ['2026-08-21', '2026-01-01']) {
  const said = dayInWords(day);
  ok(!/\//.test(said), 'no slashes in a date a person reads');
  ok(!/^\d+\.\d/.test(said), 'no dots either');
}
for (const junk of [null, undefined, '', 'yesterday', '21/08/2026', '2026-13-01', 5, {}]) {
  eq(dayInWords(junk), null, 'anything unreadable is null, never a guess');
}

// ── 3. money, in whole rupees ────────────────────────────────────────────────
eq(amountInWords('14900'), '₹149', 'paise become rupees');
eq(amountInWords('132600'), '₹1,326', 'and are grouped the Indian way');
eq(amountInWords('0'), '₹0', 'a real zero is a real zero');
eq(amountInWords(36800), '₹368', 'a number works as well as text');
for (const junk of [null, undefined, '', 'lots', '14.9', '-100', {}, []]) {
  eq(amountInWords(junk), null, 'anything that is not a whole number of paise is null');
}

// ── 4. what was on the order ─────────────────────────────────────────────────
eq(productInWords([{ name: 'One Thing' }]), 'One Thing', 'one product is its name');
eq(productInWords([{ name: 'A' }, { name: 'B' }]), 'A and 1 more thing',
  'two products name the first and count the rest');
eq(productInWords([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'A and 2 more things',
  'and the counting reads correctly for more than one');
eq(productInWords([], 'The offer’s product'), 'The offer’s product',
  'with nothing read, the offer’s own product name stands in');
eq(productInWords([]), null, 'and with nothing at all it is null');
eq(productInWords([{ name: '  ' }, { name: 'Real' }]), 'Real',
  'an empty name is not a product');
for (const junk of [null, undefined, 'a product', 5, {}]) {
  eq(productInWords(junk), null, 'anything that is not a list is null');
}

// ── 5. A MISSING VALUE IS SAID, NEVER LEFT BLANK ─────────────────────────────
// Somebody deciding whether an order is theirs has to know which parts we could
// not read. A blank row reads as a mistake in the app.
const empty = orderCardRows({});
eq(empty.length, 4, 'still four rows');
for (const r of empty) {
  eq(r.known, false, 'nothing was read');
  ok(typeof r.value === 'string' && r.value.trim().length > 0, 'and the row still says something');
  ok(!/undefined|null|NaN/.test(r.value), `"${r.value}" never shows a code to a person`);
  ok(/^[A-Z]/.test(r.value), `"${r.value}" reads as a sentence`);
}
for (const junk of [null, undefined, 5, 'an order', []]) {
  eq(orderCardRows(junk).length, 4, 'four rows whatever it is handed');
}

// ── 6. nothing here works anything out ──────────────────────────────────────
const src = readFileSync(new URL('./orderCard.js', import.meta.url), 'utf8');
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');
// It must not grow an opinion about matching. That belongs to the server, once.
for (const word of ['matches', 'productPricePaise', 'expectedPrice', 'campaign.']) {
  ok(!code.includes(word), `orderCard.js must not judge anything: it mentions ${word}`);
}

// ── ONE ORDER, TWO PRODUCTS, AND ONLY ONE OF THEM IS THE OFFER'S ───────────
//
// Measured on the owner's own Amazon order, 15 September 2026: order
// 408-…-3524313, grand total 1331, a garment rack at 938 and a bathroom shelf
// at 388. The card showed 1331 — a number nobody is paid a share of — and named
// the product "… and 1 more thing". The server already decided which product the
// offer is about; these two rows now show that one.
{
  const twoThings = {
    orderNumber: '408-1509645-3524313',
    orderDate: '2026-06-02',
    totalPaise: '133100',
    matchedPricePaise: '93800',
    matchedName: 'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
    items: [
      { name: 'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf', pricePaise: '93800' },
      { name: 'SR 2 PES Plastic Self-Adhesive Wall-Mount Bathroom Corner Shelf', pricePaise: '38800' },
    ],
  };
  const rows = orderCardRows(twoThings, {});
  const amount = rows.find((r) => /amount/i.test(r.label));
  ok(amount && amount.value === '₹938',
    `THE PRODUCT'S OWN PRICE, not the order's total (${amount && amount.value})`);
  ok(!rows.some((r) => String(r.value).includes('1,331')),
    'and the order total is nowhere on the card');
  const named = rows.find((r) => /product/i.test(r.label));
  ok(named && /Lukzer/.test(String(named.value)) && !/more thing/.test(String(named.value)),
    'and the product row names the one the amount is for');

  // AND AN ORDER OF ONE PRODUCT IS UNCHANGED, which is every order until now.
  const oneThing = {
    orderNumber: '408-5094957-4481129', orderDate: '2026-06-02', totalPaise: '25065',
    items: [{ name: 'boAt Rockerz', pricePaise: '25065' }],
  };
  const plain = orderCardRows(oneThing, {});
  ok(plain.find((r) => /amount/i.test(r.label)).value === '₹250',
    'an order with nothing matched still shows what the order came to');
}

console.log(`orderCard: ${checks} checks passed`);
