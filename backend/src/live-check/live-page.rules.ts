/**
 * WHEN AN OFFER IS SHOWN GREYED OUT, AND WHAT IT SAYS.
 *
 * Pure. No database, no clock of its own — the time is passed in — so every
 * judgement can be argued with in a test.
 *
 * TWO DIFFERENT THINGS make an offer unusable, and the app has to say which.
 *
 *   ITS PLACES ARE ALL TAKEN. We know this from our own records, which means this
 *   half works today with nobody opening anything.
 *
 *   THE SHOP'S PAGE HAS STOPPED WORKING. We only know this because a person
 *   opened it, signed in, on a real phone. That is the live check.
 *
 * THE ONE THING THIS MUST NEVER DO IS GREY OUT A WORKING OFFER. Two rules follow
 * from that, and both are the opposite of what looks tidy:
 *
 *   A check that FAILED greys out nothing. "I could not open it" is a fact about
 *   us, not about the offer, and hiding a working offer on that basis is money
 *   nobody earns and nobody notices.
 *
 *   A check goes STALE. A shop that was out of stock on Monday is very often back
 *   by Friday, so after a few days the evidence stops counting and the offer comes
 *   back on the feed by itself.
 */

/** Everything a look at a shop page can end in. */
export const LIVE_STATES = [
  'opened',
  'expired',
  'sold-out',
  'unavailable',
  'could-not-open',
  'no-link',
] as const;
export type LiveState = (typeof LIVE_STATES)[number];

/**
 * How long a look at a page is worth anything.
 *
 * A PRODUCT DECISION, not a technical one. Longer means an offer stays hidden on
 * older evidence; shorter means it comes back sooner and somebody may tap through
 * to a dead page. Erring short is the kinder mistake: a dead page is a moment's
 * annoyance, and a hidden offer is money nobody could earn.
 */
export const LIVE_CHECK_TRUSTED_DAYS = 3;

/** The states that mean a shopper genuinely cannot buy it. */
const CANNOT_BUY: readonly LiveState[] = ['expired', 'sold-out', 'unavailable'];

/**
 * What the app shows. `label` is plain words a person reads, and every one of them
 * leaves the door open, because a shop restocks and an offer that says "gone" when
 * it is only "gone for now" trains people to stop looking.
 */
export interface OfferAvailability {
  greyedOut: boolean;
  label: string | null;
  reason: 'seats' | 'page' | null;
}

const PAGE_LABEL: Record<string, string> = {
  expired: 'This offer has ended at the shop. It may come back.',
  'sold-out': 'The shop has run out of this one. It may come back.',
  unavailable:
    'The shop page for this is not open right now. It may come back.',
};

const SEATS_LABEL = 'All the places on this offer are taken. It may come back.';

export function isLiveState(value: unknown): value is LiveState {
  return (
    typeof value === 'string' &&
    (LIVE_STATES as readonly string[]).includes(value)
  );
}

/** One state, said in a whole sentence. Used by the staff screen. */
export function plainStateSentence(state: string): string {
  switch (state) {
    case 'opened':
      return 'The page opened and a shopper could buy it.';
    case 'expired':
      return 'The page says this offer has ended.';
    case 'sold-out':
      return 'The page says the shop has run out of it.';
    case 'unavailable':
      return 'The page will not open for a shopper.';
    case 'could-not-open':
      return 'We could not open the page, so we do not know either way.';
    case 'no-link':
      return 'This offer has no shop page saved, so there was nothing to open.';
    default:
      return 'We do not know what happened with this one.';
  }
}

export function offerAvailability(input: {
  seatsLeft: number | null;
  liveState: string | null;
  liveCheckedAt: Date | null;
  now: Date;
}): OfferAvailability {
  // Places first: it is the more certain of the two, and it is ours to know.
  const seats = input.seatsLeft;
  if (typeof seats === 'number' && Number.isFinite(seats) && seats <= 0) {
    return { greyedOut: true, label: SEATS_LABEL, reason: 'seats' };
  }

  const state = input.liveState;
  if (!isLiveState(state) || !CANNOT_BUY.includes(state)) {
    return { greyedOut: false, label: null, reason: null };
  }

  const checkedAt = input.liveCheckedAt;
  const at = checkedAt instanceof Date ? checkedAt.getTime() : NaN;
  const now = input.now instanceof Date ? input.now.getTime() : NaN;
  if (Number.isNaN(at) || Number.isNaN(now)) {
    return { greyedOut: false, label: null, reason: null };
  }
  const ageDays = (now - at) / (24 * 60 * 60 * 1000);
  if (ageDays > LIVE_CHECK_TRUSTED_DAYS) {
    return { greyedOut: false, label: null, reason: null };
  }

  return { greyedOut: true, label: PAGE_LABEL[state], reason: 'page' };
}

/** How many offers ended in each state. Every state present, so nothing renders blank. */
export function countByState(
  results: { state: string }[],
): Record<LiveState, number> {
  const counts = {} as Record<LiveState, number>;
  for (const state of LIVE_STATES) counts[state] = 0;
  for (const r of Array.isArray(results) ? results : []) {
    if (isLiveState(r?.state)) counts[r.state] += 1;
  }
  return counts;
}
