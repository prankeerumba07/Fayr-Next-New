// HOW MANY UNITS DID THE USER ACTUALLY BUY?
//
// A refund is always for ONE unit. Every amount a marketplace hands us is a
// LINE figure of unknown size, so paying a percentage of it without knowing the
// unit count pays a multiple of what the campaign intended (see
// chargedAmount.js, which refuses rather than assuming 1).
//
// This module is the only place allowed to answer that question from page text,
// and it answers it in exactly one way: **by reading a number the page states,
// next to a word that says what the number means.** Everything else returns
// null. A staff member confirming a quantity is cheap; paying three units for
// one review is not.
//
// Explicitly NOT accepted as a quantity, each for a reason we already know:
//
//   - a bare number sitting near the item (a badge, a column, a table cell).
//     That is reading the LAYOUT, and layout changes without notice.
//   - anything in the product TITLE. "Bedsheet Set of 2 Pieces" is one unit.
//     This is why only labelled forms match, never "2 pieces" / "2 nos".
//   - a hidden form field. Amazon's own "return or replace" and "buy it again"
//     forms carry name="quantity" value="1" whatever was bought, so an
//     attribute is a DIAGNOSTIC here and never an answer (see markupHits).
//   - the numbers inside a quantity PICKER. A return form renders its dropdown
//     as the text "Quantity: 1 2 3", and a naive label match reads 1 from an
//     order of 3. See the consecutive-run guard below.
//
// The patterns are ALSO inlined into the injected reader in platforms.js, which
// is a page script and cannot import. quantity.test.mjs reads that file as text
// and fails if the two ever drift apart.

/**
 * Above this a "quantity" is far more likely to be a misread field than a real
 * basket. The backend refuses above 100 (charged-amount.ts); this stops the
 * absurd value at the source instead of shipping it and being refused later.
 */
export const MAX_QUANTITY = 99;

/**
 * The only two labels accepted, as source strings so the inlined copies in
 * platforms.js can be compared against them character for character.
 *
 * `\b` before the word is what keeps "Antiquity 2" and "aqty 5" out — neither
 * has a word boundary in front of the label.
 */
export const QTY_PATTERN_SOURCE = '\\bqty\\b\\s*[:.\\-]?\\s*(\\d{1,3})(?![\\d.])';
export const QUANTITY_PATTERN_SOURCE = '\\bquantity\\b\\s*[:.\\-]?\\s*(\\d{1,3})(?![\\d.])';

const LABELS = [
  { label: 'qty', source: QTY_PATTERN_SOURCE },
  { label: 'quantity', source: QUANTITY_PATTERN_SOURCE },
];

/**
 * Is the number we just matched the FIRST OPTION OF A PICKER rather than a
 * statement of fact?
 *
 * A `<select>` renders as its option text, so cleanText() flattens a return
 * form's quantity dropdown to "Quantity: 1 2 3" — and the label match reads 1
 * from an order of three. A statement is followed by prose; a picker is
 * followed by the next consecutive integer. Requiring only ONE step (n, n+1)
 * is deliberate: a two-option picker ("1 2") is the common case and has to be
 * caught too.
 */
function looksLikePicker(rest, value) {
  const next = rest.match(/^\s*(\d{1,3})(?![\d.])/);
  return !!next && Number(next[1]) === value + 1;
}

/**
 * Read a stated quantity out of one item's own container text.
 *
 * @param {string|null|undefined} text  the container text, already flattened.
 * @returns {{quantity: number|null, source: string|null, reason: string|null,
 *            candidates: Array<{label: string, value: number}>}}
 *   `candidates` is every labelled number found, kept even when the answer is
 *   null, so a live capture explains ITSELF instead of needing another fetch.
 */
export function readStatedQuantity(text) {
  const out = { quantity: null, source: null, reason: 'not-stated', candidates: [] };
  if (typeof text !== 'string' || !text) return out;

  for (const { label, source } of LABELS) {
    const re = new RegExp(source, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = Number(m[1]);
      const rest = text.slice(m.index + m[0].length);
      if (looksLikePicker(rest, value)) {
        out.candidates.push({ label, value, rejected: 'picker' });
        continue;
      }
      out.candidates.push({ label, value });
    }
  }

  const accepted = out.candidates.filter((c) => !c.rejected);
  if (!accepted.length) {
    // Distinguish "the page says nothing" from "the page said something we
    // refused" — the second means the reader needs looking at, the first does not.
    if (out.candidates.length) out.reason = 'picker';
    return out;
  }

  const distinct = [...new Set(accepted.map((c) => c.value))];
  if (distinct.length > 1) {
    // Two different labelled numbers in one item's container means the walk
    // escaped the row, or the row holds a second item. Either way it is not an
    // answer about THIS item.
    out.reason = 'conflicting';
    return out;
  }

  const value = distinct[0];
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
    out.reason = 'implausible';
    return out;
  }
  out.quantity = value;
  out.source = accepted[0].label === 'qty' ? 'label-qty' : 'label-quantity';
  out.reason = null;
  return out;
}

/**
 * Quantity-shaped things in the raw MARKUP — attributes and hidden inputs.
 *
 * DIAGNOSTIC ONLY, and it must stay that way: Amazon's return/buy-again forms
 * carry a quantity field whose value is the form's default, not the purchase.
 * The point of collecting them is that ONE real capture then tells us whether a
 * trustworthy stated quantity exists on the page at all, without adding a
 * single request to find out.
 */
export function markupHits(html, limit = 8) {
  if (typeof html !== 'string' || !html) return [];
  const patterns = [
    // A quantity-named ATTRIBUTE carrying a number: data-item-qty="3".
    /([a-z-]*(?:qty|quantity)[a-z-]*)\s*=\s*"(\d{1,3})"/gi,
    // A form FIELD named quantity: <input name="quantity" value="1">. Worth
    // seeing precisely because its value is the form's default — knowing the
    // field exists is what lets us decide it is useless.
    /name\s*=\s*"([a-z-]*(?:qty|quantity)[a-z-]*)"[^>]*?value\s*=\s*"(\d{1,3})"/gi,
  ];
  const seen = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null && seen.length < limit) {
      const hit = `${m[1]}="${m[2]}"`;
      if (seen.indexOf(hit) < 0) seen.push(hit);
    }
  }
  return seen;
}

/**
 * Flipkart states its orders as UNIT RECORDS, not as page text, so it gets its
 * own combiner.
 *
 * `stated` is one entry per unit record for a single product in a single order:
 * the quantity that record states, or null when it states none.
 *
 * The asymmetry is the whole point. Counting records is NOT an answer — one
 * record could itself represent three units, and we would refund a third of
 * what was charged. Only a record that states its own count is evidence, and
 * every record has to state one before they can be added up.
 *
 * @returns {{quantity: number|null, source: string|null, reason: string|null,
 *            records: number}}
 */
export function combineUnitQuantities(stated) {
  const list = Array.isArray(stated) ? stated : [];
  const out = { quantity: null, source: null, reason: 'not-stated', records: list.length };
  if (!list.length) return out;

  const known = list.filter((v) => v != null);
  if (!known.length) return out;
  if (known.length !== list.length) {
    // Some records state a count and some do not. Adding the known ones would
    // undercount; treating the silent ones as 1 would be the assumption this
    // whole module exists to refuse.
    out.reason = 'partial';
    return out;
  }
  if (!known.every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_QUANTITY)) {
    out.reason = 'implausible';
    return out;
  }
  const sum = known.reduce((a, b) => a + b, 0);
  if (sum > MAX_QUANTITY) {
    out.reason = 'implausible';
    return out;
  }
  out.quantity = sum;
  out.source = list.length > 1 ? 'unit-records-stated' : 'unit-record-stated';
  out.reason = null;
  return out;
}

/**
 * Last gate before a quantity leaves the device.
 *
 * The backend DTO REJECTS an out-of-range or non-integer quantity with a 400,
 * which would fail the whole evidence submission — losing the order, the review
 * and the delivery date along with it. So a value the reader could not have
 * meant is turned into an honest null here, which the backend accepts and holds
 * for a human, rather than a 400 that loses everything.
 */
export function normalizeQuantity(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) return null;
  return n;
}

/**
 * KNOWING THE COUNT IS NOT THE SAME AS KNOWING WHAT THE AMOUNT MEANS.
 *
 * The backend divides by the quantity because `itemPaise` / `lineTotalPaise` is
 * defined as what the whole LINE cost. Nothing we have establishes that a
 * marketplace's item row is a line total rather than a PER-UNIT price — on a
 * single-unit order the two are the same number, which is why every capture we
 * hold is silent on the question. Assert the wrong one and:
 *
 *   - a per-unit price divided by 3 UNDER-pays by two thirds;
 *   - a line total treated as per-unit OVER-pays by three times.
 *
 * A quantity of ONE is the only value that is correct under both readings, so it
 * is the only one that may be asserted. A larger count is real information and is
 * kept — as `observed`, which no computation is allowed to touch — so the staff
 * member deciding the amount can see what the page said.
 *
 * This is not caution for its own sake. It is resolvable: one real multi-unit
 * order, read with the diagnostics the readers now emit, settles which figure the
 * page shows, and then a larger quantity becomes payable by changing this
 * function alone.
 *
 * @param read the output of readStatedQuantity / combineUnitQuantities.
 * @returns quantity — safe to compute with; observed — for a human to read only.
 */
export function payableQuantity(read) {
  const r = read || {};
  const value = r.quantity ?? null;
  if (value == null) {
    return { quantity: null, observed: null, source: null, reason: r.reason ?? 'not-stated' };
  }
  if (value === 1) {
    return { quantity: 1, observed: 1, source: r.source ?? null, reason: null };
  }
  return {
    quantity: null,
    observed: value,
    source: null,
    reason: 'multi-unit-amount-unclear',
  };
}
