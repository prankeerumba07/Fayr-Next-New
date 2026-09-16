import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LONGEST_ORDER_TEXT,
  MOST_RECENT_ORDERS_ACCEPTED,
  dateToSubmit,
  dayAsWritten,
  itemPriceIsCertain,
  itemsFromJson,
  itemsToJson,
  judgeFoundOrders,
  whatTheOrderAlreadySays,
} from './order-candidates';
import { parseOrderText } from '../ocr/order-text';

/** The owner's real Zepto order, the same fixture Part 6 reads. */
const ZEPTO = readFileSync(
  join(__dirname, '..', '..', 'test', 'fixtures', 'zepto-order-two-shipments.txt'),
  'utf8',
);

/** One row out of a shop's list of recent orders, as the phone sends it. */
const row = (parts: string[]) => parts.join('\n');

const HEADBAND_ROW = row([
  'Order ID SOSIJGGRL26770',
  'Placed on 21 Aug 2026',
  'Boldfit Strapless Sports Headband',
  '1 x ₹149',
  'Total ₹149',
]);

const SOMETHING_ELSE = row([
  'Order ID SOSZZZZZZ99999',
  'Placed on 19 Aug 2026',
  'Prestige Induction Cooktop 1900W Black',
  '1 x ₹1,326',
  'Total ₹1,326',
]);

const CAMPAIGN = {
  productName: 'Boldfit Strapless Sports Headband',
  productPricePaise: 14900n,
};

describe('the orders the phone found, read and judged on the server', () => {
  describe('the cap belongs to the server as well as the phone', () => {
    it('is the owner’s twenty', () => {
      expect(MOST_RECENT_ORDERS_ACCEPTED).toBe(20);
    });

    it('never reads more than the cap, whatever the phone sends', () => {
      // A phone is something a person controls, so a cap only the phone applied
      // would be no cap at all.
      const many = Array.from({ length: 60 }, () => HEADBAND_ROW);
      expect(judgeFoundOrders(many, CAMPAIGN)).toHaveLength(20);
    });

    it('never reads more of one order than a page of text', () => {
      const huge = `${HEADBAND_ROW}\n${'x'.repeat(LONGEST_ORDER_TEXT * 3)}`;
      const judged = judgeFoundOrders([huge], CAMPAIGN);
      expect(judged).toHaveLength(1);
      expect(judged[0].orderNumber).toBe('SOSIJGGRL26770');
    });
  });

  describe('judging what came in', () => {
    it('finds the campaign’s product among several orders', () => {
      const judged = judgeFoundOrders([SOMETHING_ELSE, HEADBAND_ROW], CAMPAIGN);
      expect(judged.map((j) => j.matches)).toEqual([false, true]);
      expect(judged[1].orderNumber).toBe('SOSIJGGRL26770');
      expect(judged[1].reason).toBe('matched');
    });

    it('keeps the shop’s own order, newest first, and numbers it from zero', () => {
      const judged = judgeFoundOrders([HEADBAND_ROW, SOMETHING_ELSE], CAMPAIGN);
      expect(judged.map((j) => j.position)).toEqual([0, 1]);
      expect(judged[0].orderNumber).toBe('SOSIJGGRL26770');
    });

    it('names what failed on every order that did not match', () => {
      const judged = judgeFoundOrders(
        [SOMETHING_ELSE, row(['Order ID 111222333', 'Placed on 1 Aug 2026'])],
        CAMPAIGN,
      );
      expect(judged[0].reason).toBe('product_name_not_found');
      expect(judged[1].reason).toBe('no_products_read');
      for (const j of judged) expect(j.reason).not.toBe('no_match');
    });

    it('says the price differs when the product is there at another price', () => {
      const judged = judgeFoundOrders([HEADBAND_ROW], {
        productName: 'Boldfit Strapless Sports Headband',
        productPricePaise: 19900n,
      });
      expect(judged[0].matches).toBe(false);
      expect(judged[0].reason).toBe('price_differs');
      expect(judged[0].matchedItem).toEqual({
        name: 'Boldfit Strapless Sports Headband',
        pricePaise: 14900n,
      });
    });

    it('reads the day as a real date, at midday so no clock can move it', () => {
      const judged = judgeFoundOrders([HEADBAND_ROW], CAMPAIGN);
      expect(judged[0].orderDate?.toISOString()).toBe('2026-08-21T12:00:00.000Z');
    });

    it('survives anything that is not a list of text', () => {
      for (const junk of [null, undefined, 'one order', 5, {}]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(judgeFoundOrders(junk as any, CAMPAIGN)).toEqual([]);
      }
      const judged = judgeFoundOrders(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [null, 5, {}, HEADBAND_ROW] as any,
        CAMPAIGN,
      );
      expect(judged).toHaveLength(4);
      expect(judged.filter((j) => j.matches)).toHaveLength(1);
    });
  });

  describe('when the product’s price is certain, and when it is not', () => {
    it('is certain for one product whose price is the whole bill', () => {
      const order = parseOrderText(HEADBAND_ROW);
      expect(itemPriceIsCertain(order, order.items[0])).toBe(true);
    });

    it('is NOT certain on the owner’s real two product order', () => {
      // Two products, two shipments, a bill of 368 and a product at 149. It might
      // be one of each, and it might not. A person decides the amount, which is
      // the same answer this project already gives for quick commerce.
      const order = parseOrderText(ZEPTO);
      expect(itemPriceIsCertain(order, order.items[0])).toBe(false);
    });

    it('is NOT certain when the bill is bigger than the product', () => {
      // One product at 149 and a bill of 199. That 50 could be delivery, or it
      // could be something the reading missed entirely.
      const order = parseOrderText(row([
        'Order ID 12345678',
        'Boldfit Strapless Sports Headband',
        '1 x ₹149',
        'Total ₹199',
      ]));
      expect(itemPriceIsCertain(order, order.items[0])).toBe(false);
    });

    it('is NOT certain when two of the thing were bought', () => {
      const order = parseOrderText(row([
        'Order ID 12345678',
        'Boldfit Strapless Sports Headband',
        '2 x ₹149',
        '₹298',
        'Total ₹298',
      ]));
      expect(order.items).toHaveLength(1);
      expect(itemPriceIsCertain(order, order.items[0])).toBe(false);
    });

    it('is NOT certain when there is no bill to compare against', () => {
      const order = parseOrderText(row([
        'Order ID 12345678',
        'Boldfit Strapless Sports Headband',
        '1 x ₹149',
      ]));
      expect(order.totalPaise).toBeNull();
      expect(itemPriceIsCertain(order, order.items[0])).toBe(false);
    });

    it('is never certain about nothing', () => {
      expect(itemPriceIsCertain(parseOrderText(HEADBAND_ROW), null)).toBe(false);
    });
  });

  describe('writing the products down and reading them back', () => {
    it('keeps paise as whole numbers through a round trip', () => {
      const order = parseOrderText(ZEPTO);
      const stored = itemsToJson(order.items);
      expect(stored).toEqual([
        { name: 'Boldfit Strapless Sports Headband', pricePaise: '14900' },
        { name: 'Hammer Nova earphones', pricePaise: '21900' },
      ]);
      expect(itemsFromJson(stored)).toEqual(order.items);
    });

    it('drops anything unreadable rather than guessing at it', () => {
      expect(itemsFromJson([
        { name: 'Real', pricePaise: '100' },
        { name: '', pricePaise: '100' },
        { name: 'No price' },
        { name: 'Bad price', pricePaise: 'lots' },
        { name: 'Free', pricePaise: '0' },
        { name: 'Negative', pricePaise: '-100' },
        null,
        'not an item',
      ])).toEqual([{ name: 'Real', pricePaise: 100n }]);
    });

    it('reads nothing out of anything that is not a list', () => {
      for (const junk of [null, undefined, 5, {}, 'items']) {
        expect(itemsFromJson(junk)).toEqual([]);
      }
    });
  });
});

describe('what date to put on the evidence when all we read was a day', () => {
  // The window in these checks is a real one: it opens two hours before a claim
  // made at midday and closes thirty minutes after it, which is how long
  // somebody really has to buy.
  const CLAIMED = Date.UTC(2026, 7, 21, 12, 0, 0);
  const WINDOW = { floor: CLAIMED - 2 * 3600_000, ceiling: CLAIMED + 30 * 60_000 };
  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));

  it('leaves the date unknown when the day overlaps the window', () => {
    // The honest answer. "21 August" cannot say whether the order was placed at
    // 11:52, which is inside the window, or at 14:30, which is not. Claiming an
    // hour we never read would either refuse every honest same day purchase or
    // assert a precision we do not have.
    expect(dateToSubmit(day(2026, 8, 21), WINDOW)).toBeNull();
  });

  it('sends the day when the whole of it is over before the window opens', () => {
    // The case the rule exists for: a purchase from months earlier, dressed up
    // as one the offer caused. Sent as the LAST instant of that day, which is the
    // most generous reading of it and still before the floor.
    const sent = dateToSubmit(day(2026, 1, 1), WINDOW);
    expect(sent).not.toBeNull();
    expect(sent as number).toBeLessThan(WINDOW.floor);
    expect(new Date(sent as number).toISOString()).toBe('2026-01-01T23:59:59.999Z');
  });

  it('sends the day when the whole of it begins after the window has closed', () => {
    const sent = dateToSubmit(day(2026, 8, 25), WINDOW);
    expect(sent).not.toBeNull();
    expect(sent as number).toBeGreaterThan(WINDOW.ceiling as number);
    expect(new Date(sent as number).toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('leaves the date unknown on the day before, when the window reaches into it', () => {
    // A claim just after midnight opens a window that reaches back into the
    // previous day. The day before then overlaps, so it cannot settle anything.
    const justAfterMidnight = Date.UTC(2026, 7, 21, 0, 30, 0);
    const reachesBack = {
      floor: justAfterMidnight - 2 * 3600_000,
      ceiling: justAfterMidnight + 30 * 60_000,
    };
    expect(dateToSubmit(day(2026, 8, 20), reachesBack)).toBeNull();
  });

  it('has nothing to send when nothing was read', () => {
    expect(dateToSubmit(null, WINDOW)).toBeNull();
    expect(dateToSubmit(new Date(NaN), WINDOW)).toBeNull();
  });

  it('works with no deadline at all', () => {
    const open = { floor: WINDOW.floor, ceiling: null };
    expect(dateToSubmit(day(2026, 8, 25), open)).toBeNull();
    expect(dateToSubmit(day(2026, 1, 1), open)).not.toBeNull();
  });

  it('keeps the day as written whatever it decides to send', () => {
    // The day is never lost. A person looking at the task later sees what was
    // read, even where it was not precise enough to test against the window.
    expect(dayAsWritten(day(2026, 8, 21))).toBe('2026-08-21');
    expect(dayAsWritten(day(2026, 1, 1))).toBe('2026-01-01');
    expect(dayAsWritten(null)).toBeNull();
    expect(dayAsWritten(new Date(NaN))).toBeNull();
  });
});

/**
 * THE TWO DATES AN ORDER PAGE STATES, CARRIED IN TWO DIFFERENT SHAPES.
 *
 * They look interchangeable and are not, and the difference is money. A date
 * being COMPARED wants the middle of its day, so no time zone can move it across
 * a boundary. A date something EXPIRES at wants the end of it: a window that
 * "closed on 19 June" closed at the end of the 19th, and reading it as midday
 * would release a refund twelve hours early.
 */
/**
 * THE BILL'S VETO ON A PRODUCT'S OWN LINE.
 *
 * The certainty rule asks whether the page's figure for this product is the
 * figure the offer states. That is not the same question as "was it paid".
 */
/**
 * WHAT A CORRECTIVE WRITE CARRIES FORWARD, AND WHAT IT MUST NOT.
 *
 * transition() applies order evidence with `preferByAuthority`, which returns
 * the INCOMING object whole — it does not merge. So a writer that only means to
 * add a price deletes every field it does not name. This is the list of what
 * gets carried, and the list of what deliberately does not.
 */
describe('whatTheOrderAlreadySays', () => {
  const full = {
    id: '408-1509645-3524313',
    itemId: 'LINE-1',
    date: 1780358400000,
    dateRaw: '2026-06-02',
    itemPaise: 133100n,
    unitPricePaise: 93800n,
    lineTotalPaise: 93800n,
    orderTotalPaise: 133100n,
    matchedPricePaise: 93800n,
    mrpPaise: 150000n,
    quantity: 1,
    quantityObserved: 3,
    itemAmountAmbiguous: true,
    match: { score: 0.9, amountOk: true, ambiguous: false, candidateCount: 2 },
    product: 'Lukzer Garment Rack',
    image: 'https://example.invalid/rack.jpg',
    statusText: 'Delivered 8 June',
    source: 'order-history',
  } as unknown as Parameters<typeof whatTheOrderAlreadySays>[0];

  it('CARRIES THE FACTS A CORRECTION HAS NO BUSINESS DELETING', () => {
    const kept = whatTheOrderAlreadySays(full);
    // The two this whole changeset exists to put on the screen.
    expect(kept.dateRaw).toBe('2026-06-02');
    expect(kept.matchedPricePaise).toBe('93800');
    // And the rest of what a page said about the order.
    expect(kept.id).toBe('408-1509645-3524313');
    expect(kept.itemId).toBe('LINE-1');
    expect(kept.date).toBe(1780358400000);
    expect(kept.product).toBe('Lukzer Garment Rack');
    expect(kept.image).toBe('https://example.invalid/rack.jpg');
    expect(kept.statusText).toBe('Delivered 8 June');
    expect(kept.match).toEqual({
      score: 0.9, amountOk: true, ambiguous: false, candidateCount: 2,
    });
    expect(kept.itemAmountAmbiguous).toBe(true);
  });

  it('AND CARRIES NO MONEY THAT A REFUND COULD BE COMPUTED FROM', () => {
    // THE HALF THAT MATTERS MOST. A correction to an amount must state the whole
    // amount itself, so that reading the fragment tells you what the task will
    // be worth. Quietly inheriting half of a previous figure — a unit price from
    // one read beside a quantity from another — is how two readings get blended
    // into a third that nobody wrote and nobody can explain a year later.
    const kept = whatTheOrderAlreadySays(full);
    for (const forbidden of [
      'itemPaise', 'unitPricePaise', 'lineTotalPaise', 'orderTotalPaise',
      'quantity', 'quantitySource', 'quantityReason', 'amountSource',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(kept, forbidden)).toBe(false);
    }
    // quantityObserved IS carried, and that is not an exception: nothing in the
    // refund path may read it, by its own declaration in evidence.types.ts.
    expect(kept.quantityObserved).toBe(3);
  });

  it('carries nothing at all from nothing', () => {
    expect(whatTheOrderAlreadySays(null)).toEqual({});
    expect(whatTheOrderAlreadySays(undefined)).toEqual({});
  });

  it('and never turns an absent field into a null one', () => {
    // An absent key leaves the incumbent's value alone where the engine merges,
    // and reads as "not stated" where it replaces. A key present with null is a
    // statement that there is no such fact, which is a different claim.
    const kept = whatTheOrderAlreadySays(
      { id: 'X', source: 'order-history' } as unknown as Parameters<
        typeof whatTheOrderAlreadySays
      >[0],
    );
    expect(Object.keys(kept)).toEqual(['id']);
  });
});

describe('a product line ABOVE what was billed is never certain', () => {
  const RACK = 'Lukzer Garment Rack';

  it('REFUSES when the bill is LOWER than the product’s own line', () => {
    // ── THE SHAPE, QUOTED IN order-text.ts FROM THE OWNER'S OWN PAGE ──────
    //
    //     Total:              ₹1,411.00
    //     Promotion Applied:    -₹80.00
    //     Grand Total:        ₹1,331.00
    //
    // An order-level discount is not on the product's line; it comes off the
    // bill. Without this, the line equals the offer, certainty passes, the
    // figure is written as unitPricePaise — which resolveChargedPaise takes
    // outright, never consulting the total — and the refund is a percentage of
    // ₹1,411.00 when ₹1,331.00 left the account.
    const items = [{ name: RACK, pricePaise: 141100n }];
    expect(
      itemPriceIsCertain({ totalPaise: 133100n, shipments: 1, items },
        items[0], 141100n),
    ).toBe(false);
  });

  it('and still ACCEPTS the ordinary case, where the bill is larger', () => {
    // The owner's real order: a ₹938.00 rack inside a ₹1,331.00 bill that also
    // holds a ₹388.00 shelf. This is the case the whole change exists to settle,
    // and the veto above must not touch it.
    const items = [
      { name: RACK, pricePaise: 93800n },
      { name: 'Bathroom Corner Shelf', pricePaise: 38800n },
    ];
    expect(
      itemPriceIsCertain({ totalPaise: 133100n, shipments: 1, items },
        items[0], 93800n),
    ).toBe(true);
  });

  it('a bill EQUAL to the line is certain, which is the single-product order', () => {
    const items = [{ name: RACK, pricePaise: 93800n }];
    expect(
      itemPriceIsCertain({ totalPaise: 93800n, shipments: 1, items },
        items[0], 93800n),
    ).toBe(true);
  });

  it('and a page that states NO bill contradicts nothing', () => {
    // Refusing here would refuse every page that prints prices and no total.
    // Nothing is being paid above a figure, because there is no figure to be
    // above.
    const items = [{ name: RACK, pricePaise: 93800n }];
    expect(
      itemPriceIsCertain({ totalPaise: null, shipments: 1, items },
        items[0], 93800n),
    ).toBe(true);
  });

  it('THE MACHINE IS NOT LOOSER THAN THE PERSON', () => {
    // staff-amount.ts refuses a staff member who types a figure above the order
    // total, in its own words: "One item on an order cannot have cost more than
    // the whole order did." A scraper path that wrote the same figure with no
    // review would be a rule that only applies to people.
    const items = [{ name: RACK, pricePaise: 200000n }];
    expect(
      itemPriceIsCertain({ totalPaise: 133100n, shipments: 1, items },
        items[0], 200000n),
    ).toBe(false);
  });
});

describe('the delivery and the return window, out of the page and onto the row', () => {
  const AMAZON = row([
    'Order placed', '2 June 2026',
    'Order # 408-5094957-4481129',
    'Boldfit Strapless Sports Headband', '1 x ₹149',
    'Order Summary', 'Order Total ₹149',
    'Delivered 5 June 2026',
    'Return window closed on 19 June 2026',
  ]);
  const CAMPAIGN = {
    productName: 'Boldfit Strapless Sports Headband',
    productPricePaise: 14900n,
  };

  it('the delivery lands at NOON, so no time zone can move the day', () => {
    const [judged] = judgeFoundOrders([AMAZON], CAMPAIGN);
    expect(judged.deliveryDate?.toISOString()).toBe('2026-06-05T12:00:00.000Z');
  });

  it('the return window lands at the LAST INSTANT of the day it named', () => {
    // THE ASSERTION THAT FAILS IF IT IS BUILT THE SAME WAY AS THE DATE ABOVE IT.
    // Noon here is a refund released twelve hours before the window it was held
    // for had run.
    const [judged] = judgeFoundOrders([AMAZON], CAMPAIGN);
    expect(judged.returnWindowEndsAt?.toISOString())
      .toBe('2026-06-19T23:59:59.999Z');
  });

  it('and both are null on a page that said neither', () => {
    const [judged] = judgeFoundOrders([HEADBAND_ROW], CAMPAIGN);
    expect(judged.deliveryDate).toBeNull();
    expect(judged.returnWindowEndsAt).toBeNull();
  });

  it('a page that states a delivery but no window keeps the delivery', () => {
    // The two are separate facts and neither waits on the other. Amazon prints
    // the window date with a year and the delivery date without one, so a page
    // stating only one of them is the ordinary case rather than a broken read.
    const [judged] = judgeFoundOrders([row([
      'Order placed', '2 June 2026',
      'Order # 408-5094957-4481129',
      'Boldfit Strapless Sports Headband', '1 x ₹149',
      'Order Summary', 'Order Total ₹149',
      'Delivered 5 June 2026',
    ])], CAMPAIGN);
    expect(judged.deliveryDate).not.toBeNull();
    expect(judged.returnWindowEndsAt).toBeNull();
  });
});

/**
 * A PRICE THE PAGE STATES, ON AN ORDER THAT HOLDS MORE THAN ONE PRODUCT.
 *
 * Measured on the owner's own Amazon order, 16 September 2026: one order number,
 * two products, and the page states each product's own price beside it —
 * ₹938.00 for the rack, ₹388.00 for the shelf, ₹1,331.00 as the bill. His refund
 * was held for a staff member to "confirm the amount you paid" with ₹938.00
 * printed twice on the page it had just been read from.
 */
describe('is the item price certain, when the page states one per product', () => {
  const RACK = 93800n;
  const SHELF = 38800n;
  const TWO_PRODUCTS = {
    totalPaise: 133100n,
    shipments: 1,
    items: [
      { name: 'Lukzer Heavy-Duty Metal Garment Rack', pricePaise: RACK },
      { name: 'SR 2 PES Bathroom Corner Shelf', pricePaise: SHELF },
    ],
  };
  const theRack = TWO_PRODUCTS.items[0];

  it('CERTAIN when the product’s own line is exactly what the offer says', () => {
    expect(itemPriceIsCertain(TWO_PRODUCTS, theRack, RACK)).toBe(true);
  });

  it('and the other product on the same order is certain on its own terms', () => {
    expect(itemPriceIsCertain(TWO_PRODUCTS, TWO_PRODUCTS.items[1], SHELF)).toBe(true);
  });

  it('NOT CERTAIN when the line is a rupee off the offer’s price', () => {
    // No tolerance anywhere. A band here is something for somebody to find the
    // edge of by ordering twice.
    expect(itemPriceIsCertain(TWO_PRODUCTS, theRack, RACK + 100n)).toBe(false);
    expect(itemPriceIsCertain(TWO_PRODUCTS, theRack, RACK - 1n)).toBe(false);
  });

  it('NOT CERTAIN from the bill, however close it is', () => {
    // The whole bill is never an item price. This is the assertion that fails if
    // anybody ever lets the total stand in for a product.
    const billShaped = { ...TWO_PRODUCTS, items: [theRack] };
    expect(itemPriceIsCertain(billShaped, theRack, 133100n)).toBe(false);
  });

  it('REFUSES TWO OF THE THING, AND THE OLD RULE DID NOT', () => {
    // THE CHECK THAT FOUND A REAL HOLE, on 16 September 2026, in the rule it was
    // written to defend.
    //
    // One product, one shipment, and a bill exactly equal to the line — every
    // condition the bill question asks for — and the line is TWICE what the
    // offer says the product costs. The old rule called that certain and would
    // have based a refund on it.
    //
    // It cannot be reached through the product today, because matchOrderToCampaign
    // refuses the order long before this is asked. That is not a reason to leave
    // it: a rule that is only safe because of where it happens to be called from
    // is one refactor away from not being safe at all.
    const twoOfThem = {
      totalPaise: 187600n,
      shipments: 1,
      items: [{ name: 'Lukzer Heavy-Duty Metal Garment Rack', pricePaise: 187600n }],
    };
    expect(itemPriceIsCertain(twoOfThem, twoOfThem.items[0], RACK)).toBe(false);
    // And with no offer price to check against, the old answer is unchanged —
    // which is what makes this a narrowing where a price is known and not a
    // change to every page that has none.
    expect(itemPriceIsCertain(twoOfThem, twoOfThem.items[0])).toBe(true);
  });

  it('a campaign with no price cannot make anything certain', () => {
    expect(itemPriceIsCertain(TWO_PRODUCTS, theRack, null)).toBe(false);
    expect(itemPriceIsCertain(TWO_PRODUCTS, theRack, 0n)).toBe(false);
    expect(itemPriceIsCertain(TWO_PRODUCTS, theRack)).toBe(false);
  });

  it('AND THE OLD RULE STILL ANSWERS FOR A PAGE THAT STATES NO PRODUCT PRICE', () => {
    // Quick commerce states a basket total and never a line price, and the only
    // way such a page can prove a quantity of one is unchanged: one product, one
    // shipment, a bill that is exactly that product's price.
    const oneProduct = {
      totalPaise: 14900n,
      shipments: 1,
      items: [{ name: 'Boldfit Headband', pricePaise: 14900n }],
    };
    expect(itemPriceIsCertain(oneProduct, oneProduct.items[0])).toBe(true);
    const twoShipments = { ...oneProduct, shipments: 2 };
    expect(itemPriceIsCertain(twoShipments, oneProduct.items[0])).toBe(false);
  });
});
