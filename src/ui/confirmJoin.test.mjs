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
// THE WINDOW IS MINUTES NOW, NOT DAYS. The owner asked on 1 September 2026 for a
// thirty minute slot: the purchase has to be made inside it. The old setting was
// whole days and could not say thirty minutes at all — its smallest value was one
// day. The server sends minutes, and this turns whatever it sent into the plain
// sentence the design's card carries.
t('thirty minutes, which is the window the owner asked for', () => {
  const d = claimDeadline({ windowMinutes: 30, now: NOW });
  assert.equal(d.minutes, 30);
  assert.equal(d.within, '30 minutes');
  assert.equal(d.line, 'Buy the product within 30 minutes of joining.');
});

t('one of anything is not plural', () => {
  assert.equal(claimDeadline({ windowMinutes: 1, now: NOW }).within, '1 minute');
  assert.equal(claimDeadline({ windowMinutes: 60, now: NOW }).within, '1 hour');
  assert.equal(claimDeadline({ windowMinutes: 1440, now: NOW }).within, '1 day');
});

t('a longer window is still said in the largest plain unit', () => {
  // The setting has a wide range, so an operator may set hours or days. Whatever
  // they set has to read as a sentence a person would say out loud.
  assert.equal(claimDeadline({ windowMinutes: 120, now: NOW }).within, '2 hours');
  assert.equal(claimDeadline({ windowMinutes: 2880, now: NOW }).within, '2 days');
  assert.equal(claimDeadline({ windowMinutes: 10080, now: NOW }).within, '7 days');
});

t('a window that is not a whole number of hours or days says both parts', () => {
  // Never rounded. "1 hour" for ninety minutes would give away half an hour the
  // person does not have, and "90 minutes" is not how anybody says it.
  assert.equal(claimDeadline({ windowMinutes: 90, now: NOW }).within, '1 hour 30 minutes');
  assert.equal(claimDeadline({ windowMinutes: 1500, now: NOW }).within, '1 day 1 hour');
  assert.equal(claimDeadline({ windowMinutes: 2895, now: NOW }).within, '2 days 15 minutes');
});

t('returns NOTHING when the server did not say', () => {
  // The screen then omits the deadline card entirely. A missing number must not
  // become a guessed one: this is the screen where tickets are spent.
  assert.equal(claimDeadline({ windowMinutes: null, now: NOW }), null);
  assert.equal(claimDeadline({ windowMinutes: undefined, now: NOW }), null);
  assert.equal(claimDeadline({ now: NOW }), null);
});

t('refuses a zero or negative window rather than showing "within 0 minutes"', () => {
  assert.equal(claimDeadline({ windowMinutes: 0, now: NOW }), null);
  assert.equal(claimDeadline({ windowMinutes: -3, now: NOW }), null);
});

t('refuses a non-integer window', () => {
  assert.equal(claimDeadline({ windowMinutes: 2.5, now: NOW }), null);
  assert.equal(claimDeadline({ windowMinutes: '30', now: NOW }), null);
  assert.equal(claimDeadline({ windowMinutes: NaN, now: NOW }), null);
});

t('the old days field is gone, so nothing can read the wrong number', () => {
  // Leaving windowDays working alongside windowMinutes would be two settings for
  // one thing, which is exactly what the owner said not to leave behind. A caller
  // still passing days gets nothing rather than a window thirty times too short.
  assert.equal(claimDeadline({ windowDays: 7, now: NOW }), null);
  const d = claimDeadline({ windowMinutes: 30, now: NOW });
  assert.equal(d.days, undefined);
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



console.log('the two screens must not state two different deadlines');
t('the PRE-claim card states a length, never a clock time', () => {
  // The bug: "Buy the product within 7 days of joining — by 1 Sep, 4:00 PM" on
  // the confirmation screen, then "yours until 1 Sep, 3:59 PM" on the very next
  // one. Both were computed from the same 7 days, a few seconds apart, and they
  // disagreed by a minute in front of a room.
  //
  // The real cause is that the exact deadline DOES NOT EXIST until the claim
  // does — the server stamps claimExpiresAt when it creates the task. So the
  // pre-claim card forecasts a length and stops there; the sheet, which has the
  // real instant, is the only screen that names one. Nothing to contradict.
  const d = claimDeadline({ windowMinutes: 30, now: NOW });
  assert.equal(d.line, 'Buy the product within 30 minutes of joining.');
  assert.doesNotMatch(d.line, /\bby\b/);
  assert.doesNotMatch(d.line, /[AP]M/);
  // And it does not even hand a screen an instant it could print by mistake.
  assert.equal(d.when, undefined);
  assert.equal(d.by, undefined);
});

t('the claimed sheet DOES name the instant, from the task', () => {
  const r = remainingToBuy(
    { claimExpiresAt: '2026-09-01T15:05:00.000Z' },
    new Date('2026-08-25T10:00:00.000Z'),
  );
  assert.match(r.when, /^\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (AM|PM)$/);
});

console.log('no phantom deadline in the screens');
{
  // src/ConfirmJoinScreen.js became src/screens/confirm.js on 1 September 2026,
  // when every design screen was given its own file under the design's own key.
  // Same screen, same rules about it.
  const src = ['../screens/confirm.js', '../ClaimOutcomeScreens.js']
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
