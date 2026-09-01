/**
 * THE USER'S OWN SCREENSHOT AGAINST THE USER'S OWN ORDER, FIELD BY FIELD.
 *
 * The owner asked for this by name: "It should compare: Order ID, Order amount,
 * Order date, Product name, Marketplace, Other relevant order details. The system
 * should confirm whether the information in the screenshot matches the actual order
 * details." And: "Show BOTH values and whether they agree. Never silently pass and
 * never silently fail."
 *
 * WHY THIS IS A SECOND COMPARISON AND NOT THE EXISTING ONE. There is already a
 * matcher, EvidenceMatchService, and it is deliberately staff-only. It compares the
 * screenshot against the CAMPAIGN — its expected price, its product name, its
 * minimum rating — with a rupee tolerance, a percentage tolerance and a name
 * overlap threshold, and its per-field notes print those thresholds out loud
 * ("within ₹2 band", "name overlap 0.72 (≥ 0.6 matches)"). Showing that to the
 * person being checked would hand a forger a way to test their own work: upload,
 * read which field failed, adjust, upload again.
 *
 * THIS ONE LEAKS NOTHING, because BOTH SIDES ARE THE USER'S OWN DATA:
 *
 *   one side   what Claude read off the screenshot the user uploaded
 *   other side the user's own order, as Fayr read it from the user's own account
 *
 * And it is EXACT, not tolerant. "Agree" means the two documents say the same
 * thing. It does not mean Fayr accepted anything, it does not consult the
 * campaign's expected price, and it cannot be used to find a threshold, because
 * there is no threshold in it. A person at Fayr still decides, and the verdict,
 * the confidence and the tolerant per-field notes all stay where they were.
 *
 * PURE. No Prisma, no Nest injection, no clock — so every row can be tested.
 */

/** What Claude read off a screenshot. Mirrors ExtractedFields, loosely typed. */
export interface ExtractedForComparison {
  orderNumber?: string | null;
  productName?: string | null;
  /** The price paid, in the screenshot's main unit (rupees), as the model read it. */
  amount?: number | null;
  orderDate?: string | null;
  marketplace?: string | null;
  deliveryStatus?: string | null;
}

/** The user's own order, as Fayr holds it. Integer paise, milliseconds. */
export interface OwnOrderForComparison {
  id?: string | null;
  product?: string | null;
  /** Every money field Fayr holds for the line, so the comparison can accept any. */
  unitPricePaise?: bigint | number | null;
  lineTotalPaise?: bigint | number | null;
  itemPaise?: bigint | number | null;
  orderTotalPaise?: bigint | number | null;
  date?: number | null;
  deliveredAt?: number | null;
}

/**
 * One row the USER sees.
 *
 * `agree` is true, false, or null. Null means one of the two sides is missing, and
 * a missing side is not a disagreement — it is a thing we do not know, and the row
 * says so rather than reading as a failure.
 */
export interface UserFieldRow {
  field: 'orderId' | 'amount' | 'orderDate' | 'productName' | 'marketplace' | 'delivery';
  /** In plain words, for the screen. */
  label: string;
  /** What the screenshot said, or null. */
  fromScreenshot: string | null;
  /** What the user's own order says, or null. */
  fromOrder: string | null;
  agree: boolean | null;
}

/** Collapse case, whitespace and punctuation that carries no meaning. */
function loose(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .replace(/[.,;:!?'"()[\]]/g, '')
    .trim();
}

/** An order number, compared on its digits and letters only. */
function looseOrderNumber(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

/** A day, as "2026-07-02", from milliseconds. */
export function dayFromMillis(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/**
 * A day, as "2026-07-02", from whatever a model wrote.
 *
 * Deliberately narrow: an ISO date, "2 Jul 2026", "Jul 2, 2026" and "02/07/2026"
 * are the shapes marketplace order pages actually print. Anything else returns
 * null, and a null is shown as "we could not read a date" rather than guessed at —
 * a date guessed wrongly would make two agreeing documents look like a mismatch.
 */
export function dayFromText(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().toLowerCase();
  if (t === '') return null;

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "2 jul 2026" and "2 july 2026"
  const dmy = t.match(/^(\d{1,2})\s+([a-z]{3,})\s+(\d{4})$/);
  if (dmy) {
    const m = MONTHS.indexOf(dmy[2].slice(0, 3));
    if (m >= 0) {
      return `${dmy[3]}-${String(m + 1).padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
  }

  // "jul 2, 2026" and "july 2 2026"
  const mdy = t.match(/^([a-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy) {
    const m = MONTHS.indexOf(mdy[1].slice(0, 3));
    if (m >= 0) {
      return `${mdy[3]}-${String(m + 1).padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
    }
  }

  // "02/07/2026" — day first, which is how India writes it.
  const slashed = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashed) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${slashed[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

/** "₹1,326.00" from integer paise. Indian grouping, done by hand — no Intl. */
export function rupeesFromPaise(paise: bigint | number | null | undefined): string | null {
  if (paise == null) return null;
  const n = typeof paise === 'bigint' ? paise : Math.trunc(paise);
  const abs = n < 0 ? -n : n;
  const whole = String(typeof abs === 'bigint' ? abs / 100n : Math.floor(abs / 100));
  const frac = String(typeof abs === 'bigint' ? abs % 100n : Math.floor(abs % 100))
    .padStart(2, '0');
  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  }
  return `${n < 0 ? '-' : ''}₹${grouped}.${frac}`;
}

/** Rupees as the model read them, to integer paise. */
export function paiseFromRupees(amount: number | null | undefined): bigint | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  return BigInt(Math.round(amount * 100));
}

/**
 * Which of Fayr's money fields to compare against.
 *
 * A screenshot of an order page shows what the line cost. Fayr may hold several
 * figures for that line — a stated unit price, a line total, the historic ambiguous
 * one, and the whole order's total — so the screenshot is counted as agreeing when
 * it matches ANY of them, in that order of preference. This is deliberately
 * generous: the question on this screen is "is this the same order", not "what
 * should we pay", and what we should pay is settled by the resolver the payout
 * uses, nowhere near here.
 */
function moneyCandidates(order: OwnOrderForComparison): bigint[] {
  const out: bigint[] = [];
  for (const raw of [order.unitPricePaise, order.lineTotalPaise, order.itemPaise,
    order.orderTotalPaise]) {
    if (raw == null) continue;
    const v = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(raw));
    if (v > 0n && !out.includes(v)) out.push(v);
  }
  return out;
}

function row(
  field: UserFieldRow['field'],
  label: string,
  fromScreenshot: string | null,
  fromOrder: string | null,
  agree: boolean | null,
): UserFieldRow {
  return { field, label, fromScreenshot, fromOrder, agree };
}

/**
 * The rows, in the design's order with the owner's fifth and sixth appended.
 *
 * `platformName` is the shop's display name — the same one the app shows — passed
 * in so this module holds no list of shops.
 */
export function compareToOwnOrder(
  extracted: ExtractedForComparison | null | undefined,
  order: OwnOrderForComparison | null | undefined,
  platformName: string | null,
): UserFieldRow[] {
  const e = extracted && typeof extracted === 'object' ? extracted : {};
  const o = order && typeof order === 'object' ? order : {};

  // ── order id ──────────────────────────────────────────────────────────────
  const shotId = typeof e.orderNumber === 'string' && e.orderNumber.trim() !== ''
    ? e.orderNumber.trim() : null;
  const ourId = typeof o.id === 'string' && o.id.trim() !== '' ? o.id.trim() : null;
  const idAgree = shotId == null || ourId == null
    ? null
    : looseOrderNumber(shotId) === looseOrderNumber(ourId);

  // ── amount ────────────────────────────────────────────────────────────────
  const shotPaise = paiseFromRupees(e.amount);
  const candidates = moneyCandidates(o);
  const amountAgree = shotPaise == null || candidates.length === 0
    ? null
    : candidates.some((c) => c === shotPaise);
  // The figure shown for OUR side is the first candidate, which is the most
  // specific one Fayr holds. When they agree it is the matching one, so the two
  // columns read identically rather than looking wrong for no reason.
  const ourPaise = amountAgree === true && shotPaise != null
    ? shotPaise
    : (candidates[0] ?? null);

  // ── order date ────────────────────────────────────────────────────────────
  const shotDay = dayFromText(e.orderDate);
  const ourDay = dayFromMillis(o.date);
  const dateAgree = shotDay == null || ourDay == null ? null : shotDay === ourDay;

  // ── product name ──────────────────────────────────────────────────────────
  const shotProduct = typeof e.productName === 'string' && e.productName.trim() !== ''
    ? e.productName.trim() : null;
  const ourProduct = typeof o.product === 'string' && o.product.trim() !== ''
    ? o.product.trim() : null;
  // One name is very often the other with extra words after it, because an order
  // page prints the full title and a screenshot may be cropped. Either containing
  // the other counts as the same product; nothing looser than that.
  let productAgree: boolean | null = null;
  if (shotProduct != null && ourProduct != null) {
    const a = loose(shotProduct);
    const b = loose(ourProduct);
    productAgree = a === b || a.includes(b) || b.includes(a);
  }

  // ── marketplace ───────────────────────────────────────────────────────────
  const shotShop = typeof e.marketplace === 'string' && e.marketplace.trim() !== ''
    ? e.marketplace.trim() : null;
  const ourShop = typeof platformName === 'string' && platformName.trim() !== ''
    ? platformName.trim() : null;
  const shopAgree = shotShop == null || ourShop == null
    ? null
    : loose(shotShop) === loose(ourShop)
      || loose(shotShop).includes(loose(ourShop))
      || loose(ourShop).includes(loose(shotShop));

  const rows: UserFieldRow[] = [
    row('orderId', 'Order ID', shotId, ourId, idAgree),
    row('amount', 'Order amount', rupeesFromPaise(shotPaise), rupeesFromPaise(ourPaise), amountAgree),
    row('orderDate', 'Order date', shotDay, ourDay, dateAgree),
    row('productName', 'Product name', shotProduct, ourProduct, productAgree),
    row('marketplace', 'Marketplace', shotShop, ourShop, shopAgree),
  ];

  // ── delivery, only when either side has something to say ──────────────────
  const shotDelivery = typeof e.deliveryStatus === 'string' && e.deliveryStatus.trim() !== ''
    ? e.deliveryStatus.trim() : null;
  const ourDelivery = dayFromMillis(o.deliveredAt);
  if (shotDelivery != null || ourDelivery != null) {
    // Never compared. A screenshot's status line and a delivery date are two
    // different facts, and calling them a disagreement would be wrong. Both are
    // shown because they are both true and both useful.
    rows.push(row(
      'delivery',
      'Delivery',
      shotDelivery,
      ourDelivery == null ? null : `Delivered on ${ourDelivery}`,
      null,
    ));
  }

  return rows;
}

/** How many rows really agree. Rows we could not compare are not counted either way. */
export function howManyAgree(rows: UserFieldRow[]): number {
  return Array.isArray(rows) ? rows.filter((r) => r && r.agree === true).length : 0;
}

/** How many rows could be compared at all. */
export function howManyCompared(rows: UserFieldRow[]): number {
  return Array.isArray(rows) ? rows.filter((r) => r && r.agree !== null).length : 0;
}
