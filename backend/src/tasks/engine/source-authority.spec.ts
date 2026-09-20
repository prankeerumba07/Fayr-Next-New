// Evidence authority, written BEFORE the fix it describes.
//
// The hole: `sourceRank` was binary — only 'ocr' ranked low, everything else
// tied at 1. `SOURCES.MANUAL` already existed AND the user-facing evidence DTO
// already accepted it (SOURCE_VALUES excludes only 'ocr'). So a user could POST
// order evidence with source 'manual' and any itemPaise they liked, tie with
// 'order-details' on authority, and REPLACE genuine scraped order data by
// last-write-wins — with nothing routing it to a human.
//
// These tests pin the property that closes it: attested sources (what a machine
// read from the marketplace) always outrank asserted ones (what a person typed
// or a picture implied), and an asserted source can never overwrite an attested
// fact or stand alone as the basis for money.

import {
  ASSERTED_SOURCES, ATTESTED_SOURCES, DAY, SOURCES, isAttestedSource, sourceRank,
} from './states';
import { createTask, type EngineTask } from './task-state';
import { transition, type EngineEvent } from './transition';

const T0 = Date.UTC(2026, 6, 1);

function fresh(): EngineTask {
  return createTask({
    id: 't1',
    platform: 'amazon',
    category: 'general',
    product: 'Test Product',
  });
}

function drive(task: EngineTask, events: EngineEvent[]): EngineTask {
  return events.reduce((acc, e) => transition(acc, e).task, task);
}

describe('evidence authority — attested beats asserted', () => {
  it('ranks the marketplace-read sources strictly above the human-asserted ones', () => {
    // Read off the two exported lists rather than two copies written out here.
    // A hand-maintained list drifts the moment a source is added — and a source
    // that nobody remembered to add would silently tie with everything, which is
    // the hole this whole file exists to close.
    for (const a of ATTESTED_SOURCES) {
      for (const b of ASSERTED_SOURCES) {
        expect(sourceRank(a)).toBeGreaterThan(sourceRank(b));
      }
    }
    // Both lists are non-empty and cover every known source, so the loop above
    // cannot pass by iterating over nothing.
    expect(ATTESTED_SOURCES.length + ASSERTED_SOURCES.length).toBe(
      Object.keys(SOURCES).length,
    );
  });

  it('puts DKIM above scraping — a signed email cannot be forged by the user', () => {
    expect(sourceRank(SOURCES.DKIM)).toBeGreaterThan(sourceRank(SOURCES.ORDER_DETAILS));
    expect(sourceRank(SOURCES.DKIM)).toBeGreaterThan(sourceRank(SOURCES.ORDER_HISTORY));
    expect(sourceRank(SOURCES.DKIM)).toBeGreaterThan(sourceRank(SOURCES.REVIEW_PUBLIC));
  });

  it('puts a Fayr reviewer above anything the USER hands us, and below every machine', () => {
    // The one asserted source the user cannot choose: a staff member opening a
    // public product page. See review-visibility.spec.ts for what rests on it.
    for (const userSupplied of [SOURCES.INVOICE, SOURCES.MANUAL, SOURCES.OCR]) {
      expect(sourceRank(SOURCES.STAFF_VISIBLE)).toBeGreaterThan(sourceRank(userSupplied));
    }
    for (const machine of ATTESTED_SOURCES) {
      expect(sourceRank(machine)).toBeGreaterThan(sourceRank(SOURCES.STAFF_VISIBLE));
    }
  });

  it('puts a SIGHTING below every figure the shop itself printed, and above staff', () => {
    // ── WHY THIS ONE HAS ITS OWN TIER ───────────────────────────────────────
    //
    // Zepto's order list says "Order delivered" with no moment beside it, so the
    // instant Fayr records is when Fayr first SAW the words — always at or after
    // the real arrival. Tied with order-history it could replace a moment the
    // shop actually printed by arriving second, and the hold would then run from
    // the later guess. A hold that runs late is safe; one that runs early pays
    // for a parcel that could still be sent back.
    for (const printed of [
      SOURCES.DKIM, SOURCES.ORDER_DETAILS, SOURCES.ORDER_HISTORY, SOURCES.REVIEW_PUBLIC,
    ]) {
      expect(sourceRank(printed)).toBeGreaterThan(sourceRank(SOURCES.OBSERVED_DELIVERED));
    }
    // AND IT IS STILL A MACHINE READING THE SHOP, so it outranks everything no
    // machine stands behind — including a Fayr reviewer's own eyes.
    for (const noMachine of ASSERTED_SOURCES) {
      expect(sourceRank(SOURCES.OBSERVED_DELIVERED)).toBeGreaterThan(sourceRank(noMachine));
    }
    expect(isAttestedSource(SOURCES.OBSERVED_DELIVERED)).toBe(true);
  });

  it('classifies every known source, and treats an unknown one as least trusted', () => {
    for (const s of Object.values(SOURCES)) expect(sourceRank(s)).toBeGreaterThan(0);
    // An unrecognised source must never tie with a real one.
    expect(sourceRank('something-new')).toBe(0);
    expect(sourceRank(null)).toBe(0);
    expect(sourceRank(undefined)).toBe(0);
  });

  it('agrees with isAttestedSource / ASSERTED_SOURCES', () => {
    expect(isAttestedSource(SOURCES.ORDER_DETAILS)).toBe(true);
    expect(isAttestedSource(SOURCES.DKIM)).toBe(true);
    for (const s of ASSERTED_SOURCES) expect(isAttestedSource(s)).toBe(false);
    expect(isAttestedSource('made-up')).toBe(false);
  });
});

describe('evidence authority — a typed amount cannot overwrite a scraped one', () => {
  // THE vulnerability this file exists for.
  it('a manual order does NOT replace a scraped order', () => {
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          order: { id: 'REAL-1', itemPaise: 32800n, source: SOURCES.ORDER_HISTORY },
        },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        // "I paid ₹5,000."
        evidence: {
          order: { id: 'REAL-1', itemPaise: 500000n, source: SOURCES.MANUAL },
        },
      },
    ]);
    expect(t.order?.itemPaise).toBe(32800n);
    expect(t.order?.source).toBe(SOURCES.ORDER_HISTORY);
  });

  it('an invoice-derived order does NOT replace a scraped order either', () => {
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { order: { id: 'REAL-2', itemPaise: 32800n, source: SOURCES.ORDER_DETAILS } },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { order: { id: 'REAL-2', itemPaise: 999900n, source: SOURCES.INVOICE } },
      },
    ]);
    expect(t.order?.itemPaise).toBe(32800n);
    expect(t.order?.source).toBe(SOURCES.ORDER_DETAILS);
  });

  it('a manual delivery date does NOT replace a scraped one', () => {
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          order: { id: 'o1', itemPaise: 32800n, source: SOURCES.ORDER_HISTORY },
          delivery: { at: T0, source: SOURCES.ORDER_HISTORY },
        },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { delivery: { at: T0 - 90 * DAY, source: SOURCES.MANUAL } },
      },
    ]);
    // A back-dated delivery would shorten the holding period — the exact reason
    // this must not be user-assertable.
    expect(t.delivery?.at).toBe(T0);
    expect(t.delivery?.source).toBe(SOURCES.ORDER_HISTORY);
  });

  it('but an asserted source DOES fill a gap no scraper filled', () => {
    // The point of the fallback: it adds where nothing exists, never overwrites.
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { order: { id: 'o1', itemPaise: 32800n, source: SOURCES.ORDER_HISTORY } },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { delivery: { at: T0 + DAY, source: SOURCES.MANUAL } },
      },
    ]);
    expect(t.delivery?.at).toBe(T0 + DAY);
    expect(t.delivery?.source).toBe(SOURCES.MANUAL);
  });

  it('a higher-authority source DOES replace a lower one — DKIM over a manual claim', () => {
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { order: { id: 'o1', itemPaise: 500000n, source: SOURCES.MANUAL } },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { order: { id: 'o1', itemPaise: 32800n, source: SOURCES.DKIM } },
      },
    ]);
    expect(t.order?.itemPaise).toBe(32800n);
    expect(t.order?.source).toBe(SOURCES.DKIM);
  });

  it('ties among attested sources still behave as before (last write wins)', () => {
    // Not a regression: the two scraper sources are peers and a re-fetch should
    // still update. Only the attested/asserted boundary is new.
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { order: { id: 'o1', itemPaise: 100n, source: SOURCES.ORDER_HISTORY } },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { order: { id: 'o1', itemPaise: 200n, source: SOURCES.ORDER_DETAILS } },
      },
    ]);
    expect(t.order?.itemPaise).toBe(200n);
  });
});
