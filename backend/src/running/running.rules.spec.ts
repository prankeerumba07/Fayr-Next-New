/**
 * THE RULES BEHIND THE PAGE THAT MEASURES FAYR ITSELF.
 *
 * No database. Every check here is a pure function against facts written out by
 * hand, so a rule can be checked at its edges rather than against whatever
 * happens to be in the practice database today.
 *
 * The three things this file exists to stop, all of which would look fine on
 * screen:
 *   a nought printed where nothing is being watched,
 *   a source name silently counted as automatic because nobody grouped it,
 *   a hold reason quietly dropped off the list.
 */

import type { TaskState } from '@prisma/client';
import { explainHoldForStaff } from '../tasks/engine/hold-reasons';
import {
  ALL_SOURCE_GROUP_KEYS,
  CANNOT_TELL_DROP,
  DO_NOT_ADD_UP,
  HELD_REASONS,
  NOBODY_CAN_CLEAR,
  addsUpWords,
  counted,
  countedMoney,
  countOrderSources,
  dayWords,
  daysAgo,
  disagreementWords,
  dropBetween,
  factsOf,
  groupOfSource,
  notAStep,
  holdOf,
  noMoneyYet,
  nothingYet,
  OPEN_STATES,
  notWatching,
  readAtWords,
  sameFunnel,
  tallyHeld,
  type JourneyRow,
} from './running.rules';
import { DO_NOT_KNOW, ORDER_SOURCE_GROUPS } from './running.words';

const NOW = new Date('2026-09-03T06:40:00.000Z');

function row(over: Partial<JourneyRow> = {}): JourneyRow {
  return {
    state: 'CLAIMED' as TaskState,
    closeReason: null,
    orderId: null,
    deliveredAt: null,
    reviewPublished: null,
    windowEndsAt: null,
    orderConfirmed: false,
    markReviewedEvents: 0,
    ...over,
  };
}

describe('the three answers', () => {
  it('a counted nought is a real nought, not nothing and not unwatched', () => {
    expect(counted(0)).toEqual({ kind: 'counted', count: 0 });
    expect(nothingYet()).toEqual({ kind: 'nothing-yet' });
    expect(notWatching('do this')).toEqual({
      kind: 'not-watching',
      whatItWouldTake: 'do this',
    });
  });

  it('the three are never the same shape, so a screen cannot confuse them', () => {
    const kinds = new Set(
      [counted(0), nothingYet(), notWatching('x')].map((r) => r.kind),
    );
    expect(kinds.size).toBe(3);
  });

  it('an unwatched reading always says what it would take', () => {
    const reading = notWatching('somebody has to open each offer on a phone');
    expect(reading.kind).toBe('not-watching');
    if (reading.kind !== 'not-watching') throw new Error('wrong shape');
    expect(reading.whatItWouldTake.length).toBeGreaterThan(10);
  });

  it('money is carried as whole paise in a string, never a Number', () => {
    // 90,00,00,00,00,000 paise is past what a Number holds exactly. A formatter
    // that routes money through a Number starts lying quietly above 2^53.
    const huge = 9_000_000_000_000_000n;
    expect(countedMoney(huge)).toEqual({
      kind: 'counted',
      paise: '9000000000000000',
    });
    expect(noMoneyYet()).toEqual({ kind: 'nothing-yet' });
  });
});

describe('the drop between two steps', () => {
  it('is the plain difference when both steps are counted', () => {
    expect(dropBetween(counted(10), counted(7))).toEqual({
      kind: 'dropped',
      count: 3,
    });
  });

  it('is nought when nobody dropped out, and still says so', () => {
    expect(dropBetween(counted(4), counted(4))).toEqual({
      kind: 'dropped',
      count: 0,
    });
  });

  it('CANNOT be told when the step above is not watched', () => {
    // The point of the whole file. "Went to the shop" is not recorded, so the
    // drop into "signed in at the shop" is not nought, it is unknowable.
    const above = notWatching('the phone would have to tell our side');
    expect(dropBetween(above, counted(9))).toEqual({
      kind: 'cannot-tell',
      why: CANNOT_TELL_DROP,
    });
    expect(dropBetween(counted(9), above)).toEqual({
      kind: 'cannot-tell',
      why: CANNOT_TELL_DROP,
    });
  });

  it('says two columns do not line up rather than showing a negative drop', () => {
    expect(dropBetween(counted(6), counted(7))).toEqual({
      kind: 'does-not-line-up',
      by: 1,
      why: 'This counts 1 more place than the step above it.',
    });
    expect(dropBetween(counted(2), counted(6))).toEqual({
      kind: 'does-not-line-up',
      by: 4,
      why: 'This counts 4 more places than the step above it.',
    });
  });

  it('carries its own sentence in every shape but the plain one', () => {
    // The screen prints what it is given rather than writing a sentence of its
    // own, so every shape that needs words has to bring them.
    const above = notWatching('the phone would have to tell our side');
    for (const drop of [
      dropBetween(above, counted(9)),
      dropBetween(counted(6), counted(7)),
      notAStep('not everybody is asked this'),
    ]) {
      expect(drop.kind).not.toBe('dropped');
      if (drop.kind === 'dropped') throw new Error('wrong shape');
      expect(drop.why.length).toBeGreaterThan(10);
    }
  });

  it('never clamps a disagreement to nought', () => {
    const drop = dropBetween(counted(2), counted(5));
    expect(drop.kind).not.toBe('dropped');
  });
});

describe('the journey facts', () => {
  it('counts each step off the column that records it happening', () => {
    const rows = [
      row(),
      row({ orderConfirmed: true, orderId: 'A1' }),
      row({ orderId: 'A2', deliveredAt: new Date('2026-08-20T00:00:00Z') }),
      row({
        orderId: 'A3',
        deliveredAt: new Date('2026-08-21T00:00:00Z'),
        reviewPublished: true,
        markReviewedEvents: 1,
        windowEndsAt: new Date('2026-08-28T00:00:00Z'),
      }),
      row({
        orderId: 'A4',
        reviewPublished: true,
        windowEndsAt: new Date('2026-12-01T00:00:00Z'),
      }),
    ];
    expect(factsOf(rows, NOW)).toEqual({
      tookAPlace: 5,
      gaveUsTheirOrder: 1,
      orderEstablished: 4,
      productArrived: 2,
      reviewFoundLive: 2,
      reviewStepReached: 1,
      // One window has passed; the December one has not.
      returnTimeFinished: 1,
    });
  });

  it('reads a review that has not been marked as unknown, never as false', () => {
    // reviewPublished is three-way on purpose: nothing established it, it is
    // there, it is gone. Only a real true counts as found.
    const rows = [row({ reviewPublished: null }), row({ reviewPublished: false })];
    expect(factsOf(rows, NOW).reviewFoundLive).toBe(0);
  });

  it('counts nothing out of nothing without falling over', () => {
    expect(factsOf([], NOW).tookAPlace).toBe(0);
  });
});

describe('two columns disagreeing', () => {
  it('says nothing at all when they agree', () => {
    expect(disagreementWords(7, 7, 'The other count')).toBeNull();
  });

  it('names the other count and says by how much, in either direction', () => {
    const fewer = disagreementWords(7, 6, 'The other count');
    expect(fewer).toContain('The other count counts 1 fewer place than this');
    const more = disagreementWords(6, 9, 'The other count');
    expect(more).toContain('The other count counts 3 more places than this');
  });

  it('never averages the two and never takes the bigger', () => {
    const words = disagreementWords(7, 6, 'The other count') ?? '';
    expect(words).not.toContain('6.5');
    expect(words).toContain('this row shows the first of them');
  });
});

describe('whether the page agrees with the report', () => {
  const funnel = {
    claimed: 11, purchased: 7, delivered: 7,
    reviewed: 4, holding: 4, refunded: 1, expired: 2,
  };

  it('says yes when every one of the seven matches', () => {
    expect(sameFunnel(funnel, { ...funnel })).toBe(true);
  });

  it('SAYS NO on any one of the seven, and the false answer is the point', () => {
    // Hard-wiring this to true used to pass every check, because nothing
    // anywhere exercised the disagreeing answer. Each of the seven is tried.
    for (const key of Object.keys(funnel)) {
      expect(sameFunnel(funnel, { ...funnel, [key]: funnel[key as keyof typeof funnel] + 1 }))
        .toBe(false);
    }
  });

  it('says no when a number is missing altogether', () => {
    const { refunded, ...missing } = funnel;
    void refunded;
    expect(sameFunnel(funnel, missing)).toBe(false);
  });
});

describe('how each order was established', () => {
  it('groups every name the code can really produce', () => {
    expect(groupOfSource('order-details')).toBe('automatic');
    expect(groupOfSource('order-history')).toBe('automatic');
    expect(groupOfSource('dkim')).toBe('automatic');
    expect(groupOfSource('ocr')).toBe('picture');
    expect(groupOfSource('invoice')).toBe('picture');
    expect(groupOfSource('manual')).toBe('byHand');
  });

  it('groups nothing, an empty name and only spaces as not known', () => {
    expect(groupOfSource(null)).toBeNull();
    expect(groupOfSource(undefined)).toBeNull();
    expect(groupOfSource('')).toBeNull();
    expect(groupOfSource('   ')).toBeNull();
  });

  it('AN UNGROUPED NAME LANDS IN WE DO NOT KNOW, BY NAME', () => {
    // The safety net. A source added next month must not be counted as
    // automatic just because automatic happens to be first in the list.
    const tally = countOrderSources(
      ['order-details', 'order-details', 'shiny-new-reader'],
      3,
    );
    expect(tally.groups).toEqual([
      { key: 'automatic', count: 2 },
      { key: 'picture', count: 0 },
      { key: 'byHand', count: 0 },
    ]);
    expect(tally.doNotKnow).toBe(1);
    expect(tally.unmappedNames).toEqual(['shiny-new-reader']);
  });

  it('never counts an ungrouped name as automatic', () => {
    const tally = countOrderSources(['shiny-new-reader'], 1);
    const automatic = tally.groups.find((g) => g.key === 'automatic');
    expect(automatic?.count).toBe(0);
  });

  it('lists each ungrouped name once, in order, however often it appears', () => {
    const tally = countOrderSources(['zeta', 'alpha', 'zeta', 'alpha'], 4);
    expect(tally.unmappedNames).toEqual(['alpha', 'zeta']);
    expect(tally.doNotKnow).toBe(4);
  });

  it('adds up to the number of orders established, and says so', () => {
    const tally = countOrderSources(
      ['order-details', 'ocr', 'manual', null, 'mystery'],
      5,
    );
    const total =
      tally.groups.reduce((n, g) => n + g.count, 0) + tally.doNotKnow;
    expect(total).toBe(5);
    expect(tally.established).toBe(5);
    expect(tally.addsUp).toBe(true);
    expect(addsUpWords(tally)).toBeNull();
  });

  it('CALLS A FAILURE TO ADD UP A FAULT, from the real arithmetic', () => {
    // Section A says six orders are established; this tally was handed five
    // sources. One of the two is reading the wrong rows, and the page must SAY
    // so rather than quietly showing parts that do not come to the whole.
    //
    // This used to be built by hand with addsUp: false, which proved nothing: a
    // mutation that hard-wired addsUp to true passed every check.
    const wrong = countOrderSources(
      ['order-details', 'order-details', 'ocr', 'manual', null],
      6,
    );
    expect(wrong.addsUp).toBe(false);
    expect(addsUpWords(wrong)).toBe(DO_NOT_ADD_UP);
    expect(wrong.established).toBe(6);

    // And the other way: more sources than Section A found is a fault too.
    const alsoWrong = countOrderSources(['order-details'], 0);
    expect(alsoWrong.addsUp).toBe(false);
  });

  it('shows the we-do-not-know row as a group in its own right', () => {
    expect(ALL_SOURCE_GROUP_KEYS).toEqual([
      'automatic',
      'picture',
      'byHand',
      DO_NOT_KNOW.key,
    ]);
    expect(ALL_SOURCE_GROUP_KEYS).toHaveLength(ORDER_SOURCE_GROUPS.length + 1);
  });

  it('has no name in two groups at once', () => {
    const all = ORDER_SOURCE_GROUPS.flatMap((g) => [...g.names]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('money held, and why', () => {
  it('lists ALL SIX reasons every time, with nought against the empty ones', () => {
    const tally = tallyHeld(['amount-unknown', 'amount-unknown']);
    expect(tally.rows).toHaveLength(6);
    expect(tally.rows.map((r) => r.reason)).toEqual([...HELD_REASONS]);
    expect(tally.rows[0]).toEqual({
      reason: 'amount-unknown',
      explanation: explainHoldForStaff('amount-unknown'),
      count: 2,
      nobodyCanClearIt: false,
    });
    expect(tally.rows.filter((r) => r.count === 0)).toHaveLength(5);
    expect(tally.total).toBe(2);
  });

  it('shows six reasons even when nothing at all is held', () => {
    const tally = tallyHeld([]);
    expect(tally.rows).toHaveLength(6);
    expect(tally.total).toBe(0);
  });

  it('takes its words from hold-reasons.ts and writes none of its own', () => {
    for (const held of tallyHeld([]).rows) {
      expect(held.explanation).toBe(explainHoldForStaff(held.reason));
      expect(held.explanation.length).toBeGreaterThan(20);
    }
  });

  it('marks the two reasons nobody has a control for', () => {
    const tally = tallyHeld([]);
    const marked = tally.rows.filter((r) => r.nobodyCanClearIt).map((r) => r.reason);
    expect(marked.sort()).toEqual([...NOBODY_CAN_CLEAR].sort());
    expect(marked).toHaveLength(2);
  });

  it('keeps a reason nobody expected instead of dropping it', () => {
    const tally = tallyHeld(['something-new']);
    const extra = tally.rows.find((r) => r.reason === 'something-new');
    expect(extra?.count).toBe(1);
    // The fallback words already say the reason was not recognised, which is
    // itself worth somebody looking at.
    expect(extra?.explanation).toBe(explainHoldForStaff('something-new'));
    expect(tally.total).toBe(1);
  });
});

describe('which places can have a refund held at all', () => {
  it('is exactly the four states where the money is still in question', () => {
    expect([...OPEN_STATES]).toEqual([
      'PURCHASED',
      'DELIVERED',
      'REVIEWED',
      'HOLDING',
    ]);
  });

  it('LEAVES OUT a refund already paid, and a place nobody has bought on', () => {
    // Pinned as a list because no fixture can catch it: a refunded place always
    // has a readable amount, or it could not have been paid, so adding REFUNDED
    // here changes no number and every check still passes.
    expect(OPEN_STATES).not.toContain('REFUNDED');
    expect(OPEN_STATES).not.toContain('CLAIMED');
  });
});

describe('whether one refund is held', () => {
  it('holds a refund with no readable price', () => {
    expect(holdOf({ id: 'A', source: 'order-details' })).toBe('amount-unknown');
  });

  it('holds a refund whose unit count nobody stated', () => {
    expect(
      holdOf({
        id: 'A',
        source: 'order-details',
        lineTotalPaise: 119800n,
        orderTotalPaise: 145700n,
      }),
    ).toBe('quantity-unknown');
  });

  it('does not hold a refund with a stated price for one unit', () => {
    expect(
      holdOf({ id: 'A', source: 'order-details', unitPricePaise: 21990n }),
    ).toBeNull();
  });

  it('holds nothing when there is no order at all', () => {
    // A place with no order is not a held refund. It has not got that far.
    expect(holdOf(null)).toBeNull();
    expect(holdOf(undefined)).toBeNull();
  });
});

describe('when the page was read', () => {
  it('says the time in India, in words, morning afternoon and evening', () => {
    // 03:44 in the world is 09:14 in India.
    expect(readAtWords(new Date('2026-09-03T03:44:00Z'))).toBe(
      'Read at 9:14 in the morning on 3 September.',
    );
    expect(readAtWords(new Date('2026-09-03T08:30:00Z'))).toBe(
      'Read at 2:00 in the afternoon on 3 September.',
    );
    expect(readAtWords(new Date('2026-09-03T14:05:00Z'))).toBe(
      'Read at 7:35 in the evening on 3 September.',
    );
  });

  it('says twelve rather than nought at noon and at midnight', () => {
    expect(readAtWords(new Date('2026-09-03T06:30:00Z'))).toContain('12:00 in the afternoon');
    expect(readAtWords(new Date('2026-09-02T18:30:00Z'))).toContain('12:00 in the morning');
  });

  it('uses the day in India, not the day where our side happens to be', () => {
    // Late on 2 September in the world is already 3 September in India.
    expect(dayWords(new Date('2026-09-02T20:00:00Z'))).toBe('3 September');
  });

  it('counts whole days by the calendar in India, never by dividing', () => {
    const then = new Date('2026-08-26T18:23:09Z'); // 3 September in India
    expect(daysAgo(then, new Date('2026-09-03T06:40:00Z'))).toBe(8);
    // Nineteen hours apart, and two different days to the person reading:
    // half past seven on the 1st in India, then half past two on the 2nd.
    expect(
      daysAgo(new Date('2026-09-01T14:00:00Z'), new Date('2026-09-02T09:00:00Z')),
    ).toBe(1);
    // And the other way round: nineteen hours apart inside ONE India day is
    // nought days ago, which is why this cannot be a division.
    expect(
      daysAgo(new Date('2026-09-01T20:00:00Z'), new Date('2026-09-02T15:00:00Z')),
    ).toBe(0);
  });

  it('never returns a day count below nought', () => {
    expect(
      daysAgo(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-03T00:00:00Z')),
    ).toBe(0);
  });
});
