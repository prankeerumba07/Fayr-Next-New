import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAIMED_SEATS_WHERE,
  CLAIMED_SEATS_WHERE_MANY,
  SEAT_TAKEN_BY,
  claimedFor,
  claimedSeatsByCampaign,
  isFull,
  seatsLeft,
  seatIsTakenBy,
} from './seats';

/**
 * ONE DEFINITION OF "A SEAT IS TAKEN".
 *
 * The app is about to show the design's three campaign states — "1,240 joined",
 * "3 left", "All seats taken" — and the server already refuses a claim with
 * "Campaign is full". Those are the same fact read by two different audiences,
 * and if they were counted differently the app would offer a seat the server
 * then refused, or hide one it would have allowed.
 *
 * So the count lives here, once, and both the claim gate and the campaign
 * response use it. These tests are mostly about that: not the arithmetic, which
 * is trivial, but the fact that there is only one of it.
 */
describe('seats', () => {
  describe('the shared definition', () => {
    it('counts every task on the campaign EXCEPT a claim released without buying', () => {
      // UNTIL 18 SEPTEMBER 2026 this read "counts EVERY task on the campaign,
      // whatever state it reached", and the predicate was empty on purpose. The
      // owner measured what that did on his own account: a one-slot campaign,
      // claimed and released, stayed shut for ever — "the tickets came back; the
      // seat did not". His rule: "a claim that has been RELEASED — closed with
      // its tickets returned, and never purchased — holds no seat. A claim that
      // was PURCHASED still holds one, for ever."
      //
      // THE SHAPE IS ASSERTED EXACTLY, not merely "has a NOT": the two
      // mutations this file exists to catch each drop one of the three facts,
      // and each is a different wrong rule.
      expect(CLAIMED_SEATS_WHERE('c-1')).toEqual({
        campaignId: 'c-1',
        NOT: { closedAt: { not: null }, state: 'CLAIMED', orderId: null },
      });
    });

    // ── THE RULE, WALKED ROW BY ROW, THROUGH THE IN-MEMORY TWIN ─────────────
    //
    // A Prisma where-clause cannot be run here. seatIsTakenBy is the same rule
    // written so a test can ask it, and the last case below checks the twin
    // agrees with the clause's own three facts so the two cannot drift.
    const open = { closedAt: null, state: 'CLAIMED', orderId: null };
    const released = { closedAt: new Date(), state: 'CLAIMED', orderId: null };

    it('A RELEASED, NEVER-PURCHASED CLAIM FREES ITS SEAT', () => {
      expect(seatIsTakenBy(released)).toBe(false);
    });

    it('A CLAIM IN PROGRESS STILL HOLDS ITS SEAT', () => {
      // "A claim still running holds a seat." Open means closedAt is null,
      // whatever else is true of the row.
      expect(seatIsTakenBy(open)).toBe(true);
      expect(seatIsTakenBy({ ...open, orderId: 'ORD-1' })).toBe(true);
    });

    it('A PURCHASED CLAIM STILL HOLDS ITS SEAT FOR EVER', () => {
      // "because that seat really was used" — open or closed, and in every
      // state past CLAIMED.
      for (const state of ['PURCHASED', 'DELIVERED', 'REVIEWED', 'HOLDING', 'REFUNDED']) {
        expect(seatIsTakenBy({ closedAt: null, state, orderId: 'ORD-1' })).toBe(true);
        expect(seatIsTakenBy({ closedAt: new Date(), state, orderId: 'ORD-1' })).toBe(true);
        // And the state alone is enough: a row that reached PURCHASED with no
        // orderId written is still a used seat.
        expect(seatIsTakenBy({ closedAt: new Date(), state, orderId: null })).toBe(true);
      }
    });

    it('and does NOT widen: a closed CLAIMED row with an order on it keeps its seat', () => {
      // The ambiguous case — matched, never confirmed, then lapsed. The owner
      // said not to widen the rule, so it stays taken.
      expect(seatIsTakenBy({ ...released, orderId: 'ORD-1' })).toBe(true);
    });

    it('the in-memory twin and the where-clause say the same three things', () => {
      // WALKED, NOT RESTATED — corrected 18 September 2026. The first writing
      // re-asserted the clause's literal shape, which the test above already
      // pins, and never called the twin at all, so a twin that drifted would
      // have passed here. This evaluates the clause's own NOT against every
      // shape of row a task can be in and asks the twin the same question.
      const not = SEAT_TAKEN_BY.NOT as {
        closedAt: { not: null }; state: string; orderId: null;
      };
      expect(Object.keys(not).sort()).toEqual(['closedAt', 'orderId', 'state']);
      const clauseSays = (row: { closedAt: Date | null; state: string; orderId: string | null }) => {
        const closedAtMatches = row.closedAt !== null; // { not: null }
        const stateMatches = row.state === not.state;
        const orderIdMatches = row.orderId === not.orderId;
        return !(closedAtMatches && stateMatches && orderIdMatches); // NOT (all three)
      };
      const rows: { closedAt: Date | null; state: string; orderId: string | null }[] = [];
      for (const closedAt of [null, new Date()]) {
        for (const state of ['CLAIMED', 'PURCHASED', 'DELIVERED', 'REVIEWED', 'HOLDING', 'REFUNDED']) {
          for (const orderId of [null, 'ORD-1']) rows.push({ closedAt, state, orderId });
        }
      }
      expect(rows).toHaveLength(24);
      for (const row of rows) {
        expect(seatIsTakenBy(row)).toBe(clauseSays(row));
      }
      // And exactly one of the twenty-four frees its seat.
      expect(rows.filter((r) => !seatIsTakenBy(r))).toHaveLength(1);
    });

    it('is the ONLY place the claim gate counts seats', () => {
      // The defect this prevents: the gate keeping its own inline count while the
      // response computes another. Two numbers for one fact, drifting the first
      // time either changes.
      const src = readFileSync(
        join(__dirname, '..', 'tasks', 'task.service.ts'),
        'utf8',
      )
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // No hand-rolled seat count anywhere in the task service.
      expect(src).not.toMatch(/task\.count\(\s*\{\s*where:\s*\{\s*campaignId/);
      expect(src).toMatch(/CLAIMED_SEATS_WHERE|isFull\(/);
    });
  });

  describe('counting seats for many campaigns at once', () => {
    const db = (rows: { campaignId: string; n: number }[]) => {
      const calls: unknown[] = [];
      return {
        calls,
        task: {
          groupBy: (args: unknown) => {
            calls.push(args);
            return Promise.resolve(
              rows.map((r) => ({ campaignId: r.campaignId, _count: { _all: r.n } })),
            );
          },
        },
      };
    };

    it('asks the SAME question the claim gate asks', async () => {
      // The defect avoided: Prisma's `_count: { select: { tasks: true } }` on the
      // campaign include would have been shorter and cannot be told about
      // SEAT_TAKEN_BY, so the feed and the gate would have been two expressions of
      // one rule — agreeing today, diverging the first time the rule changed.
      const d = db([]);
      await claimedSeatsByCampaign(d, ['c-1', 'c-2']);
      expect(d.calls).toHaveLength(1);
      expect(d.calls[0]).toEqual({
        by: ['campaignId'],
        where: CLAIMED_SEATS_WHERE_MANY(['c-1', 'c-2']),
        _count: { _all: true },
      });
    });

    it('the one-campaign and many-campaign predicates carry the same conditions', () => {
      // If a condition is ever added to SEAT_TAKEN_BY, BOTH must gain it. This is
      // the assertion that makes the shared constant worth having.
      const one = CLAIMED_SEATS_WHERE('c-1');
      const many = CLAIMED_SEATS_WHERE_MANY(['c-1']);
      const extraKeys = (w: object) =>
        Object.keys(w).filter((k) => k !== 'campaignId').sort();
      expect(extraKeys(one)).toEqual(extraKeys(many));
      expect(extraKeys(one)).toEqual(Object.keys(SEAT_TAKEN_BY).sort());
    });

    it('is ONE query however many campaigns are asked about', async () => {
      // A per-campaign count would be an N+1 across the whole feed.
      const d = db([{ campaignId: 'c-1', n: 3 }]);
      await claimedSeatsByCampaign(d, ['c-1', 'c-2', 'c-3', 'c-4', 'c-5']);
      expect(d.calls).toHaveLength(1);
    });

    it('asks nothing at all when there are no campaigns', async () => {
      const d = db([]);
      expect(await claimedSeatsByCampaign(d, [])).toEqual(new Map());
      expect(d.calls).toHaveLength(0);
    });

    it('reads a campaign nobody has claimed as 0, not undefined', async () => {
      // groupBy returns only groups that EXIST, so an unclaimed campaign is absent
      // from the result. Read through claimedFor and absence becomes zero; index
      // the map directly and it becomes undefined, which arithmetic turns into NaN
      // and a screen turns into "NaN joined".
      const counts = await claimedSeatsByCampaign(
        db([{ campaignId: 'c-1', n: 7 }]),
        ['c-1', 'c-2'],
      );
      expect(claimedFor(counts, 'c-1')).toBe(7);
      expect(claimedFor(counts, 'c-2')).toBe(0);
      expect(counts.get('c-2')).toBeUndefined();
    });
  });

  describe('seatsLeft', () => {
    it('is the slots minus the seats taken', () => {
      expect(seatsLeft(50, 47)).toBe(3);
      expect(seatsLeft(25, 0)).toBe(25);
    });

    it('is null when the campaign has no limit — not Infinity, not a big number', () => {
      // An unlimited campaign has no "seats left" to state. Null means the screen
      // says nothing about seats, which is the truth.
      expect(seatsLeft(null, 12)).toBeNull();
    });

    it('never goes negative, however the data got there', () => {
      // Slots can be lowered by an operator after claims exist. "-2 left" is not
      // a thing to put on a screen.
      expect(seatsLeft(10, 14)).toBe(0);
    });
  });

  describe('isFull', () => {
    it('matches the gate exactly at the boundary', () => {
      // The gate refuses when taken >= totalSlots. Off by one here would offer a
      // seat the server refuses, which reads to the user as the app lying.
      expect(isFull(50, 49)).toBe(false);
      expect(isFull(50, 50)).toBe(true);
      expect(isFull(50, 51)).toBe(true);
    });

    it('an unlimited campaign is never full', () => {
      expect(isFull(null, 10000)).toBe(false);
    });

    it('is EXACTLY "no seats left" — the equivalence the app reads', () => {
      // The response carries seatsLeft, and the screen shows "All seats taken"
      // when it is 0. That is only safe if 0 and full are the same thing at every
      // boundary — otherwise the app offers a seat the server refuses, or hides
      // one it would have allowed.
      for (const total of [null, 0, 1, 3, 50]) {
        for (const taken of [0, 1, 2, 3, 49, 50, 51]) {
          const left = seatsLeft(total, taken);
          expect(left === 0).toBe(isFull(total, taken));
        }
      }
    });
  });
});
