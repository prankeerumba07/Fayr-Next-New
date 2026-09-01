// THE ORDER, FIELD BY FIELD, AS THE DESIGN'S CONFIRM SCREEN ASKS FOR IT.
//
// The design's ocrconfirm screen (fayr-design.browser.jsx:2898) lists four rows —
// Order ID, Order Amount, Order Date, Product Name — and asks "are these correct?".
// The owner asked for a fifth, Marketplace. This builds those five rows.
//
// PURE. No React, no fetch, and the clock is never read: it takes what it is given
// and returns strings. So every row, and every case where a value is not known,
// can be checked under node. Same reason as ui/journey.js and ui/returnWindow.js.
//
// WHAT A ROW IS ALLOWED TO SAY. A row either has a value we really hold, or it says
// plainly that we do not hold it. It never shows a blank, a dash on its own, the
// word undefined, or a number nobody wrote down. The design writes an order number
// and an order date into the file; neither is copied, and the audit records that.
//
// THE AMOUNT COMES THROUGH ONE RESOLVER. src/chargedAmount.js is the device's
// mirror of the backend's own, so the figure this screen shows is the figure the
// refund would be worked out from. Reading a raw field instead would let the screen
// name a price the payout would refuse — the exact mistake that resolver exists to
// prevent. When the resolver says a person has to decide, the row says so rather
// than picking one of the numbers.

import { resolveChargedPaise } from '../chargedAmount.js';
import { formatPaise } from '../money.js';

/** Short month names, so no Intl is needed. Hermes only partially ships it. */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "2 Jul 2026" from milliseconds, or null. */
export function orderDate(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "₹1,326.00" from integer paise, or null. Indian grouping, done by hand. */
export function money(paise) {
  const plain = formatPaise(paise);
  if (plain == null) return null;
  const [whole, frac] = plain.split('.');
  const neg = whole.startsWith('-');
  const digits = neg ? whole.slice(1) : whole;
  let grouped = digits;
  if (digits.length > 3) {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }
  return `${neg ? '-' : ''}₹${grouped}.${frac}`;
}

/** The one sentence a row shows when Fayr does not hold that fact. */
const NOT_KNOWN = 'We do not have this yet';

function row(label, value, note) {
  const known = typeof value === 'string' && value !== '';
  return {
    label,
    value: known ? value : NOT_KNOWN,
    known,
    note: typeof note === 'string' && note !== '' ? note : null,
  };
}

/**
 * The five rows, in the design's order with the owner's fifth appended.
 *
 * `order` is the device's engine-shaped task.order — integer paise, milliseconds —
 * which is what taskStore.getTask returns. `shopName` is the shop's display name
 * from the frozen platforms.js. `productName` is the campaign's, used only as the
 * fallback label when the order itself did not carry a product name.
 */
export function orderDetailRows(state) {
  const s = state && typeof state === 'object' ? state : {};
  const order = s.order && typeof s.order === 'object' ? s.order : null;

  const charged = order ? resolveChargedPaise(order) : null;
  const amount = charged && charged.paise != null ? money(charged.paise) : null;
  const amountNote = charged && charged.needsStaff
    ? 'A person at Fayr has to settle this amount, so we are not showing a '
      + 'figure we might have to change.'
    : null;

  const product = order && typeof order.product === 'string' && order.product
    ? order.product
    : typeof s.productName === 'string' && s.productName
      ? s.productName
      : null;

  return [
    row('Order ID', order && order.id ? String(order.id) : null),
    row('Order amount', amount, amountNote),
    row('Order date', order ? orderDate(order.date) : null),
    row('Product name', product),
    row('Marketplace', typeof s.shopName === 'string' && s.shopName ? s.shopName : null),
  ];
}

/** How many of the five rows Fayr actually holds. Drawn as "4 of 5 read". */
export function howManyKnown(rows) {
  return Array.isArray(rows) ? rows.filter((r) => r && r.known === true).length : 0;
}

/**
 * Where these details came from, in plain words.
 *
 * The design's own screen has this as a variable too — its chip reads either
 * "Fetched from email" or "Read from screenshot" — so a third value for the
 * on-device reader is the design's own structure, not a new one.
 */
export function readFrom(source) {
  switch (source) {
    case 'email':
      return { icon: '📧', label: 'Read from your order email' };
    case 'ocr':
    case 'screenshot':
      return { icon: '🔍', label: 'Read from your screenshot' };
    case 'scrape':
    case 'reader':
      return { icon: '🛍️', label: 'Read from your orders on the shop' };
    default:
      return { icon: '🛍️', label: 'Read from your own order' };
  }
}
