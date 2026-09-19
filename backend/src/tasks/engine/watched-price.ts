/**
 * WHAT TO REFUND ON A PURCHASE FAYR WATCHED, AND WHY IT DIFFERED — THE RULES.
 *
 * ── THE OWNER'S WORDS, 19 SEPTEMBER 2026 ──────────────────────────────────────
 *
 * On the price no longer being a reason to refuse:
 *
 *   "It doesn't matter [if the price differs]. You just have to go and check if
 *    the user has purchased the product inside the Fayr app or not, the same
 *    product he has purchased, and whatever amount the user has paid, because we
 *    will know the actual amount paid by the user. We will just give a refund on
 *    that particular amount, the paid amount, not on the amount that we were
 *    showing on our app."
 *
 * On what is NOT part of it:
 *
 *   "The amount is showing 359 and the user paid, for example, 400. It is around
 *    ₹41 in delivery charge, so at that point the user will receive only a refund
 *    on 359, not on 400. The extra delivery charge is not in our hands."
 *
 * On a coupon:
 *
 *   "If the amount is lower than the specified amount ... if there is any coupon
 *    or anything, we will just refund the amount on the total amount that they
 *    have paid after adding a coupon or offers."
 *
 * Those three are one rule with a floor and a ceiling:
 *
 *   THE REFUND BASE = min(what was paid for THAT product, what the offer listed)
 *
 * The person never gets less than they paid taken as the base, and Fayr never
 * pays a percentage of more than it advertised. Everything below is that one
 * line, plus the arithmetic for working out the first half of it honestly.
 *
 * ── WHAT "WHAT WAS PAID FOR THAT PRODUCT" MEANS, EXACTLY ─────────────────────
 *
 * The product's own price as the page prints it AFTER the shop's own discount —
 * which is already what order-text.ts hands over, because a struck pair has
 * always been read as the smaller of the two — LESS this product's share of any
 * discount the page takes off the WHOLE bill.
 *
 * AND NOTHING THAT IS NOT THE PRODUCT. Delivery, handling, shipping, a platform
 * or small-cart fee, a tip, packaging: never part of it, in either direction.
 * They are not subtracted either, because they were never in the figure to
 * begin with — the base is built UP from the product's own line and never DOWN
 * from a bill total. That is structural, and it is why a fee line nobody has
 * ever measured cannot leak into somebody's refund: there is no arithmetic here
 * that a missing fee could change.
 *
 * ── AND WHY IT DIFFERED IS A NOTE, NOT AN INPUT ──────────────────────────────
 *
 * `because` names what the page printed that explains the gap. It is recorded
 * for the person at Fayr who has to answer "why is this refund not the number on
 * the offer?", and it is read by nothing that decides money — not the refund
 * gate, not the engine, not the wallet. The whole payout input is `paise`.
 *
 * Every answer is derived from a line the page ACTUALLY PRINTED. Where the page
 * printed nothing that explains it, the answer is 'unknown', which is a real
 * answer and the honest one. Nothing here guesses at a coupon nobody saw.
 *
 * PURE. No Prisma, no Nest, no clock, no floats — integer paise throughout.
 */

/**
 * WHY WHAT THEY PAID IS NOT WHAT THE OFFER SAID, in the page's own terms.
 *
 *   none           they paid the offer's price for it, and the bill added nothing
 *   shop-discount  the product's own line was struck through above a lower price
 *   coupon         the page took a discount off the whole bill, and this
 *                  product's share of it has been subtracted
 *   fees-on-top    the bill carried charges above the products — delivery,
 *                  handling, shipping — which are not refunded and never were
 *   price-rose     the product cost MORE than the offer listed, so the offer's
 *                  price is the ceiling and the difference is not refunded
 *   unknown        the page printed nothing that explains it, or printed a bill
 *                  that does not add up from the lines we can read
 */
export const PRICE_GAP_REASONS = [
  'none',
  'shop-discount',
  'coupon',
  'fees-on-top',
  'price-rose',
  'unknown',
] as const;

export type PriceGapReason = (typeof PRICE_GAP_REASONS)[number];

/** Is this one of the named reasons? Used where a stored value is read back. */
export function isAPriceGapReason(value: unknown): value is PriceGapReason {
  return typeof value === 'string'
    && (PRICE_GAP_REASONS as readonly string[]).includes(value);
}

/** One product as the order page printed it. `wasPricePaise` is the struck one. */
export interface ItemAsPrinted {
  name: string;
  pricePaise: bigint;
  wasPricePaise?: bigint | null;
  /**
   * How many of it the page said were bought, when it said so. See
   * ParsedOrderItem.unitsStated — on a quick-commerce page this is printed, and
   * "2 units / ₹74" means ₹74 bought both of them.
   */
  unitsStated?: number | null;
}

/**
 * Above this, a stated count is far likelier to be a misread than a real basket,
 * and dividing by it would produce a tiny refund that looked deliberate. The same
 * number, for the same reason, as MAX_PLAUSIBLE_QUANTITY in charged-amount.ts.
 */
const MOST_UNITS_A_LINE_MAY_HOLD = 100;

/**
 * WHAT ONE OF THEM COST, out of a line that may hold several.
 *
 * ── ONLY A COUNT THE PAGE ACTUALLY PRINTED ───────────────────────────────────
 *
 * A count of one, or no count at all, leaves the figure alone — which is what
 * every caller of this has always done, on every platform, and is not loosened
 * here. What is NEW is that a page SAYING there were two is now believed:
 * #LRGSKOMA18669 prints "2 units" above "₹74", and ₹74 bought both.
 *
 * ── AND ONLY WHEN IT DIVIDES EXACTLY ─────────────────────────────────────────
 *
 * Rounding real money in either direction is not a silent decision. A line that
 * does not divide by its own count answers null, the refund is held, and a person
 * reads the page — the same answer charged-amount.ts gives for the same shape.
 */
function whatOneOfThemCost(paise: bigint, units: number | null | undefined): bigint | null {
  if (units == null) return paise;
  if (!Number.isInteger(units) || units < 1 || units > MOST_UNITS_A_LINE_MAY_HOLD) {
    return null;
  }
  if (units === 1) return paise;
  const n = BigInt(units);
  return paise % n === 0n ? paise / n : null;
}

/** The bill block as the page printed it. Every field null when it said nothing. */
export interface BillAsPrinted {
  /** What the products alone came to. */
  itemTotalPaise: bigint | null;
  /** What was charged for the lot. */
  totalPaise: bigint | null;
  /** Delivery, handling and shipping, added up. Zero is a real answer. */
  feesPaise: bigint | null;
  /** A discount taken off the whole bill, as a positive figure. */
  billDiscountPaise: bigint | null;
}

export interface TheRefundBase {
  /** Integer paise to base the refund on, or null when it cannot be worked out. */
  paise: bigint | null;
  /** Why it is not the offer's price. A note. Nothing that moves money reads it. */
  because: PriceGapReason;
}

/** The paid figures of every product on the order, added up. */
function whatTheProductsCameTo(items: readonly ItemAsPrinted[]): bigint {
  let sum = 0n;
  for (const one of items) {
    if (one == null) continue;
    if (typeof one.pricePaise !== 'bigint' || one.pricePaise <= 0n) continue;
    sum += one.pricePaise;
  }
  return sum;
}

/**
 * THIS PRODUCT'S SHARE OF A DISCOUNT TAKEN OFF THE WHOLE BILL.
 *
 * ── THE WHOLE OF IT ON A ONE-PRODUCT ORDER ───────────────────────────────────
 *
 * Which is not a special case but the general rule arriving at the obvious
 * answer: one product's share of a bill it is the whole of is all of it.
 *
 * ── AND BY PRICE WHEN THERE ARE SEVERAL ──────────────────────────────────────
 *
 * A ₹100 discount over a ₹300 product and a ₹100 product takes ₹75 off the
 * first and ₹25 off the second. Apportioning by COUNT instead would take ₹50 off
 * each, which on a basket of one expensive thing and five cheap ones is not a
 * rounding difference — it is most of the discount landing on the wrong line.
 *
 * ── THE ODD PAISE GOES TO FAYR, DELIBERATELY ─────────────────────────────────
 *
 * The share is rounded UP, so the amount taken away is never less than the true
 * share and the base is never more than what was really paid. Integer bigint
 * arithmetic, no float anywhere: (d × p + sum − 1) / sum is the ceiling of
 * d × p / sum, written the only way that stays exact.
 *
 * Rounding the other way would, on a basket, hand out a paise nobody paid — and
 * "never pay above the amount actually charged" is the rule the whole of
 * charged-amount.ts is built on. A paise is not worth breaking it for.
 *
 * NEVER MORE THAN THE PRODUCT COST. A discount larger than the basket — which no
 * page has ever printed — would otherwise produce a negative base.
 */
export function theShareOfTheBillDiscount(
  item: ItemAsPrinted | null | undefined,
  items: readonly ItemAsPrinted[] | null | undefined,
  discountPaise: bigint | null | undefined,
): bigint {
  if (item == null || typeof item.pricePaise !== 'bigint') return 0n;
  if (item.pricePaise <= 0n) return 0n;
  if (typeof discountPaise !== 'bigint' || discountPaise <= 0n) return 0n;

  const all = Array.isArray(items) ? items : [];
  const sum = whatTheProductsCameTo(all);
  // A basket that does not include this product, or does not add up, is not a
  // basket this can apportion over. The product's own price is then the whole of
  // what is known, and the discount is taken against it.
  const over = sum >= item.pricePaise ? sum : item.pricePaise;

  const share = over === item.pricePaise
    ? discountPaise
    : (discountPaise * item.pricePaise + over - 1n) / over;

  return share > item.pricePaise ? item.pricePaise : share;
}

/**
 * DOES THE BILL ADD UP FROM THE LINES WE CAN READ?
 *
 * The products, less any discount on the whole bill, plus the charges on top,
 * should be what was charged. When it is, every figure below has been read; when
 * it is not, the page printed a line this project does not parse — a platform
 * fee, a tip, a membership charge, a wallet balance applied — and no statement
 * about "what else was on this bill" can honestly be made from it.
 *
 * It is asked ONLY where an answer depends on the whole bill, which is 'none' and
 * 'fees-on-top'. 'shop-discount' and 'price-rose' are read off the product's own
 * line against the offer's price and do not care what else was on the bill.
 */
export function theBillAddsUp(bill: BillAsPrinted | null | undefined): boolean {
  const b = bill ?? null;
  if (b == null) return false;
  if (typeof b.itemTotalPaise !== 'bigint') return false;
  if (typeof b.totalPaise !== 'bigint') return false;
  const discount = typeof b.billDiscountPaise === 'bigint' ? b.billDiscountPaise : 0n;
  const fees = typeof b.feesPaise === 'bigint' ? b.feesPaise : 0n;
  return b.itemTotalPaise - discount + fees === b.totalPaise;
}

/**
 * THE REFUND BASE FOR A PURCHASE FAYR WATCHED, AND WHY IT IS WHAT IT IS.
 *
 *   item         the product on the order that IS the campaign's product
 *   items        every product on the order, for apportioning a bill discount
 *   bill         the bill block as printed
 *   listedPaise  what the offer says the product costs — the ceiling
 *
 * `paise` is null, with 'unknown', when there is nothing honest to compute: no
 * product, no price on it, or an offer that states no price. A null base is not
 * a refusal of the purchase — the order still matched, the task still moves, and
 * the existing gate holds the money for a person exactly as it does today for
 * every other amount that could not be worked out.
 */
export function theRefundBase(input: {
  item: ItemAsPrinted | null | undefined;
  items?: readonly ItemAsPrinted[] | null;
  bill?: BillAsPrinted | null;
  listedPaise: bigint | null | undefined;
}): TheRefundBase {
  const item = input.item ?? null;
  const listed = typeof input.listedPaise === 'bigint' ? input.listedPaise : null;
  const bill = input.bill ?? null;

  if (item == null || typeof item.pricePaise !== 'bigint' || item.pricePaise <= 0n) {
    return { paise: null, because: 'unknown' };
  }
  // NO CEILING, NO BASE. An offer that states no price states no ceiling either,
  // and paying a percentage of an uncapped figure read off a shop's page is the
  // one thing the cap exists to stop.
  if (listed == null || listed <= 0n) {
    return { paise: null, because: 'unknown' };
  }

  const share = theShareOfTheBillDiscount(item, input.items ?? [item], bill?.billDiscountPaise);
  // THE DISCOUNT COMES OFF THE LINE, THEN THE LINE IS DIVIDED. Both orders give
  // the same answer when it divides exactly, and this one is the order the page
  // prints: a bill discount is taken off a line, not off a unit.
  const paidForTheItem = whatOneOfThemCost(item.pricePaise - share, item.unitsStated);
  if (paidForTheItem == null) {
    // The page stated a count this cannot honestly divide by. No base, and the
    // reason says what the page said rather than pretending it said nothing.
    return { paise: null, because: 'unknown' };
  }
  const paise = paidForTheItem < listed ? paidForTheItem : listed;

  return { paise, because: whyItDiffered({ item, share, paidForTheItem, listed, bill }) };
}

/**
 * WHICH PRINTED LINE EXPLAINS THE GAP. In order, because more than one can be
 * true at once and the page's own strongest statement wins.
 */
function whyItDiffered(at: {
  item: ItemAsPrinted;
  share: bigint;
  paidForTheItem: bigint;
  listed: bigint;
  bill: BillAsPrinted | null;
}): PriceGapReason {
  // A DISCOUNT OFF THE WHOLE BILL, APPORTIONED. It is the only one of these that
  // changed the base rather than merely describing it, so it is named first.
  if (at.share > 0n) return 'coupon';

  // IT COST MORE THAN THE OFFER SAID. The offer's price is the ceiling and the
  // difference is not refunded — which is a thing to be able to explain.
  if (at.paidForTheItem > at.listed) return 'price-rose';

  // IT COST LESS. The page either says why, on the product's own line, or it
  // does not and nobody may invent a reason.
  if (at.paidForTheItem < at.listed) {
    const was = typeof at.item.wasPricePaise === 'bigint' ? at.item.wasPricePaise : null;
    return was != null && was > at.item.pricePaise ? 'shop-discount' : 'unknown';
  }

  // IT COST EXACTLY WHAT THE OFFER SAID, so anything the person paid above that
  // is on the bill rather than on the product.
  const fees = typeof at.bill?.feesPaise === 'bigint' ? at.bill.feesPaise : null;
  // The page named no charge line at all — which is every order page that prints
  // no bill block, and the 18 September Zepto read was one. "It stated none" and
  // "there were none" are different things and only the second is a zero.
  if (fees == null) return 'unknown';
  if (!theBillAddsUp(at.bill)) return 'unknown';
  return fees > 0n ? 'fees-on-top' : 'none';
}
