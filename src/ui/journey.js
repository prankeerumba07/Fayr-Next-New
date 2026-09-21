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
import { theWatchedOrderKey } from '../order/whichRead.js';

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
// THE JOIN STEP IS GONE, AND SO IS THE SCREEN.
//
// The owner took "Confirm participation" out of the path on 2 September 2026. The
// claim now happens on the product page itself, where the terms tick box is, so a
// separate page asking somebody to confirm the thing they just confirmed was one
// tap for no new information.
//
// AND THEN HE ASKED FOR IT TO BE DELETED, because taking it off the path twice
// and leaving the file in place was not what he had asked for: "WHEN HE SAYS
// REMOVE, YOU DELETE. Not hide, not mark, not leave off a path. Delete the file,
// the key and the route. This replaces the earlier rule in this project that no
// design screen is ever deleted. That rule is withdrawn." So src/screens/confirm.js
// is gone, its key is out of the registry and its route is out of App.js. The
// removal is recorded by name in src/screens/keys.js, which still knows the design
// has sixty one screens and now says the app has sixty.
//
// WHAT THAT PAGE WAS CARRYING DID NOT VANISH. It showed the ticket cost, the
// tickets left afterwards, the refund, and the claim deadline. The first three
// moved to the product page, in the block directly above the tick box. The
// deadline moved to the slot reserved moment, the connect page and the before you
// go page. There is a test for each of the four.
export const JOURNEY = [
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
    key: 'returncatch',
    designKey: 'returncatch',
    from: 'ReturnCatch',
    short: 'Did you buy it?',
    next: 'You will show us the order, so we can check it against the offer.',
  },
  // ── THE SHOP INSIDE FAYR — ADDED 18 SEPTEMBER 2026, PHASE 7 ──────────────
  //
  // FOR THE THREE QUICK-COMMERCE SHOPS THIS STEP REPLACES THE THREE ABOVE IT.
  // The owner's flow, in his own words: "card -> the product detail page ->
  // accept terms -> CLAIM -> STRAIGHT to the shop's own LOGIN page, inside Fayr.
  // No screen between." Connecting, "before you go" and "did you buy it" all
  // existed because the person LEFT the app to buy. Inside Fayr they do not, so
  // asking them to confirm what Fayr watched them do is not caution — his word
  // for it was "an insult and a place to drop out".
  //
  // ITS SCREEN IS A DOOR, NOT A PAGE. src/screens/shop.js draws almost nothing:
  // it records the consent our side needs and hands over to the Shop route, the
  // web view of the shop's own site with Fayr's bar across the top. The design's
  // frame for this is the one the owner read the flow off — 74:60107.
  //
  // THE FOUR OTHER SHOPS NEVER REACH IT. journeyStepFor only answers 'shop' for
  // a shop in SHOPS_INSIDE_FAYR, and Amazon, Flipkart, Meesho and Myntra still
  // walk connect -> buy -> returncatch exactly as they did.
  {
    key: 'shop',
    designKey: 'shop',
    from: 'ShopScreen (the shop inside Fayr, Figma 74:60107)',
    short: 'Buy inside Fayr',
    next: 'When you have bought it, Fayr reads the order off your own account by itself.',
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

/** How many pages there are. The design's tracker counts seven; this counts twelve. */
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
 *
 * TWO FACTS ARRIVED WITH PHASE 7, both about a shop that is shopped inside Fayr:
 *   inFayrShop          the campaign's shop is in SHOPS_INSIDE_FAYR. The router
 *                       answers it from the campaign; this function never reads
 *                       a shop list itself, so it stays a function of its
 *                       arguments.
 *   lookedForTheOrder   a read of the shop's orders has run for this claim, in
 *                       Fayr's own doing. A note on the phone, like the others.
 *
 * AND ONE MORE WITH PHASE 8A, read off the RECORD and not handed in: the key of
 * the order Fayr watched being placed, `task.watchedOrderKey`. It is our side's
 * own column, so a reinstall or a second phone derives the same step.
 */
export function journeyStepFor(state) {
  const s = state && typeof state === 'object' ? state : {};
  const task = s.task && typeof s.task === 'object' ? s.task : null;
  // NO RECORD AT ALL lands on the first step, which is connecting the shop.
  // It used to land on 'join', the confirmation page, because the claim happened
  // there. The claim happens on the product page now, so by the time anybody is
  // inside the journey there is a task; if there somehow is not, the first thing
  // to do is still the first step.
  if (!task) return JOURNEY[0].key;

  const st = task.state || STATES.CLAIMED;

  if (st === STATES.REFUNDED) return 'refund';
  if (st === STATES.HOLDING) return 'window';

  // ── THE ORDER FAYR WATCHED, AND THE FOUR STEPS IT NEVER WALKS — PHASE 8A ──
  //
  // 19 September 2026. When the record carries the key of an order Fayr watched
  // being placed inside its own view, the read opens THAT order's own page and
  // the server's match on it is the confirm. The owner's decision, in his
  // words: "the phone watched THIS order be placed from THIS claim; the
  // server's match on the watched page is the confirm." So purchase-shot,
  // checking, order-details and review-shot do not appear for such a claim —
  // each of them asks a person for a picture or a word about a page Fayr read
  // itself. Without a key — Amazon, Flipkart, Meesho, Myntra, and a listed shop
  // whose confirmation page carried none — every one of those steps stays
  // exactly as it was.
  const watched = s.inFayrShop === true && theWatchedOrderKey(task) != null;

  // REVIEWED on a watched order is the return window, not a photograph of a
  // review that exists only inside Fayr. The rated signal was read off the
  // order's own page by the server.
  if (st === STATES.REVIEWED) return watched ? 'window' : 'review-shot';
  // ── DELIVERED, BUT HAVE THEY BEEN ASKED? ─────────────────────────────────
  //
  // The record can know a parcel arrived before the person has said a word about
  // it. That is the ordinary case now, not a corner: an order whose return window
  // has already closed is delivered the moment its page is read, so the delivery
  // is on the record before anybody reaches this step, and the step was stepped
  // straight over — order confirmed, and the next thing seen was the arrival.
  //
  // The owner's step seven is a QUESTION — "Is the product delivered? Yes / Not
  // yet" — and a question that is only asked when the answer is unknown is a
  // question most people never see.
  //
  // SO THE ANSWER IS WAITED FOR, AND IT SETTLES NOTHING. The note is on the
  // phone, it is written by the tap, and the delivery on the record is untouched
  // either way: "not yet" does not un-deliver a parcel the shop has said arrived,
  // it just leaves them here. See SAID_IT_ARRIVED in journey/shopVisits.js.
  if (st === STATES.DELIVERED) {
    // ── INSIDE FAYR THERE IS NO QUESTION TO WAIT FOR — 18 SEPTEMBER 2026 ──
    //
    // The delivery was read off the shop's own page by a read Fayr ran itself,
    // for a purchase Fayr watched happen. The owner: "delivery fetches itself.
    // No screen, no tap ... the review step appears by itself." So a listed shop
    // goes straight to the review, and the question below is for the four shops
    // whose person left the app to buy.
    if (s.inFayrShop === true) return 'review';
    return s.saidItArrived === true ? 'review' : 'delivered';
  }

  if (st === STATES.PURCHASED || task.order) {
    // THE WATCHED ORDER SKIPS THE PICTURE AND THE QUESTION. The server matched
    // it on its own page and confirmed it itself, and a page it could not read
    // is read again on the next look of that same page, never photographed.
    if (watched) return 'delivered';
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

  // JOINED, AND THE SHOP HAS TOLD US NOTHING YET.
  //
  // Everything above this line is the server's word. Everything below it is the few
  // steps that happen entirely on the phone, before there is any record to read —
  // so the notes in journey/shopVisits.js can only ever move somebody between these
  // four, and never past the point where money is decided.
  //
  // ── A SHOP INSIDE FAYR SKIPS ALL FOUR OF THESE — 18 SEPTEMBER 2026 ─────
  //
  // No connect step: the sign in happens in the shop view itself (6A). No
  // "before you go": the consent is recorded by the claim. No "did you buy
  // it": the read runs by itself. What is left to decide is one thing — has a
  // read RUN for this claim yet? If not, the next thing is the shop. If one
  // has, and the record still shows no order, the read failed or found nothing,
  // and the only honest offer left is the screenshot fallback the owner named
  // himself. "We have not looked yet" is not a failure, and lookedForTheOrder
  // is what tells the two apart — see LOOKED_FOR_THE_ORDER in shopVisits.js.
  if (s.inFayrShop === true) {
    // A WATCHED ORDER IS THE SHOP STEP'S SECOND FACE, and never the screenshot:
    // the read of that one page runs by itself and looks again on the cadence.
    // See src/journey/shopStep.js for which face, and for why it is a face of
    // the Buy step rather than a step of its own.
    if (watched) return 'shop';
    // ── AND A READ THAT FOUND NOTHING ASKS, IT DOES NOT ASK FOR A CAMERA ──
    //
    // 21 September 2026. The owner: "there might be some cases ... it could not
    // complete the payment due to bank servers or any other things. When they
    // come back to Fayr ... it should show the screen: 'We cannot see you have
    // placed a product. Have you completed a purchase?' ... This is not only for
    // Zepto. This is for all the marketplaces."
    //
    // THE CARD HE DESCRIBED ALREADY EXISTS and four shops already land on it —
    // src/screens/returncatch.js, reached from `wentToBuy` below. A shop inside
    // Fayr was the only kind that never got there: this line sent it straight to
    // the photograph instead, so somebody whose payment failed was asked to
    // photograph an order that does not exist.
    //
    // THE PHOTOGRAPH IS NOT LOST, IT WAS ALREADY NOT OFFERED HERE. src/screens/
    // delivery.js keeps the camera door shut for these shops for the reason
    // written there — a picture is the same question asked of a camera, and the
    // watched order's own page is the only evidence there is. This makes the buy
    // step agree with the delivery step rather than contradicting it.
    //
    // AND THE TAP STILL SETTLES NOTHING. returncatch's YES writes one
    // device-local note and opens the same read this step already runs; the
    // record's order still comes only from the server reading the shop's pages.
    return s.lookedForTheOrder === true ? 'returncatch' : 'shop';
  }
  // Connecting comes first, and only once.
  if (s.connected !== true) return 'connect';
  // They came back from the shop and told us they bought it. We cannot see the
  // order yet, so the next thing is to show us one.
  if (s.saidTheyBought === true) return 'purchase-shot';
  // They were sent to the shop to buy and they are back. Asking is the design's own
  // screen for exactly this, and it is better than showing "before you go" to
  // somebody who has already been.
  if (s.wentToBuy === true) return 'returncatch';
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
