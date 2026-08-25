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
    it('counts EVERY task on the campaign, whatever state it reached', () => {
      // The gate has always counted every task, and it must: a seat consumed by
      // someone who bought, reviewed and was refunded is gone for good. An
      // expired unpurchased claim also stays counted — the row is still there.
      expect(CLAIMED_SEATS_WHERE('c-1')).toEqual({ campaignId: 'c-1' });
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
