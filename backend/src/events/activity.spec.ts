import {
  ACTIVITY_KINDS,
  SETUP_STEPS,
  daysBetween,
  fromChatHandover,
  fromChatMessage,
  fromLapsedSession,
  fromQuestion,
  fromScreenshot,
  fromShopSignIn,
  fromTaskEvent,
  fromUserEvent,
  fromWithdrawalDecision,
  fromWithdrawalRequest,
  sortAndTrim,
  whereSetupStopped,
  type ActivityRow,
} from './activity';

const AT = new Date('2026-09-17T10:00:00.000Z');

/** A row at a given instant, for the ordering tests. */
const row = (
  at: string,
  kind: ActivityRow['kind'],
  id: string,
): ActivityRow => ({
  at: new Date(at),
  kind,
  what: `${kind} ${id}`,
  detail: null,
  campaignId: null,
  campaignTitle: null,
  id,
});

describe('sortAndTrim', () => {
  it('puts the newest first', () => {
    const out = sortAndTrim(
      [
        row('2026-09-17T09:00:00.000Z', 'task', 'a'),
        row('2026-09-17T11:00:00.000Z', 'chat', 'b'),
        row('2026-09-17T10:00:00.000Z', 'screen', 'c'),
      ],
      10,
    );
    expect(out.entries.map((e) => e.at)).toEqual([
      '2026-09-17T11:00:00.000Z',
      '2026-09-17T10:00:00.000Z',
      '2026-09-17T09:00:00.000Z',
    ]);
  });

  it('orders two sources in the SAME SECOND the same way every time', () => {
    // The defect this exists for: eight queries run at once and finish in
    // whatever order the database feels like. Two rows written in the same
    // second would otherwise swap places between two reads of the same data,
    // and a trail that reorders itself under a support agent stops being
    // trusted at all.
    const same = '2026-09-17T10:00:00.000Z';
    const rows = [
      row(same, 'task', 'zzz'),
      row(same, 'chat', 'aaa'),
      row(same, 'screen', 'mmm'),
      row(same, 'chat', 'bbb'),
    ];
    const first = sortAndTrim(rows, 10).entries.map((e) => e.what);
    // Every order the eight queries could hand them back in must give one answer.
    for (const shuffled of [
      [rows[3], rows[0], rows[2], rows[1]],
      [rows[2], rows[1], rows[3], rows[0]],
      [...rows].reverse(),
    ]) {
      expect(sortAndTrim(shuffled, 10).entries.map((e) => e.what)).toEqual(first);
    }
    // And the order is the stated one: kind, then the row's own id.
    expect(first).toEqual(['chat aaa', 'chat bbb', 'screen mmm', 'task zzz']);
  });

  it('counts what it left out rather than lying by omission', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row(`2026-09-17T0${i}:00:00.000Z`, 'screen', `id${i}`),
    );
    const out = sortAndTrim(rows, 3);
    expect(out.total).toBe(7);
    expect(out.shown).toBe(3);
    expect(out.trimmed).toBe(4);
    expect(out.entries).toHaveLength(3);
  });

  it('trims the OLDEST, never whichever query answered first', () => {
    const rows = [
      row('2026-09-17T01:00:00.000Z', 'screen', 'old'),
      row('2026-09-17T09:00:00.000Z', 'task', 'new'),
      row('2026-09-17T05:00:00.000Z', 'chat', 'mid'),
    ];
    const out = sortAndTrim(rows, 2);
    expect(out.entries.map((e) => e.what)).toEqual(['task new', 'chat mid']);
    expect(out.trimmed).toBe(1);
  });

  it('says nothing was trimmed when nothing was', () => {
    const out = sortAndTrim([row('2026-09-17T01:00:00.000Z', 'screen', 'a')], 500);
    expect(out.trimmed).toBe(0);
    expect(out.total).toBe(1);
    expect(out.shown).toBe(1);
  });

  it('is an empty timeline, not an error, when there is nothing', () => {
    expect(sortAndTrim([], 500)).toEqual({
      entries: [],
      total: 0,
      shown: 0,
      trimmed: 0,
    });
  });
});

describe('the sentences a support agent reads', () => {
  it('names the screen somebody opened', () => {
    const e = fromUserEvent({
      id: 'x', type: 'SCREEN_VIEWED', at: AT, payload: { screen: 'Wallet' },
    });
    expect(e.what).toBe('Opened Wallet');
    expect(e.kind).toBe('screen');
  });

  it('names the setup step they finished', () => {
    expect(
      fromUserEvent({ id: 'x', type: 'SETUP_STEP_DONE', at: AT, payload: { step: 2 } }).what,
    ).toBe('Finished setup step 2');
  });

  it('says so in words when a step arrives that this file has no wording for', () => {
    // Dropping the row would leave an invisible gap in a trail. A line that
    // reads oddly sends somebody to the file; a missing line sends nobody.
    const e = fromUserEvent({ id: 'x', type: 'SOMETHING_NEW', at: AT, payload: null });
    expect(e.what).toBe('Something Fayr has no words for yet');
  });

  it('names the offer on a task event, not the state machine', () => {
    const e = fromTaskEvent({
      id: 'x', type: 'CLAIM', fromState: 'CLAIMED', toState: 'CLAIMED',
      reason: null, createdAt: AT, offer: 'Keep the Oil Flowing', campaignId: 'c1',
    });
    expect(e.what).toBe('Claimed “Keep the Oil Flowing”');
    expect(e.what).not.toMatch(/CLAIMED|fromState|task_events/);
  });

  it('falls back to plain state words, never the stored names', () => {
    const e = fromTaskEvent({
      id: 'x', type: 'SOMETHING_ELSE', fromState: 'PURCHASED', toState: 'DELIVERED',
      reason: 'the shop said so', createdAt: AT, offer: 'A kettle', campaignId: 'c1',
    });
    expect(e.what).toBe('“A kettle” moved from bought to arrived');
    expect(e.detail).toBe('the shop said so');
  });

  it('writes money the way a person reads it, never paise', () => {
    // Through rupeesOf, the one converter this project has, so the trail and
    // every other sentence in Fayr say an amount the same way. A whole number of
    // rupees shows no paise at all, which is that helper's own rule and not a
    // second format invented here.
    expect(fromWithdrawalRequest({ id: 'x', amountPaise: 25000n, requestedAt: AT }).what)
      .toBe('Asked to withdraw ₹250');
    expect(fromWithdrawalRequest({ id: 'x', amountPaise: 25050n, requestedAt: AT }).what)
      .toBe('Asked to withdraw ₹250.50');
    expect(
      fromWithdrawalDecision({
        id: 'x', amountPaise: 123456789n, status: 'PAID', failureReason: null, decidedAt: AT,
      }).what,
    ).toBe('Their withdrawal of ₹12,34,567.89 was paid');
  });

  it('never puts a bare paise number in a sentence', () => {
    // The failure this guards: a bigint reaching a sentence as 25000, which a
    // person reads as twenty five thousand rupees.
    const sentences = [
      fromWithdrawalRequest({ id: 'x', amountPaise: 25000n, requestedAt: AT }).what,
      fromWithdrawalDecision({
        id: 'x', amountPaise: 25000n, status: 'REJECTED', failureReason: null, decidedAt: AT,
      }).what,
    ];
    for (const said of sentences) {
      expect(said).toContain('₹');
      expect(said).not.toMatch(/\b25000\b/);
      expect(said).not.toMatch(/paise/i);
    }
  });

  it('says a question was asked and how it went, never what was asked', () => {
    const e = fromQuestion({
      id: 'x', askedAt: AT, answerOrigin: 'NONE', topic: 'refund', helpful: false,
    });
    expect(e.what).toBe('Asked the assistant a question');
    expect(e.detail).toBe('about refund, nothing matched it, they said it did not help');
  });

  it('says a picture was sent and nothing about the picture', () => {
    const e = fromScreenshot({
      id: 'x', kind: 'REVIEW', uploadedAt: AT, campaignId: 'c1', campaignTitle: 'A kettle',
    });
    expect(e.what).toBe('Sent a picture of the review');
    expect(e.detail).toBeNull();
    expect(JSON.stringify(e)).not.toMatch(/storageKey|sha256|mimetype|\.jpg|\.png/);
  });

  it('writes a shop by the name a person uses', () => {
    const e = fromShopSignIn({
      id: 'x', platform: 'AMAZON', firstAt: AT, howWeKnew: 'the orders page opened',
    });
    expect(e.what).toBe('Connected Amazon');
    expect(e.what).not.toContain('AMAZON');
  });

  it('every kind it can produce is one of the declared kinds', () => {
    const produced = [
      fromUserEvent({ id: 'a', type: 'APP_OPENED', at: AT, payload: null }),
      fromTaskEvent({ id: 'b', type: 'CLAIM', fromState: 'CLAIMED', toState: 'CLAIMED', reason: null, createdAt: AT, offer: 'x', campaignId: 'c1' }),
      fromQuestion({ id: 'c', askedAt: AT, answerOrigin: 'NONE', topic: null, helpful: null }),
      fromScreenshot({ id: 'd', kind: 'REVIEW', uploadedAt: AT, campaignId: 'c1', campaignTitle: 'x' }),
      fromShopSignIn({ id: 'e', platform: 'AMAZON', firstAt: AT, howWeKnew: 'x' }),
      fromWithdrawalRequest({ id: 'f', amountPaise: 1n, requestedAt: AT }),
    ];
    for (const e of produced) expect(ACTIVITY_KINDS).toContain(e.kind);
  });
});

describe('which offer an entry belongs to', () => {
  // ── WHY EVERY ENTRY CARRIES THIS, AND WHY MOST CARRY NULL ───────────────
  //
  // The page above the trail puts one offer's whole story in one card. It can
  // only do that if each entry says which offer it belongs to, and it can only
  // be trusted to do it if "none" is a real answer rather than a guess.

  it('puts the offer on a task event, id and title together', () => {
    const e = fromTaskEvent({
      id: 'x', type: 'CLAIM', fromState: 'CLAIMED', toState: 'CLAIMED',
      reason: null, createdAt: AT, offer: 'Keep the Oil Flowing', campaignId: 'c1',
    });
    expect(e.campaignId).toBe('c1');
    // The title beside the id, so a screen can label a group without a second
    // read and without picking the name back out of the sentence.
    expect(e.campaignTitle).toBe('Keep the Oil Flowing');
  });

  it('puts the offer on a screenshot, because evidence is sent FOR one', () => {
    const e = fromScreenshot({
      id: 'x', kind: 'PURCHASE', uploadedAt: AT,
      campaignId: 'c2', campaignTitle: 'A kettle',
    });
    expect(e.kind).toBe('evidence');
    expect(e.campaignId).toBe('c2');
    expect(e.campaignTitle).toBe('A kettle');
  });

  it('leaves it null on everything that belongs to the person and not an offer', () => {
    // A guess here would be worse than nothing: an entry filed under an offer it
    // has nothing to do with reads as evidence about that offer.
    const elsewhere = [
      fromUserEvent({ id: 'a', type: 'SCREEN_VIEWED', at: AT, payload: { screen: 'Wallet' } }),
      fromUserEvent({ id: 'a2', type: 'FEED_OPENED', at: AT, payload: { platform: 'AMAZON', size: 4 } }),
      fromChatMessage({ id: 'b', author: 'PERSON', language: 'en', sentAt: AT }),
      fromChatHandover({ id: 'b2', handedOverAt: AT }),
      fromQuestion({ id: 'c', askedAt: AT, answerOrigin: 'NONE', topic: 'refund', helpful: null }),
      fromWithdrawalRequest({ id: 'd', amountPaise: 25000n, requestedAt: AT }),
      fromWithdrawalDecision({
        id: 'e', amountPaise: 25000n, status: 'PAID', failureReason: null, decidedAt: AT,
      }),
      fromShopSignIn({ id: 'f', platform: 'AMAZON', firstAt: AT, howWeKnew: 'x' }),
      fromLapsedSession({ id: 'g', expiresAt: AT }),
    ];
    for (const e of elsewhere) {
      expect(e.campaignId).toBeNull();
      expect(e.campaignTitle).toBeNull();
    }
    // And the two that DO carry one are not in that list, so this is a real
    // split rather than a file where nothing ever carries an offer.
    expect(elsewhere).toHaveLength(9);
  });

  it('carries both fields out through sortAndTrim onto the wire', () => {
    // The shaper is where a field quietly gets dropped, and a dropped campaignId
    // does not throw — it just makes every entry land in "everything else".
    const out = sortAndTrim(
      [
        {
          at: AT, kind: 'task', what: 'Claimed', detail: null,
          campaignId: 'c1', campaignTitle: 'A kettle', id: 'r1',
        },
        {
          at: AT, kind: 'screen', what: 'Opened Wallet', detail: null,
          campaignId: null, campaignTitle: null, id: 'r2',
        },
      ],
      10,
    );
    const task = out.entries.find((e) => e.kind === 'task');
    expect(task?.campaignId).toBe('c1');
    expect(task?.campaignTitle).toBe('A kettle');
    const screen = out.entries.find((e) => e.kind === 'screen');
    expect(screen?.campaignId).toBeNull();
    expect(screen?.campaignTitle).toBeNull();
  });
});

describe('whereSetupStopped', () => {
  it('is null once setup is finished, whatever the steps say', () => {
    expect(whereSetupStopped([], true)).toBeNull();
    expect(whereSetupStopped([1], true)).toBeNull();
  });

  it('is the FIRST gap, not the highest step plus one', () => {
    // Those differ when somebody skipped a step and came back, and the first gap
    // is the one worth asking about.
    expect(whereSetupStopped([1, 3], false)).toBe(2);
    expect(whereSetupStopped([2, 3], false)).toBe(1);
  });

  it('is step one when they did none of it', () => {
    expect(whereSetupStopped([], false)).toBe(1);
  });

  it('is the next one along when they stopped partway', () => {
    expect(whereSetupStopped([1], false)).toBe(2);
    expect(whereSetupStopped([1, 2], false)).toBe(3);
  });

  it('is null when every step is done but the finish was never written', () => {
    // A real state, and guessing a number for it would be inventing a fact.
    const all = Array.from({ length: SETUP_STEPS }, (_, i) => i + 1);
    expect(whereSetupStopped(all, false)).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween(new Date('2026-09-10T10:00:00Z'), new Date('2026-09-17T10:00:00Z'))).toBe(7);
    expect(daysBetween(new Date('2026-09-17T09:00:00Z'), new Date('2026-09-17T10:00:00Z'))).toBe(0);
  });

  it('is never negative, so a clock skew cannot produce -3 days quiet', () => {
    expect(daysBetween(new Date('2026-09-20T10:00:00Z'), new Date('2026-09-17T10:00:00Z'))).toBe(0);
  });
});
