// THE CLAIM JOURNEY, AS TEN STEPS — AND NOTHING ABOUT HOW A STEP LOOKS.
//
// This file answers exactly two questions and no others:
//
//   WHICH step of the claim is this person on?   journeyStepFor(record)
//   WHERE is that in the whole journey?          journeyView(record)
//
// It used to answer a third — what each page says — and that is now wrong. Every
// one of the ten steps is a screen the design already drew, and as of the split
// on 1 September 2026 each of those has its own file under src/screens/, named by
// the design's own key, holding the design's own words and layout. Each step below
// therefore names the design key it maps to, and says nothing about what is drawn.
//
// PURE. No React, no fetch, no clock unless it is handed in — so every "which
// step am I on" decision can be checked under node. Same reason as ui/stages.js
// and ui/chat.js.
//
// TWO THINGS HERE ARE OURS AND NOT THE DESIGN'S, and they are the reason this
// file still has words in it at all:
//
//   the step counter    The design's own tracker counts seven. This journey has
//     ten steps, so the total is ours. No journey screen in the design tells
//     anybody where they are.
//   what happens next   One line per step, on no design screen. It belongs to
//     the journey machine rather than to any one screen: it is a statement about
//     what FOLLOWS this step, which only something that knows the order can make.
//
// Both are drawn once, by the strip the router puts above a design screen while
// somebody is inside a claim. Opened on its own, a design screen has neither and
// is exactly what the design draws.

import { STATES } from '../taskflow.js'; // explicit extension: also run under node

/**
 * The ten steps, in order.
 *
 *   key        the step's name, used by journeyStepFor and by nothing on a screen
 *   designKey  the design's own key for the screen that draws this step. The
 *              screen lives at src/screens/<designKey>.js and owns every word on
 *              it. This is the whole link between the machine and the drawing.
 *   from       the design's own component name, so the design file can be found
 *   short      the tracker's own label. Seven of these are the design's STEPS7
 *              (fayr-design.browser.jsx:482) - its own canonical journey copy,
 *              which was written and then never put on a screen.
 *   next       what happens after this step. Ours, not the design's.
 *   waiting    true when nothing is needed from the person on this step
 *   iAdded     true when the design has no screen for this step and the nearest
 *              one is used instead, with what was added spelt out.
 *
 * THERE ARE NO TITLES, BODIES OR BUTTON LABELS HERE ANY MORE. They moved to the
 * eleven screens on 1 September 2026. A heading in this file and a heading on the
 * screen would be two copies of one sentence, and they would drift.
 */
export const JOURNEY = [
  {
    key: 'join',
    designKey: 'confirm',
    from: 'ConfirmJoin',
    short: 'Join the offer',
    next: 'You will connect your shop account, so we can see your order.',
  },
  {
    key: 'connect',
    designKey: 'linkaccount',
    from: 'LinkAccount',
    short: 'Connect your shop',
    next: 'You will buy the product on the shop, then come back here.',
  },
  {
    key: 'buy',
    designKey: 'buyinterstitial',
    from: 'BuyInterstitial',
    short: 'Buy the exact product',
    next: 'When it arrives, come back and tell us it was delivered.',
  },
  {
    key: 'purchase-shot',
    designKey: 'proofprimer',
    from: 'ProofPrimer',
    short: 'Upload order proof',
    next: 'We will read it and check it against the offer.',
  },
  {
    key: 'checking',
    designKey: 'underreview',
    from: 'UnderReview',
    iAdded:
      'the design goes straight from here to a green "refund tracked" '
      + 'celebration. It has no state for waiting on a person, and the product '
      + 'never accepts a screenshot without one.',
    short: 'We check your proof',
    next: 'Once your order is read, you confirm the details are yours.',
    waiting: true,
  },
  {
    key: 'order-details',
    designKey: 'ocrconfirm',
    from: 'OcrConfirm',
    short: 'Confirm your order',
    next: 'We wait for the shop to tell us it was delivered.',
  },
  {
    key: 'delivered',
    designKey: 'delivery',
    from: 'DeliveryConfirm',
    short: 'Confirm it arrived',
    next: 'You will write your review, and it can say anything you like.',
  },
  {
    key: 'review',
    designKey: 'reviewguide',
    from: 'ReviewGuide',
    short: 'Use it & review honestly',
    next: 'You will send us a picture of your review once it is live.',
  },
  {
    key: 'review-shot',
    designKey: 'reviewproof',
    from: 'ReviewProof',
    iAdded:
      'the design has an "upload a screenshot instead" button with nothing '
      + 'behind it. This one really opens the photos.',
    short: 'Submit review proof',
    next: 'We wait for the shop’s return window to close.',
  },
  {
    key: 'window',
    designKey: 'returnwindow',
    from: 'ReturnWindow',
    short: 'Return window closes',
    next: 'Your refund lands in your Fayr wallet.',
    waiting: true,
  },
  {
    key: 'refund',
    designKey: 'reward',
    from: 'Reward',
    short: 'Get paid',
    next: 'Nothing. This one is finished.',
  },
];

/** How many pages there are. The design's tracker counts seven; this counts ten. */
export const OF = JOURNEY.length;

/** Every page's name, for anything that needs the order and nothing else. */
export const JOURNEY_KEYS = JOURNEY.map((s) => s.key);

/**
 * WHAT THE DESIGN COVERS, AND WHAT WE ADDED, OUT LOUD.
 *
 * The design has a screen for every one of the ten steps, so no step's look is
 * invented, and since the split each step's screen IS the design's screen. What
 * the design does not have is four things across the whole journey rather than
 * four missing screens:
 *
 *   the step indicator   The design wrote its own journey copy - STEPS7, at
 *     line 482 - and then never put it on a screen. Seven of the short labels
 *     above are those words; the other three are ours, for the three steps
 *     STEPS7 does not count. No journey screen in the design tells anybody
 *     where they are.
 *   what happens next    On no screen in the design. Ours, on all ten.
 *   a real upload on the review-proof screen   The design's button is dead.
 *   waiting on a person after a screenshot   The design has no such state.
 */
export const EVERY_PAGE_HAS_A_DESIGN = JOURNEY.every(
  (s) => typeof s.from === 'string' && s.from !== ''
    && typeof s.designKey === 'string' && s.designKey !== '',
);
export const WHAT_I_ADDED = JOURNEY.filter((s) => s.iAdded).map((s) => ({
  key: s.key,
  added: s.iAdded,
}));

const byKey = new Map(JOURNEY.map((s) => [s.key, s]));

/** One step by name, or null. */
export function page(key) {
  return byKey.get(key) || null;
}

/**
 * The design key for one step, or null.
 *
 * This is the ONE place the journey machine and the eleven screens are joined.
 * The router looks the step up here and renders src/screens/<designKey>.js, so a
 * step cannot end up drawn by two screens and a screen cannot be reached by two
 * steps. src/screens/keys.test.mjs checks every key named here really exists.
 */
export function designKeyFor(stepKey) {
  const s = byKey.get(stepKey);
  return s ? s.designKey : null;
}

/** Every step's design key, in the journey's order. */
export const DESIGN_KEYS = JOURNEY.map((s) => s.designKey);

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
    // AN ORDER NOBODY HAS SAID IS THEIRS.
    //
    // The engine has a human gate here — CONFIRM_ORDER, "this is my order" —
    // and until the split there was no screen for it. The design has one, and
    // has had one all along: ocrconfirm, "are these order details correct?". It
    // was drawn, listed in the design's own map, and unreachable in the app,
    // and the tap that fired the event was on the DELIVERY screen instead,
    // where it was labelled as confirming a delivery. Two different facts under
    // one button. This step is that screen, in its own place.
    //
    // BOTH SHAPES ARE CHECKED, and that is not belt and braces. The server's own
    // record carries the flag inside the order (task.order.orderConfirmed); the
    // engine task the machine was written against carries it at the top. This
    // function is handed whichever one the caller has, so it has to read both, and
    // getting it wrong in either direction would either strand somebody on a screen
    // they have already finished with or skip the gate entirely.
    const confirmed =
      task.orderConfirmed === true ||
      (task.order && task.order.orderConfirmed === true);
    if (task.order && !confirmed) return 'order-details';
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
  // `forcedStep` exists for the walk through, which has to be able to look at a
  // step no real claim happens to be at. It is honoured ONLY when it names a real
  // step, so nothing can push a person onto a screen the record does not support,
  // and it lives here rather than in the router so that "where am I in the journey"
  // is answered in exactly one place. Unset, the record decides, as it must.
  const forced = typeof s.forcedStep === 'string' && byKey.has(s.forcedStep)
    ? s.forcedStep
    : null;
  const key = forced || journeyStepFor(s);
  const current = page(key) || JOURNEY[0];
  const n = stepNumber(key) || 1;

  const busy = s.busy === true;
  const check = s.check && typeof s.check === 'object' ? s.check : null;

  return {
    key,
    /** Which design screen draws this step. The router renders exactly this one. */
    designKey: current.designKey,
    /** Where somebody is, said out loud as well as drawn. */
    where: `Step ${n} of ${OF}`,
    /** What happens after this step. Ours: the design does not have one per screen. */
    next: current.next,
    stepNumber: n,
    of: OF,
    /** One segment per step: done, here, or still to come. */
    track: JOURNEY.map((s2, i) => ({
      key: s2.key,
      short: s2.short,
      state: i + 1 < n ? 'done' : i + 1 === n ? 'here' : 'todo',
    })),
    /** The tracker's label for this step, in the design's own short words. */
    short: current.short,
    /** True when nothing at all is needed from the person on this step. */
    waiting: current.waiting === true,
    /**
     * True while an action for this step is in flight, so the strip can say so
     * and the screen can refuse a second tap. There is no button LABEL here any
     * more: the screen owns its own words, and the design already wrote them.
     */
    busy,
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
