import {
  compareToOwnOrder,
  dayFromMillis,
  dayFromText,
  howManyAgree,
  howManyCompared,
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
