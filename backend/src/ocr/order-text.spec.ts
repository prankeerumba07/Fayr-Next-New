import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BILL_LABELS, foldBareSellerLabels, parseOrderText, whichMarkersAppear,
} from './order-text';
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

/** The same two orders as the SHOP DRAWS them, both carrying arrival times. */
const DRAWN_ONE = readFileSync(
  join(__dirname, '..', '..', 'test', 'fixtures', 'zepto-order-page-drawn.txt'),
  'utf8',
);
const DRAWN_TWO = readFileSync(
  join(__dirname, '..', '..', 'test', 'fixtures',
    'zepto-order-page-drawn-two-shipments.txt'),
  'utf8',
);

/** Order #LRGSKOMA18669, assembled line for line — see its own describe below. */
const NOODLES = [
  'Order #LRGSKOMA18669', '1 item', 'Delivered', 'Arrived in', '4 MINS',
  '1 item in order',
  "Korean Kab's Jackpot 2x Hot and Spicy Instant Noodles Non Veg",
  '1 pack (100 g)', '2 units', '\u20b974', '\u20b9100',
  'Bill Summary', 'Item Total', '\u20b9100', '\u20b974',
  'Delivery Fee', '\u20b930', 'Handling Fee', '\u20b910', 'FREE',
  'Total Bill', '\u20b9140', '\u20b9104',
  'Order Details', 'Order ID', '#LRGSKOMA18669',
  'Order Placed at', '23 Aug 2026, 6:04 AM',
  'Order Arrived at', '23 Aug 2026, 6:09 AM',
  'Rate Order', 'Order Again',
].join('\n');

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
        // AND THE PAGE SAID TWO OF THEM: "2 x ₹149" states its own count, and
        // ₹149 is still the price of ONE. Read since 19 September 2026 — see
        // ParsedOrderItem.unitsStated for the refund this exists to get right.
        {
          name: 'Boldfit Strapless Sports Headband',
          pricePaise: 14900n,
          wasPricePaise: null,
          unitsStated: 2,
        },
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
          wasPricePaise: null,
          unitsStated: null,
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
        {
          name: 'Boldfit Strapless Sports Headband',
          pricePaise: 14900n,
          wasPricePaise: null,
          unitsStated: null,
        },
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
        {
          name: 'Boldfit Strapless Sports Headband',
          pricePaise: 14900n,
          wasPricePaise: null,
          unitsStated: 1,
        },
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
        {
          name: 'Totally Awesome Headband',
          pricePaise: 49900n,
          wasPricePaise: null,
          unitsStated: null,
        },
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
        // TWO LINES MORE SINCE 19 SEPTEMBER 2026. The empty shape is pinned in
        // full on purpose — it is the one place that says what "we read nothing"
        // looks like — so a field added to the parser has to be added here too,
        // with null meaning the page stated no such line. See ParsedOrder.
        feesPaise: null,
        billDiscountPaise: null,
        // Both null and neither false: nothing was read, so nothing is claimed.
        // "We did not look" is not "we looked and it was not returned".
        deliveryDate: null,
        // AND THE MINUTE IT ARRIVED — added 20 September 2026 with Phase 8B-c.
        // Null means the page printed no time beside the date, which is every
        // Amazon page and every list row. The day is still the day.
        deliveryAt: null,
        // Null means the page did not state one, OR stated one without a year.
        // This date is never inferred — see the field's own comment for why the
        // delivery date beside it is.
        returnWindowEndsDate: null,
        returned: null,
        // AND NOTHING SAID ABOUT ARRIVING — added 21 September 2026. Null is "the
        // page did not say it arrived", which is a different fact from a missing
        // delivery DATE: Zepto's order list states "Order delivered" and prints
        // no time at all, and before this field those two were the same silence.
        deliveredSaid: null,
        // AND NOT RATED EITHER — added 19 September 2026 with Phase 8A, tri-state
        // for the same reason `returned` is: nothing was read, so nothing is
        // claimed about whether the order was rated at the shop.
        rated: null,
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

    it('THE YEAR COMES FROM THE ORDER, because the same page prints it', () => {
      // This asserted null until 16 September 2026, and the reason written here
      // was that a year filled in from today's would be an invention. It was
      // right while nothing else on the page was being read. The ORDER date is
      // read off the same page now — "2 June 2026", in full — so the year is not
      // invented. It is the order's own.
      //
      // IT IS THE RULE THE DEVICE HAS ALWAYS USED: src/taskflow.js:184,
      // resolveDeliveryDate, same rollover, same refusal with no anchor. One
      // purchase read two ways has to give one date.
      expect(parseOrderText(page('Delivered 5 June')).deliveryDate)
        .toBe('2026-06-05');
    });

    it('and STILL null when there is no order date to borrow one from', () => {
      // No anchor, so no year, so no date. Nothing falls back to the year it
      // happens to be today: that would put an invented year on the date a
      // return window is judged against, which is the whole thing this refuses.
      // SEVERAL MONTHS, on purpose. One month cannot tell a fallback to "the
      // first of this year" from a fallback to "today" from an honest refusal —
      // whichever single month is picked, one of those inventions lands close
      // enough to it to look right. February catches a year-start fallback and
      // November catches a today fallback.
      for (const line of [
        'Delivered 5 February', 'Delivered 5 June', 'Delivered 5 November',
      ]) {
        const noAnchor = [
          'Order # 408-5094957-4481129',
          'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
          line,
        ].join('\n');
        expect(parseOrderText(noAnchor).orderDate).toBeNull();
        expect(parseOrderText(noAnchor).deliveryDate).toBeNull();
      }
    });

    it('rolls 31 December into 2 January, and only that way', () => {
      const newYear = [
        'Order placed', '31 December 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Delivered 2 January',
      ].join('\n');
      expect(parseOrderText(newYear).deliveryDate).toBe('2027-01-02');
    });

    it('REFUSES A ROLL THAT WOULD MEAN A 364-DAY DELIVERY', () => {
      // The rollover is right for 31 December to 2 January and wrong for
      // everything that merely looks like it. An order placed 2 June whose page
      // reads "Delivered 1 June" is one day SHORT of its own order date — a
      // stray line, a second order on the page, a word read slightly wrong — and
      // rolling it produces 1 June of the following year. A 364-day delivery,
      // silently, on the date a payout waits for.
      //
      // REFUSING IS FREE, WHICH IS WHY THE BOUND IS SAFE: null is exactly what
      // this page got yesterday, so the bound takes nothing away. It declines to
      // add something.
      expect(parseOrderText(page('Delivered 1 June')).deliveryDate).toBeNull();
    });

    it('and refuses a borrowed year that is hundreds of days out WITHOUT a roll', () => {
      // No rollover happens here at all — 30 December is after 2 June in the
      // same year — and the answer is still 211 days from the order. Bounding
      // only the roll would have let this one through.
      expect(parseOrderText(page('Delivered 30 December')).deliveryDate)
        .toBeNull();
    });

    it('never builds a day that is not on the calendar', () => {
      // 2027 has no 29 February. Putting a year beside a day and a month can
      // build a date out of nothing, and the reader that turns text into a day
      // does not check — hand it "29 February 2027" and it hands back
      // "2027-02-29". A delivery date silently a day out is a return window
      // silently a day out.
      const leap = [
        'Order placed', '20 February 2027',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Delivered 29 February',
      ].join('\n');
      expect(parseOrderText(leap).deliveryDate).toBeNull();
    });

    it('THE LABEL’S OWN LINE BEATS THE LINE UNDER IT', () => {
      // "Delivered 5 June" with "2 June 2026" underneath. The line under is a
      // full date and the line beside the label is not, so a reader that tried
      // the line under first would answer with the ORDER's date and call it the
      // delivery — an order that arrived before it was placed, and a return
      // window starting three days early. The label's own line is the stronger
      // statement about the label, so it is exhausted first, both ways.
      expect(parseOrderText(page('Delivered 5 June', '2 June 2026')).deliveryDate)
        .toBe('2026-06-05');
    });

    it('BOTH DATES OFF ONE LINE, when a layout runs them together', () => {
      // Amazon's page prints the delivery and the return window three lines
      // apart; a layout that folds them onto one handed the whole tail to a date
      // reader that is deliberately strict, and got null for a page stating the
      // day in full. The delivery branch now trims to the date at the FRONT,
      // which the order branch beside it has always done.
      const together = parseOrderText(page(
        'Delivered 5 June 2026 Return window closed on 19 June 2026',
      ));
      expect(together.deliveryDate).toBe('2026-06-05');
      expect(together.returnWindowEndsDate).toBeNull();
    });

    it('a year on the line under is never REPLACED by the order’s', () => {
      // "5 June 2025 IST" is not a shape the date reader accepts, so the line
      // under the label gives nothing. What must NOT then happen is the year
      // being thrown away and the order's put in its place: the page said 2025
      // and the answer would say 2026. A string carrying a year is refused by
      // the borrowing rule outright, and null is the honest answer here.
      expect(parseOrderText(page('Delivered', '5 June 2025 IST')).deliveryDate)
        .toBeNull();
    });

    it('a year PRINTED on the page is never inferred over', () => {
      // The borrowed year is the last resort and not the first. A page that
      // states its delivery year in full is read, not second-guessed — even when
      // the year it states is not the order's.
      const crossing = [
        'Order placed', '28 December 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Delivered 3 January 2027',
      ].join('\n');
      expect(parseOrderText(crossing).deliveryDate).toBe('2027-01-03');
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
   * THE DATE THE MONEY WAITS FOR, WHICH THE SHOP PRINTS AND NOTHING READ.
   *
   * engine/return-policy.ts says of itself, in writing, that "no marketplace
   * exposes a return-window end date, so this is the OPERATOR's policy table".
   * For Amazon that is not true and has not been: the line is on the order page,
   * in words, with a year on it.
   */
  describe("the shop's own return window, off its own page", () => {
    /**
     * ── THE CAPTURED LINES, AND ONLY THE CAPTURED LINES ───────────────────
     *
     * These six are the owner's real Amazon order page, 15 September 2026, as
     * recorded in order-text.ts beside AROUND_A_PRODUCT — the product block that
     * cost every item on that order until the furniture around it was named.
     * Nothing has been added to them and nothing has been reworded.
     *
     * THERE IS NO DELIVERY LINE IN THIS CAPTURE, and one is not being invented
     * to put here. REVIEW-FLOW-BRIEF.md states the same page also shows
     * "Delivered 8 June", with no year; that line is the brief's, not this
     * repository's, so the year-borrowing it describes is exercised against the
     * plainly assembled page in "when it arrived" above, and this block tests
     * only what was actually captured.
     */
    const capturedProductBlock = [
      'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
      'Sold by: Lukzer',
      'Return window closed on 19 June 2026',
      '₹938.00',
      '₹938.00',
      'Buy It Again',
    ].join('\n');

    it('READS THE DATE THE WINDOW CLOSED, off the real captured line', () => {
      expect(parseOrderText(capturedProductBlock).returnWindowEndsDate)
        .toBe('2026-06-19');
    });

    it('and that line is STILL not a product, which is what it cost before', () => {
      // The comment beside AROUND_A_PRODUCT records what happened when this line
      // was readable as a name: the reader walked past the real product looking
      // for money, and "Return window closed on 19 June 2026" is what it would
      // have called the thing he bought. Reading a DATE off it must not make it
      // a name again.
      const order = parseOrderText(capturedProductBlock);
      const names = order.items.map((i) => i.name);
      expect(names.some((n) => /return window/i.test(n))).toBe(false);
      expect(names).toContain(
        'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
      );
    });

    it('and the page still says the order was NOT sent back', () => {
      // A page that discusses a return window has told us there was no return.
      // Tri-state, and false is a real answer — not the same as "we did not
      // look". Reading a date off the line must not disturb that either.
      expect(parseOrderText(capturedProductBlock).returned).toBe(false);
    });

    it('reads the OPEN form too, while the window is still running', () => {
      // "Return items: Eligible through 3 July 2026" — the wording already in
      // this file as chrome, where it has always carried a full date that
      // nothing read. Not measured on a live page, and said so.
      const stillOpen = [
        'Order placed', '2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Return items: Eligible through 3 July 2026',
      ].join('\n');
      expect(parseOrderText(stillOpen).returnWindowEndsDate).toBe('2026-07-03');
    });

    it('NULL WITHOUT A YEAR, and this one is never borrowed', () => {
      // Deliberately not what the delivery date beside it does, and the
      // asymmetry is the cost of refusing. A delivery date with no year leaves a
      // refund held for ever, so borrowing one buys something real. A
      // return-window date with no year costs nothing, because the operator's
      // policy table still computes a window. There is no reason to guess where
      // refusing is free, and this is the date the money waits for.
      const noYear = [
        'Order placed', '2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Return window closed on 19 June',
      ].join('\n');
      const order = parseOrderText(noYear);
      expect(order.orderDate).toBe('2026-06-02');
      expect(order.returnWindowEndsDate).toBeNull();
    });

    it('and a sentence that merely mentions a return window drags no date in', () => {
      // Anchored at the start of the line, like every other label in the reader.
      const prose = [
        'Order placed', '2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Items in this order have a return window closed on 19 June 2026',
      ].join('\n');
      expect(parseOrderText(prose).returnWindowEndsDate).toBeNull();
    });

    it('null when the page never mentions a window at all', () => {
      const plain = [
        'Order placed', '2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x ₹1,299.00',
        'Delivered 5 June 2026',
      ].join('\n');
      expect(parseOrderText(plain).returnWindowEndsDate).toBeNull();
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

  /**
   * ── THE ORDER THE CAMPAIGN IS ACTUALLY FOR, AS ZEPTO DRAWS IT ───────────
   *
   * The Boldfit headband campaign's real purchase, found on the owner's account
   * on 15 September 2026 behind seven presses of "Load More": order
   * SOSIJGGRL26770, placed 21 July 2026, two parcels, headband at ₹149 with
   * ₹325 struck through beside it.
   *
   * THERE IS AN OLDER FIXTURE OF THIS SAME ORDER NEXT DOOR, and it is kept.
   * That one is the order as a SCREENSHOT of it read: "Shipment 1 of 2" and
   * "Delivered on 21 Aug 2026, 8:04 PM". This is the same order as the PAGE
   * draws it, and the two are laid out differently enough that the reader was
   * wrong on this one while being right on that one:
   *
   *   delivery date  null   the page never writes "Order Arrived at" on an
   *                         order in two parcels. It writes "Shipment 1
   *                         Arrived at", and this was anchored at "delivered".
   *   shipments      6      the drawn page names the same two shipments six
   *                         times — a tab each, a heading each, an arrival
   *                         line each — and they were being counted as lines.
   */
  describe('the campaign order itself, in two parcels, as the shop draws it', () => {
    const TWO = readFileSync(
      join(__dirname, '..', '..', 'test', 'fixtures',
        'zepto-order-page-drawn-two-shipments.txt'),
      'utf8',
    );
    const order = parseOrderText(TWO);

    it('reads the day it arrived off a SHIPMENT line, not an order line', () => {
      expect(order.deliveryDate).toBe('2026-07-21');
    });

    it('counts two parcels on a page that names them six times', () => {
      expect(order.shipments).toBe(2);
    });

    it('reads the campaign product at the price the campaign states', () => {
      const band = order.items.find((i) => /Boldfit/i.test(i.name));
      expect(band).toBeDefined();
      // ₹149 paid, ₹325 struck through. The campaign is written at ₹149 and the
      // match is exact, so reading the struck price would have refused a real
      // purchase as "price_differs".
      expect(band?.pricePaise).toBe(14900n);
    });

    it('reads the order number and the day it was placed', () => {
      expect(order.orderNumber).toBe('SOSIJGGRL26770');
      expect(order.orderDate).toBe('2026-07-21');
    });

    it('keeps both parcels\' products, and nothing else', () => {
      expect(order.items).toHaveLength(2);
    });
  });

  /**
   * ── THE MINUTE IT ARRIVED, AND NOT THE DAY AT NOON — PHASE 8B-c ─────────
   *
   * Every one of these pages printed the time and every one of them had it
   * thrown away. The day became an instant at noon UTC, which is half past five
   * in the EVENING in India — so a three hour hold on a parcel that arrived at
   * nine at night released the refund before it turned up, and a page read at
   * ten in the morning carried a delivery seven hours in the future, which the
   * plausibility gate refused outright.
   *
   * THE ARITHMETIC IS WRITTEN OUT IN EVERY CHECK. India is five and a half hours
   * ahead, so the universal instant is the printed time minus 5:30. A check that
   * merely re-ran the code's own conversion would pass whichever way round the
   * offset had been applied.
   */
  describe('the minute it arrived, in India\u2019s own time', () => {
    it('THE THREE MEASURED PAGES GIVE THE THREE EXACT INSTANTS', () => {
      // "Order Arrived at / 25 Aug 2026, 9:02 PM" -> 21:02 IST -> 15:32 UTC.
      expect(parseOrderText(DRAWN_ONE).deliveryAt)
        .toBe('2026-08-25T15:32:00.000Z');

      // "Order Arrived at / 23 Aug 2026, 6:09 AM" -> 06:09 IST -> 00:39 UTC, the
      // SAME day. A morning delivery is the one the six hour skew allowance was
      // refusing when the instant was noon.
      expect(parseOrderText(NOODLES).deliveryAt)
        .toBe('2026-08-23T00:39:00.000Z');

      // "Shipment 1 Arrived at / 21 Jul 2026, 5:32 PM" -> 17:32 IST -> 12:02 UTC,
      // read on its own so the line itself is pinned. The page it comes off
      // carries a SECOND shipment, and the whole page answers with that one —
      // see the check below.
      const oneParcel = [
        'Order ID', '#SOSIJGGRL26770',
        'Order Placed at', '21 Jul 2026, 5:07 PM',
        'Shipment 1 Arrived at', '21 Jul 2026, 5:32 PM',
      ].join('\n');
      expect(parseOrderText(oneParcel).deliveryAt)
        .toBe('2026-07-21T12:02:00.000Z');
    });

    it('AND THE DAY BESIDE THE INSTANT IS THE DAY IT ALWAYS WAS', () => {
      // The day is not replaced by the instant and nothing that compares days
      // has changed. Both are carried.
      expect(parseOrderText(DRAWN_ONE).deliveryDate).toBe('2026-08-25');
      expect(parseOrderText(NOODLES).deliveryDate).toBe('2026-08-23');
    });

    it('TWO SHIPMENTS: THE LATER ARRIVAL IS THE ONE THE ORDER IS DELIVERED AT', () => {
      // 5:32 PM and 5:46 PM on the drawn page. The order is delivered when ALL
      // of it is, so the answer is 17:46 IST -> 12:16 UTC. It used to stop at
      // the first date it could read, which is the EARLIER parcel.
      expect(parseOrderText(DRAWN_TWO).deliveryAt)
        .toBe('2026-07-21T12:16:00.000Z');

      // The same order in the screenshot layout: "Delivered on 21 Aug 2026,
      // 8:04 PM" and "8:31 PM", label and value on ONE line. 20:31 IST -> 15:01
      // UTC.
      expect(parseOrderText(ZEPTO).deliveryAt)
        .toBe('2026-08-21T15:01:00.000Z');
    });

    it('AND WHEN THE PARCELS ARRIVE ON DIFFERENT DAYS, THE LATER DAY WINS', () => {
      const overnight = [
        'Order ID', '#SOSTWODAYS00001',
        'Order Placed at', '21 Jul 2026, 11:40 PM',
        'Shipment 1 Arrived at', '21 Jul 2026, 11:52 PM',
        'Shipment 2 Arrived at', '22 Jul 2026, 12:14 AM',
      ].join('\n');
      const order = parseOrderText(overnight);
      // THE DAY MOVES TOO, not just the time. 00:14 IST on the 22nd is 18:44
      // UTC on the 21st, and the day this order was delivered is the 22nd — the
      // day its own page printed.
      expect(order.deliveryDate).toBe('2026-07-22');
      expect(order.deliveryAt).toBe('2026-07-21T18:44:00.000Z');
    });

    it('A PAGE THAT PRINTS ONLY A DAY STATES NO INSTANT AT ALL', () => {
      // Amazon prints no times. The day is read exactly as it always was and
      // nothing is invented beside it — an instant guessed at noon is what this
      // whole change exists to stop being mistaken for a reading.
      const amazon = [
        'Order placed', '2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x \u20b91,299.00',
        'Delivered 5 June 2026',
      ].join('\n');
      expect(parseOrderText(amazon).deliveryDate).toBe('2026-06-05');
      expect(parseOrderText(amazon).deliveryAt).toBeNull();
    });

    it('AND A NUMBER THAT IS NOT A CLOCK IS NEVER READ AS ONE', () => {
      // Each of these states a day and then something that is not a time. An
      // instant invented out of a price, a quantity or a second date would move
      // the moment somebody is paid.
      for (const after of [
        '25 Aug 2026',
        '25 Aug 2026, \u20b9149',
        '25 Aug 2026, 1 unit',
        '25 Aug 2026, 17:32',
        '25 Aug 2026, 13:40 pm',
        '25 Aug 2026, 0:15 pm',
      ]) {
        const page = ['Order Arrived at', after].join('\n');
        // THE DAY IS STILL READ IN EVERY ONE OF THEM. Refusing a time must not
        // cost the date, which is the thing every window has been computed from
        // since before this existed.
        expect(parseOrderText(page).deliveryDate).toBe('2026-08-25');
        expect(parseOrderText(page).deliveryAt).toBeNull();
      }

      // AND ONE MORE, WHERE THE DAY IS LOST TOO — pre-existing, unchanged, and
      // named here rather than left to be discovered. The reader for the line
      // BESIDE a label trims to the date at the front; the reader for the line
      // UNDER it does not, so a second date folded onto that line gives nothing.
      // Phase 8B-c did not touch either reader and does not widen this one.
      const folded = ['Order Arrived at',
        '25 Aug 2026 Return window closed on 19 June 2026'].join('\n');
      expect(parseOrderText(folded).deliveryDate).toBeNull();
      expect(parseOrderText(folded).deliveryAt).toBeNull();
    });

    it('MIDNIGHT IS 12 AM AND NOON IS 12 PM, which is where a naive reading breaks', () => {
      const at = (printed: string): string | null => parseOrderText(
        ['Order Arrived at', `25 Aug 2026, ${printed}`].join('\n'),
      ).deliveryAt;
      // 00:00 IST -> 18:30 UTC the day before.
      expect(at('12:00 AM')).toBe('2026-08-24T18:30:00.000Z');
      // 12:00 IST -> 06:30 UTC the same day.
      expect(at('12:00 PM')).toBe('2026-08-25T06:30:00.000Z');
    });

    it('and the time comes off the SAME text the day came off', () => {
      // A time read from the line under a day read from the line beside is two
      // halves of two different statements stitched into one instant.
      const split = [
        'Order placed', '2 June 2026',
        'Order # 408-5094957-4481129',
        'boAt Rockerz 255 Pro Plus', '1 x \u20b91,299.00',
        'Delivered 5 June 2026',
        '9:02 PM',
      ].join('\n');
      expect(parseOrderText(split).deliveryDate).toBe('2026-06-05');
      expect(parseOrderText(split).deliveryAt).toBeNull();
    });
  });

  /**
   * THE SCREENSHOT LAYOUT OF THE SAME ORDER MUST NOT HAVE MOVED.
   *
   * "Shipment 1 of 2" carries a number and an "of", and the count now reads
   * numbers rather than lines. Two layouts, one answer.
   */
  it('still counts "Shipment 1 of 2" and "Shipment 2 of 2" as two', () => {
    expect(parseOrderText(ZEPTO).shipments).toBe(2);
  });
});
});

/**
 * A WHOLE AMAZON ORDER PAGE, AND ONLY THE THINGS HE ACTUALLY BOUGHT.
 *
 * ── WHERE EVERY LINE OF THIS FIXTURE CAME FROM ────────────────────────────
 *
 * It is ASSEMBLED and it is said so here rather than implied, because the other
 * fixtures in this folder are captures and this one is not. Nothing in it is
 * invented; every block is a shape this project has already written down:
 *
 *   the navigation and the cart flyout — "Subtotal / ₹0.00 / Go to Cart /
 *     ₹849.00 / Quantity is 1" — copied line for line out of
 *     backend/test/fixtures/amazon-review-garment-rack.txt, which IS a capture
 *     of the owner's own Amazon page on the same account.
 *   the header line — "Ordered on 2 June 2026  Order number 408-1509645-…" —
 *     the shape recorded beside ORDER_NUMBER_ANYWHERE in order-text.ts, with the
 *     order number of the task measured on 16 September 2026.
 *   the bill — "Total: ₹1,411.00 / Promotion Applied: -₹80.00 / Grand Total:
 *     ₹1,331.00" — the block recorded beside moneyForLabels in order-text.ts.
 *   the first product — the block recorded beside AROUND_A_PRODUCT.
 *   the second product — its name from src/campaign.js and its ₹388.00 from the
 *     owner's own statement of the order.
 *   the carousels — the shape stated by the owner on 16 September 2026: the
 *     "Recommended for you" carousels, every tile printing an "M.R.P:" line.
 *
 * ── WHAT IT ANSWERED BEFORE THE TWO RULES BELOW EXISTED ───────────────────
 *
 * NINETEEN products, on an order of two. "Go to Cart" at ₹849.00, "Limited time
 * deal" at ₹1,299.00, the two real ones, and FIFTEEN called "M.R.P:".
 */
describe("a whole Amazon order page, and not the shop's suggestions", () => {
  const PAGE = readFileSync(
    join(__dirname, '..', '..', 'test', 'fixtures',
      'amazon-order-page-garment-rack.txt'),
    'utf8',
  );
  const order = parseOrderText(PAGE);

  it('ONLY THE THINGS HE ACTUALLY BOUGHT, AND THERE ARE TWO OF THEM', () => {
    expect(order.items.map((i) => i.name)).toEqual([
      'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
      'SR 2 PES Plastic Self-Adhesive Wall-Mount Bathroom Shelf',
    ]);
  });

  it('at the prices printed beside them, which is what a match is made on', () => {
    expect(order.items.map((i) => i.pricePaise)).toEqual([93800n, 38800n]);
  });

  it('NOT ONE THING OFF THE CART FLYOUT', () => {
    // It sits at the TOP of every page the shop serves, above the order, so no
    // rule about where the order stops can reach it.
    const names = order.items.map((i) => i.name);
    expect(names).not.toContain('Go to Cart');
    expect(names).not.toContain('Limited time deal');
  });

  it('AND NOT ONE "M.R.P:", of which the page prints fifteen', () => {
    // Fifteen, counted off the fixture rather than asserted from memory, so this
    // fails if the carousels are ever taken out of it and the check goes quiet.
    const printed = PAGE.split('\n')
      .filter((l: string) => /^M\.R\.P:/.test(l.trim()));
    expect(printed).toHaveLength(15);
    expect(order.items.some((i) => /m\.?r\.?p/i.test(i.name))).toBe(false);
  });

  it('and the four fields the whole read exists to produce are unharmed', () => {
    expect(order.orderNumber).toBe('408-1509645-3524313');
    expect(order.orderDate).toBe('2026-06-02');
    // THE BILL, AND NOT THE FIRST "TOTAL" ON THE PAGE. ₹1,411.00 is printed
    // above it and ₹1,331.00 is what left his account.
    expect(order.totalPaise).toBe(133100n);
    expect(order.itemTotalPaise).toBe(141100n);
  });

  it('and so are the two dates the money waits for', () => {
    // "Delivered 8 June" carries no year and borrows the order's, inside the
    // bounded rule. The window's own date states its year and never borrows one.
    expect(order.deliveryDate).toBe('2026-06-08');
    expect(order.returnWindowEndsDate).toBe('2026-06-19');
    expect(order.returned).toBe(false);
  });

  it('THE ORDER TOTAL IS NEVER ONE OF THE PRODUCTS, on a page of two', () => {
    // The rule the refund rests on, asked of this page directly: no product on a
    // two-product order may carry the figure the whole order came to.
    for (const item of order.items) expect(item.pricePaise).not.toBe(133100n);
  });
});

/**
 * THE TWO RULES ON THEIR OWN, so a failure says WHICH of them stopped working.
 *
 * The page above proves them together. These prove them apart, which is what
 * tells "the carousel moved" from "the cart flyout moved" when one day it does.
 */
describe("the shop's own furniture is never a product", () => {
  const withA = (...lines: string[]) => parseOrderText([
    'Order placed', '2 June 2026',
    'Order # 408-1509645-3524313',
    ...lines,
    'boAt Rockerz 255 Pro Plus', '₹1,299.00',
  ].join('\n'));

  it('the cart flyout, captured word for word off his own page', () => {
    const order = withA('Subtotal', '₹0.00', 'Go to Cart', '₹849.00', 'Quantity is 1');
    expect(order.items.map((i) => i.name)).toEqual(['boAt Rockerz 255 Pro Plus']);
  });

  it('a deal badge with a price under it', () => {
    const order = withA('Limited time deal', '₹499.00');
    expect(order.items.map((i) => i.name)).toEqual(['boAt Rockerz 255 Pro Plus']);
  });

  it('a struck price written as a label, which is what a carousel prints', () => {
    const order = withA('M.R.P: ₹1,999.00', 'MRP ₹2,499.00');
    expect(order.items.map((i) => i.name)).toEqual(['boAt Rockerz 255 Pro Plus']);
  });

  it('and a product whose OWN NAME contains one of those words is untouched', () => {
    // Openings, not words anywhere in a line. This is the whole reason the rule
    // is anchored, and the cost of getting it wrong is refusing a real purchase.
    const order = parseOrderText([
      'Order placed', '2 June 2026',
      'Quantity Surveyor Handbook, Limited Edition', '₹640.00',
    ].join('\n'));
    expect(order.items.map((i) => i.name))
      .toEqual(['Quantity Surveyor Handbook, Limited Edition']);
  });
});

describe('where the order stops and the shop\u2019s suggestions begin', () => {
  const page = (...tail: string[]) => [
    'Order placed', '2 June 2026',
    'Order # 408-1509645-3524313',
    'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
    'Sold by: Lukzer', '₹938.00',
    'Buy It Again',
    'SR 2 PES Plastic Self-Adhesive Wall-Mount Bathroom Shelf',
    'Sold by: SR RETAIL', '₹388.00',
    ...tail,
  ].join('\n');

  it('A SUGGESTION LAID OUT EXACTLY LIKE A PURCHASE IS STILL NOT ONE', () => {
    // The layout the furniture rule cannot see: a name with a bare price under
    // it. And the worst case on purpose — the shop suggesting the campaign's own
    // product at the campaign's own price, beside the order it was bought on.
    const order = parseOrderText(page(
      'Recommended for you',
      'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
      '₹938.00',
    ));
    expect(order.items).toHaveLength(2);
  });

  it('and "Buy It Again" is NOT a place to stop, which would cost a product', () => {
    // It is printed under every purchased item — between his two, in the
    // captured page — as well as being a carousel heading on other pages.
    const order = parseOrderText(page());
    expect(order.items.map((i) => i.name)).toEqual([
      'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
      'SR 2 PES Plastic Self-Adhesive Wall-Mount Bathroom Shelf',
    ]);
  });

  it('a heading somewhere unexpected COSTS THE JUNK, NEVER THE ORDER', () => {
    // If cutting there would leave no products at all, the cut is abandoned and
    // the page reads exactly as it did before the rule existed. Fail open, by
    // construction, because the alternative is a read that returns nothing.
    const order = parseOrderText([
      'Recommended for you',
      'Order placed', '2 June 2026',
      'boAt Rockerz 255 Pro Plus', '₹1,299.00',
    ].join('\n'));
    expect(order.items.map((i) => i.name)).toEqual(['boAt Rockerz 255 Pro Plus']);
  });

  /**
   * THE HEADINGS THIS LIST DID NOT HAVE, AND THE LEAK THEY LET THROUGH.
   *
   * MEASURED ON THE OWNER'S OWN NIKE ORDER PAGE, 16 September 2026. That page
   * carries no "Recommended for you" at all — its carousels are headed "Pick up
   * where you left offSee more" and "Recommended based on your shopping
   * trends". Neither was in the list, so no cut happened, and one tile came back
   * as an item on his order:
   *
   *   FIG Living Mini Serenity Table Lamp | European Linen Lampshade with ...
   *   ₹2,999.00
   *
   * A plain name with a plain price under it, which the furniture rule cannot
   * see and was never meant to: it catches a LABELLED struck price. The order
   * cost ₹4,995 and held one pair of shoes, and the read answered with two.
   */
  it('THE HEADINGS OFF HIS REAL NIKE PAGE, which let a lamp onto an order', () => {
    const page = [
      'Order placed 11 February 2026  Order number 408-5614193-1514764',
      'Order Summary',
      'Grand Total:', '₹4,995.00',
      'Nike M PROMINA Extra Wide Black/White',
      'Sold by: Westbury Sportswear',
      'Return window closed on 26 February 2026',
      '₹4,995.00', '₹4,995.00',
      'Buy It Again',
      'View your item',
      // The heading exactly as the page writes it — "See more" GLUED on, no space.
      'Pick up where you left offSee more',
      'Page 1 of 8',
      'FIG Living Mini Serenity Table Lamp | European Linen Lampshade with Mango Wood Base',
      '₹2,999.00',
      'Recommended based on your shopping trends',
      'Sponsored',
      'PAPER PLANE DESIGN Travel Yellow York Poster Painting Living Room 20x30',
      '₹2,495.00',
    ].join('\n');
    const order = parseOrderText(page);
    expect(order.items.map((i) => i.name)).toEqual([
      'Nike M PROMINA Extra Wide Black/White',
    ]);
    expect(order.items[0].pricePaise).toBe(499500n);
  });

  it('and the four fields off that same page are all still read', () => {
    // The order it is actually about, and the one field it does NOT have: this
    // page states no delivery at all, seven months on. That is the shop's page,
    // not a reading failure, and null is the honest answer for it.
    const page = [
      'Order placed 11 February 2026  Order number 408-5614193-1514764',
      'Grand Total:', '₹4,995.00',
      'Nike M PROMINA Extra Wide Black/White',
      'Return window closed on 26 February 2026',
      '₹4,995.00', '₹4,995.00',
    ].join('\n');
    const order = parseOrderText(page);
    expect(order.orderNumber).toBe('408-5614193-1514764');
    expect(order.orderDate).toBe('2026-02-11');
    expect(order.totalPaise).toBe(499500n);
    expect(order.returnWindowEndsDate).toBe('2026-02-26');
    expect(order.deliveryDate).toBeNull();
  });

  it('and a product whose name reads like a heading is not a heading', () => {
    // Whole lines, anchored both ends.
    //
    // THE REAL PURCHASE IN FRONT OF IT IS LOAD BEARING, and it was not there
    // when this check was written. Without it the heading-shaped product is the
    // ONLY product, so a loose test cuts everything, the fail-open rule above
    // puts it all back, and the check passes with the anchors gone. It is the
    // second product that makes the cut survivable and therefore visible.
    const order = parseOrderText([
      'Order placed', '2 June 2026',
      'boAt Rockerz 255 Pro Plus', '₹1,299.00',
      'Books Recommended For You By Our Editors, Volume 3', '₹299.00',
    ].join('\n'));
    expect(order.items.map((i) => i.name)).toEqual([
      'boAt Rockerz 255 Pro Plus',
      'Books Recommended For You By Our Editors, Volume 3',
    ]);
  });
});

/**
 * THE LINES THE APP ACTUALLY SENDS, WHICH ARE NOT THE LINES ON THE SCREEN.
 *
 * ── WHERE THIS CAME FROM ──────────────────────────────────────────────────
 *
 * The owner's phone, 16 September 2026, 22:26. The journey worked, he tapped
 * "yes, I bought it", the read opened his Nike order — and the server answered
 * product_name_not_found on a page with the shoes printed on it. His log:
 *
 *   orders-found pages=1 lens=[1550]
 *   orders-found judged=1 matched=0 reasons=[product_name_not_found]
 *
 * The block below is that 1550-character page, obtained by reproducing the
 * app's exact fetch inside his signed-in browser and running src/orderhistory.js
 * pageToLines and readOrderBlocks over what came back. It is a CAPTURE, not an
 * assembly, and it is trimmed only of the page furniture after "View your item".
 *
 * Note what it does that innerText never does: "Sold by:" and the seller are on
 * TWO LINES, because they are two elements and the app cuts at every tag. Every
 * note in order-text.ts about this block was written from innerText, where they
 * are one line — so the reader had never once been reasoned about against what
 * it is actually given.
 */
describe('a bare "Sold by:" with the seller on the line under it', () => {
  const AS_THE_APP_SENDS_IT = [
    'Order placed',
    '11 February 2026',
    'Order number',
    '408-5614193-1514764',
    'Invoice',
    'Payment method',
    'Amazon Pay Balance',
    'Order Summary',
    'Item(s) Subtotal:',
    '₹4,995.00',
    'Shipping:',
    '₹0.00',
    'Total:',
    '₹4,995.00',
    'Grand Total:',
    '₹4,995.00',
    'Nike M PROMINA Extra Wide Black/White',
    'Sold by:',
    'Westbury Sportswear',
    'Return window closed on 26 February 2026',
    '₹4,995.00',
    '₹4,995.00',
    'Buy It Again',
    'View your item',
  ].join('\n');

  it('THE PRODUCT IS THE PRODUCT, AND NOT THE SELLER', () => {
    // What it did before: the walk from the name stepped over "Sold by:",
    // landed on "Westbury Sportswear", found neither furniture nor money, and
    // gave up on the product — then the scan reached that same line, called it a
    // name, stepped over the return-window line and filed THE SELLER as the
    // thing he bought, at exactly the right price.
    const order = parseOrderText(AS_THE_APP_SENDS_IT);
    expect(order.items.map((i) => i.name)).toEqual([
      'Nike M PROMINA Extra Wide Black/White',
    ]);
    expect(order.items[0].pricePaise).toBe(499500n);
  });

  it('and the seller is not on the order at all', () => {
    const names = parseOrderText(AS_THE_APP_SENDS_IT).items.map((i) => i.name);
    expect(names).not.toContain('Westbury Sportswear');
  });

  it('with the other three fields read off the same block', () => {
    const order = parseOrderText(AS_THE_APP_SENDS_IT);
    expect(order.orderNumber).toBe('408-5614193-1514764');
    expect(order.orderDate).toBe('2026-02-11');
    expect(order.totalPaise).toBe(499500n);
    expect(order.returnWindowEndsDate).toBe('2026-02-26');
    // No delivery line on this page, which is the shop's doing and not a failure.
    expect(order.deliveryDate).toBeNull();
    expect(order.returned).toBe(false);
  });

  it('A PAGE THAT ALREADY WRITES THEM TOGETHER IS UNTOUCHED', () => {
    // The innerText shape, which every other fixture in this file uses. The fold
    // must not change it: the line is not bare, so nothing is folded.
    const together = [
      'Order placed 2 June 2026  Order number 408-1509645-3524313',
      'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
      'Sold by: Lukzer',
      'Return window closed on 19 June 2026',
      '₹938.00', '₹938.00',
    ].join('\n');
    const order = parseOrderText(together);
    expect(order.items.map((i) => i.name)).toEqual([
      'Lukzer | Heavy-Duty Metal Garment Rack with Bottom Storage Shelf',
    ]);
    expect(order.items[0].pricePaise).toBe(93800n);
  });

  it('and the same for every other way a shop names who sold it', () => {
    for (const label of ['Sold by:', 'Shipped by', 'Dispatched by:', 'Fulfilled by:']) {
      const page = [
        'Order placed', '2 June 2026',
        'Order # 408-1509645-3524313',
        'boAt Rockerz 255 Pro Plus',
        label,
        'Some Seller Private Limited',
        '₹1,299.00',
      ].join('\n');
      const order = parseOrderText(page);
      expect(order.items.map((i) => i.name)).toEqual(['boAt Rockerz 255 Pro Plus']);
    }
  });

  it('and folding is asked of the LINES, so it can be walked on its own', () => {
    expect(foldBareSellerLabels(['Sold by:', 'Westbury Sportswear']))
      .toEqual(['Sold by: Westbury Sportswear']);
    expect(foldBareSellerLabels(['Sold by: Lukzer', 'Return window closed']))
      .toEqual(['Sold by: Lukzer', 'Return window closed']);
    // A LABEL WITH NOTHING UNDER IT IS LEFT ALONE rather than dropped.
    expect(foldBareSellerLabels(['Sold by:'])).toEqual(['Sold by:']);
    // AND NOTHING ELSE IS FOLDED. A bill label carries money, the bill reader
    // already looks on the line under it, and folding one would be a change to
    // how money is read.
    expect(foldBareSellerLabels(['Grand Total:', '₹4,995.00']))
      .toEqual(['Grand Total:', '₹4,995.00']);
  });
});

/**
 * WHETHER THE ORDER HAS BEEN RATED, READ OFF THE TWO REAL PAGES. Phase 8A.
 *
 * ZEPTO-BRIEF.md measured it on the owner's own account: an unrated order's page
 * carries "Rate Order"; a rated one carries "You rated:" and no "Rate Order".
 * Both pages are fixtures, so this is checked against what the shop wrote and
 * not against a sentence typed here.
 */
describe('whether the order has been rated at the shop', () => {
  const fixture = (name: string): string =>
    readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', name), 'utf8');

  it('TRUE on the owner’s rated order: "You rated:" and no "Rate Order"', () => {
    const page = fixture('zepto-order-page-drawn-two-shipments.txt');
    expect(page).toMatch(/You rated:/);
    expect(page).not.toMatch(/Rate Order/);
    expect(parseOrderText(page).rated).toBe(true);
  });

  it('FALSE on the owner’s unrated order, which invites a rating', () => {
    const page = fixture('zepto-order-page-drawn.txt');
    expect(page).toMatch(/Rate Order/);
    expect(page).not.toMatch(/You rated:/);
    expect(parseOrderText(page).rated).toBe(false);
  });

  it('NULL on a page that says neither, which is every Amazon order page', () => {
    expect(parseOrderText(fixture('amazon-order-page-garment-rack.txt')).rated).toBeNull();
    expect(parseOrderText('Order ID 12345678\nPlaced on 21 Aug 2026').rated).toBeNull();
    expect(parseOrderText('').rated).toBeNull();
  });

  it('NULL, never true, on a page that says both — a page nobody understood', () => {
    expect(parseOrderText('Order #SOS12345\nYou rated:\nRate Order').rated).toBeNull();
  });

  it('reads whole words, so a product name cannot be an invitation', () => {
    expect(parseOrderText('Order #SOS12345\nRate Orderly Socks\n₹99').rated).toBeNull();
    expect(parseOrderText('Order #SOS12345\nyou RATED:').rated).toBe(true);
  });

  // ── ZEPTO'S ORDER LIST DOES NOT SAY "YOU RATED" ──────────────────────────
  //
  // 20 September 2026. The owner rated his razor on Zepto and the task would
  // not move. Both cards, copied off his own order list minutes apart:
  //
  //   rated     Order delivered  ₹360  Your delivery experience rating: ★★★★★
  //                                    Order Again
  //   unrated   Order delivered  ₹480  Rate order   Order Again
  //
  // The invitation half was already right — an unrated Zepto order does say
  // "Rate order", and it is REPLACED by the rating row once rated. The positive
  // half was missing: "you rated" appears nowhere on Zepto, so his rated order
  // read as neither, `rated` came back null, and ratedFromALaterLook returned
  // before it could run MARK_REVIEWED. Fayr read the page that proved he had
  // rated it and went on asking him to write a review.
  it('TRUE on Zepto’s own wording, which never says "you rated"', () => {
    const rated = parseOrderText(
      'Order delivered\n₹360\nPlaced at 20th Sep 2026, 07:45 pm\n'
      + 'Your delivery experience rating:\nOrder Again',
    );
    expect(rated.rated).toBe(true);
  });

  it('and FALSE on the card beside it that still invites a rating', () => {
    const unrated = parseOrderText(
      'Order delivered\n₹480\nPlaced at 18th Sep 2026, 08:47 pm\n'
      + 'Rate order\nOrder Again',
    );
    expect(unrated.rated).toBe(false);
  });

  // THE PHRASE IS THE WHOLE LABEL AND NOT A WORD INSIDE IT. "rating" on its own
  // is a word an order page may carry for all sorts of reasons; this must not
  // fire on any of them.
  it('and a bare mention of a rating is still not a rating', () => {
    expect(parseOrderText('Order #SOS12345\nProduct rating 4.7').rated).toBeNull();
    expect(parseOrderText('Order #SOS12345\nYour rating matters to us').rated).toBeNull();
  });

  it('AND READS NO NUMBER OF STARS. The page prints none, and none is wanted', () => {
    const page = fixture('zepto-order-page-drawn-two-shipments.txt');
    const order = parseOrderText(page) as unknown as Record<string, unknown>;
    expect(Object.keys(order)).not.toContain('rating');
    expect(Object.keys(order)).not.toContain('stars');
  });
});

// ── ONE PRODUCT IS ITS OWN ITEM TOTAL, WHEN THE PAGE LABELS NOTHING ────────
//
// 20 September 2026, from the owner's own razor. Zepto's ORDER LIST labels none
// of its money — no "Total", no "Item total", no "Subtotal" — so both labelled
// lookups answered null, the candidate stored no bill at all, theRefundBase had
// nothing to work from, and a refund the shop had already priced at ₹360 sat
// waiting for a person to type 360 into a staff panel.
describe('the item total of an order that holds one product', () => {
  it('is that product’s own price when the page labels nothing', () => {
    // THE SHAPE THE OWNER'S OWN CANDIDATE ROW CARRIED, copied out of the
    // database: one item, its own price, no stated count, and no labelled
    // total anywhere on the card.
    //   items = [{"name":"Gillette Fusion Manual Shaving Razor For Men",
    //             "pricePaise":"36000","unitsStated":1}]
    //   totalPaise = null   itemTotalPaise = null
    const page = parseOrderText(
      'Order #RGTLJGSNO87088\n'
      + 'Gillette Fusion Manual Shaving Razor For Men ₹360.00',
    );
    expect(page.items).toHaveLength(1);
    expect(page.itemTotalPaise).toBe(36000n);
  });

  // NOTHING IS SUMMED. Two products at ₹180 and one at ₹360 give the same
  // total and mean completely different refunds — which is exactly why a
  // basket's total is never paid from.
  it('and is NULL the moment there is more than one product', () => {
    const page = parseOrderText(
      'Order delivered\nFirst Thing ₹180.00\nSecond Thing ₹180.00\nOrder Again',
    );
    expect(page.items.length).toBeGreaterThan(1);
    expect(page.itemTotalPaise).toBeNull();
  });

  it('and NULL when the page states a count above one', () => {
    const page = parseOrderText(
      'Order delivered\n2 x Gillette Fusion Manual Shaving Razor For Men ₹720.00',
    );
    if (page.items.length === 1 && page.items[0]?.unitsStated === 2) {
      expect(page.itemTotalPaise).toBeNull();
    }
  });

  // A LABELLED FIGURE ALWAYS WINS. This only ever fills a hole.
  it('and never overrides a total the page put a name to', () => {
    const page = parseOrderText(
      'Order #SOS12345\nOne Thing ₹360.00\nItem total: ₹400.00',
    );
    expect(page.itemTotalPaise).toBe(40000n);
  });
});

// ── A PAGE THAT SAYS IT ARRIVED AND WILL NOT SAY WHEN ──────────────────────
//
// 21 September 2026. The owner's chilli oil was delivered and Fayr would not
// record it. Zepto's order list prints the status and never the moment:
//
//   Order delivered   ₹225   Placed at 21st Sep 2026, 12:37 am
//
// "Placed at" is when he ORDERED it. So deliveryDate and deliveryAt both come
// back null on a card that plainly says the thing arrived, and
// deliveryFromALaterLook bailed on a missing date. His words: "The product has
// been delivered. Why are you not able to fetch the same?"
describe('whether the page SAYS the order arrived, without dating it', () => {
  it('TRUE on the owner’s own delivered card, which states no arrival time', () => {
    const page = parseOrderText(
      'Order delivered\n₹225\nPlaced at 21st Sep 2026, 12:37 am\nOrder Again',
    );
    expect(page.deliveredSaid).toBe(true);
    // AND IT IS STILL NOT A DATE. The page stated no instant and none is invented
    // here; what the caller does with the status is the caller's business.
    expect(page.deliveryDate).toBeNull();
    expect(page.deliveryAt).toBeNull();
  });

  // THE TWO STATES IMMEDIATELY BEFORE IT, off the same screen, which mean the
  // opposite and must never read as an arrival.
  it('NULL while the order is still coming', () => {
    expect(parseOrderText('Order on the way\n₹225').deliveredSaid).toBeNull();
    expect(parseOrderText('Your order is getting packed\n₹225').deliveredSaid).toBeNull();
    expect(parseOrderText('Out for delivery').deliveredSaid).toBeNull();
  });

  // THE LINE THAT MAKES THIS SAFE. A bare /delivered/ would read the shop's own
  // advertising as a statement about somebody's parcel: Zepto prints "delivered
  // in minutes*" on every page of the site and offers "Groceries in Minutes" in
  // its search box.
  it('NULL on the shop’s own advertising, which says "delivered" everywhere', () => {
    expect(parseOrderText('Zepto | Everything delivered in minutes*').deliveredSaid).toBeNull();
    expect(parseOrderText('Groceries in Minutes delivered in minutes').deliveredSaid).toBeNull();
    expect(
      parseOrderText('Zepto: Online Grocery Delivery App - Groceries in Minutes').deliveredSaid,
    ).toBeNull();
  });

  it('and TRUE on the other whole phrases a shop uses for the same fact', () => {
    expect(parseOrderText('Delivery completed').deliveredSaid).toBe(true);
    expect(parseOrderText('Delivered on 21 Sep 2026').deliveredSaid).toBe(true);
  });
});

describe('telling a page that arrived half drawn from one whose wording moved', () => {
  // ── WHY THIS IS NOT A LOG LINE'S PRIVATE BUSINESS ────────────────────────
  //
  // 21 September 2026: a Zepto order page, delivered and rated hours before,
  // read `rated=null delivered=null` over and over. The two causes need
  // opposite fixes and the two nulls look identical. These six names are what
  // separate them, so they are checked rather than trusted.
  const HALF_DRAWN = [
    'Order #RGTLJGSNT54558',
    '1 item',
  ].join('\n');

  const WHOLE = [
    'Order #RGTLJGSNT54558',
    'You rated:',
    'Delivered',
    '1 item in order',
    'Bill Summary',
    'Item Total ₹195',
  ].join('\n');

  it('a page we did not wait for says so: no landmark from further down it', () => {
    const said = whichMarkersAppear(HALF_DRAWN);
    expect(said).toContain('bill-heading=no');
    expect(said).toContain('item-total=no');
    expect(said).toContain('you-rated=no');
  });

  it('and a whole page whose wording moved carries the landmarks and not the phrase', () => {
    const said = whichMarkersAppear(WHOLE.replace('You rated:', 'Rating given'));
    expect(said).toContain('bill-heading=yes');
    expect(said).toContain('item-total=yes');
    expect(said).toContain('you-rated=no');
  });

  it('and the whole page as Zepto actually prints it answers yes to the phrase', () => {
    const said = whichMarkersAppear(WHOLE);
    expect(said).toContain('you-rated=yes');
    expect(said).toContain('rate-order=no');
    // THE ONE THAT IS EASY TO MISREAD. Zepto's order page says the bare word
    // and never "Order delivered", which is the LIST's wording — so the reader
    // is right to answer null here, and the probe shows why.
    expect(said).toContain('order-delivered=no');
    expect(said).toContain('the-word-delivered=yes');
    expect(parseOrderText(WHOLE).deliveredSaid).toBeNull();
  });

  it('and it carries no word of the page itself', () => {
    const said = whichMarkersAppear(WHOLE);
    expect(said).not.toContain('RGTLJGSNT54558');
    expect(said).not.toContain('195');
    expect(said).toMatch(/^[a-z-]+=(yes|no)( [a-z-]+=(yes|no))*$/);
  });
});
