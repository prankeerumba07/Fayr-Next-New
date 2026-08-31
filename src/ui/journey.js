// THE CLAIM JOURNEY, AS TEN PAGES.
//
// What was there before: one long scrolling screen with a vertical rail of every
// stage at once. It was honest and it was complete, and it read as a list. This
// is the same journey as a sequence of pages, one thing at a time, which is what
// the design draws and what somebody holding a phone can actually follow.
//
// PURE. No React, no fetch, no clock unless it is handed in — so every page's
// wording and every "which page am I on" decision can be checked under node.
// Same reason as ui/stages.js and ui/chat.js.
//
// WHERE THE WORDS COME FROM. The headings and the button labels are the design's
// own (fayr-design.browser.jsx), named against each step below so anybody can go
// and look. Two things are mine and are marked as such: the "what happens next"
// line, which the design does not have on every page, and the step counter's
// total, because the design's tracker counts seven and this journey has ten.

import { STATES } from '../taskflow.js'; // explicit extension: also run under node

/**
 * The ten pages, in order.
 *
 *   title    the heading, in the design's words where the design has one
 *   short    the tracker's own label. Seven of these are the design's STEPS7
 *            (fayr-design.browser.jsx:482) - its own canonical journey copy,
 *            which was written and then never put on a screen.
 *   from     which design screen it is ported from, so it can be checked
 *   next     what happens after this page. Mine, not the design's.
 *   act      the button, or null when there is nothing to press
 *   waiting  true when nothing is needed from the person on this page
 *   mine     true when the design has no page for this step and I wrote it,
 *            matching the nearest page the design does cover. Four of ten.
 */
export const JOURNEY = [
  {
    key: 'join',
    short: 'Join the offer',
    title: 'Confirm participation',
    from: 'ConfirmJoin',
    body:
      'Joining uses five of your tickets. They come back if the offer runs out '
      + 'of time before you buy.',
    next: 'You will connect your shop account, so we can see your order.',
    act: 'Join this offer',
  },
  {
    key: 'connect',
    short: 'Connect your shop',
    title: 'Connect your shop account',
    from: 'LinkAccount',
    body:
      'You sign in on the shop’s own page, not ours. We never see your shop '
      + 'password, and we only read your own orders and reviews.',
    next: 'You will buy the product on the shop, then come back here.',
    act: 'Connect now',
  },
  {
    key: 'buy',
    short: 'Buy the exact product',
    title: 'Buy exactly this',
    from: 'BuyInterstitial',
    body:
      'It has to be this exact product. A different size or colour is a different '
      + 'product to the shop, and we will not be able to match it.',
    next: 'When it arrives, come back and tell us it was delivered.',
    act: 'Open the shop',
  },
  {
    key: 'delivered',
    short: 'Confirm it arrived',
    title: 'Has it arrived?',
    from: 'DeliveryConfirm',
    body:
      'Tell us once it is in your hands. That is what opens the review step.',
    next: 'You will send us a picture of your order.',
    act: 'Yes, it arrived',
  },
  {
    key: 'purchase-shot',
    short: 'Upload order proof',
    title: 'Grab a screenshot of your order',
    from: 'ProofPrimer',
    body:
      'Open your orders on the shop, take a screenshot of this one, and choose it '
      + 'here. It only has to show the product, the amount and the date.',
    next: 'We will read it and check it against the offer.',
    act: 'Choose a picture',
  },
  {
    key: 'checking',
    iAdded:
      'the design goes straight from here to a green "refund tracked" '
      + 'celebration. It has no state for waiting on a person, and the product '
      + 'never accepts a screenshot without one.',
    short: 'We check your proof',
    title: 'We are reading your screenshot',
    from: 'UnderReview',
    body:
      'A person at Fayr checks every screenshot. Nothing is decided by the '
      + 'reading alone.',
    next: 'Once it is checked, you can write your review.',
    act: null,
    waiting: true,
  },
  {
    key: 'review',
    short: 'Use it & review honestly',
    title: 'Share your honest review',
    from: 'ReviewGuide',
    body:
      'One star or five, you are paid the same. Write what you really think: how '
      + 'you used it, what surprised you, and who it is for.',
    next: 'You will send us a picture of your review once it is live.',
    act: 'Write it on the shop',
  },
  {
    key: 'review-shot',
    iAdded:
      'the design has an "upload a screenshot instead" button with nothing '
      + 'behind it. This one really opens the photos.',
    short: 'Submit review proof',
    title: 'Posted? Show us',
    from: 'ReviewProof',
    body:
      'Take a screenshot of your review on the product page and choose it here.',
    next: 'We wait for the shop’s return window to close.',
    act: 'Choose a picture',
  },
  {
    key: 'window',
    short: 'Return window closes',
    title: 'Waiting for the return window',
    from: 'ReturnWindow',
    body:
      'Your money is released once the shop’s return window has closed and '
      + 'your review is still there. We check it again before we pay.',
    next: 'Your refund lands in your Fayr wallet.',
    act: null,
    waiting: true,
  },
  {
    key: 'refund',
    short: 'Get paid',
    title: 'Your refund is in your wallet',
    from: 'Reward',
    body: 'It is yours to withdraw whenever you like.',
    next: 'Nothing. This one is finished.',
    act: 'Go to my wallet',
  },
];

/** How many pages there are. The design's tracker counts seven; this counts ten. */
export const OF = JOURNEY.length;

/** Every page's name, for anything that needs the order and nothing else. */
export const JOURNEY_KEYS = JOURNEY.map((s) => s.key);

/**
 * WHAT THE DESIGN COVERS, AND WHAT I ADDED, OUT LOUD.
 *
 * The design has a screen for every one of the ten pages, so no page's look is
 * invented. What it does not have is listed here per page, and there are four
 * things across the whole journey rather than four missing pages:
 *
 *   the step indicator   The design wrote its own journey copy - STEPS7, at
 *     line 482 - and then never put it on a screen. Seven of the short labels
 *     below are those words; the other three are mine, for the three steps
 *     STEPS7 does not count. No journey screen in the design tells anybody
 *     where they are.
 *   what happens next    On no page in the design. Mine, on all ten.
 *   a real upload on the review-proof page   The design's button is dead.
 *   waiting on a person after a screenshot   The design has no such state.
 */
export const EVERY_PAGE_HAS_A_DESIGN = JOURNEY.every(
  (s) => typeof s.from === 'string' && s.from !== '',
);
export const WHAT_I_ADDED = JOURNEY.filter((s) => s.iAdded).map((s) => ({
  key: s.key,
  added: s.iAdded,
}));

const byKey = new Map(JOURNEY.map((s) => [s.key, s]));

/** One page by name, or null. */
export function page(key) {
  return byKey.get(key) || null;
}

/** Which page is this, counting from one? Zero when the name is not one of ours. */
export function stepNumber(key) {
  return JOURNEY_KEYS.indexOf(key) + 1;
}

/**
 * The blockers that mean "we could not read your order, so send us a picture".
 *
 * The same names ui/stages.js already explains to somebody whose task is stuck,
 * so the two screens cannot end up disagreeing about when a screenshot is needed.
 * Anything else is not a screenshot problem and must not put a screenshot page in
 * front of somebody who has nothing to send.
 */
export const NEEDS_A_PICTURE = ['order_unreadable', 'no_delivery_date'];

/** Does this task need a screenshot of the order? */
export function needsAPicture(task) {
  const t = task && typeof task === 'object' ? task : {};
  return NEEDS_A_PICTURE.includes(t.blocker);
}

/**
 * WHICH PAGE IS THIS PERSON ON?
 *
 * Worked out from the SERVER'S record of the task and nothing on the device. That
 * is the whole reason coming back from the shop cannot land somebody at the
 * beginning: there is no local pointer to lose, so the page is re-derived from
 * what is true every single time the screen is looked at.
 *
 * A campaign with no task at all is somebody who has not joined yet.
 */
export function journeyStepFor(state) {
  const s = state && typeof state === 'object' ? state : {};
  const task = s.task && typeof s.task === 'object' ? s.task : null;
  if (!task) return 'join';

  const st = task.state || STATES.CLAIMED;

  if (st === STATES.REFUNDED) return 'refund';
  if (st === STATES.HOLDING) return 'window';
  if (st === STATES.REVIEWED) return 'review-shot';
  if (st === STATES.DELIVERED) return 'review';

  if (st === STATES.PURCHASED || task.order) {
    // Bought and read. The screenshot step is only in the way when the shop
    // could not be read for us — otherwise there is nothing to send.
    // Whether a picture is needed is the SERVER's word, read off the task's own
    // blocker, and it can be overridden by the caller only for a test.
    const needs =
      s.needsPurchaseShot === true ||
      (s.needsPurchaseShot !== false && needsAPicture(task));
    if (needs) {
      return s.purchaseShotSent === true ? 'checking' : 'purchase-shot';
    }
    return 'delivered';
  }

  // Joined, nothing bought yet. Connecting comes first, and only once.
  if (s.connected !== true) return 'connect';
  return 'buy';
}

/**
 * THE WHOLE PAGE, AS DATA.
 *
 * Everything the screen draws comes out of here, which is what makes the render
 * check possible: it runs this over every realistic state and looks for anything
 * missing reaching what would be drawn.
 */
export function journeyView(state) {
  const s = state && typeof state === 'object' ? state : {};
  const key = journeyStepFor(s);
  const current = page(key) || JOURNEY[0];
  const n = stepNumber(key) || 1;

  const busy = s.busy === true;
  const check = s.check && typeof s.check === 'object' ? s.check : null;

  return {
    key,
    title: current.title,
    body: current.body,
    /** Where somebody is, said out loud as well as drawn. The design's wording. */
    where: `Step ${n} of ${OF}`,
    /** What happens after this page. Mine: the design does not have one per page. */
    next: current.next,
    stepNumber: n,
    of: OF,
    /** One segment per page: done, here, or still to come. */
    track: JOURNEY.map((s2, i) => ({
      key: s2.key,
      short: s2.short,
      state: i + 1 < n ? 'done' : i + 1 === n ? 'here' : 'todo',
    })),
    /** The tracker's label for this page, in the design's own short words. */
    short: current.short,
    /** True when nothing at all is needed from the person on this page. */
    waiting: current.waiting === true,
    action:
      current.act && !current.waiting
        ? { label: current.act, busy, enabled: !busy }
        : null,
    /** What the reading of a screenshot found, when there is a reading to show. */
    check,
    error: typeof s.error === 'string' && s.error ? s.error : null,
    /** The product, when we know it. Never the word "undefined" on a screen. */
    product: typeof s.productName === 'string' && s.productName ? s.productName : null,
    shopName: typeof s.shopName === 'string' && s.shopName ? s.shopName : null,
  };
}

/**
 * What to say about a screenshot while it is being read, and afterwards.
 *
 * The words are the same set the existing screenshot screen already uses, so the
 * two cannot disagree about what a status means; what this adds is a plain line
 * about who decides. NOTHING here ever says a screenshot was accepted on its
 * own: a person at Fayr approves, always, and a screen that implied otherwise
 * would be promising something the product does not do.
 */
export function checkLine(status) {
  switch (status) {
    case 'UPLOADED':
      return 'Sent. We will start reading it in a moment.';
    case 'EXTRACTING':
      return 'Reading your screenshot now.';
    case 'EXTRACTED':
      return 'Read. A person at Fayr is checking it against the offer.';
    case 'APPROVED':
      return 'Checked and accepted by a person at Fayr.';
    case 'REJECTED':
      return 'A person at Fayr could not accept this one.';
    case 'NEEDS_MORE':
      return 'A person at Fayr needs another picture.';
    case 'FAILED':
      return 'We could not read that picture. Please choose another.';
    default:
      return 'Waiting.';
  }
}
