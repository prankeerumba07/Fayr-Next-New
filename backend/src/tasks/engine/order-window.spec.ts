// The date rule, written before it was wired in.
//
// Grounded in real data: task 920244c9 (Amazon, Lukzer garment rack) reached
// REVIEWED on order 408-1509645-3524313 dated 2026-06-02, against a campaign
// created 2026-08-11 — 71 days earlier. It passed every gate that existed. Two
// FLIPKART tasks reached REFUNDED the same way. Those cases are the tests.

import {
  ORDER_WINDOW_GRACE_MS,
  ORDER_WINDOW_RULE_FROM,
  OUT_OF_WINDOW_MESSAGE,
  checkOrderWindow,
  lookbackDays,
  orderWindow,
  screenEvidenceByWindow,
} from './order-window';
import { BLOCKERS, DAY } from './states';

/** After the rule's cutoff, so the rule is enforced unless a test says otherwise. */
const CLAIMED = ORDER_WINDOW_RULE_FROM + 30 * DAY;

const win = (over: Partial<Parameters<typeof orderWindow>[0]> = {}) =>
  orderWindow({
    claimedAt: CLAIMED,
    campaignCreatedAt: CLAIMED - 5 * DAY,
    claimExpiresAt: CLAIMED + 7 * DAY,
    ...over,
  });

describe('order window — the campaign must have caused the purchase', () => {
  it('refuses the exact Lukzer case: an order 71 days before the claim', () => {
    const w = win();
    expect(checkOrderWindow(CLAIMED - 71 * DAY, w)).toBe('before-claim');
  });

  it('accepts an order placed just after claiming', () => {
    expect(checkOrderWindow(CLAIMED + 60_000, win())).toBe('ok');
  });

  it('accepts the claim instant itself, and the deadline instant itself', () => {
    const w = win();
    expect(checkOrderWindow(w.floor, w)).toBe('ok');
    expect(checkOrderWindow(w.ceiling as number, w)).toBe('ok');
  });

  it('allows the 2-hour grace for buying just before tapping Claim', () => {
    const w = win();
    expect(checkOrderWindow(CLAIMED - 90 * 60 * 1000, w)).toBe('ok');
    // ...but not a minute beyond it.
    expect(checkOrderWindow(CLAIMED - ORDER_WINDOW_GRACE_MS - 60_000, w)).toBe(
      'before-claim',
    );
  });

  it('closes the window at the purchase deadline', () => {
    const w = win();
    expect(checkOrderWindow(CLAIMED + 8 * DAY, w)).toBe('after-deadline');
  });

  it('has no upper bound when no deadline is set', () => {
    const w = win({ claimExpiresAt: null });
    expect(w.ceiling).toBeNull();
    expect(checkOrderWindow(CLAIMED + 400 * DAY, w)).toBe('ok');
  });
});

describe('order window — the campaign-start backstop', () => {
  it('never reaches back past the campaign itself, even with the grace', () => {
    // Campaign created 30 minutes before the claim: the 2h grace must not reach
    // behind it, or a re-published campaign could reopen an older window.
    const w = win({ campaignCreatedAt: CLAIMED - 30 * 60 * 1000 });
    expect(w.floor).toBe(CLAIMED - 30 * 60 * 1000);
    expect(checkOrderWindow(CLAIMED - 60 * 60 * 1000, w)).toBe('before-claim');
  });

  it('uses claim time when the campaign is older than the grace', () => {
    const w = win({ campaignCreatedAt: CLAIMED - 100 * DAY });
    expect(w.floor).toBe(CLAIMED - ORDER_WINDOW_GRACE_MS);
  });

  it('falls back to claim time when the campaign date is unknown', () => {
    const w = win({ campaignCreatedAt: null });
    expect(w.floor).toBe(CLAIMED - ORDER_WINDOW_GRACE_MS);
  });
});

describe('order window — what it deliberately does NOT refuse', () => {
  it('an absent order date is not a failure', () => {
    // Readers legitimately fail to resolve a date; refusing on absence would
    // destroy real evidence. The missing-data path handles it instead.
    expect(checkOrderWindow(null, win())).toBe('ok');
    expect(checkOrderWindow(undefined, win())).toBe('ok');
  });

  it('a task claimed before the rule shipped is exempt, permanently', () => {
    // All seven tasks that existed when this landed would fail, two of them
    // already REFUNDED. Keyed on the TASK so re-fetching an old one is still fine.
    const w = orderWindow({
      claimedAt: ORDER_WINDOW_RULE_FROM - DAY,
      campaignCreatedAt: null,
      claimExpiresAt: null,
    });
    expect(w.enforced).toBe(false);
    expect(checkOrderWindow(ORDER_WINDOW_RULE_FROM - 200 * DAY, w)).toBe('ok');
  });

  it('but a task claimed on or after the cutoff IS bound', () => {
    const w = orderWindow({
      claimedAt: ORDER_WINDOW_RULE_FROM,
      campaignCreatedAt: null,
      claimExpiresAt: null,
    });
    expect(w.enforced).toBe(true);
    expect(checkOrderWindow(ORDER_WINDOW_RULE_FROM - 200 * DAY, w)).toBe(
      'before-claim',
    );
  });
});

describe('screenEvidenceByWindow — the enforcement point', () => {
  const order = (date: number) => ({
    id: 'o1',
    date,
    itemPaise: 93800n,
    source: 'order-details',
  });

  it('strips an out-of-window order so nothing can compute a refund from it', () => {
    const res = screenEvidenceByWindow(
      { order: order(CLAIMED - 71 * DAY), delivery: { at: CLAIMED, source: 'order-details' } } as never,
      win(),
    );
    expect(res.refused).toBe(true);
    expect(res.evidence.order).toBeNull();
    // The delivery goes too: a delivery date for a non-qualifying order is not
    // evidence of anything, and a stale one could shorten the holding period.
    expect(res.evidence.delivery).toBeNull();
    expect(res.evidence.blocker).toBe(BLOCKERS.ORDER_OUT_OF_WINDOW);
  });

  it('keeps a qualifying order untouched', () => {
    const ev = { order: order(CLAIMED + DAY) } as never;
    const res = screenEvidenceByWindow(ev, win());
    expect(res.refused).toBe(false);
    expect(res.evidence).toBe(ev); // same object — no needless copying
  });

  it('keeps the review, which cannot advance the task on its own', () => {
    const res = screenEvidenceByWindow(
      { order: order(CLAIMED - 71 * DAY), review: { published: true, rating: 5 } } as never,
      win(),
    );
    expect(res.evidence.review).not.toBeNull();
  });

  it('uses a DISTINCT blocker from "unreadable", so the screen can offer no upload', () => {
    const res = screenEvidenceByWindow({ order: order(CLAIMED - 71 * DAY) } as never, win());
    expect(res.evidence.blocker).not.toBe(BLOCKERS.ORDER_UNREADABLE);
  });

  it('is a no-op for a grandfathered task', () => {
    const w = orderWindow({
      claimedAt: ORDER_WINDOW_RULE_FROM - DAY,
      campaignCreatedAt: null,
      claimExpiresAt: null,
    });
    const res = screenEvidenceByWindow({ order: order(ORDER_WINDOW_RULE_FROM - 200 * DAY) } as never, w);
    expect(res.refused).toBe(false);
    expect(res.evidence.order).not.toBeNull();
  });
});

describe('out-of-window wording — a rule, not a glitch', () => {
  for (const [verdict, msg] of Object.entries(OUT_OF_WINDOW_MESSAGE)) {
    it(`${verdict}: says it does not qualify, and what to do next`, () => {
      expect(msg).toMatch(/doesn’t qualify/);
      // Must not read as breakage — the exact confusion the old copy caused.
      expect(msg).not.toMatch(/couldn’t read|could not read|error|failed|wrong/i);
      // Must never send someone to an upload that cannot fix a date.
      expect(msg).not.toMatch(/screenshot|upload|photo|invoice/i);
      // Must not dead-end: either an action, or an explicit "nothing is wrong".
      expect(msg).toMatch(/claim the offer|Nothing is wrong/i);
      expect(msg.length).toBeGreaterThan(60);
    });
  }

  it('the before-claim message names the actual cause in its first sentence', () => {
    expect(OUT_OF_WINDOW_MESSAGE['before-claim']).toMatch(
      /^You bought this before you claimed the offer/,
    );
  });
});

describe('lookbackDays — bounded search replaces "the last 10 orders"', () => {
  const now = CLAIMED + 3 * DAY;

  it('covers the window plus its boundary day', () => {
    const w = win({ campaignCreatedAt: null });
    expect(lookbackDays(w, now, 365)).toBe(5); // 3 days + grace, rounded up, +1
  });

  it('is clamped by the configurable maximum', () => {
    // The floor is claim-time-bounded, so an OLD CLAIM is what widens the span —
    // an older campaign cannot, because the backstop only ever raises the floor.
    const w = orderWindow({
      claimedAt: CLAIMED - 300 * DAY,
      campaignCreatedAt: null,
      claimExpiresAt: null,
    });
    expect(lookbackDays(w, now, 30)).toBe(30);
    expect(lookbackDays(w, now, 365)).toBeGreaterThan(300);
  });

  it('never returns less than a day', () => {
    const w = win({ campaignCreatedAt: null });
    expect(lookbackDays(w, w.floor, 365)).toBe(1);
    // A clock skewed backwards must not produce a negative or zero span.
    expect(lookbackDays(w, w.floor - 10 * DAY, 365)).toBe(1);
  });

  it('a longer test window widens the SEARCH without weakening the RULE', () => {
    const w = win({ campaignCreatedAt: null });
    expect(lookbackDays(w, now, 365)).toBeLessThanOrEqual(365);
    // The rule is unchanged by however far the scraper is allowed to look.
    expect(checkOrderWindow(CLAIMED - 200 * DAY, w)).toBe('before-claim');
  });
});
