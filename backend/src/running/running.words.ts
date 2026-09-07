/**
 * EVERY WORD ON THE PAGE THAT MEASURES FAYR ITSELF.
 *
 * One file, for one reason: a director reads this page with nobody standing next
 * to them translating. So the same rule the assistant's words live under applies
 * here, and running.words.spec.ts walks every sentence below through the real
 * plain-language rule. If a sentence is written anywhere else, the check cannot
 * see it, and the file list at the bottom of that spec is what stops that
 * happening quietly.
 *
 * THE PANEL RENDERS THESE, IT DOES NOT WRITE ITS OWN. A screen that invents a
 * sentence is a screen the check has never read.
 *
 * ── TWO THINGS ARE DELIBERATELY NOT SENTENCES ────────────────────────────────
 *
 *   1. The names in our own records ('order-details', 'dkim'). They are stored
 *      values, not words Fayr wrote, and renaming one to read prettily would
 *      change what the grouping matches. They are carried as data.
 *   2. The name of the code that worked a figure out. The owner asked for it by
 *      name so a number can be traced, and a function name is not English.
 *
 * Both are kept in their own fields so the walk can skip them ON PURPOSE rather
 * than by accident.
 */

/** How a number that is not a number is said. Never swap these two. */
export const NOTHING_YET = 'nothing yet';
export const NOT_WATCHING = 'we are not watching this yet';

export const PAGE = {
  title: 'How Fayr is running',
  lead: 'Every number on this page is read out of our own records.',
  leadTwo: 'Nothing here is worked out from a guess.',
  leadThree: 'Nothing on this page changes anything, and nothing refreshes by itself.',
} as const;

// ── Section A. The journey ───────────────────────────────────────────────────

export const JOURNEY = {
  title: 'The journey, step by step',
  lead: 'The two columns answer different questions, so they are kept apart.',
  everythingSoFar: 'Everything so far',
  everythingSoFarMeaning:
    'Every place anybody has ever taken on an offer, counted by how far it got.',
  lastThirtyDays: 'The last 30 days',
  lastThirtyDaysMeaning:
    'Only the places taken in the last 30 days, counted by how far they got.',
  bothMatchToday:
    'Every place Fayr holds was taken in the last 30 days, so both columns match today.',
  whereTheyAreNow:
    'This journey counts where people are now, not every step they ever touched.',
  canGoBackwards:
    'A review taken down during the wait sends somebody back a step. '
    + 'This page shows the step they are on now.',
  stepHeading: 'The step',
  dropHeading: 'Did not get this far',
  /**
   * Said when this page's own thirty-day numbers do not match the Reports tab.
   *
   * Both sides come from one function now, so it should never fire. It is written
   * anyway: a page that quietly disagreed with the spreadsheet in front of a
   * director would be worse than either of them being wrong on its own.
   */
  disagreesWithTheReports:
    'These numbers do not match the Reports tab, and that is a fault.',
  /**
   * WHY ONE STEP SHOWS NO DROP, and it is a real finding rather than a get-out.
   *
   * "Gave us their order" sits between two steps in the owner's list, but it is
   * not on the way: Fayr matches most orders by itself and only asks the person
   * when the match is in doubt. More orders are established than are confirmed,
   * every day, and showing that as a drop of minus something would read as a
   * fault in the product rather than the order of events being different.
   */
  notAStepOnTheWay:
    'Not everybody is asked this. '
    + 'Fayr matches most orders by itself and only asks when the match is in doubt. '
    + 'So this is not a step on the way, and no drop is shown against it.',
  /**
   * What the OTHER way of counting the same step is called, for the line that
   * owns up to a disagreement.
   *
   * Here rather than in the service because they are read by a director, and the
   * service's own check refused them when they were written there.
   */
  bySittingStep: 'Counting by which step a place is sitting on',
  byReviewStep: 'Counting the places that were moved on to the review step',
} as const;

/** One row of the journey: what the step is, and where its number comes from. */
export interface StepWords {
  step: string;
  meaning: string;
  /** Only on a step nothing records. What it would take to start recording it. */
  whatItWouldTake?: string;
}

export const STEPS = {
  tookAPlace: {
    step: 'Took a place on an offer',
    meaning:
      'Somebody spent their tickets to take a place on an offer. '
      + 'The number is how many places have been taken.',
  },
  wentToTheShop: {
    step: 'Went to the shop',
    meaning:
      'Opening a shop happens inside the phone, and the phone tells our side '
      + 'nothing about it.',
    whatItWouldTake:
      'The phone would have to tell our side each time somebody opens a shop.',
  },
  signedInAtTheShop: {
    step: 'Signed in at the shop',
    // WHAT THIS NUMBER IS, AND WHAT IT IS NOT, because it is the one row on this
    // page that rests on what a phone saw rather than on what our side did.
    //
    // AND IT IS NOW TWO DIFFERENT FACTS UNDER ONE HEADING, which the row has to
    // say out loud. Some shops show us: Amazon greets a person by name, and a shop
    // showing its own way out is a shop saying they are in. Flipkart's and
    // Blinkit's own home pages show neither, and were measured on 6 September 2026
    // to show no way IN either when signed out, so on those shops there is nothing
    // to read and the person is asked instead. The row on our side keeps which of
    // the two it was.
    meaning:
      'The shop showed the phone that this person was in, or the person said so '
      + 'when the shop showed nothing either way. It is not proof about any order, '
      + 'and it moves no money.',
  },
  gaveUsTheirOrder: {
    step: 'Gave us their order',
    meaning:
      'Somebody told Fayr which order on the shop is theirs. '
      + 'The number is how many places carry that confirmation.',
  },
  orderEstablished: {
    step: 'Order established',
    meaning:
      'Fayr matched a real order on the shop to this offer. '
      + 'The number is how many places have an order number on them.',
  },
  productArrived: {
    step: 'Product arrived',
    meaning:
      "The shop's records say the product was delivered. "
      + 'The number is how many places carry a delivery date.',
  },
  reviewFoundLive: {
    step: 'Review found live on the product page',
    meaning:
      "The review can be read on the shop's own product page. "
      + 'The number is how many places are marked as having a live review.',
  },
  returnTimeFinished: {
    step: "Shop's return time finished",
    meaning:
      "The shop's return time has run out, so the money is allowed to move. "
      + 'The number is how many places have a finish date that has passed.',
  },
  refundReleased: {
    step: 'Refund released into their wallet',
    meaning:
      'The refund was worked out and put into somebody’s wallet. '
      + 'The number is how many refunds the money book holds.',
  },
  moneyTakenOut: {
    step: 'Money taken out to their own account',
    meaning:
      'Somebody asked for their money and it was marked as sent. '
      + 'This counts payouts and not places, and the money block below says what really happened.',
  },
} as const satisfies Record<string, StepWords>;

export const EXPIRED = {
  step: 'Places that ran out of time',
  meaning:
    'Nobody bought the product in time, so the place was given up and the tickets went back. '
    + 'These are counted inside the top row of the journey as well.',
} as const;

// ── Section B. How each order was established ────────────────────────────────

export const HOW_ORDERS = {
  title: 'How each order was established',
  lead:
    'This is the honest answer to one question. '
    + 'Is Fayr reading orders by itself, or is somebody doing it by hand?',
  addsUp: 'These add up to the number of orders established above.',
  establishedLabel: 'Orders established',
  countHeading: 'Orders',
  namesHeading: 'What our own records call it',
  candidatesNote:
    'Our own records carry a list of three ways an order arrives, and that list is empty today. '
    + 'So this block reads the order held against each place instead. '
    + 'Once the order reader starts filling that list, this number will come from there.',
  unmappedHeading: 'Names nobody has grouped yet',
} as const;

/**
 * THE ONE PLACE A SOURCE NAME IS GROUPED.
 *
 * Written once, shown on the screen, and walked by the checks. A source name that
 * is not in this table lands in "we do not know" BY NAME, so a source added next
 * month shows up as ungrouped instead of being quietly counted as automatic.
 */
export const ORDER_SOURCE_GROUPS = [
  {
    key: 'automatic',
    heading: 'Read automatically off the shop',
    meaning:
      "A machine read the order off the shop's own pages, "
      + "or the shop's own signed email said so.",
    /** Stored values, not words. See the note at the top of this file. */
    names: ['dkim', 'order-details', 'order-history'],
  },
  {
    key: 'picture',
    heading: 'Read from a picture',
    meaning:
      'Somebody sent a picture and the details were read out of it. '
      + 'A person has to approve every one of these.',
    names: ['ocr', 'invoice'],
  },
  {
    key: 'byHand',
    heading: 'Typed in by hand',
    meaning: 'A number was typed in rather than read off the shop.',
    names: ['manual'],
  },
] as const;

export const DO_NOT_KNOW = {
  key: 'doNotKnow',
  heading: 'We do not know',
  meaning:
    'The order does not say where it came from, '
    + 'or it says something nobody has grouped yet.',
} as const;

// ── Section C. Money ─────────────────────────────────────────────────────────

export const MONEY = {
  title: 'Money',
  lead: 'Every figure here is counted exactly and shown in rupees.',
  refundsReleased: 'Refunds released into wallets, in all',
  refundsReleasedMeaning:
    'What the money book has put into wallets, added up. '
    + 'This is the same figure the payouts report shows.',
  sittingInWallets: 'Money sitting in wallets, not yet taken out',
  sittingInWalletsMeaning:
    'What people hold and have not asked for. Asking for it moves it out at once.',
  inHoldingAccount: 'Money in the payout holding account, waiting to go out',
  inHoldingAccountMeaning:
    'Money that has left a wallet because somebody asked for it, '
    + 'and has not been recorded as leaving Fayr.',
  hasLeftFayr: 'Money that has actually left Fayr',
} as const;

/**
 * The most important paragraph on the page, built from the real figures.
 *
 * Written as a function because two of its numbers are read out of the record.
 * The spec walks the sentence this builds, not a template.
 */
export function moneyHasLeftWords(
  paidCount: number,
  holdingRupees: string,
): string {
  const payouts =
    paidCount === 0
      ? 'No payout is marked paid.'
      : paidCount === 1
        ? 'One payout is marked paid.'
        : `${paidCount} payouts are marked paid.`;
  return (
    `${payouts} `
    + "Fayr's own money book records no money leaving, because Fayr cannot send money yet. "
    + 'Marking a payout paid means a person moved the money by hand, outside Fayr, '
    + 'and wrote the bank reference here. '
    + `${holdingRupees} is sitting in the payout holding account.`
  );
}

export const WAITING = {
  title: "Refunds waiting for the shop's return time",
  lead:
    'This is normal and nothing is wrong. '
    + "The money is waiting for the shop's return time to finish.",
  count: 'Refunds waiting',
  wouldPay: 'What these would pay if they were all released today',
  wouldPayMeaning:
    'This is not money anybody is owed yet. '
    + 'It is worked out by the same code that pays a real refund.',
  cannotWorkOut: 'Waiting refunds whose amount cannot be worked out yet',
  cannotWorkOutMeaning:
    'These are in the held list below as well, and they carry no figure here.',
} as const;

export const HELD = {
  title: 'Money held and not released',
  leadOne:
    'Held is not the same as waiting. Waiting is normal. Held is a decision.',
  leadTwo:
    'No amount is shown against these. '
    + 'Fayr does not know what was paid, and that is the reason the money is held.',
  /**
   * THE STRONGEST SENTENCE ON THE PAGE. The owner wrote it and asked for it word
   * for word, neither cut nor lengthened. Its own check pins it.
   */
  theRule:
    'Money is held when Fayr is not sure. '
    + 'Fayr would rather make somebody wait for a person than send the wrong amount.',
  allSix:
    'All six reasons are listed. '
    + 'Every open place was looked at, so a nought here is a real nought.',
  reasonHeading: 'Why it is held',
  countHeading: 'Refunds held',
} as const;

/**
 * A hold nobody has a control for is worse than a hold with a queue, so it is
 * said out loud when there is one.
 *
 * It lived in running.service.ts until this file's own check refused it. Words in
 * the service reach a director unread, which is the whole reason for that check.
 */
export const NOBODY_CAN_CLEAR_WARNING =
  'One of these reasons has no control anybody can use. '
  + 'So nothing is being done about it. '
  + 'The staff list only shows the reasons a person can act on.';

/** Said against a held reason no staff control can clear. */
export const NOBODY_CAN_CLEAR_THIS_ONE =
  'Nobody has a control that can clear this one.';

/** How many held refunds are also in the waiting list. Built from real counts. */
export function alsoWaitingWords(both: number): string {
  if (both === 0) return 'None of these is in the waiting list above.';
  if (both === 1) return 'One of these is in the waiting list above as well.';
  return `${both} of these are in the waiting list above as well.`;
}

// ── Section D. Is the machine still working ──────────────────────────────────

export const MACHINE = {
  title: 'Is the machine still working',
  lead:
    'Some of these are counted and some are not watched at all. '
    + 'Each row says which it is.',
  overdueClaims: 'Places sitting past their own deadline',
  overdueClaimsMeaning:
    'A place has a deadline set the moment it is taken. '
    + 'This counts places past that deadline which have not been given up yet.',
  overdueHolds: "Refunds sitting past the shop's return time",
  overdueHoldsMeaning:
    "The shop's return time has finished and the money has not moved. "
    + 'The return time is the deadline, so no other number had to be chosen.',
  slowChats: 'Conversations waiting for a person too long',
  slowChatsMeaning:
    'Fayr tells people a person will be with them in a minute or two. '
    + 'This counts the conversations that have waited longer than that.',
  failedPayouts: 'Payouts that failed',
  failedPayoutsMeaning:
    'A payout somebody marked as failed, which puts the money back in the wallet. '
    + 'A nought here is a real nought.',
  unreadableOffers: 'Offer pages that could not be read',
  unreadableOffersMeaning:
    'Whether each offer still opens on the real shop for a shopper.',
  unreadableOffersWouldTake:
    'Somebody has to open each offer on a phone and record what they saw. '
    + 'That has never been done, so there is nothing to count.',
  brokenOrderReading: 'Shops whose order list has stopped working',
  brokenOrderReadingMeaning:
    'Whether Fayr can still read orders off a shop at all.',
  brokenOrderReadingWouldTake:
    'It is written down one person at a time against their own place. '
    + 'Nothing adds it up across everybody, so nothing would tell us if a whole shop stopped.',
  failedMessages: 'Messages we tried to send and could not',
  failedMessagesMeaning: 'Whether a sign-in code actually reached a phone.',
  failedMessagesWouldTake:
    'Nothing records a send at all. '
    + 'The row is written before the send is even tried. '
    + 'So a code that arrived cannot be told apart from one that never left.',
} as const;

// ── Section E. The offers themselves ─────────────────────────────────────────

export const OFFERS = {
  title: 'The offers themselves',
  lead:
    'Two checks already exist. '
    + 'This shows the last time each one ran, and the date is the point.',
  nightly: 'The nightly offer check',
  nightlyMeaning:
    'Every live offer, read out of our own records once a night. '
    + 'It never goes out to the shops.',
  livePages: 'The real shop page check',
  livePagesMeaning:
    "Somebody opens each offer's real shop page on a phone and records what they saw.",
  neverRun: 'No offer page has ever been checked.',
  checked: 'Offers looked at',
  blocking: 'Wrong enough to stop a shopper',
  attention: 'Worth somebody looking',
  unchecked: 'Could not be checked at all',
  byHand: 'Somebody ran this by hand.',
  byTheClock: 'This ran on its own overnight.',
} as const;

/** "Last looked on 26 August, which was 8 days ago." Built from real dates. */
export function lastLookedWords(when: string, daysAgo: number): string {
  const ago =
    daysAgo <= 0
      ? 'which was today'
      : daysAgo === 1
        ? 'which was yesterday'
        : `which was ${daysAgo} days ago`;
  return `Last looked on ${when}, ${ago}.`;
}

// ── Section F. What is not real yet ──────────────────────────────────────────

export const NOT_REAL_YET = {
  title: 'What is not real yet',
  lead:
    'This list is meant to be uncomfortable. '
    + 'A page that hides its own gaps cannot be trusted about anything else.',
  items: [
    'Fayr cannot send money to a bank or a payment handle yet. '
      + 'Nothing in Fayr contacts a bank. Every payout so far was moved by hand.',
    'Nobody is ever told anything. '
      + 'There is no text message, no email and no phone alert. '
      + 'Not for a refund released, a payout approved, a payout refused, or a review gone missing. '
      + 'A person only finds out by opening the app.',
    'Most of what is on this page came from practice data rather than real use. '
      + 'Every place that got past the first step was built by the practice script.',
    'No offer page has ever been checked against the real shop.',
    'One step of the journey is not recorded at all. '
      + 'Going to the shop happens inside the phone, '
      + 'and the phone tells our side nothing about it.',
    // THE HONEST CATCH ON THE NEW NUMBER, and it belongs here rather than beside
    // the number, because it is a gap and this is the list of gaps.
    'Signing in at the shop is counted only from the day the phone started '
      + 'telling our side. '
      + 'A place taken before that shows no sign in, however far it got. '
      + 'So that row can read lower than the row under it, and the page says so '
      + 'rather than hiding it.',
    'Two of the six held reasons cannot be cleared by anybody today. '
      + 'The staff list only shows the four a person has a control for. '
      + 'So a refund held for either of the other two has nobody looking at it.',
    'Nothing records whether a sign-in code reached a phone.',
    'The nightly offer check has run once, and that once was a person pressing the button. '
      + 'It has never fired on its own here, because our side is not left running overnight.',
  ],
} as const;
