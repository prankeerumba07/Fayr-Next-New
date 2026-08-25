// The claim confirmation screen's own numbers, tested away from React.
//
// This screen is where 5 tickets are actually committed, so every figure on it
// has to be one the backend stated. The one that used not to exist is the
// DEADLINE: the design says "buy the product within 48 hours of joining", the
// prototype's own claimed sheet says 2 hours, and the backend's real window is
// whatever CLAIM_TTL_DAYS says (7 by default). Three numbers, none agreeing —
// so the server now sends its own, and this module refuses to state one it was
// not given.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  claimDeadline,
  ticketPlan,
  refundLines,
  heldTicketCount,
  remainingToBuy,
} from './confirmJoin.js';

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    process.exitCode = 1;
  }
};

// A fixed instant so the formatted date is deterministic. Real Date, real
// formatting — this is the same Intl path the screen uses.
const NOW = new Date('2026-08-25T10:30:00.000Z');

console.log('claimDeadline');
t('states the window the server sent, and the date it lands on', () => {
  const d = claimDeadline({ windowDays: 7, now: NOW });
  assert.equal(d.days, 7);
  assert.match(d.within, /^7 days$/);
  // The design's sentence, with the real numbers in it.
  assert.match(d.line, /^Buy the product within 7 days of joining — by /);
});

t('says "1 day", not "1 days"', () => {
  assert.equal(claimDeadline({ windowDays: 1, now: NOW }).within, '1 day');
});

t('returns NOTHING when the server did not say', () => {
  // The screen then omits the deadline card entirely. A missing number must not
  // become a guessed one: this is the screen where tickets are spent.
  assert.equal(claimDeadline({ windowDays: null, now: NOW }), null);
  assert.equal(claimDeadline({ windowDays: undefined, now: NOW }), null);
  assert.equal(claimDeadline({ now: NOW }), null);
});

t('refuses a zero or negative window rather than showing "within 0 days"', () => {
  assert.equal(claimDeadline({ windowDays: 0, now: NOW }), null);
  assert.equal(claimDeadline({ windowDays: -3, now: NOW }), null);
});

t('refuses a non-integer window', () => {
  assert.equal(claimDeadline({ windowDays: 2.5, now: NOW }), null);
  assert.equal(claimDeadline({ windowDays: '7', now: NOW }), null);
  assert.equal(claimDeadline({ windowDays: NaN, now: NOW }), null);
});

console.log('ticketPlan');
t('spends the campaign cost and says the balance after', () => {
  const p = ticketPlan({ balance: 15, cost: 5 });
  assert.equal(p.cost, 5);
  assert.equal(p.after, 10);
  assert.equal(p.enough, true);
  assert.equal(p.shortBy, 0);
});

t('knows when there are not enough, and by how many', () => {
  const p = ticketPlan({ balance: 3, cost: 5 });
  assert.equal(p.enough, false);
  assert.equal(p.shortBy, 2);
  // No negative balance is ever shown to a user.
  assert.equal(p.after, null);
});

t('an exact balance is enough', () => {
  const p = ticketPlan({ balance: 5, cost: 5 });
  assert.equal(p.enough, true);
  assert.equal(p.after, 0);
});

t('an unknown balance is not "enough" — it is unknown', () => {
  // The wallet call can fail. Treating a missing balance as sufficient would put
  // a live CONFIRM & JOIN button in front of a user who cannot claim.
  const p = ticketPlan({ balance: null, cost: 5 });
  assert.equal(p.enough, null);
  assert.equal(p.after, null);
  assert.equal(p.shortBy, null);
});

t('uses the campaign cost, not a hardcoded 5', () => {
  assert.equal(ticketPlan({ balance: 15, cost: 8 }).after, 7);
});

console.log('refundLines');
t('states the percentage and the ceiling the campaign really has', () => {
  const r = refundLines({ percent: 90, productPricePaise: 60000, payoutCapPaise: null });
  assert.equal(r.percentLine, '90% of what you pay');
  assert.equal(r.maxLine, '₹540');
});

t('a cap below the percentage IS the maximum', () => {
  const r = refundLines({ percent: 100, productPricePaise: 129900, payoutCapPaise: 60400 });
  assert.equal(r.maxLine, '₹604');
});

t('omits the maximum when the price is unknown rather than printing ₹—', () => {
  const r = refundLines({ percent: 90, productPricePaise: null, payoutCapPaise: null });
  assert.equal(r.maxLine, null);
});

console.log('heldTicketCount');
t('counts the tickets sitting in claims that could still come back', () => {
  // "Held in active claims" on the design's insufficient sheet. There is no held
  // bucket in the ledger — a claim DEDUCTS and an expiry RETURNS — so this is
  // derived from the user's own open claims, which is what would be returned.
  const tasks = [
    { state: 'CLAIMED', ticketCost: 5 },
    { state: 'CLAIMED', ticketCost: 5 },
    { state: 'REFUNDED', ticketCost: 5 },
    { state: 'PURCHASED', ticketCost: 5 },
  ];
  assert.equal(heldTicketCount(tasks), 10);
});

t('a purchased claim has SPENT its tickets, not held them', () => {
  // The economy is explicit: consumed permanently once the purchase is
  // confirmed. Counting those as "held" would promise a return that never comes.
  assert.equal(heldTicketCount([{ state: 'PURCHASED', ticketCost: 5 }]), 0);
});

t('falls back to nothing rather than guessing a cost', () => {
  assert.equal(heldTicketCount([{ state: 'CLAIMED' }]), 0);
  assert.equal(heldTicketCount(null), 0);
  assert.equal(heldTicketCount([]), 0);
});


console.log('remainingToBuy');
t('reads the deadline off the task, not off a design constant', () => {
  // The design's claimed sheet counts down from 25m 35s and says "2 hours".
  // Neither number exists anywhere in the system; claimExpiresAt does, and it is
  // the only one that expires anything.
  const r = remainingToBuy(
    { claimExpiresAt: '2026-09-01T10:30:00.000Z' },
    new Date('2026-08-25T10:30:00.000Z'),
  );
  assert.equal(r.phrase, '7 days');
  assert.equal(r.clock, '7d 0h');
});

t('drops to hours on the last day, and to minutes in the last hour', () => {
  const now = new Date('2026-08-25T10:00:00.000Z');
  const hours = remainingToBuy({ claimExpiresAt: '2026-08-25T15:30:00.000Z' }, now);
  assert.equal(hours.phrase, '5 hours');
  assert.equal(hours.clock, '5h 30m');
  const mins = remainingToBuy({ claimExpiresAt: '2026-08-25T10:12:00.000Z' }, now);
  assert.equal(mins.phrase, '12 minutes');
  assert.equal(mins.clock, '12m');
});

t('says nothing at all when the task carries no deadline', () => {
  // A CLAIMED task always has one, but a task read from an older cache may not,
  // and "your product is yours for the next undefined" is unshippable.
  assert.equal(remainingToBuy({ claimExpiresAt: null }, new Date()), null);
  assert.equal(remainingToBuy({}, new Date()), null);
  assert.equal(remainingToBuy(null, new Date()), null);
});

t('says nothing once the deadline has passed rather than counting backwards', () => {
  const now = new Date('2026-08-25T10:00:00.000Z');
  assert.equal(remainingToBuy({ claimExpiresAt: '2026-08-24T10:00:00.000Z' }, now), null);
  assert.equal(remainingToBuy({ claimExpiresAt: '2026-08-25T10:00:00.000Z' }, now), null);
});

t('singular at exactly one of each unit', () => {
  const now = new Date('2026-08-25T10:00:00.000Z');
  assert.equal(
    remainingToBuy({ claimExpiresAt: '2026-08-26T10:00:00.000Z' }, now).phrase,
    '1 day',
  );
  assert.equal(
    remainingToBuy({ claimExpiresAt: '2026-08-25T11:00:00.000Z' }, now).phrase,
    '1 hour',
  );
  assert.equal(
    remainingToBuy({ claimExpiresAt: '2026-08-25T10:01:00.000Z' }, now).phrase,
    '1 minute',
  );
});

t('ignores an unparseable date instead of rendering NaN', () => {
  assert.equal(remainingToBuy({ claimExpiresAt: 'soon' }, new Date()), null);
});


console.log('no phantom deadline in the screens');
{
  const src = ['../ConfirmJoinScreen.js', '../ClaimOutcomeScreens.js']
    .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));

  t('neither screen hardcodes a deadline the backend never stated', () => {
    // The design's three phantom numbers: "48 hours" on the confirmation screen,
    // "2 hours" on the claimed sheet, and a countdown seeded at 25*60+35. All
    // three are prototype fiction; the real window is the operator's setting.
    // A guard rather than a comment, because this is the exact thing a later edit
    // would paste back in from the design file.
    for (const code of src) {
      const prose = code.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.doesNotMatch(prose, /48\s*hours/i);
      assert.doesNotMatch(prose, /\b2\s*hours\b/i);
      assert.doesNotMatch(prose, /25\s*\*\s*60/);
    }
  });

  t('the claim screen states no variant, because campaigns have none', () => {
    // The design shows "exact variant: {c.variant}" here and a "Variant / size"
    // row on the redirect screen. Campaigns carry no variant field at all, and
    // filling it with the product name would tell the user a size was checked.
    const prose = src[0].replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(prose, /variant/i);
  });
}

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
