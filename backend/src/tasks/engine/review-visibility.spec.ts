// WHO IS ALLOWED TO SAY A REVIEW IS PUBLICLY VISIBLE — written BEFORE the code.
//
// `published` is a PAYOUT SIGNAL. It is the one fact that decides whether a
// review Fayr paid for actually exists where a shopper can read it, and the
// countermeasure to loophole 3 (a review deleted after payout) is built entirely
// on top of it.
//
// Until now the review object had no provenance at all: `patch.review = e.review`
// replaced it wholesale, so every source of a `published` verdict tied with every
// other and the last write won. That was survivable while the only writers were
// the device readers and the scheduler's permalink re-check, both machines. It
// stops being survivable the moment a PERSON can assert it — which is what the
// eyes-on-page confirmation does, because Meesho publishes no review text on the
// web and no machine can ever check it there.
//
// So the review now carries `publishedSource`, and these are the tests for the
// two directions that matter:
//
//   1. A person's word must NOT be quietly undone by a device read that never
//      looked at a public page. Without this the whole action is pointless: a
//      Meesho re-fetch would clobber the confirmation and the task would fall
//      back into the same dead end.
//   2. A person's word must NOT survive a MACHINE that did look. If the
//      scheduler fetches the permalink and the review is gone, that outranks
//      anybody's memory of having seen it — otherwise the confirmation becomes a
//      way to disarm loophole 3 by hand.

import {
  ASSERTED_SOURCES,
  ATTESTED_SOURCES,
  DAY,
  SOURCES,
  isAttestedSource,
  sourceRank,
} from './states';
import { createTask, type EngineTask } from './task-state';
import { transition, type EngineEvent } from './transition';

const T0 = Date.UTC(2026, 7, 1);

function fresh(platform = 'meesho'): EngineTask {
  return createTask({
    id: 't-vis',
    platform,
    category: 'general',
    product: 'Test Product',
  });
}

function drive(task: EngineTask, events: EngineEvent[]): EngineTask {
  return events.reduce((acc, e) => transition(acc, e).task, task);
}

/** The ordinary Meesho shape: a real star, and nothing that proves it is public. */
const starOnly = {
  reviewId: 'sub-1',
  product: 'Test Product',
  rating: 5,
  published: false,
  // NOTHING established this verdict. Meesho's orders payload cannot: it shows
  // the star, never the words, and there is no permalink to fetch. `false` here
  // is an ABSENCE of information, not a finding — which is exactly why a person
  // is allowed to fill it and why that is not an override.
  publishedSource: null,
};

describe('review visibility — the tier a person occupies', () => {
  it('puts a staff eye-witness BELOW every machine that read the marketplace', () => {
    for (const attested of ATTESTED_SOURCES) {
      expect(sourceRank(attested)).toBeGreaterThan(
        sourceRank(SOURCES.STAFF_VISIBLE),
      );
    }
  });

  it('puts it ABOVE everything the USER supplies — they cannot choose it', () => {
    // An invoice, a typed figure and a screenshot are all things the person being
    // paid selected. A Fayr reviewer opening a public product page is not.
    for (const userSupplied of [
      SOURCES.INVOICE,
      SOURCES.MANUAL,
      SOURCES.OCR,
    ]) {
      expect(sourceRank(SOURCES.STAFF_VISIBLE)).toBeGreaterThan(
        sourceRank(userSupplied),
      );
    }
  });

  it('is NOT attested — no machine read it, and the word must not imply one did', () => {
    expect(isAttestedSource(SOURCES.STAFF_VISIBLE)).toBe(false);
    expect(ASSERTED_SOURCES).toContain(SOURCES.STAFF_VISIBLE);
  });

  it('treats a machine read of the public review as a peer of the order reads', () => {
    // Both are the marketplace's own rendered truth, read on-device. Neither
    // should be able to veto the other, so a re-fetch still updates.
    expect(sourceRank(SOURCES.REVIEW_PUBLIC)).toBe(
      sourceRank(SOURCES.ORDER_DETAILS),
    );
    expect(sourceRank(SOURCES.DKIM)).toBeGreaterThan(
      sourceRank(SOURCES.REVIEW_PUBLIC),
    );
    expect(isAttestedSource(SOURCES.REVIEW_PUBLIC)).toBe(true);
  });
});

describe('review visibility — a staff confirmation is not quietly undone', () => {
  it('SURVIVES a later device read that never looked at a public page', () => {
    // THE test this file exists for. Meesho's reader emits published:false on
    // every fetch, because the web payload cannot say otherwise. If that
    // overwrote the confirmation, a user pressing Fetch once more would silently
    // put their own refund back into the dead end a person had just cleared.
    const t = drive(fresh(), [
      { type: 'EVIDENCE', at: T0, evidence: { review: { ...starOnly } } },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: {
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
            visibleUrl: 'https://www.meesho.com/s/p/abc123',
            visibleCheckedAt: T0 + DAY,
          },
        },
      },
      // The user hits Fetch again. Same payload as the first read.
      { type: 'EVIDENCE', at: T0 + 2 * DAY, evidence: { review: { ...starOnly } } },
    ]);
    expect(t.review?.published).toBe(true);
    expect(t.review?.publishedSource).toBe(SOURCES.STAFF_VISIBLE);
    expect(t.review?.visibleUrl).toBe('https://www.meesho.com/s/p/abc123');
  });

  it('survives an OCR-approved fragment too — a screenshot cannot prove visibility', () => {
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
          },
        },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: {
          review: { ...starOnly, published: false, publishedSource: SOURCES.OCR },
        },
      },
    ]);
    expect(t.review?.published).toBe(true);
    expect(t.review?.publishedSource).toBe(SOURCES.STAFF_VISIBLE);
  });
});

describe('review visibility — a machine that DID look always wins', () => {
  it('a public-review read REPLACES a staff confirmation when the review is gone', () => {
    // Loophole 3 stays armed. A person who saw it last week does not outrank a
    // fetch of the permalink today.
    const t = drive(fresh('amazon'), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
          },
        },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: {
          review: {
            ...starOnly,
            published: false,
            publishedSource: SOURCES.REVIEW_PUBLIC,
          },
        },
      },
    ]);
    expect(t.review?.published).toBe(false);
    expect(t.review?.publishedSource).toBe(SOURCES.REVIEW_PUBLIC);
  });

  it('the HOLDING re-check stamps itself as a machine read, so it outranks a person', () => {
    // VISIBILITY_CHECK is only ever reached after the scheduler has actually
    // fetched the permalink (see SchedulerService.runTick), so recording it as a
    // machine read is the truth and not a convenience.
    const t = drive(fresh('amazon'), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          order: { id: 'o1', itemPaise: 32800n, source: SOURCES.ORDER_DETAILS },
          delivery: { at: T0, source: SOURCES.ORDER_DETAILS },
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
          },
        },
      },
      { type: 'MARK_REVIEWED', at: T0 + DAY },
      { type: 'START_HOLD', at: T0 + DAY },
      { type: 'VISIBILITY_CHECK', published: false, at: T0 + 2 * DAY },
    ]);
    expect(t.state).toBe('REVIEWED'); // regressed: it cannot refund
    expect(t.review?.published).toBe(false);
    expect(t.review?.publishedSource).toBe(SOURCES.REVIEW_PUBLIC);
  });

  it('and a still-public re-check leaves the hold running, stamped by the machine', () => {
    const t = drive(fresh('amazon'), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          order: { id: 'o1', itemPaise: 32800n, source: SOURCES.ORDER_DETAILS },
          delivery: { at: T0, source: SOURCES.ORDER_DETAILS },
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
          },
        },
      },
      { type: 'MARK_REVIEWED', at: T0 + DAY },
      { type: 'START_HOLD', at: T0 + DAY },
      { type: 'VISIBILITY_CHECK', published: true, at: T0 + 2 * DAY },
    ]);
    expect(t.state).toBe('HOLDING');
    expect(t.review?.published).toBe(true);
    expect(t.review?.publishedSource).toBe(SOURCES.REVIEW_PUBLIC);
  });
});

describe('review visibility — nothing already stored behaves differently', () => {
  it('two unsourced reviews still last-write-wins, exactly as before', () => {
    // Every review written before this change carries no publishedSource. The
    // authority check must be a NO-OP for them, or a release that worked
    // yesterday stops working today for reasons nobody asked for.
    const t = drive(fresh(), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: { review: { published: false, rating: 3 } },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { review: { published: true, rating: 5 } },
      },
    ]);
    expect(t.review?.published).toBe(true);
    expect(t.review?.rating).toBe(5);
  });

  it('a blocker that carries a review cannot launder a downgrade either', () => {
    // The blocker branch has its own `review:` assignment. It used to replace the
    // review wholesale too, which would have been a second route straight past
    // the authority check — the exact defect class this codebase keeps finding.
    const t = drive(fresh('amazon'), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
          },
        },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: {
          blocker: 'order_unreadable',
          reason: "Amazon's order page returned no readable content.",
          review: { ...starOnly, published: false, publishedSource: null },
        },
      },
    ]);
    expect(t.blocker).toBe('order_unreadable'); // the blocker still lands
    expect(t.review?.published).toBe(true); // the confirmation does not
    expect(t.review?.publishedSource).toBe(SOURCES.STAFF_VISIBLE);
  });

  it('and a blocker with no review at all leaves the review alone', () => {
    const t = drive(fresh('amazon'), [
      {
        type: 'EVIDENCE',
        at: T0,
        evidence: {
          review: {
            ...starOnly,
            published: true,
            publishedSource: SOURCES.STAFF_VISIBLE,
          },
        },
      },
      {
        type: 'EVIDENCE',
        at: T0 + DAY,
        evidence: { blocker: 'reconnect_account', reason: 'Sign in again.' },
      },
    ]);
    expect(t.review?.published).toBe(true);
    expect(t.review?.publishedSource).toBe(SOURCES.STAFF_VISIBLE);
  });
});

describe('review visibility — a user can never mint the staff tier', () => {
  it('is excluded from the sources a client may claim on submitted evidence', () => {
    // The allow-list on the wire is ATTESTED_SOURCES. `staff-confirmed-visible`
    // is asserted, so it is refused there — which is what makes the human gate
    // mandatory rather than merely conventional.
    expect(ATTESTED_SOURCES).not.toContain(SOURCES.STAFF_VISIBLE);
  });
});
