import {
  compareToOwnOrder,
  dayFromMillis,
  dayFromText,
  howManyAgree,
  howManyCompared,
  matchOrderToCampaign,
  paiseFromRupees,
  rupeesFromPaise,
} from './order-comparison';

/** A day at noon UTC, so no time zone can move it. */
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12, 0, 0);

const ORDER = {
  id: '402-3925017-7784521',
  product: 'Prestige Induction Cooktop 1900W Black',
  unitPricePaise: 132600n,
  orderTotalPaise: 132600n,
  date: day(2026, 7, 2),
};

const SHOT = {
  orderNumber: '402-3925017-7784521',
  productName: 'Prestige Induction Cooktop 1900W Black',
  amount: 1326,
  orderDate: '2 Jul 2026',
  marketplace: 'Amazon',
};

const by = (rows: ReturnType<typeof compareToOwnOrder>) =>
  Object.fromEntries(rows.map((r) => [r.field, r]));

describe('the user’s own screenshot against the user’s own order', () => {
  describe('the rows themselves', () => {
    it('is the design’s four, then the marketplace the owner asked for', () => {
      const rows = compareToOwnOrder(SHOT, ORDER, 'Amazon');
      expect(rows.map((r) => r.label)).toEqual([
        'Order ID', 'Order amount', 'Order date', 'Product name', 'Marketplace',
      ]);
    });

    it('adds a delivery row only when either side has something to say', () => {
      expect(compareToOwnOrder(SHOT, ORDER, 'Amazon')
        .some((r) => r.field === 'delivery')).toBe(false);
      const withStatus = compareToOwnOrder(
        { ...SHOT, deliveryStatus: 'Delivered' }, ORDER, 'Amazon',
      );
      expect(withStatus.some((r) => r.field === 'delivery')).toBe(true);
      const withDate = compareToOwnOrder(
        SHOT, { ...ORDER, deliveredAt: day(2026, 7, 6) }, 'Amazon',
      );
      expect(withDate.some((r) => r.field === 'delivery')).toBe(true);
    });

    it('never compares a delivery status against a delivery date', () => {
      // Two different facts. Calling them a disagreement would be wrong, so the
      // row is shown with no verdict at all.
      const rows = compareToOwnOrder(
        { ...SHOT, deliveryStatus: 'Delivered' },
        { ...ORDER, deliveredAt: day(2026, 7, 6) },
        'Amazon',
      );
      expect(by(rows).delivery.agree).toBeNull();
      expect(by(rows).delivery.fromScreenshot).toBe('Delivered');
      expect(by(rows).delivery.fromOrder).toContain('2026-07-06');
    });
  });

  describe('a screenshot of the right order', () => {
    it('agrees on every row', () => {
      const rows = compareToOwnOrder(SHOT, ORDER, 'Amazon');
      expect(howManyAgree(rows)).toBe(5);
      expect(howManyCompared(rows)).toBe(5);
      for (const r of rows) expect(r.agree).toBe(true);
    });

    it('shows the same figure on both sides when they agree', () => {
      const rows = by(compareToOwnOrder(SHOT, ORDER, 'Amazon'));
      expect(rows.amount.fromScreenshot).toBe('₹1,326.00');
      expect(rows.amount.fromOrder).toBe('₹1,326.00');
    });

    it('ignores punctuation and spacing in an order number', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, orderNumber: ' 402 3925017 7784521 ' }, ORDER, 'Amazon',
      ));
      expect(rows.orderId.agree).toBe(true);
      // But it shows what the screenshot really said, not a tidied version.
      expect(rows.orderId.fromScreenshot).toBe('402 3925017 7784521');
    });

    it('accepts a cropped product name, because an order page prints the full title', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, productName: 'Prestige Induction Cooktop' }, ORDER, 'Amazon',
      ));
      expect(rows.productName.agree).toBe(true);
    });

    it('accepts any money field Fayr holds for the line', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, amount: 328 },
        { ...ORDER, unitPricePaise: null, lineTotalPaise: 36700n, orderTotalPaise: 32800n },
        'Amazon',
      ));
      expect(rows.amount.agree).toBe(true);
    });

    it('reads every date shape a marketplace order page prints', () => {
      for (const written of ['2026-07-02', '2 Jul 2026', '2 July 2026',
        'Jul 2, 2026', 'July 2 2026', '02/07/2026', '2-7-2026']) {
        const rows = by(compareToOwnOrder({ ...SHOT, orderDate: written }, ORDER, 'Amazon'));
        expect(rows.orderDate.agree).toBe(true);
      }
    });
  });

  describe('a screenshot of a DIFFERENT order', () => {
    it('says so on the row that is wrong, and only that row', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, orderNumber: '402-0000000-0000000' }, ORDER, 'Amazon',
      ));
      expect(rows.orderId.agree).toBe(false);
      expect(rows.amount.agree).toBe(true);
      expect(rows.orderDate.agree).toBe(true);
      expect(rows.productName.agree).toBe(true);
    });

    it('shows BOTH values, so the person can see what differs', () => {
      const rows = by(compareToOwnOrder({ ...SHOT, amount: 999 }, ORDER, 'Amazon'));
      expect(rows.amount.agree).toBe(false);
      expect(rows.amount.fromScreenshot).toBe('₹999.00');
      expect(rows.amount.fromOrder).toBe('₹1,326.00');
    });

    it('catches a wrong date and a wrong product', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, orderDate: '9 Aug 2026', productName: 'A completely other thing' },
        ORDER, 'Amazon',
      ));
      expect(rows.orderDate.agree).toBe(false);
      expect(rows.productName.agree).toBe(false);
    });

    it('catches a screenshot from another shop', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, marketplace: 'Flipkart' }, ORDER, 'Amazon',
      ));
      expect(rows.marketplace.agree).toBe(false);
    });
  });

  describe('IT IS EXACT, WHICH IS WHAT MAKES IT SAFE TO SHOW', () => {
    it('one paise off is a disagreement, so no tolerance can be found from here', () => {
      // The staff matcher allows a ₹2 or 5% band. Nothing on this screen does, so
      // uploading screenshots and watching this flip cannot reveal that band.
      const rows = by(compareToOwnOrder({ ...SHOT, amount: 1326.01 }, ORDER, 'Amazon'));
      expect(rows.amount.agree).toBe(false);
      const nearby = by(compareToOwnOrder({ ...SHOT, amount: 1325 }, ORDER, 'Amazon'));
      expect(nearby.amount.agree).toBe(false);
    });

    it('never mentions a threshold, a score, a verdict or a confidence', () => {
      const rows = compareToOwnOrder(
        { ...SHOT, amount: 1, orderNumber: 'x', deliveryStatus: 'Delivered' },
        { ...ORDER, deliveredAt: day(2026, 7, 6) },
        'Amazon',
      );
      const flat = JSON.stringify(rows).toLowerCase();
      for (const leak of ['tolerance', 'threshold', 'overlap', 'confidence',
        'verdict', 'suspicious', 'band', 'score']) {
        expect(flat).not.toContain(leak);
      }
    });

    it('carries no field the campaign decides', () => {
      // The campaign's expected price and product name are the staff matcher's
      // business. Nothing here reads them, so nothing here can leak them.
      const rows = compareToOwnOrder(SHOT, ORDER, 'Amazon');
      const keys = new Set(rows.flatMap((r) => Object.keys(r)));
      expect([...keys].sort()).toEqual(
        ['agree', 'field', 'fromOrder', 'fromScreenshot', 'label'],
      );
    });
  });

  describe('a missing side is not a disagreement', () => {
    it('is null when the screenshot could not be read', () => {
      const rows = compareToOwnOrder({}, ORDER, 'Amazon');
      for (const r of rows) expect(r.agree).toBeNull();
      expect(howManyCompared(rows)).toBe(0);
      // And our side is still shown, because it is still true.
      expect(by(rows).orderId.fromOrder).toBe(ORDER.id);
    });

    it('is null when Fayr has no order yet', () => {
      const rows = compareToOwnOrder(SHOT, null, 'Amazon');
      for (const r of rows) {
        if (r.field !== 'marketplace') expect(r.agree).toBeNull();
      }
      expect(by(rows).orderId.fromScreenshot).toBe(SHOT.orderNumber);
    });

    it('is null for a date neither side wrote in a shape we can read', () => {
      const rows = by(compareToOwnOrder(
        { ...SHOT, orderDate: 'last Tuesday' }, ORDER, 'Amazon',
      ));
      expect(rows.orderDate.agree).toBeNull();
      expect(rows.orderDate.fromScreenshot).toBeNull();
      expect(rows.orderDate.fromOrder).toBe('2026-07-02');
    });
  });

  describe('nothing missing or malformed gets through', () => {
    const junk: unknown[] = [undefined, null, {}, 'nonsense', 42, [], true];
    it.each(junk.map((j) => [JSON.stringify(j) ?? 'undefined', j]))(
      'survives %s on either side',
      (_label, value) => {
        for (const rows of [
          compareToOwnOrder(value as never, ORDER, 'Amazon'),
          compareToOwnOrder(SHOT, value as never, 'Amazon'),
          compareToOwnOrder(value as never, value as never, value as never),
        ]) {
          expect(rows.length).toBeGreaterThanOrEqual(5);
          const flat = JSON.stringify(rows);
          expect(flat).not.toContain('undefined');
          expect(flat).not.toContain('NaN');
          expect(flat).not.toContain('[object');
          for (const r of rows) {
            expect(typeof r.label).toBe('string');
            expect([true, false, null]).toContain(r.agree);
          }
        }
      },
    );

    it('refuses an amount that is not a real amount', () => {
      for (const bad of [undefined, null, -1, NaN, Infinity]) {
        expect(paiseFromRupees(bad as never)).toBeNull();
      }
      expect(paiseFromRupees(0)).toBe(0n);
      expect(paiseFromRupees(295.2)).toBe(29520n);
      // Rounded, not truncated: a model reading 295.199 means 295.20.
      expect(paiseFromRupees(295.199)).toBe(29520n);
    });
  });

  describe('the small pieces', () => {
    it('formats money the Indian way, with no Intl', () => {
      expect(rupeesFromPaise(0n)).toBe('₹0.00');
      expect(rupeesFromPaise(5n)).toBe('₹0.05');
      expect(rupeesFromPaise(100000n)).toBe('₹1,000.00');
      expect(rupeesFromPaise(12345678n)).toBe('₹1,23,456.78');
      expect(rupeesFromPaise(null)).toBeNull();
    });

    it('reads a day out of milliseconds and out of text', () => {
      expect(dayFromMillis(day(2026, 1, 1))).toBe('2026-01-01');
      expect(dayFromMillis(null)).toBeNull();
      expect(dayFromMillis(NaN)).toBeNull();
      expect(dayFromText('2026-12-31T10:00:00Z')).toBe('2026-12-31');
      expect(dayFromText('31 Dec 2026')).toBe('2026-12-31');
      for (const bad of [undefined, null, '', 'soon', '2026', '13/13/2026', 42]) {
        expect(dayFromText(bad as never)).toBeNull();
      }
    });
  });
});

/* ============================================================================
   ONE CAMPAIGN PRODUCT AGAINST AN ORDER THAT HOLDS SEVERAL
   ----------------------------------------------------------------------------
   Added 2 September 2026. A real Zepto order carries several products under
   several shipment headings, so "does this order contain the thing we asked them
   to buy" can no longer be answered by looking at one name and one price.
   ========================================================================== */

const HEADBAND = { name: 'Boldfit Strapless Sports Headband', pricePaise: 14900n };
const EARPHONES = { name: 'Hammer Nova earphones', pricePaise: 21900n };

/** The Zepto order from the fixture, in the shape the comparison takes. */
const MANY = {
  id: 'SOSIJGGRL26770',
  date: day(2026, 8, 21),
  orderTotalPaise: 36800n,
  items: [HEADBAND, EARPHONES],
};

describe('an order that holds several products', () => {
  describe('the field by field rows read it too', () => {
    it('agrees on a product that is one of several on the order', () => {
      const rows = by(compareToOwnOrder(
        { productName: 'Hammer Nova earphones', amount: 219 },
        MANY,
        'Zepto',
      ));
      expect(rows.productName.agree).toBe(true);
      expect(rows.productName.fromOrder).toBe('Hammer Nova earphones');
      expect(rows.amount.agree).toBe(true);
    });

    it('shows the price of the product that agreed, not the whole bill', () => {
      const rows = by(compareToOwnOrder(
        { productName: 'Boldfit Strapless Sports Headband', amount: 149 },
        MANY,
        'Zepto',
      ));
      expect(rows.amount.fromScreenshot).toBe('₹149.00');
      expect(rows.amount.fromOrder).toBe('₹149.00');
    });

    it('still accepts the whole bill as the amount', () => {
      // A screenshot of the bill block shows ₹368 and nothing else. That is the
      // same order, so the row must not read as a disagreement.
      const rows = by(compareToOwnOrder({ amount: 368 }, MANY, 'Zepto'));
      expect(rows.amount.agree).toBe(true);
    });

    it('disagrees on a product that is not on the order at all', () => {
      const rows = by(compareToOwnOrder(
        { productName: 'Prestige Induction Cooktop', amount: 1326 },
        MANY,
        'Zepto',
      ));
      expect(rows.productName.agree).toBe(false);
      expect(rows.amount.agree).toBe(false);
    });

    it('changes nothing for an order with one product and no item list', () => {
      // The old shape, untouched. This is the check that stops the hard case from
      // being fixed by breaking the easy one.
      const rows = by(compareToOwnOrder(SHOT, ORDER, 'Amazon'));
      expect(rows.productName.agree).toBe(true);
      expect(rows.amount.agree).toBe(true);
      expect(rows.orderId.agree).toBe(true);
      expect(rows.orderDate.agree).toBe(true);
    });
  });

  describe('does this order contain what we asked them to buy', () => {
    const CAMPAIGN = {
      productName: 'Hammer Nova earphones',
      expectedPricePaise: 21900n,
    };

    it('matches when any one product on the order is the right one', () => {
      const answer = matchOrderToCampaign(MANY, CAMPAIGN);
      expect(answer.matches).toBe(true);
      expect(answer.reason).toBe('matched');
      expect(answer.item).toEqual(EARPHONES);
    });

    it('matches the first product on the order just as readily as the last', () => {
      const answer = matchOrderToCampaign(MANY, {
        productName: 'Boldfit Strapless Sports Headband',
        expectedPricePaise: 14900n,
      });
      expect(answer.matches).toBe(true);
      expect(answer.item).toEqual(HEADBAND);
    });

    it('says the name was not found when nothing on the order is it', () => {
      const answer = matchOrderToCampaign(MANY, {
        productName: 'Prestige Induction Cooktop 1900W Black',
        expectedPricePaise: 132600n,
      });
      expect(answer.matches).toBe(false);
      expect(answer.reason).toBe('product_name_not_found');
      expect(answer.item).toBeNull();
    });

    it('says the price differs when the name was found and the price was not', () => {
      const answer = matchOrderToCampaign(MANY, {
        productName: 'Hammer Nova earphones',
        expectedPricePaise: 19900n,
      });
      expect(answer.matches).toBe(false);
      expect(answer.reason).toBe('price_differs');
      // The item is handed back, so whoever shows this can say which product and
      // what it actually cost without going looking for it again.
      expect(answer.item).toEqual(EARPHONES);
    });

    it('never says only that there was no match', () => {
      // Every answer names what failed. This is the owner's rule, checked over
      // every way the comparison can end rather than one of them.
      const answers = [
        matchOrderToCampaign(MANY, CAMPAIGN),
        matchOrderToCampaign(MANY, { productName: 'Nothing Like It', expectedPricePaise: 100n }),
        matchOrderToCampaign(MANY, { productName: 'Hammer Nova earphones', expectedPricePaise: 100n }),
        matchOrderToCampaign({ items: [] }, CAMPAIGN),
        matchOrderToCampaign(MANY, { productName: 'Hammer Nova earphones', expectedPricePaise: null }),
        matchOrderToCampaign(MANY, { productName: null, expectedPricePaise: 21900n }),
      ];
      expect(answers.map((a) => a.reason)).toEqual([
        'matched',
        'product_name_not_found',
        'price_differs',
        'no_products_read',
        'no_expected_price',
        'no_campaign_product',
      ]);
      for (const a of answers) {
        expect(typeof a.reason).toBe('string');
        expect(a.reason).not.toBe('no_match');
      }
    });

    it('has no tolerance in it at all', () => {
      // One paise out is out. The staff side has a rupee band and a percentage
      // band on purpose; this one must not, or it becomes a way for somebody to
      // find where the band ends by trying.
      for (const off of [21899n, 21901n, 21800n, 22000n]) {
        const answer = matchOrderToCampaign(MANY, {
          productName: 'Hammer Nova earphones',
          expectedPricePaise: off,
        });
        expect(answer.matches).toBe(false);
        expect(answer.reason).toBe('price_differs');
      }
    });

    it('reads an order with one product and no item list', () => {
      // Amazon's shape. The order carries a product and a price and no list, and
      // it must still match, or every Amazon task stops working.
      const answer = matchOrderToCampaign(ORDER, {
        productName: 'Prestige Induction Cooktop 1900W Black',
        expectedPricePaise: 132600n,
      });
      expect(answer.matches).toBe(true);
      expect(answer.reason).toBe('matched');
    });

    it('says nothing was read when the order has no products on it', () => {
      for (const empty of [{}, { items: [] }, { items: null }]) {
        const answer = matchOrderToCampaign(empty, CAMPAIGN);
        expect(answer.matches).toBe(false);
        expect(answer.reason).toBe('no_products_read');
      }
    });

    it('accepts a longer name on the order than on the campaign', () => {
      // An order line prints the full title and a campaign carries a shorter one,
      // or the other way about. One containing the other is the same product;
      // nothing looser than that counts, and there is no score anywhere in it.
      const answer = matchOrderToCampaign(
        { items: [{ name: 'Hammer Nova Bluetooth earphones with 60 hour battery', pricePaise: 21900n }] },
        { productName: 'Hammer Nova Bluetooth earphones', expectedPricePaise: 21900n },
      );
      expect(answer.matches).toBe(true);
    });

    it('survives junk on either side', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j = (v: any) => v;
      expect(matchOrderToCampaign(j(null), j(null)).matches).toBe(false);
      expect(matchOrderToCampaign(j(undefined), CAMPAIGN).reason).toBe('no_products_read');
      expect(matchOrderToCampaign(MANY, j(null)).reason).toBe('no_campaign_product');
      expect(matchOrderToCampaign(j({ items: 'not a list' }), CAMPAIGN).reason)
        .toBe('no_products_read');
    });
  });
});

describe('a purchase Fayr watched: the product is the whole verdict', () => {
  // PHASE 8B-a, THE OWNER'S WORDS, 19 September 2026: "It doesn't matter [if the
  // price differs]. You just have to go and check if the user has purchased the
  // product inside the Fayr app or not, the same product he has purchased."
  //
  // THE SAME ORDER, THE SAME GAP, TWO ANSWERS — that is the whole check, and it
  // is written as one comparison run twice so the two can never drift apart.
  const ORDER = { items: [{ name: 'Boldfit Strapless Sports Headband', pricePaise: 14900n }] };
  const CAMPAIGN = {
    productName: 'Boldfit Strapless Sports Headband',
    expectedPricePaise: 32500n,
  };

  it('WATCHED: a price gap is not a reason to refuse', () => {
    const answer = matchOrderToCampaign(ORDER, CAMPAIGN, { priceMayDiffer: true });
    expect(answer.matches).toBe(true);
    expect(answer.reason).toBe('matched');
    expect(answer.item?.pricePaise).toBe(14900n);
  });

  it('UNWATCHED: the same gap on the same order is still price_differs', () => {
    for (const how of [undefined, null, {}, { priceMayDiffer: false }]) {
      const answer = matchOrderToCampaign(ORDER, CAMPAIGN, how);
      expect(answer.matches).toBe(false);
      expect(answer.reason).toBe('price_differs');
    }
  });

  it('and it is the price that bends, not the product', () => {
    const answer = matchOrderToCampaign(
      { items: [{ name: 'Something Else Entirely', pricePaise: 32500n }] },
      CAMPAIGN,
      { priceMayDiffer: true },
    );
    expect(answer.matches).toBe(false);
    expect(answer.reason).toBe('product_name_not_found');
  });

  it('an order with nothing readable on it is still nothing', () => {
    expect(matchOrderToCampaign({ items: [] }, CAMPAIGN, { priceMayDiffer: true }).reason)
      .toBe('no_products_read');
  });

  it('AND A CAMPAIGN THAT STATES NO PRICE IS STILL REFUSED', () => {
    // The ceiling is what stops a percentage being paid on a figure read off a
    // shop's page. An offer with no price has no ceiling, so this does not bend.
    const answer = matchOrderToCampaign(
      ORDER,
      { productName: CAMPAIGN.productName, expectedPricePaise: null },
      { priceMayDiffer: true },
    );
    expect(answer.matches).toBe(false);
    expect(answer.reason).toBe('no_expected_price');
  });

  it('and the product AT the offer\u2019s price still wins over one that is not', () => {
    const answer = matchOrderToCampaign(
      {
        items: [
          { name: 'Boldfit Strapless Sports Headband', pricePaise: 14900n },
          { name: 'Boldfit Strapless Sports Headband', pricePaise: 32500n },
        ],
      },
      CAMPAIGN,
      { priceMayDiffer: true },
    );
    expect(answer.item?.pricePaise).toBe(32500n);
  });
});
