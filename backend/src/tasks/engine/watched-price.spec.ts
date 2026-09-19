import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseOrderText } from '../../ocr/order-text';
import {
  PRICE_GAP_REASONS,
  isAPriceGapReason,
  theBillAddsUp,
  theRefundBase,
  theShareOfTheBillDiscount,
} from './watched-price';

/**
 * WHAT A PURCHASE FAYR WATCHED IS REFUNDED ON — Phase 8B-a, 19 September 2026.
 *
 * ── READ OFF REAL PAGES, NOT OFF SENTENCES TYPED HERE ────────────────────────
 *
 * Every figure below that matters comes from a page somebody really bought
 * something on, parsed by the real parser at the top of each block:
 *
 *   zepto-order-page-drawn.txt              six products, every one discounted
 *                                           on its own line, delivery and
 *                                           handling both waived
 *   zepto-order-page-drawn-two-shipments.txt  the campaign purchase, two parcels
 *   zepto-order-two-shipments.txt           the same order as a screenshot reads
 *   amazon-order-page-garment-rack.txt      the only bill-level discount anybody
 *                                           has captured: "Promotion Applied:
 *                                           -₹80.00"
 *   #LRGSKOMA18669 (inline)                 the only page where a delivery fee
 *                                           was really CHARGED — ₹30 of ₹104 —
 *                                           and the only one stating "2 units"
 *
 * Where a shape has never been photographed — a coupon on a quick-commerce page
 * — the arithmetic is exercised over a page built here from a label that HAS
 * been measured, and the block says so in as many words.
 */

const FIXTURES = join(__dirname, '..', '..', '..', 'test', 'fixtures');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** The owner's own Zepto order with a fee that was charged. See order-text.spec.ts. */
const CHARGED_FEE_PAGE = [
  'Order #LRGSKOMA18669', '1 item', 'Delivered', 'Arrived in', '4 MINS',
  '1 item in order',
  "Korean Kab's Jackpot 2x Hot and Spicy Instant Noodles Non Veg",
  '1 pack (100 g)', '2 units', '₹74', '₹100',
  'Bill Summary', 'Item Total', '₹100', '₹74',
  'Delivery Fee', '₹30', 'Handling Fee', '₹10', 'FREE',
  'Total Bill', '₹140', '₹104',
  'Order Details', 'Order ID', '#LRGSKOMA18669',
  'Order Placed at', '23 Aug 2026, 6:04 AM',
].join('\n');

/** The bill block of a parsed page, in the shape the rule reads. */
function billOf(text: string) {
  const p = parseOrderText(text);
  return {
    itemTotalPaise: p.itemTotalPaise,
    totalPaise: p.totalPaise,
    feesPaise: p.feesPaise,
    billDiscountPaise: p.billDiscountPaise,
  };
}

describe('what a purchase Fayr watched is refunded on', () => {
  describe('the struck pair: the paid figure, never the one struck through', () => {
    const page = parseOrderText(fixture('zepto-order-page-drawn.txt'));
    const razor = page.items.find((i) => i.name.startsWith('Gillette Fusion'));

    it('reads the razor as ₹340 paid with ₹425 struck through', () => {
      expect(razor).toBeDefined();
      expect(razor?.pricePaise).toBe(34000n);
      expect(razor?.wasPricePaise).toBe(42500n);
    });

    it('REFUNDS ON THE ₹340 THAT WAS PAID, not the ₹425 that was not', () => {
      const out = theRefundBase({
        item: razor ?? null,
        items: page.items,
        bill: billOf(fixture('zepto-order-page-drawn.txt')),
        listedPaise: 42500n,
      });
      expect(out.paise).toBe(34000n);
      expect(out.because).toBe('shop-discount');
    });

    it('and says so for every one of the six products on that page', () => {
      for (const item of page.items) {
        const out = theRefundBase({
          item,
          items: page.items,
          bill: billOf(fixture('zepto-order-page-drawn.txt')),
          listedPaise: item.wasPricePaise ?? item.pricePaise,
        });
        expect(out.paise).toBe(item.pricePaise);
        expect(out.because).toBe('shop-discount');
      }
    });

    it('a lower price with NO struck figure beside it is not called a discount', () => {
      // The same order read as a screenshot: one figure per product, no pair.
      const shot = parseOrderText(fixture('zepto-order-two-shipments.txt'));
      const band = shot.items[0];
      expect(band.wasPricePaise).toBeNull();
      const out = theRefundBase({
        item: band,
        items: shot.items,
        bill: billOf(fixture('zepto-order-two-shipments.txt')),
        listedPaise: 32500n,
      });
      expect(out.paise).toBe(14900n);
      // THE PAGE PRINTED NO REASON, so none is invented. 'unknown' is the answer.
      expect(out.because).toBe('unknown');
    });
  });

  describe('the charges the shop adds on top are never part of it', () => {
    const page = parseOrderText(CHARGED_FEE_PAGE);
    const bill = billOf(CHARGED_FEE_PAGE);

    it('reads ₹74 of products, ₹30 of delivery and ₹104 charged', () => {
      expect(bill.itemTotalPaise).toBe(7400n);
      expect(bill.feesPaise).toBe(3000n);
      expect(bill.totalPaise).toBe(10400n);
      expect(theBillAddsUp(bill)).toBe(true);
    });

    it('THE OWNER’S OWN CASE: the refund is on the product, not on the bill', () => {
      // "The amount is showing 359 and the user paid, for example, 400. It is
      // around ₹41 in delivery charge, so at that point the user will receive
      // only a refund on 359, not on 400."
      const out = theRefundBase({
        item: page.items[0],
        items: page.items,
        bill,
        listedPaise: 3700n,
      });
      // ₹74 bought TWO of them, so one cost ₹37 — and ₹37 is what the offer says.
      expect(out.paise).toBe(3700n);
      expect(out.because).toBe('fees-on-top');
      // AND THE ₹30 IS NOWHERE IN IT. Not added, not subtracted, never seen.
      expect(out.paise).not.toBe(10400n);
      expect(out.paise).not.toBe(7400n);
    });

    it('a waived fee is a zero and a page that names none is a null', () => {
      expect(billOf(fixture('zepto-order-page-drawn.txt')).feesPaise).toBe(0n);
      expect(billOf(fixture('zepto-order-page-drawn-two-shipments.txt')).feesPaise).toBe(0n);
      expect(billOf(fixture('zepto-order-two-shipments.txt')).feesPaise).toBe(0n);
      // A row out of a list has no bill block at all.
      expect(parseOrderText('Order ID 1\nA Thing ₹100').feesPaise).toBeNull();
    });

    it('a fee, a tip and a platform charge can never reach the base, by construction', () => {
      // The base is built UP from the product's own line. There is no
      // subtraction from a total anywhere in it, so a charge nobody parsed
      // cannot move it. Proved by moving the bill around under a fixed product.
      const item = { name: 'A Thing', pricePaise: 10000n };
      const listed = 10000n;
      for (const bill of [
        { itemTotalPaise: 10000n, totalPaise: 10000n, feesPaise: 0n, billDiscountPaise: null },
        { itemTotalPaise: 10000n, totalPaise: 14100n, feesPaise: 4100n, billDiscountPaise: null },
        { itemTotalPaise: 10000n, totalPaise: 99900n, feesPaise: null, billDiscountPaise: null },
        { itemTotalPaise: null, totalPaise: null, feesPaise: null, billDiscountPaise: null },
      ]) {
        expect(theRefundBase({ item, items: [item], bill, listedPaise: listed }).paise)
          .toBe(10000n);
      }
    });
  });

  describe('a discount taken off the whole bill', () => {
    it('ONE PRODUCT TAKES THE WHOLE OF IT', () => {
      // The measured label, on a page with one product on it.
      const page = parseOrderText([
        'Order ID 408-0000000-0000000',
        'Order Summary',
        'Item(s) Subtotal:', '₹1,000.00',
        'Promotion Applied:', '-₹200.00',
        'Grand Total:', '₹800.00',
        'A Thing Somebody Bought', '₹1,000.00',
      ].join('\n'));
      expect(page.billDiscountPaise).toBe(20000n);
      const out = theRefundBase({
        item: page.items[0],
        items: page.items,
        bill: billOf([
          'Order ID 408-0000000-0000000',
          'Order Summary',
          'Item(s) Subtotal:', '₹1,000.00',
          'Promotion Applied:', '-₹200.00',
          'Grand Total:', '₹800.00',
          'A Thing Somebody Bought', '₹1,000.00',
        ].join('\n')),
        listedPaise: 100000n,
      });
      expect(out.paise).toBe(80000n);
      expect(out.because).toBe('coupon');
    });

    it('TWO PRODUCTS SHARE IT BY PRICE, not by count', () => {
      const dear = { name: 'Dear Thing', pricePaise: 30000n };
      const cheap = { name: 'Cheap Thing', pricePaise: 10000n };
      const items = [dear, cheap];
      const bill = {
        itemTotalPaise: 40000n, totalPaise: 30000n, feesPaise: null, billDiscountPaise: 10000n,
      };
      // ₹100 over ₹300 and ₹100 is ₹75 and ₹25 — never ₹50 each.
      expect(theShareOfTheBillDiscount(dear, items, 10000n)).toBe(7500n);
      expect(theShareOfTheBillDiscount(cheap, items, 10000n)).toBe(2500n);
      expect(theRefundBase({ item: dear, items, bill, listedPaise: 30000n }).paise).toBe(22500n);
      expect(theRefundBase({ item: cheap, items, bill, listedPaise: 30000n }).paise).toBe(7500n);
    });

    it('the odd paise goes to Fayr and never out of the wallet', () => {
      // ₹1.00 over ₹3.33 and ₹6.67 does not divide. Both shares round UP, so the
      // two bases add to LESS than what was paid, never to more.
      const a = { name: 'A', pricePaise: 333n };
      const b = { name: 'B', pricePaise: 667n };
      const items = [a, b];
      const shareA = theShareOfTheBillDiscount(a, items, 100n);
      const shareB = theShareOfTheBillDiscount(b, items, 100n);
      expect(shareA).toBe(34n);
      expect(shareB).toBe(67n);
      expect(shareA + shareB).toBeGreaterThanOrEqual(100n);
      expect((333n - shareA) + (667n - shareB)).toBeLessThanOrEqual(900n);
    });

    it('never takes more off a product than the product cost', () => {
      const one = { name: 'One', pricePaise: 5000n };
      expect(theShareOfTheBillDiscount(one, [one], 999999n)).toBe(5000n);
      expect(theRefundBase({
        item: one,
        items: [one],
        bill: {
          itemTotalPaise: 5000n, totalPaise: 0n, feesPaise: null, billDiscountPaise: 999999n,
        },
        listedPaise: 5000n,
      }).paise).toBe(0n);
    });

    it('no discount, a zero discount and a missing one all take nothing off', () => {
      const one = { name: 'One', pricePaise: 5000n };
      for (const none of [null, undefined, 0n, -100n]) {
        expect(theShareOfTheBillDiscount(one, [one], none)).toBe(0n);
      }
    });

    it('AND NO QUICK-COMMERCE PAGE HAS EVER PRINTED ONE', () => {
      // Which is why the case above is built rather than read. Every Zepto page
      // on disk discounts each product on its own line and states no bill-level
      // discount at all — so on a watched order the share is zero, every time.
      for (const name of [
        'zepto-order-page-drawn.txt',
        'zepto-order-page-drawn-two-shipments.txt',
        'zepto-order-two-shipments.txt',
      ]) {
        expect(billOf(fixture(name)).billDiscountPaise).toBeNull();
      }
      expect(parseOrderText(CHARGED_FEE_PAGE).billDiscountPaise).toBeNull();
    });
  });

  describe('the ceiling: never a percentage of more than the offer advertised', () => {
    it('a product that cost MORE than the offer says is capped at the offer', () => {
      const item = { name: 'A Thing', pricePaise: 50000n };
      const out = theRefundBase({
        item,
        items: [item],
        bill: { itemTotalPaise: 50000n, totalPaise: 50000n, feesPaise: 0n, billDiscountPaise: null },
        listedPaise: 35900n,
      });
      expect(out.paise).toBe(35900n);
      expect(out.because).toBe('price-rose');
    });

    it('and a product that cost LESS is paid on what it cost', () => {
      const item = { name: 'A Thing', pricePaise: 30000n, wasPricePaise: 40000n };
      const out = theRefundBase({
        item,
        items: [item],
        bill: { itemTotalPaise: 30000n, totalPaise: 30000n, feesPaise: 0n, billDiscountPaise: null },
        listedPaise: 35900n,
      });
      expect(out.paise).toBe(30000n);
      expect(out.because).toBe('shop-discount');
    });

    it('an offer that states no price states no ceiling, and pays nothing by itself', () => {
      const item = { name: 'A Thing', pricePaise: 30000n };
      for (const listed of [null, undefined, 0n, -1n]) {
        const out = theRefundBase({ item, items: [item], bill: null, listedPaise: listed });
        expect(out.paise).toBeNull();
        expect(out.because).toBe('unknown');
      }
    });
  });

  describe('a line that holds more than one of them', () => {
    it('DIVIDES BY THE COUNT THE PAGE PRINTED — ₹74 for 2 units is ₹37 each', () => {
      const page = parseOrderText(CHARGED_FEE_PAGE);
      expect(page.items[0].unitsStated).toBe(2);
      const out = theRefundBase({
        item: page.items[0],
        items: page.items,
        bill: billOf(CHARGED_FEE_PAGE),
        listedPaise: 10000n,
      });
      expect(out.paise).toBe(3700n);
    });

    it('and refuses rather than round when it does not divide', () => {
      const item = { name: 'A Thing', pricePaise: 10000n, unitsStated: 3 };
      const out = theRefundBase({
        item, items: [item], bill: null, listedPaise: 10000n,
      });
      expect(out.paise).toBeNull();
      expect(out.because).toBe('unknown');
    });

    it('a count of one, and a page that states none, leave the figure alone', () => {
      for (const units of [1, null, undefined]) {
        const item = { name: 'A Thing', pricePaise: 10000n, unitsStated: units };
        expect(theRefundBase({ item, items: [item], bill: null, listedPaise: 10000n }).paise)
          .toBe(10000n);
      }
    });

    it('and an absurd count is refused rather than divided by', () => {
      for (const units of [0, -2, 101, 1.5, Number.NaN]) {
        const item = { name: 'A Thing', pricePaise: 10000n, unitsStated: units };
        expect(theRefundBase({ item, items: [item], bill: null, listedPaise: 10000n }).paise)
          .toBeNull();
      }
    });
  });

  describe('integer paise, and never a float', () => {
    it('every figure it answers is a bigint or null', () => {
      const page = parseOrderText(fixture('zepto-order-page-drawn.txt'));
      for (const item of page.items) {
        const out = theRefundBase({
          item, items: page.items, bill: billOf(fixture('zepto-order-page-drawn.txt')), listedPaise: 42500n,
        });
        expect(out.paise === null || typeof out.paise === 'bigint').toBe(true);
      }
      expect(typeof theShareOfTheBillDiscount(
        { name: 'A', pricePaise: 333n }, [{ name: 'A', pricePaise: 333n }], 100n,
      )).toBe('bigint');
    });

    it('and the source of the rule contains no floating-point arithmetic at all', () => {
      const src = readFileSync(join(__dirname, 'watched-price.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      // Math.round and friends, Number() on a figure, a decimal literal, and the
      // one operator that silently turns paise into something else.
      expect(src).not.toMatch(/Math\.(round|floor|ceil|abs)\s*\(/);
      expect(src).not.toMatch(/parseFloat|toFixed/);
      expect(src).not.toMatch(/\b\d+\.\d+\b/);
      // Every numeric literal in it is a bigint literal.
      const numbers = src.match(/\b\d+n?\b/g) ?? [];
      for (const n of numbers) {
        expect(n.endsWith('n') || /^\d{1,3}$/.test(n)).toBe(true);
      }
    });
  });

  describe('why it differed, derived only from lines the page printed', () => {
    it('names every reason, and they are all machine names', () => {
      expect([...PRICE_GAP_REASONS].sort()).toEqual([
        'coupon', 'fees-on-top', 'none', 'price-rose', 'shop-discount', 'unknown',
      ]);
      for (const r of PRICE_GAP_REASONS) expect(isAPriceGapReason(r)).toBe(true);
      for (const junk of ['COUPON', 'a coupon', '', null, 7, {}]) {
        expect(isAPriceGapReason(junk)).toBe(false);
      }
    });

    it('NONE when they paid the offer’s price and the bill added nothing', () => {
      const item = { name: 'A Thing', pricePaise: 35900n };
      const out = theRefundBase({
        item,
        items: [item],
        bill: {
          itemTotalPaise: 35900n, totalPaise: 35900n, feesPaise: 0n, billDiscountPaise: null,
        },
        listedPaise: 35900n,
      });
      expect(out.because).toBe('none');
      expect(out.paise).toBe(35900n);
    });

    it('UNKNOWN when the page stated no charge line at all, even at the right price', () => {
      // The 18 September Zepto read is exactly this shape: one product, a price,
      // and no bill block — its stored row has a null total to this day.
      const item = { name: 'A Thing', pricePaise: 36600n };
      const out = theRefundBase({
        item,
        items: [item],
        bill: {
          itemTotalPaise: null, totalPaise: null, feesPaise: null, billDiscountPaise: null,
        },
        listedPaise: 36600n,
      });
      expect(out.because).toBe('unknown');
      // AND THE BASE IS STILL THE RIGHT FIGURE. The note is shy; the money is not.
      expect(out.paise).toBe(36600n);
    });

    it('UNKNOWN when the bill does not add up from the lines we can read', () => {
      const item = { name: 'A Thing', pricePaise: 35900n };
      const out = theRefundBase({
        item,
        items: [item],
        bill: {
          // ₹359 of products, no fee named, but ₹400 charged: something was
          // printed that nothing here parsed — a platform fee, a tip, a
          // membership. No statement about this bill can honestly be made.
          itemTotalPaise: 35900n, totalPaise: 40000n, feesPaise: 0n, billDiscountPaise: null,
        },
        listedPaise: 35900n,
      });
      expect(out.because).toBe('unknown');
    });

    it('and the real pages all add up', () => {
      for (const name of [
        'zepto-order-page-drawn.txt',
        'zepto-order-page-drawn-two-shipments.txt',
        'zepto-order-two-shipments.txt',
        'amazon-order-page-garment-rack.txt',
      ]) {
        expect(theBillAddsUp(billOf(fixture(name)))).toBe(true);
      }
      expect(theBillAddsUp(billOf(CHARGED_FEE_PAGE))).toBe(true);
    });

    it('a bill with a figure missing does not add up, and does not pretend to', () => {
      expect(theBillAddsUp(null)).toBe(false);
      expect(theBillAddsUp({
        itemTotalPaise: null, totalPaise: 100n, feesPaise: 0n, billDiscountPaise: null,
      })).toBe(false);
      expect(theBillAddsUp({
        itemTotalPaise: 100n, totalPaise: null, feesPaise: 0n, billDiscountPaise: null,
      })).toBe(false);
    });

    it('nothing at all is not a product, and answers nothing', () => {
      for (const item of [null, undefined, { name: 'A', pricePaise: 0n }]) {
        const out = theRefundBase({ item, items: [], bill: null, listedPaise: 10000n });
        expect(out.paise).toBeNull();
        expect(out.because).toBe('unknown');
      }
    });
  });
});
