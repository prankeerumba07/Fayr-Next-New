// Reading how many units were bought.
//
// This is a MONEY reader, so the tests are written to attack it, not to confirm
// it. Every case below is a way the page could hand us a number that looks like
// a quantity and is not one:
//
//   - a product title that contains a count ("Set of 2 Pieces")
//   - a return form's quantity DROPDOWN, flattened to text as "Quantity: 1 2 3"
//   - a hidden form field whose value is the form's default, not the purchase
//   - two different labelled numbers, because the DOM walk escaped the item row
//
// Each of those must produce null. Getting a null costs a staff click; getting
// any of them wrong pays a multiple of one unit's price.

import fs from 'node:fs';
import path from 'node:path';
import {
  readStatedQuantity, markupHits, combineUnitQuantities, normalizeQuantity, payableQuantity,
  MAX_QUANTITY, QTY_PATTERN_SOURCE, QUANTITY_PATTERN_SOURCE,
} from './quantity.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== 1. a labelled number IS read ===');
{
  ok(readStatedQuantity('Qty: 2').quantity === 2, 'Qty: 2');
  ok(readStatedQuantity('Quantity: 3').quantity === 3, 'Quantity: 3');
  ok(readStatedQuantity('qty 1').quantity === 1, 'lowercase, no colon');
  ok(readStatedQuantity('QTY:1').quantity === 1, 'uppercase, no space');
  ok(readStatedQuantity('Qty - 4').quantity === 4, 'dash separator');
  ok(readStatedQuantity('Qty: 2').source === 'label-qty', 'and records WHICH label answered');
  ok(readStatedQuantity('Quantity: 3').source === 'label-quantity', 'both labels are distinguishable');
}

console.log('\n=== 2. an unlabelled number is NOT a quantity ===');
{
  const title = 'Solimo Bedsheet Set of 2 Pieces, King Size 2 x 90 inch ₹1,299.00';
  const r = readStatedQuantity(title);
  ok(r.quantity === null, 'a product title carrying counts reads as unknown');
  ok(r.reason === 'not-stated', 'and says the page stated nothing');
  ok(readStatedQuantity('₹249.00 Delivered 5 June 3').quantity === null,
    'a bare trailing number (a badge, a column) is never read');
  ok(readStatedQuantity('Antiquity 2 brass lamp').quantity === null,
    'a word ENDING in the label does not match (word boundary)');
  ok(readStatedQuantity('aqty 5').quantity === null, 'nor a word ending in qty');
}

console.log('\n=== 3. a quantity PICKER is not a statement — the dangerous case ===');
{
  // cleanText() flattens a <select> to its option text. This is what Amazon's
  // "return or replace items" form looks like AFTER flattening, and a naive
  // label match reads 1 out of an order of three.
  const r = readStatedQuantity('Return or replace items Quantity: 1 2 3 Reason for return');
  ok(r.quantity === null, 'a 1 2 3 run after the label is refused, not read as 1');
  ok(r.reason === 'picker', 'and it is reported as a picker, not as silence');
  ok(readStatedQuantity('Quantity: 1 2').quantity === null, 'a two-option picker too');
  ok(readStatedQuantity('Qty: 2 3 4').quantity === null, 'a picker that does not start at 1');
  // ...and the guard must not eat a real statement that happens to be followed
  // by a number that is NOT its successor.
  ok(readStatedQuantity('Qty: 2 ₹249.00 delivered 5 June').quantity === 2,
    'a real statement followed by an unrelated number still reads');
  ok(readStatedQuantity('Qty: 3 1 year warranty').quantity === 3,
    'a following SMALLER number is not a picker');
}

console.log('\n=== 4. two different labelled numbers = the walk escaped the row ===');
{
  const r = readStatedQuantity('Qty: 2 ... other item ... Qty: 5');
  ok(r.quantity === null, 'conflicting numbers refuse');
  ok(r.reason === 'conflicting', 'and say why');
  ok(readStatedQuantity('Qty: 2 Qty: 2').quantity === 2, 'the SAME number twice is not a conflict');
  ok(readStatedQuantity('Qty: 2 Quantity: 4').quantity === null, 'across the two labels as well');
}

console.log('\n=== 5. an impossible number refuses ===');
{
  ok(readStatedQuantity('Qty: 0').quantity === null, 'zero units is not a purchase');
  ok(readStatedQuantity('Qty: 0').reason === 'implausible', 'reported as implausible');
  ok(readStatedQuantity('Qty: 250').quantity === null, 'above the ceiling');
  ok(readStatedQuantity(`Qty: ${MAX_QUANTITY}`).quantity === MAX_QUANTITY, 'the ceiling itself is allowed');
  ok(readStatedQuantity('Qty: 2.5').quantity === null, 'a decimal is not a unit count');
  ok(readStatedQuantity(null).quantity === null, 'null text');
  ok(readStatedQuantity('').quantity === null, 'empty text');
}

console.log('\n=== 6. candidates are kept even when the answer is null ===');
{
  const r = readStatedQuantity('Qty: 2 Qty: 5');
  ok(r.candidates.length === 2, 'both labelled numbers are recorded');
  ok(r.candidates.every((c) => typeof c.value === 'number'), 'with their values');
  const p = readStatedQuantity('Quantity: 1 2 3');
  ok(p.candidates.length === 1 && p.candidates[0].rejected === 'picker',
    'a rejected candidate says which rule rejected it');
}

console.log('\n=== 7. markup hits are DIAGNOSTIC, never an answer ===');
{
  const html = '<input type="hidden" name="quantity" value="1"><div data-item-qty="3">';
  const hits = markupHits(html);
  ok(hits.indexOf('data-item-qty="3"') >= 0,
    'attribute NAMES containing qty are collected with their values');
  ok(hits.indexOf('quantity="1"') >= 0,
    'and a form field named quantity, whose value is a DEFAULT, is seen too');
  ok(readStatedQuantity(html).quantity === null,
    'and the text reader never turns a hidden field into a quantity');
  ok(markupHits('<div>', 8).length === 0, 'no hits, no noise');
  ok(markupHits(null).length === 0, 'null html');
}

console.log('\n=== 8. Flipkart unit records — counting is NOT reading ===');
{
  ok(combineUnitQuantities([null]).quantity === null,
    'ONE record stating nothing is unknown — it could itself hold three units');
  ok(combineUnitQuantities([null, null, null]).quantity === null,
    'THREE records stating nothing is still unknown: counting records is not reading a number');
  ok(combineUnitQuantities([null, null, null]).records === 3,
    'but the record count is reported, so the collapse is visible');
  ok(combineUnitQuantities([1]).quantity === 1, 'one record stating one unit');
  ok(combineUnitQuantities([1, 1, 1]).quantity === 3, 'three records each stating one = three');
  ok(combineUnitQuantities([2, 1]).quantity === 3, 'stated counts add up');
  ok(combineUnitQuantities([1, null]).quantity === null, 'mixed: some stated, some not');
  ok(combineUnitQuantities([1, null]).reason === 'partial', 'and it says which');
  ok(combineUnitQuantities([0]).quantity === null, 'zero refuses');
  ok(combineUnitQuantities([500]).quantity === null, 'absurd refuses');
  ok(combineUnitQuantities([50, 60]).quantity === null, 'so does an absurd SUM');
  ok(combineUnitQuantities([]).quantity === null, 'no records at all');
  ok(combineUnitQuantities([1, 1]).source === 'unit-records-stated', 'source names the plural case');
  ok(combineUnitQuantities([1]).source === 'unit-record-stated', 'and the singular one');
}

console.log('\n=== 8b. nothing the backend would 400 on ever leaves the device ===');
{
  ok(normalizeQuantity(1) === 1, 'a real quantity passes through');
  ok(normalizeQuantity('3') === 3, 'a numeric string is accepted');
  ok(normalizeQuantity(0) === null, 'zero becomes an honest unknown, not a 400');
  ok(normalizeQuantity(-2) === null, 'negative');
  ok(normalizeQuantity(2.5) === null, 'fractional');
  ok(normalizeQuantity(1000) === null, 'above the ceiling');
  ok(normalizeQuantity(null) === null, 'null');
  ok(normalizeQuantity(undefined) === null, 'undefined');
  ok(normalizeQuantity('') === null, 'empty string');
  ok(normalizeQuantity('two') === null, 'a word');
  ok(normalizeQuantity(NaN) === null, 'NaN');
  ok(normalizeQuantity(Infinity) === null, 'Infinity');
}

console.log('\n=== 8c. a count is not the same as knowing what the AMOUNT means ===');
{
  // Nothing establishes whether a marketplace's item row is a line total or a
  // per-unit price. One unit is the only count that is right either way.
  const one = payableQuantity({ quantity: 1, source: 'label-qty', reason: null });
  ok(one.quantity === 1, 'one unit is payable — both readings of the amount agree');
  ok(one.source === 'label-qty', 'and keeps its provenance');

  const three = payableQuantity({ quantity: 3, source: 'label-qty', reason: null });
  ok(three.quantity === null, 'THREE units is NOT payable: dividing a per-unit price underpays by two thirds');
  ok(three.observed === 3, 'but the number the page stated is kept for the staff member');
  ok(three.reason === 'multi-unit-amount-unclear', 'and the reason names the real gap');
  ok(three.source === null, 'no source is claimed for a quantity we are not asserting');

  const none = payableQuantity({ quantity: null, source: null, reason: 'picker' });
  ok(none.quantity === null && none.observed === null, 'nothing read stays nothing');
  ok(none.reason === 'picker', 'and the original refusal survives');
  ok(payableQuantity(null).reason === 'not-stated', 'a missing read is treated as silence');
  ok(payableQuantity({}).quantity === null, 'an empty read too');
}

console.log('\n=== 9. the inlined copies in platforms.js have not drifted ===');
{
  // platforms.js is an injected PAGE SCRIPT: it is a string, it cannot import
  // this module, so the patterns exist twice. This is the guard that stops the
  // two versions quietly disagreeing about what counts as a quantity.
  const src = fs.readFileSync(
    path.join(import.meta.dirname, 'platforms.js'), 'utf8',
  );
  // Inside a template literal every backslash is doubled. Undo that once, then
  // the pattern should appear character for character.
  const unescaped = src.replace(/\\\\/g, '\\');
  ok(unescaped.includes(QTY_PATTERN_SOURCE),
    'the qty pattern is inlined verbatim');
  ok(unescaped.includes(QUANTITY_PATTERN_SOURCE),
    'the quantity pattern is inlined verbatim');
  ok(/quantity/i.test(src), 'platforms.js reads a quantity at all');
  // Flipkart's answer comes from a JSON payload, not page text. The guard there
  // is that the reader captures the quantity-shaped PATHS, so one real multi-unit
  // order names the field exactly instead of it staying a guess.
  ok(/quantityLikePaths/.test(src),
    'and it captures quantity-shaped JSON paths for Flipkart');
  ok(/unitRecordCounts/.test(src),
    'and how many unit records each order/product had');
}

console.log('\n=== 10. the injected page script still PARSES ===');
{
  // platforms.js edits are edits to a STRING. A syntax error in it would not
  // show up until the script ran inside a real WebView on a real marketplace,
  // where the only symptom is a fetch that silently reports nothing. Parse it
  // here instead.
  const { PLATFORMS } = await import('./platforms.js');
  for (const key of ['amazon', 'flipkart']) {
    const script = PLATFORMS[key].fetchScript;
    let parsed = true, err = null;
    try { new Function(script); } catch (e) { parsed = false; err = e.message; }
    ok(parsed, `${key}'s injected script parses` + (err ? ` (${err})` : ''));
    const reads = key === 'flipkart' ? /combineUnits/ : /statedQuantityIn/;
    ok(reads.test(script), `${key} reads a quantity`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
