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

  describe('one row out of a LIST of orders', () => {
    // A row in a shop's list of recent orders is the whole order in five lines,
    // with no bill block under it. This is the shape the phone hands the server
    // after it looks at somebody's order list, so it has to read.
    const ROW = [
      'Order ID SOSIJGGRL26770',
      'Placed on 21 Aug 2026',
      'Boldfit Strapless Sports Headband',
      '1 x ₹149',
      'Total ₹368',
    ].join('\n');

    it('reads a row with no bill block under it', () => {
      const order = parseOrderText(ROW);
      expect(order.orderNumber).toBe('SOSIJGGRL26770');
      expect(order.orderDate).toBe('2026-08-21');
      expect(order.totalPaise).toBe(36800n);
      expect(order.items).toEqual([
        { name: 'Boldfit Strapless Sports Headband', pricePaise: 14900n },
      ]);
    });

    it('does not turn the word Total into a product', () => {
      const order = parseOrderText(ROW);
      expect(order.items.map((i) => i.name)).not.toContain('Total');
      expect(order.items).toHaveLength(1);
    });

    it('still reads a product whose name merely starts like a label', () => {
      // "Totally" begins with the letters of "total". A label is only a label
      // when it is a whole word, or this product disappears and its price
      // becomes the order total.
      const order = parseOrderText([
        'Order ID 12345678',
        'Totally Awesome Headband ₹499',
        'Total ₹499',
      ].join('\n'));
      expect(order.items).toEqual([
        { name: 'Totally Awesome Headband', pricePaise: 49900n },
      ]);
      expect(order.totalPaise).toBe(49900n);
    });
  });

  describe('nothing is invented when there is nothing to read', () => {
    it('gives an empty shape for empty text', () => {
      expect(parseOrderText('')).toEqual({
        orderNumber: null,
        orderDate: null,
        totalPaise: null,
        itemTotalPaise: null,
        // Both null and neither false: nothing was read, so nothing is claimed.
        // "We did not look" is not "we looked and it was not returned".
        deliveryDate: null,
        returned: null,
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
  
  /**
   * ── AMAZON'S ORDER PAGE, WHICH IS WHERE THE FOUR FIELDS COME FROM ────────
   *
   * The owner's one requirement: read his Amazon order history and come back
   * with the ORDER NUMBER, the ORDER AMOUNT, the ORDER DATE and the PRODUCT
   * NAME, matched to the campaign.
   *
   * The order LIST page cannot give them. It is filled in by Amazon's own code
   * after the page arrives and a fetch runs none of it, so the cards come back
   * as empty frames — measured twice, fourteen minutes apart in one session:
   * eight matched products, then none. The order's OWN page is rendered by
   * Amazon's server, and this is the reader that has to get all four out of it.
   *
   * THE TEXT BELOW IS THE SHAPE THE PHONE REALLY HANDS OVER, taken from
   * readDetailOutcome in src/orderhistory.js: every tag becomes a line break, so
   * a label and its value arrive as two lines rather than one sentence.
   *
   * AND ONE OF THE FOUR WAS MISSING WHEN THIS WAS FIRST TRIED. "Order placed"
   * with no "on" after it did not match the date label, so the read came back
   * with the number, the total and the product and no date at all. That is why
   * the first check here is the date.
   */
  /**
   * ── THE DELIVERY, WHICH WAS BEING DROPPED ────────────────────────────────
   *
   * The order page states the day it arrived and whether it went back. The
   * reader read neither, and JudgedOrder had nowhere to put them, so they went
   * no further than the page. Both are carried now.
   *
   * TWO DATES, KEPT APART. An order placed on 2 June and delivered on 5 June has
   * both printed on it. Reading one as the other would make an order look as
   * though it was placed after it turned up, and would compare it against the
   * wrong window.
   */
  describe('when it arrived, and whether it went back', () => {
    const page = (...extra: string[]) => [
      'Order placed', '2 June 2026',
      'Order # 408-5094957-4481129',
      'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
      'Order Summary', 'Order Total ₹1,299.00',
      ...extra,
    ].join('\n');

    it('reads the day it arrived', () => {
      expect(parseOrderText(page('Delivered 5 June 2026')).deliveryDate)
        .toBe('2026-06-05');
    });

    it('and the two dates never become one', () => {
      const order = parseOrderText(page('Delivered 5 June 2026'));
      expect(order.orderDate).toBe('2026-06-02');
      expect(order.deliveryDate).toBe('2026-06-05');
      expect(order.orderDate).not.toBe(order.deliveryDate);
    });

    it('reads "Delivered on" and the label-then-date shape too', () => {
      expect(parseOrderText(page('Delivered on 5 Jun 2026')).deliveryDate)
        .toBe('2026-06-05');
      expect(parseOrderText(page('Delivered', '5 June 2026')).deliveryDate)
        .toBe('2026-06-05');
    });

    it('NULL WITHOUT A YEAR, because "Delivered 5 June" is not a date', () => {
      // A real and known limit of Amazon's own page. A year filled in from
      // today's would be an invention, and an invented year on a date the order
      // window is judged against is the worst kind.
      expect(parseOrderText(page('Delivered 5 June')).deliveryDate).toBeNull();
    });

    it('and a PROMISE about the future is never read as an arrival', () => {
      for (const line of [
        'Arriving tomorrow', 'Arriving 12 June 2026', 'Out for delivery',
        'Out for delivery 5 June 2026', 'Shipped 3 June 2026',
      ]) {
        expect(parseOrderText(page(line)).deliveryDate).toBeNull();
      }
    });

    it('a delivery CHARGE is not a delivery date', () => {
      expect(parseOrderText(page('Delivery fee ₹40')).deliveryDate).toBeNull();
    });

    it('TRUE only for a return that really happened', () => {
      for (const line of [
        'Returned', 'Return completed', 'Return complete', 'Refund issued',
        'Cancelled', 'Canceled', 'Refunded',
      ]) {
        expect(parseOrderText(page(line)).returned).toBe(true);
      }
    });

    it('and the LIMIT of that, said out loud rather than left to be found', () => {
      // "Your return is complete" reads FALSE. The words have to be adjacent,
      // because the pattern is the one the on-device reader has used against
      // these pages since it was written and this is not the place to guess at a
      // wider one.
      //
      // WHICH WAY THE RISK RUNS, AND IT IS WHY THIS STAYS NARROW. A true here
      // stops a refund — the gate refuses a returned order. So a wrong true
      // costs somebody their money and a wrong false costs a staff member a
      // second look. The narrow pattern fails in the cheaper direction.
      //
      // If Amazon is ever SEEN writing it this way, the pattern widens then, on
      // the evidence, and this check becomes the record of when it changed.
      expect(parseOrderText(page('Your return is complete')).returned).toBe(false);
    });

    it('FALSE when the page talks about returns and states none', () => {
      // The ordinary answer on a delivered order, and worth having: it is the
      // page saying "not returned". Every order page carries chrome like this,
      // which contains "Return" and never "Returned" — a looser test reported
      // every order as returned.
      for (const line of [
        'Return window closed', 'Return items: Eligible through 3 July 2026',
        'Return or replace items',
      ]) {
        expect(parseOrderText(page(line)).returned).toBe(false);
      }
    });

    it('and NULL when the page said nothing that could be one', () => {
      expect(parseOrderText(page()).returned).toBeNull();
      expect(parseOrderText(page('Delivered 5 June 2026')).returned).toBeNull();
    });

    it('the delivery line is still not read as a product', () => {
      const names = parseOrderText(page('Delivered 5 June 2026'))
        .items.map((i) => i.name);
      expect(names).toEqual(['boAt Rockerz 255 Pro Plus']);
    });
  });

  describe("Amazon's own order page, all four fields", () => {
    const orderPage = [
      'Order placed',
      '2 June 2026',
      'Order # 408-5094957-4481129',
      'Order Total',
      '₹1,299.00',
      'boAt Rockerz 255 Pro Plus Bluetooth Headphones',
      '1 x ₹1,299.00',
      'Delivered 5 June 2026',
    ].join('\n');

    it('THE ORDER DATE, from "Order placed" with no "on" after it', () => {
      expect(parseOrderText(orderPage).orderDate).toBe('2026-06-02');
    });

    it('the order number, written the way Amazon writes it', () => {
      expect(parseOrderText(orderPage).orderNumber).toBe('408-5094957-4481129');
    });

    it('the order amount, from its own label and not the first rupee token', () => {
      expect(parseOrderText(orderPage).totalPaise).toBe(129900n);
    });

    it('and the product name, which is what the match is made on', () => {
      const order = parseOrderText(orderPage);
      expect(order.items).toHaveLength(1);
      expect(order.items[0].name).toBe(
        'boAt Rockerz 255 Pro Plus Bluetooth Headphones',
      );
      expect(order.items[0].pricePaise).toBe(129900n);
    });

    it('the delivery line is NOT read as the order date', () => {
      // The order was placed on 2 June and arrived on 5 June. Reading the
      // arrival as the placing would make an order look as though it was placed
      // after it turned up, and it would be compared against the wrong window.
      expect(parseOrderText(orderPage).orderDate).not.toBe('2026-06-05');
    });

    it('and "Delivered" is not read as a product either', () => {
      const names = parseOrderText(orderPage).items.map((i) => i.name);
      expect(names.some((n) => /delivered/i.test(n))).toBe(false);
    });

    it('still reads it when the label and the value share one line', () => {
      // Not every page breaks where this one does, so both shapes are checked.
      const oneLine = [
        'Order placed 2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus ₹1,299.00',
        'Order Summary',
        'Order Total ₹1,299.00',
      ].join('\n');
      const order = parseOrderText(oneLine);
      expect(order.orderDate).toBe('2026-06-02');
      expect(order.orderNumber).toBe('408-5094957-4481129');
      expect(order.totalPaise).toBe(129900n);
    });
  });

  /**
   * ── THE PAGE ZEPTO ACTUALLY DRAWS, READ OFF THE OWNER'S OWN ACCOUNT ──────
   *
   * Everything above this point was read off SCREENSHOTS. This is the other
   * thing entirely: the text of a real Zepto order page as its own code draws
   * it, taken from the owner's signed-in account on 15 September 2026 — the
   * whole page, top to bottom, with the shop's own furniture left in and only
   * the buyer's name, number and address replaced.
   *
   * IT IS HERE BECAUSE THE READER FAILED ON IT IN FOUR OF ITS FIVE FIELDS, and
   * nobody knew, because this page had never once been read. What it answered
   * before the change beside this:
   *
   *   order number   JMOKSGSNP94115     right
   *   order date     null               "Order Placed at" — the label ends "on"
   *   delivery date  null               "Order Arrived at" — anchored at "order"
   *   total          ₹1739              the STRUCK price. It cost ₹1079.
   *   products       six, every one named "1 unit"
   *
   * The last two are the ones that matter. A total four hundred rupees too high
   * is the wrong number in the field a refund is paid from, and six products
   * named "1 unit" cannot match any campaign ever written.
   */
  describe('a real Zepto order page, as the shop draws it', () => {
    const DRAWN = readFileSync(
      join(__dirname, '..', '..', 'test', 'fixtures', 'zepto-order-page-drawn.txt'),
      'utf8',
    );
    const order = parseOrderText(DRAWN);

    it('reads the order number the page prints twice', () => {
      expect(order.orderNumber).toBe('JMOKSGSNP94115');
    });

    it('reads the day it was placed, from a label that says "at" and not "on"', () => {
      expect(order.orderDate).toBe('2026-08-25');
    });

    it('reads the day it ARRIVED, off a line that opens with the word Order', () => {
      // This is the field the whole delivery question is answered from, and it
      // was null on a page that states the minute the order turned up.
      expect(order.deliveryDate).toBe('2026-08-25');
    });

    it('takes the price that was PAID and not the one struck through', () => {
      // ₹1739 is printed directly above ₹1079 under "Total Bill". The bill was
      // ₹1079. Reading the first figure overstated this order by ₹660.
      expect(order.totalPaise).toBe(107900n);
      expect(order.itemTotalPaise).toBe(107900n);
    });

    it('names all six products, and the size and count lines are not names', () => {
      expect(order.items).toHaveLength(6);
      const names = order.items.map((i) => i.name);
      expect(names.some((n) => /^\d+\s*(unit|pc|pack)/i.test(n))).toBe(false);
    });

    it('names the product a campaign would be matched on, with its paid price', () => {
      const razor = order.items.find((i) => /Gillette/i.test(i.name));
      expect(razor).toBeDefined();
      expect(razor?.name).toBe('Gillette Fusion Manual Shaving Razor For Men');
      // ₹340 paid, ₹425 struck through beside it.
      expect(razor?.pricePaise).toBe(34000n);
    });

    it('reads nothing out of the shop\'s own furniture as a product', () => {
      const names = order.items.map((i) => i.name);
      // "Available Balance: ₹0", "Add Balance", "Zepto Cash & Gift Card" and the
      // delivery address all sit on this page. None of them is a thing bought.
      expect(names.some((n) => /balance|gift card|address|cart/i.test(n))).toBe(false);
    });
  });

  /**
   * A SECOND REAL ONE, because one page is a sample and two is a shape.
   *
   * The same account, a different order, 15 September 2026. It carries what the
   * first did not: a delivery fee that was CHARGED rather than waived, so the
   * bill total and the item total are genuinely different numbers, and an
   * "Arrived in / 4 MINS" line sitting above the real arrival date.
   */
  describe('a second real Zepto order page, with a fee that was charged', () => {
    const page = [
      'Order #LRGSKOMA18669', '1 item', 'Delivered', 'Arrived in', '4 MINS',
      '1 item in order',
      "Korean Kab's Jackpot 2x Hot and Spicy Instant Noodles Non Veg",
      '1 pack (100 g)', '2 units', '₹74', '₹100',
      'Bill Summary', 'Item Total', '₹100', '₹74',
      'Delivery Fee', '₹30', 'Handling Fee', '₹10', 'FREE',
      'Total Bill', '₹140', '₹104',
      'Order Details', 'Order ID', '#LRGSKOMA18669',
      'Order Placed at', '23 Aug 2026, 6:04 AM',
      'Order Arrived at', '23 Aug 2026, 6:09 AM',
      'Rate Order', 'Order Again',
    ].join('\n');
    const order = parseOrderText(page);

    it('keeps the bill and the item total apart when a fee was charged', () => {
      // The campaign is matched against what the PRODUCT cost, and the product
      // cost ₹74 of the ₹104 that left his account.
      expect(order.itemTotalPaise).toBe(7400n);
      expect(order.totalPaise).toBe(10400n);
    });

    it('reads the arrival date and not the "4 MINS" above it', () => {
      expect(order.deliveryDate).toBe('2026-08-23');
    });

    it('names the one product, with a count line of "2 units" in the way', () => {
      expect(order.items).toHaveLength(1);
      expect(order.items[0].name).toBe(
        "Korean Kab's Jackpot 2x Hot and Spicy Instant Noodles Non Veg",
      );
      expect(order.items[0].pricePaise).toBe(7400n);
    });

    it('a single figure under a label is still read as that figure', () => {
      // "Delivery Fee / ₹30" has nothing under it. The rule that picks the
      // smaller of a pair must never turn one figure into something else.
      expect(parseOrderText(['Order Total', '₹30'].join('\n')).totalPaise).toBe(3000n);
    });
  });
});
});
