import {
  RECENT_STEP_LIMIT,
  buildJourney,
  plainStateName,
  type JourneyFacts,
} from './journey';

const T = (minutesAgo: number): Date =>
  new Date(Date.UTC(2026, 7, 27, 12, 0, 0) - minutesAgo * 60_000);

const NOW = T(0);

const emptyFacts = (): JourneyFacts => ({
  takenAt: NOW,
  account: { joinedAt: T(60 * 24 * 30), setupDoneAt: null },
  tickets: { balance: 15, entries: [] },
  wallet: { balancePaise: 0n, entries: [] },
  tasks: [],
  withdrawals: [],
  proofs: [],
  questionsWrittenBefore: 0,
});

const task = (over: Partial<JourneyFacts['tasks'][number]> = {}) => ({
  id: 't1',
  offer: 'Prestige induction cooktop',
  platform: 'AMAZON',
  state: 'HOLDING',
  closedAt: null,
  closeReason: null,
  blocker: null,
  blockerReason: null,
  claimExpiresAt: null,
  windowEndsAt: T(-60 * 24 * 3),
  events: [],
  ...over,
});

/**
 * WHAT WAS THIS PERSON DOING WHEN THEY WROTE IN?
 *
 * Nothing here is new tracking. Every step comes from a record the app already
 * keeps — the task log, the ticket ledger, the wallet, the payout requests, the
 * pictures somebody sent in. This file turns those records into sentences, and it
 * is pure so the sentences can be read in a test rather than in a database.
 *
 * The whole point is the sentence a person answering can read in two seconds:
 * "waiting out the return window on the cooktop, and it ends on Sunday". Not a
 * state name, not a code.
 */
describe('buildJourney', () => {
  describe('what they are in the middle of', () => {
    it('says nothing is in progress when nothing is', () => {
      const j = buildJourney(emptyFacts());
      expect(j.nowDoing).toEqual(['Nothing is in progress right now.']);
    });

    it('describes a claim that has not been bought yet', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [task({ state: 'CLAIMED', claimExpiresAt: T(-60 * 24 * 2) })],
      });
      expect(j.nowDoing[0]).toContain('Prestige induction cooktop');
      expect(j.nowDoing[0]).toMatch(/has not bought it yet/i);
    });

    it('describes each stage in words, never a state name', () => {
      for (const state of [
        'CLAIMED',
        'PURCHASED',
        'DELIVERED',
        'REVIEWED',
        'HOLDING',
      ]) {
        const j = buildJourney({
          ...emptyFacts(),
          tasks: [task({ state })],
        });
        expect(j.nowDoing).toHaveLength(1);
        expect(j.nowDoing[0]).not.toContain(state);
        expect(j.nowDoing[0].length).toBeGreaterThan(10);
      }
    });

    it('says when the return-window wait ends', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [task({ state: 'HOLDING', windowEndsAt: T(-60 * 24 * 3) })],
      });
      expect(j.nowDoing[0]).toMatch(/return window/i);
      expect(j.nowDoing[0]).toMatch(/30 August 2026/);
    });

    it('says out loud when something is in the way', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [
          task({
            state: 'DELIVERED',
            blocker: 'order_unreadable',
            blockerReason: 'We could not read your order page.',
          }),
        ],
      });
      expect(j.nowDoing.join(' ')).toContain(
        'We could not read your order page.',
      );
    });

    it('falls back to the short reason when there is no sentence', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [task({ state: 'DELIVERED', blocker: 'order_unreadable' })],
      });
      // Even the fallback must read as words, not as a code with underscores.
      const text = j.nowDoing.join(' ');
      expect(text).not.toContain('order_unreadable');
      expect(text).toContain('order unreadable');
    });

    it('ignores tasks that are finished', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [
          task({ state: 'REFUNDED', closedAt: T(60), closeReason: 'refunded' }),
        ],
      });
      expect(j.nowDoing).toEqual(['Nothing is in progress right now.']);
    });

    it('mentions a payout they are waiting on', () => {
      const j = buildJourney({
        ...emptyFacts(),
        withdrawals: [
          { at: T(120), amountPaise: 429910n, status: 'REQUESTED' },
        ],
      });
      expect(j.nowDoing.join(' ')).toContain('₹4,299.10');
      expect(j.nowDoing.join(' ')).toMatch(/waiting/i);
    });
  });

  describe('the steps they actually took', () => {
    it('turns a task step into a sentence about the offer', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [
          task({
            events: [
              {
                at: T(100),
                type: 'EVIDENCE',
                fromState: 'PURCHASED',
                toState: 'DELIVERED',
                reason: null,
              },
            ],
          }),
        ],
      });
      expect(j.recent[0].what).toContain('Prestige induction cooktop');
      expect(j.recent[0].what).toMatch(/arrived/i);
      expect(j.recent[0].from).toBe('task');
    });

    it('describes a step that changed nothing without pretending it did', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [
          task({
            events: [
              {
                at: T(100),
                type: 'EVIDENCE',
                fromState: 'CLAIMED',
                toState: 'CLAIMED',
                reason: 'No matching review found',
              },
            ],
          }),
        ],
      });
      expect(j.recent[0].what).toMatch(/looked|checked/i);
      expect(j.recent[0].what).toContain('No matching review found');
    });

    it('never prints a state name or an underscore', () => {
      const states = [
        'CLAIMED',
        'PURCHASED',
        'DELIVERED',
        'REVIEWED',
        'HOLDING',
        'REFUNDED',
      ];
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [
          task({
            events: states.map((toState, i) => ({
              at: T(200 - i),
              type: 'SOMETHING_NEW_NOBODY_MAPPED',
              fromState: 'CLAIMED',
              toState,
              reason: null,
            })),
          }),
        ],
      });
      const text = j.recent.map((s) => s.what).join(' | ');
      expect(text).not.toMatch(/_/);
      for (const s of states) expect(text).not.toContain(s);
    });

    it('turns ticket movements into sentences with the real numbers', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tickets: {
          balance: 10,
          entries: [
            { at: T(500), delta: 15, reason: 'SIGNUP_GRANT' },
            { at: T(400), delta: -5, reason: 'CLAIM' },
            { at: T(300), delta: 5, reason: 'EXPIRY_RETURN' },
            { at: T(200), delta: 10, reason: 'COMPLETION_RETURN' },
            { at: T(100), delta: -2, reason: 'ADJUSTMENT' },
          ],
        },
      });
      const text = j.recent.map((s) => s.what).join(' | ');
      expect(text).toContain('15 tickets');
      expect(text).toContain('5 tickets');
      expect(text).toContain('10 tickets');
      expect(text).not.toMatch(/SIGNUP_GRANT|EXPIRY_RETURN|COMPLETION_RETURN/);
    });

    it('turns money into rupees, never paise', () => {
      const j = buildJourney({
        ...emptyFacts(),
        wallet: {
          balancePaise: 429910n,
          entries: [
            { at: T(300), amountPaise: 29520n, kind: 'REFUND', memo: null },
            {
              at: T(200),
              amountPaise: -429910n,
              kind: 'WITHDRAWAL',
              memo: null,
            },
          ],
        },
      });
      const text = j.recent.map((s) => s.what).join(' | ');
      expect(text).toContain('₹295.20');
      expect(text).toContain('₹4,299.10');
      expect(text).not.toMatch(/paise|29520/);
    });

    it('describes every payout state in words', () => {
      const j = buildJourney({
        ...emptyFacts(),
        withdrawals: [
          { at: T(500), amountPaise: 100000n, status: 'REQUESTED' },
          { at: T(400), amountPaise: 100000n, status: 'APPROVED' },
          { at: T(300), amountPaise: 100000n, status: 'PAID' },
          { at: T(200), amountPaise: 100000n, status: 'REJECTED' },
          { at: T(100), amountPaise: 100000n, status: 'FAILED' },
        ],
      });
      const text = j.recent.map((s) => s.what).join(' | ');
      for (const code of [
        'REQUESTED',
        'APPROVED',
        'PAID',
        'REJECTED',
        'FAILED',
      ]) {
        expect(text).not.toContain(code);
      }
      expect(text).toMatch(/paid out/i);
    });

    it('mentions a picture somebody sent in', () => {
      const j = buildJourney({
        ...emptyFacts(),
        proofs: [
          { at: T(50), kind: 'REVIEW', offer: 'Dollar Bigboss Men Vest' },
        ],
      });
      expect(j.recent[0].what).toMatch(/picture/i);
      expect(j.recent[0].what).toContain('Dollar Bigboss Men Vest');
      expect(j.recent[0].from).toBe('proof');
    });

    it('puts the newest thing first, whichever record it came from', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tickets: {
          balance: 10,
          entries: [{ at: T(300), delta: -5, reason: 'CLAIM' }],
        },
        wallet: {
          balancePaise: 0n,
          entries: [
            { at: T(100), amountPaise: 29520n, kind: 'REFUND', memo: null },
          ],
        },
        proofs: [{ at: T(200), kind: 'REVIEW', offer: null }],
      });
      const froms = j.recent.map((s) => s.from);
      expect(froms.slice(0, 3)).toEqual(['wallet', 'proof', 'tickets']);
      const times = j.recent.map((s) => Date.parse(s.at));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('includes joining Fayr as the first thing that ever happened', () => {
      const j = buildJourney(emptyFacts());
      expect(j.recent.at(-1)!.what).toMatch(/joined fayr/i);
      expect(j.recent.at(-1)!.from).toBe('account');
    });
  });

  describe('being honest about what it cannot see', () => {
    it('always says the app does not record which screens they opened', () => {
      const j = buildJourney(emptyFacts());
      expect(j.notIncluded.join(' ')).toMatch(/screens/i);
    });

    it('says so when there were more steps than it shows', () => {
      const many = Array.from({ length: RECENT_STEP_LIMIT + 20 }, (_, i) => ({
        at: T(1000 - i),
        delta: -5,
        reason: 'CLAIM',
      }));
      const j = buildJourney({
        ...emptyFacts(),
        tickets: { balance: 0, entries: many },
      });
      expect(j.recent).toHaveLength(RECENT_STEP_LIMIT);
      expect(j.notIncluded.join(' ')).toContain(String(many.length + 1));
    });

    it('says nothing extra when everything fits', () => {
      const j = buildJourney(emptyFacts());
      expect(j.notIncluded.some((n) => /older steps/i.test(n))).toBe(false);
    });
  });

  describe('the numbers a person answering would want', () => {
    it('carries the balances and counts without anyone having to ask', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tickets: { balance: 5, entries: [] },
        wallet: { balancePaise: 429910n, entries: [] },
        tasks: [
          task({ state: 'HOLDING' }),
          task({
            id: 't2',
            state: 'REFUNDED',
            closedAt: T(60),
            closeReason: 'refunded',
          }),
        ],
        withdrawals: [{ at: T(10), amountPaise: 100000n, status: 'REQUESTED' }],
        questionsWrittenBefore: 2,
      });
      expect(j.standing.ticketBalance).toBe(5);
      expect(j.standing.walletBalance).toBe('₹4,299.10');
      expect(j.standing.offersInProgress).toBe(1);
      expect(j.standing.offersRefunded).toBe(1);
      expect(j.standing.payoutsWaiting).toBe(1);
      expect(j.standing.hasWrittenInBefore).toBe(true);
    });

    it('counts nobody who has never written in as never having written in', () => {
      expect(buildJourney(emptyFacts()).standing.hasWrittenInBefore).toBe(
        false,
      );
    });
  });

  describe('the snapshot itself', () => {
    it('can be stored as it is, with no large numbers left in it', () => {
      // It is written to a JSON column. A bigint in there throws on the way out
      // of the process, long after anybody would connect it to this.
      const j = buildJourney({
        ...emptyFacts(),
        wallet: {
          balancePaise: 429910n,
          entries: [
            { at: T(1), amountPaise: 29520n, kind: 'REFUND', memo: null },
          ],
        },
        withdrawals: [{ at: T(2), amountPaise: 100000n, status: 'PAID' }],
      });
      expect(() => JSON.stringify(j)).not.toThrow();
      expect(JSON.stringify(j)).not.toContain('undefined');
      expect(JSON.stringify(j)).not.toContain('NaN');
    });

    it('records when it was taken', () => {
      const j = buildJourney(emptyFacts());
      expect(j.takenAt).toBe(NOW.toISOString());
    });

    it('reads the same facts the same way every time', () => {
      const facts = emptyFacts();
      expect(buildJourney(facts)).toEqual(buildJourney(facts));
    });

    it('survives facts with holes in them', () => {
      const j = buildJourney({
        ...emptyFacts(),
        tasks: [task({ offer: '', state: 'WHO_KNOWS' })],
      });
      expect(() => JSON.stringify(j)).not.toThrow();
      expect(JSON.stringify(j)).not.toContain('undefined');
    });
  });
});

describe('plainStateName', () => {
  it('has words for every state a task can be in', () => {
    for (const s of [
      'CLAIMED',
      'PURCHASED',
      'DELIVERED',
      'REVIEWED',
      'HOLDING',
      'REFUNDED',
    ]) {
      const name = plainStateName(s);
      expect(name).not.toContain('_');
      expect(name).toBe(name.toLowerCase());
      expect(name.length).toBeGreaterThan(3);
    }
  });

  it('does not invent words for a state it has never seen', () => {
    expect(plainStateName('SOMETHING_ELSE')).toBe('something else');
  });
});
