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

/**
 * ONE PRODUCT ON AN ORDER, with its own price in integer paise.
 *
 * Added 2 September 2026, because a real Zepto order is one order with several
 * shipments and several products on it, and until now every shape in here
 * assumed exactly one. See order-text.ts, which reads a screen into this.
 */
export interface OrderItemForComparison {
  name: string;
  pricePaise: bigint | number;
}

/** The user's own order, as Fayr holds it. Integer paise, milliseconds. */
export interface OwnOrderForComparison {
  id?: string | null;
  product?: string | null;
  /**
   * Every product on the order, when the order has more than one.
   *
   * Optional, and absent on every order Fayr held before this existed: an Amazon
   * order carries one product in `product` and its price in the money fields
   * below, and that shape still works exactly as it did. When both are present
   * the single product is not ignored — it is simply one more product to look
   * through.
   */
  items?: readonly OrderItemForComparison[] | null;
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
/**
 * ── AND THE SEPARATORS A SHOP DECORATES A TITLE WITH ───────────────────────
 *
 * Measured on the owner's own Amazon order, 15 September 2026. The offer names
 * the product exactly as its listing does, and the order page prints the same
 * words with the shop's own pipes between them:
 *
 *   offer  Lukzer Heavy-Duty Metal Garment Rack with Bottom Storage Shelf ...
 *   order  Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf ...
 *
 * One character, in one place, and neither string contains the other — so a
 * product he really bought read as "that product is not on this order". A
 * shop's punctuation now falls away on both sides before they are compared, and
 * what is left is the words.
 *
 * THE PRICE STILL HAS TO BE EXACT. Loosening a NAME is safe here precisely
 * because the name only chooses WHICH line is looked at; what decides the money
 * is an exact figure on that line, and that has not moved.
 */
function loose(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
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
  const add = (raw: bigint | number | null | undefined): void => {
    if (raw == null) return;
    const v = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(raw));
    if (v > 0n && !out.includes(v)) out.push(v);
  };
  add(order.unitPricePaise);
  add(order.lineTotalPaise);
  add(order.itemPaise);
  add(order.orderTotalPaise);
  // AND EACH PRODUCT'S OWN PRICE. On an order with several products, a screenshot
  // of one row shows that row's figure and a screenshot of the bill shows the
  // whole total, and both are the same order. Neither may read as a disagreement.
  for (const item of itemsOf(order)) add(item.pricePaise);
  return out;
}

/**
 * The products on an order, whatever shape the order came in.
 *
 * An order with a list has that list. An order with no list but a product name
 * has one product, priced at the most specific figure Fayr holds for it — which
 * is what every order looked like before this file learned to count. An order
 * with neither has none, and none is not an error, it is a thing we could not
 * read, and it is said as that.
 */
function itemsOf(order: OwnOrderForComparison): OrderItemForComparison[] {
  const list = Array.isArray(order.items) ? order.items : [];
  const out: OrderItemForComparison[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name === '') continue;
    const price = raw.pricePaise;
    if (price == null) continue;
    const paise = typeof price === 'bigint' ? price : BigInt(Math.trunc(price));
    if (paise <= 0n) continue;
    out.push({ name, pricePaise: paise });
  }
  if (out.length > 0) return out;

  const single = typeof order.product === 'string' && order.product.trim() !== ''
    ? order.product.trim() : null;
  if (single == null) return [];
  // Deliberately NOT moneyCandidates, which would call this back. The four money
  // fields in their order of preference, first one that is a real figure.
  for (const raw of [order.unitPricePaise, order.lineTotalPaise, order.itemPaise,
    order.orderTotalPaise]) {
    if (raw == null) continue;
    const paise = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(raw));
    if (paise > 0n) return [{ name: single, pricePaise: paise }];
  }
  return [];
}

/**
 * Are these two the same product's name?
 *
 * One name is very often the other with extra words after it, because an order
 * page prints the full title and a campaign carries a shorter one. Either
 * containing the other counts as the same product; nothing looser than that.
 *
 * THERE IS NO SCORE IN THIS AND THERE MUST NOT BE. The staff side has a token
 * overlap threshold and prints it out loud; this side is a yes or a no, so there
 * is no number here for anybody to find by trying.
 */
/**
 * ARE THESE TWO NAMES THE SAME PRODUCT?
 *
 * EXPORTED, because the review read asks exactly this question of exactly these
 * two kinds of string — a campaign's short name against a shop's long title —
 * and a second copy of the rule would be a second answer to "is this the right
 * product", which is the question a refund turns on.
 */
export function sameProductName(a: string, b: string): boolean {
  const x = loose(a);
  const y = loose(b);
  if (x === '' || y === '') return false;
  return x === y || x.includes(y) || y.includes(x);
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
  const ourItems = itemsOf(o);
  // OUR SIDE MAY BE A LIST. The screenshot names one product; the order may hold
  // several. Any one of them being the named product means the two documents
  // agree, and the one that agreed is the one shown, so the two columns read
  // identically instead of looking wrong beside a product the person did buy.
  let productAgree: boolean | null = null;
  let ourProductShown = ourProduct;
  if (shotProduct != null) {
    if (ourProduct != null && sameProductName(shotProduct, ourProduct)) {
      productAgree = true;
    } else {
      const hit = ourItems.find((it) => sameProductName(shotProduct, it.name));
      if (hit) {
        productAgree = true;
        ourProductShown = hit.name;
      } else if (ourProduct != null) {
        productAgree = false;
      } else if (ourItems.length > 0) {
        productAgree = false;
        ourProductShown = ourItems[0].name;
      }
    }
  } else if (ourProduct == null && ourItems.length > 0) {
    ourProductShown = ourItems[0].name;
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
    row('productName', 'Product name', shotProduct, ourProductShown, productAgree),
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

/* ============================================================================
   DOES THIS ORDER CONTAIN WHAT WE ASKED THEM TO BUY?
   ----------------------------------------------------------------------------
   A different question from everything above, asked of the same data.

   Above: does the user's screenshot say the same as the user's own order. Both
   sides are theirs, and it leaks nothing.

   Here: is one of the products on this order the campaign's product, at the
   campaign's price. This is the question the automatic check after "yes, I
   purchased" has to answer, over an order that may hold several products.

   EXACT, PURE, AND WITHOUT A TOLERANCE ANYWHERE IN IT. The staff side
   (EvidenceMatchService) has a rupee band and a percentage band and prints them
   out loud, and it is staff-only for that reason. This one has no band, so there
   is nothing here for somebody to find the edge of by uploading twice.

   IT NEVER SAYS ONLY "NO MATCH". Every answer names what failed, because "no
   match" tells the person nothing and tells the next person reading a record even
   less.
   ========================================================================== */

/** What the campaign says the product is and what it should cost. */
export interface CampaignForOrderMatch {
  productName?: string | null;
  /** The campaign's own expected price, in integer paise. */
  expectedPricePaise?: bigint | number | null;
}

/**
 * Why the answer is what it is. Each one names a thing that actually happened.
 *
 *   matched                 one product on the order is it, at the right price
 *   product_name_not_found  nothing on the order is that product
 *   price_differs           the product is on the order, at a different price
 *   no_products_read        we could not read any product off the order
 *   no_campaign_product     the campaign does not say what the product is
 *   no_expected_price       the campaign does not say what it should cost
 */
export type OrderMatchReason =
  | 'matched'
  | 'product_name_not_found'
  | 'price_differs'
  | 'no_products_read'
  | 'no_campaign_product'
  | 'no_expected_price';

export interface OrderMatchAnswer {
  matches: boolean;
  reason: OrderMatchReason;
  /**
   * The product this answer is about, where there is one.
   *
   * On a match, the product that matched. On `price_differs`, the product whose
   * NAME matched, so whoever shows this can say which product and what it
   * actually cost without going and looking for it again.
   */
  item: OrderItemForComparison | null;
}

/**
 * One campaign product against an order that may hold several.
 *
 * THE RULE: the order matches if ANY product on it is the campaign's product by
 * name AND that product's price is the campaign's expected price. Not the order
 * total, not the sum of the products — that one product's own price.
 */
export function matchOrderToCampaign(
  order: OwnOrderForComparison | null | undefined,
  campaign: CampaignForOrderMatch | null | undefined,
): OrderMatchAnswer {
  const o = order && typeof order === 'object' ? order : {};
  const c = campaign && typeof campaign === 'object' ? campaign : {};

  const items = itemsOf(o);
  if (items.length === 0) {
    return { matches: false, reason: 'no_products_read', item: null };
  }

  const wanted = typeof c.productName === 'string' && c.productName.trim() !== ''
    ? c.productName.trim() : null;
  if (wanted == null) {
    return { matches: false, reason: 'no_campaign_product', item: null };
  }

  // NAME FIRST, ALWAYS. "The product is not on this order" and "the product is on
  // this order at the wrong price" are two different things to be told, and the
  // second one can only be said once the first has been answered.
  const named = items.filter((it) => sameProductName(wanted, it.name));
  if (named.length === 0) {
    return { matches: false, reason: 'product_name_not_found', item: null };
  }

  const raw = c.expectedPricePaise;
  if (raw == null) {
    return { matches: false, reason: 'no_expected_price', item: named[0] };
  }
  const expected = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(raw));

  const exact = named.find((it) => it.pricePaise === expected);
  if (exact) return { matches: true, reason: 'matched', item: exact };
  return { matches: false, reason: 'price_differs', item: named[0] };
}
