import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BILL_LABELS, parseOrderText } from './order-text';
import { paiseFromRupees, rupeesFromPaise } from './order-comparison';

/**
 * A REAL ZEPTO ORDER, READ AS TEXT.
 *
 * The fixture is the layout of one real order screen, top to bottom, as text —
 * both shipment headings, both products, the bill block, and the noise around
 * them (the shop's own name, a heading, a delivery time, a payment line). It is a
 * file rather than a string in here so it can be read the way a person reads the
 * screen, and so the layout can be corrected later without touching the checks.
 *
 * These are the owner's own figures, and every one of them is asserted below:
 *
 *   order number  SOSIJGGRL26770
 *   shipments     2
 *   products      2
 *     Boldfit Strapless Sports Headband     149 rupees
 *     Hammer Nova earphones                 219 rupees
 *   item total    368 rupees
 *   total bill    368 rupees
 */
const ZEPTO = readFileSync(
  join(__dirname, '..', '..', 'test', 'fixtures', 'zepto-order-two-shipments.txt'),
  'utf8',
);

describe('reading an order screen that holds several shipments', () => {
  describe('the real Zepto order, every figure the owner listed', () => {
    const order = parseOrderText(ZEPTO);

    it('reads the order number', () => {
      expect(order.orderNumber).toBe('SOSIJGGRL26770');
    });

    it('reads the day it was placed, not the day it arrived', () => {
      // Both shipment lines carry a later time on the same day, and the delivery
      // time must never be mistaken for the order time. Same day here on purpose:
      // a quick commerce order arrives within the hour, so the two dates agreeing
      // is the normal case and a check that only passed on different days would
      // never fire on a real Zepto order.
      expect(order.orderDate).toBe('2026-08-21');
    });

    it('counts both shipments', () => {
      expect(order.shipments).toBe(2);
    });

    it('finds both products, in the order they appear', () => {
      expect(order.items.map((i) => i.name)).toEqual([
        'Boldfit Strapless Sports Headband',
        'Hammer Nova earphones',
      ]);
    });

    it('finds each product’s own price', () => {
      expect(order.items.map((i) => i.pricePaise)).toEqual([14900n, 21900n]);
    });

    it('reads the item total', () => {
      expect(order.itemTotalPaise).toBe(36800n);
    });

    it('reads the total bill', () => {
      expect(order.totalPaise).toBe(36800n);
    });

    it('says both prices in rupees the way a person would read them', () => {
      // The only two converters, used the only way round they are allowed to be
      // used: paise inside, rupees at the moment of showing.
      expect(order.items.map((i) => rupeesFromPaise(i.pricePaise))).toEqual([
        '₹149.00', '₹219.00',
      ]);
      expect(rupeesFromPaise(order.totalPaise)).toBe('₹368.00');
    });
  });

  describe('the noise around the products is not read as a product', () => {
    const order = parseOrderText(ZEPTO);

    it('leaves the bill lines out of the products', () => {
      const names = order.items.map((i) => i.name.toLowerCase());
      for (const label of ['item total', 'handling charge', 'delivery fee', 'total bill']) {
        expect(names).not.toContain(label);
      }
      expect(order.items).toHaveLength(2);
    });

    it('leaves the shop’s name, the heading and the delivery lines out', () => {
      const names = order.items.map((i) => i.name);
      expect(names).not.toContain('Zepto');
      expect(names).not.toContain('Order Details');
      for (const name of names) expect(name.startsWith('Delivered')).toBe(false);
      for (const name of names) expect(name.startsWith('Shipment')).toBe(false);
    });

    it('never lets a free line become a price', () => {
      // "Delivery Fee FREE" has no figure at all. A parser that read that as a
      // zero would put a zero rupee product on somebody's order.
      for (const item of order.items) expect(item.pricePaise > 0n).toBe(true);
    });

    it('keeps the bill labels it skips in one named list', () => {
      // Named, so the next shop's wording is added in one place rather than being
      // typed into a regular expression somewhere in the middle of the reader.
      expect(BILL_LABELS.length).toBeGreaterThan(0);
    });
  });

  describe('the traps a same day order hides', () => {
    // THE FIXTURE CANNOT PROVE THESE. A Zepto order arrives within the hour, so
    // its order date and its delivery date are the same day, and a reader that
    // took the delivery date would still look right on it. These three checks are
    // laid out so that they can only pass for the right reason.

    it('takes the day it was placed even when it arrived on another day', () => {
      const order = parseOrderText([
        'Order ID SOSIJGGRL26770',
        'Placed on 21 Aug 2026, 11:48 PM',
        'Shipment 1 of 1',
        'Delivered on 22 Aug 2026, 12:19 AM',
        'Boldfit Strapless Sports Headband',
        '1 x ₹149',
        'Bill Details',
        'Total Bill ₹149',
      ].join('\n'));
      expect(order.orderDate).toBe('2026-08-21');
    });

    it('ignores a delivery date even when it is printed first', () => {
      // A quick commerce screen leads with the delivery, so the delivery date can
      // sit ABOVE the order date. A reader that simply took the first date it saw
      // would look right on the fixture and be wrong here, which is why this case
      // is written the awkward way round on purpose.
      const order = parseOrderText([
        'Delivered on 22 Aug 2026, 12:19 AM',
        'Order ID SOSIJGGRL26770',
        'Placed on 21 Aug 2026, 11:48 PM',
        'Boldfit Strapless Sports Headband',
        '1 x ₹149',
        'Bill Details',
        'Total Bill ₹149',
      ].join('\n'));
      expect(order.orderDate).toBe('2026-08-21');
    });

    it('will not take a word off the next line as an order number', () => {
      // "Order ID" with the value missing, and a line under it with no space in
      // it. Only the rule that an order number carries a digit stops this.
      expect(parseOrderText('Order ID\nDelivered\nBill Details').orderNumber)
        .toBeNull();
    });

    it('keeps the product’s own price when two of it were bought', () => {
      // "2 x ₹149" then "₹298". The item's own price is ₹149 and the ₹298 is what
      // that line came to. Reading the ₹298 as a price would say the product
      // costs twice what it does; reading it as another line would put a second
      // product on the order that nobody bought.
      const order = parseOrderText([
        'Order ID: 12345678',
        'Boldfit Strapless Sports Headband',
        '2 x ₹149',
        '₹298',
        'Bill Details',
        'Total Bill ₹298',
      ].join('\n'));
      expect(order.items).toEqual([
        { name: 'Boldfit Strapless Sports Headband', pricePaise: 14900n },
      ]);
      expect(order.totalPaise).toBe(29800n);
    });
  });

  describe('the easy case still works', () => {
    // The reader used to assume exactly this: one order, one product, no
    // shipments. Fixing the hard case by breaking the easy one would be a step
    // backwards, so the easy one is checked here every time.
    const ONE = [
      'Amazon.in',
      'Order Details',
      'Ordered on 2 Jul 2026',
      'Order# 402-3925017-7784521',
      'Prestige Induction Cooktop 1900W Black',
      '₹1,326.00',
      'Order Summary',
      'Item(s) Subtotal ₹1,326.00',
      'Grand Total ₹1,326.00',
    ].join('\n');

    it('reads one order with one product', () => {
      const order = parseOrderText(ONE);
      expect(order.orderNumber).toBe('402-3925017-7784521');
      expect(order.orderDate).toBe('2026-07-02');
      expect(order.shipments).toBe(0);
      expect(order.items).toEqual([
        {
          name: 'Prestige Induction Cooktop 1900W Black',
          pricePaise: 132600n,
        },
      ]);
      expect(order.totalPaise).toBe(132600n);
    });

    it('reads a product whose price sits on the same line', () => {
      const order = parseOrderText([
        'Order ID: 12345678',
        'Boldfit Strapless Sports Headband ₹149',
        'Bill Details',
        'Total Bill ₹149',
      ].join('\n'));
      expect(order.items).toEqual([
        { name: 'Boldfit Strapless Sports Headband', pricePaise: 14900n },
      ]);
    });
  });

  describe('nothing is invented when there is nothing to read', () => {
    it('gives an empty shape for empty text', () => {
      expect(parseOrderText('')).toEqual({
        orderNumber: null,
        orderDate: null,
        totalPaise: null,
        itemTotalPaise: null,
        shipments: 0,
        items: [],
      });
    });

    it('gives an empty shape for text that is not an order at all', () => {
      const order = parseOrderText('Hello\nThis is a picture of a cat\n');
      expect(order.orderNumber).toBeNull();
      expect(order.items).toEqual([]);
      expect(order.totalPaise).toBeNull();
    });

    it('survives anything that is not text', () => {
      for (const junk of [null, undefined, 5, {}, []]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(parseOrderText(junk as any).items).toEqual([]);
      }
    });

    it('does not accept a scrap of a line as an order number', () => {
      // "Order ID" with nothing readable after it must stay unknown. An order
      // number half read is worse than none: it would be compared, and it would
      // disagree with the real one.
      expect(parseOrderText('Order ID\n\nBill Details').orderNumber).toBeNull();
      expect(parseOrderText('Order ID: --').orderNumber).toBeNull();
    });
  });

  describe('the money never leaves paise on the way in', () => {
    it('turns every figure into paise through the one converter', () => {
      const order = parseOrderText(ZEPTO);
      // The same numbers, arrived at the other way round. If the reader ever grew
      // its own rupees to paise sum, this is where the two would part company.
      expect(order.items[0].pricePaise).toBe(paiseFromRupees(149));
      expect(order.items[1].pricePaise).toBe(paiseFromRupees(219));
      expect(order.totalPaise).toBe(paiseFromRupees(368));
    });

    it('reads paise after the point without losing them', () => {
      const order = parseOrderText([
        'Order ID: 99887766',
        'Some Product Name Here',
        '1 x ₹1,299.50',
        'Bill Details',
        'Total Bill ₹1,299.50',
      ].join('\n'));
      expect(order.items[0].pricePaise).toBe(129950n);
      expect(order.totalPaise).toBe(129950n);
    });
  });
});
