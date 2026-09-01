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
  countdown,
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


console.log('countdown');
// A LIVE COUNTDOWN NOW, because the window is thirty minutes. The old function
// spoke in days and hours and refreshed when the screen came back into view, which
// was right for a seven day window and useless for this one. The owner asked for a
// countdown of the thirty minutes, and for the screen to SAY SO when it runs out
// rather than sit at zero.
t('counts in minutes and seconds, in the shape the design draws', () => {
  const c = countdown(
    { claimExpiresAt: '2026-08-25T10:30:00.000Z' },
    new Date('2026-08-25T10:00:00.000Z'),
  );
  assert.equal(c.over, false);
  assert.equal(c.clock, '30m : 00s');
  assert.equal(c.ticking, true, 'a per-second clock has to redraw every second');
});

t('the seconds are padded, so the clock does not jump about', () => {
  const now = new Date('2026-08-25T10:00:00.000Z');
  assert.equal(
    countdown({ claimExpiresAt: '2026-08-25T10:09:05.000Z' }, now).clock,
    '9m : 05s',
  );
});

t('never shows more time than there is, and never shows zero while it is alive', () => {
  const now = new Date('2026-08-25T10:00:00.000Z');
  // Half a second left. Rounding down would print "0m : 00s" on a live claim,
  // which reads as a stuck clock; rounding up prints one second and then ends.
  const c = countdown({ claimExpiresAt: '2026-08-25T10:00:00.500Z' }, now);
  assert.equal(c.over, false);
  assert.equal(c.clock, '0m : 01s');
});

t('says the time is up, rather than saying nothing', () => {
  // THE DIFFERENCE THAT MATTERS. The old function answered null both for "this
  // task has no deadline" and for "the deadline has passed", so the screen could
  // not tell the two apart and drew nothing either way. A person whose thirty
  // minutes ran out was shown a sheet with no timer and no explanation.
  const now = new Date('2026-08-25T10:00:00.000Z');
  for (const iso of ['2026-08-25T09:59:59.000Z', '2026-08-25T10:00:00.000Z']) {
    const c = countdown({ claimExpiresAt: iso }, now);
    assert.equal(c.over, true, `${iso} did not read as over`);
    assert.equal(c.clock, null, 'an expired claim has no clock to show');
    assert.equal(c.ticking, false, 'an expired claim must not keep redrawing');
  }
});

t('says nothing at all when the task carries no deadline', () => {
  // A CLAIMED task always has one, but a task read from an older cache may not,
  // and "your product is yours for the next undefined" is unshippable. This is
  // null, which is different from over: null means say nothing.
  assert.equal(countdown({ claimExpiresAt: null }, new Date()), null);
  assert.equal(countdown({}, new Date()), null);
  assert.equal(countdown(null, new Date()), null);
});

t('ignores an unparseable date instead of rendering NaN', () => {
  assert.equal(countdown({ claimExpiresAt: 'soon' }, new Date()), null);
});

t('a longer window an operator sets reads in hours, and stops ticking', () => {
  // The setting goes up to ninety days. "4320m : 00s" is not a clock, and a
  // per-second redraw of a three day countdown is battery for nothing.
  const now = new Date('2026-08-25T10:00:00.000Z');
  const long = countdown({ claimExpiresAt: '2026-08-25T15:30:00.000Z' }, now);
  assert.equal(long.clock, '5h 30m');
  assert.equal(long.ticking, false);
  const days = countdown({ claimExpiresAt: '2026-08-28T10:00:00.000Z' }, now);
  assert.equal(days.clock, '3d 0h');
  assert.equal(days.ticking, false);
});

t('names the instant it ends, in the design’s own format', () => {
  const c = countdown(
    { claimExpiresAt: '2026-09-01T15:05:00.000Z' },
    new Date('2026-09-01T14:35:00.000Z'),
  );
  assert.match(c.when, /^\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (AM|PM)$/);
});

t('an expired claim still names the instant it ended', () => {
  // So the sheet can say WHEN it ran out rather than only that it did.
  const c = countdown(
    { claimExpiresAt: '2026-09-01T10:00:00.000Z' },
    new Date('2026-09-01T11:00:00.000Z'),
  );
  assert.equal(c.over, true);
  assert.match(c.when, /^\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (AM|PM)$/);
});

t('the old days-and-hours function is gone, not left beside this one', () => {
  // Two functions answering "how long is left" is the defect class this project
  // keeps finding. There is one.
  const src = readFileSync(new URL('./confirmJoin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /export function remainingToBuy/);
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
  const r = countdown(
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

console.log('the claimed sheet draws the slot, and says when it is gone');
{
  const sheet = readFileSync(new URL('../ClaimOutcomeScreens.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const flat = sheet.replace(/\s+/g, ' ');

  t('it says "Slot Reserved!", which is what has actually happened', () => {
    assert.ok(/Slot Reserved!/.test(flat), 'the sheet does not say Slot Reserved');
    // And not the design's own heading, which describes the wrong thing: nothing
    // has been bought, a slot has been held for thirty minutes.
    assert.ok(!/Product Claimed!/.test(flat), 'the sheet still says Product Claimed');
  });

  t('the clock really redraws while it is ticking', () => {
    // The old sheet refreshed only when it came back into view, which was right
    // for a seven day window and useless for thirty minutes.
    assert.ok(/setInterval/.test(sheet), 'the sheet has no per-second timer');
    assert.ok(/clearInterval/.test(sheet), 'the timer is never stopped');
  });

  t('and it stops redrawing when there is nothing left to redraw', () => {
    // Guarded on the countdown's own answer, so an expired claim and a long window
    // an operator has set both stop the timer instead of spinning for nothing.
    assert.ok(
      /if \(!ticking\) return undefined;/.test(flat),
      'the timer runs regardless of whether anything is changing',
    );
  });

  t('it reads the record each tick rather than counting a number down', () => {
    // A clock holding its own number drifts away from the real deadline while the
    // phone sleeps. Every tick asks the record again.
    //
    // assert.ok rather than assert.match here and below: a failed match prints the
    // whole file, and these read a screen file of several hundred lines.
    const tick = (flat.match(/setInterval\([\s\S]{0,160}?\}, 1000\)/) || [''])[0];
    assert.ok(
      /countdown\(getAuthoritative\(campaignId\)\)/.test(tick),
      'the tick does not re-read the authoritative record',
    );
  });

  t('when the time is up it says so, and does not sit at zero', () => {
    assert.ok(/Your time ran out/.test(flat), 'the sheet never says the time ran out');
    // And the buy button is gone in that state: sending somebody to the shop for a
    // purchase the order-window rule will refuse is worse than saying nothing.
    assert.ok(/See the offer again/.test(flat), 'there is no way back');
    assert.ok(/over \?/.test(flat), 'the sheet does not change with the ran-out state');
  });

  t('the button says Continue, and does not open a shop', () => {
    // It used to open the marketplace's own web view, so the very next thing after
    // claiming was a shop, with nothing in between saying what to buy. The owner
    // asked for "Continue", into the journey that owns all of that.
    assert.ok(/Continue →/.test(flat), 'the button does not say Continue');
    assert.ok(!/Go to \$\{mktName\} →/.test(flat), 'the button still names a shop');
    assert.ok(
      !/navigation\.replace\(campaign\.marketplace/.test(flat),
      'the sheet still opens the marketplace web view directly',
    );
    assert.ok(
      /navigation\.replace\('Journey', \{ campaignId \}\)/.test(flat),
      'the button does not open the claim journey',
    );
  });

  t('the tickets are described honestly in both states', () => {
    // Held while it is live; on their way back once it has lapsed. The sweep
    // really does return them, so this is a promise the backend keeps.
    assert.ok(
      /tickets held · returned if the claim expires/.test(flat),
      'the sheet does not say the tickets are held',
    );
    assert.ok(
      /tickets are on their way back/.test(flat),
      'the sheet does not say the tickets are coming back once it lapses',
    );
  });
}

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
