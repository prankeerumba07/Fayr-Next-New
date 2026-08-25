import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAIMED_SEATS_WHERE,
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
  });
});
