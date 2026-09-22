// THE REVIEW HALF OF THE JOURNEY, AS THE OWNER SPECIFIED IT.
//
// REVIEW-FLOW-PROMPT.md, written 17 September 2026 from the owner's own words,
// is twenty one numbered steps plus the refund wording. This file checks the
// rules those steps added, and every check below names the step it comes from.
//
// ── WHAT CAN AND CANNOT BE CHECKED HERE ───────────────────────────────────
//
// The DECIDING can: which face of the review step somebody is on, when the day
// after delivery is up, whether the arrival is worth celebrating and for how
// long. All of it is pure and all of it runs under node.
//
// The DRAWING cannot, because a React Native screen will not import here. What
// stands in for it is the same thing the rest of this project uses: the screen's
// own source is read off disk and held to the rule. That catches a screen that
// stopped naming its words or stopped asking the one helper that decides; it
// does not catch a screen that draws them badly.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  CELEBRATION_MS, LONGEST_CELEBRATION_MS, SHORTEST_CELEBRATION_MS,
  shouldCelebrateDelivery,
} from './arrived.js';
import {
  REVIEW_FACES, facePutsTheQuestion, faceSaysTheWait, reviewStepFace,
} from './reviewStep.js';
import * as reviewStep from './reviewStep.js';
import {
  EVERY_SENTENCE, HAVE_YOU_POSTED_THE_REVIEW, IS_THE_PRODUCT_DELIVERED,
  PRODUCT_DELIVERED, REFUND_CONFIRMED, REVIEW_CONFIRMATION_RECEIVED,
  REVIEW_LIVE_AND_WINDOW_CLOSED, THANK_YOU_FOR_CONFIRMING,
  USE_IT_AND_REVIEW_FAIRLY, WRITE_A_FAIR_REVIEW, addedToYourWallet,
  howLongAgoInWords, reviewsGoLiveIn, waitThenComeBack, youPostedItAgo,
} from '../ui/journeyWords.js';
import { shouldRefreshOnForeground } from '../foregroundRefresh.js';

const { ok, equal, deepEqual } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/**
 * THE NOTE NAMES, READ OFF DISK RATHER THAN IMPORTED.
 *
 * src/journey/shopVisits.js reaches expo-file-system, which will not load under
 * node, so this file cannot import it. The repo's own answer to that is a source
 * pin — the same one src/chargedAmount.test.mjs uses — and it is worth more than
 * an import would be here: what these checks are actually about is that the
 * WRITTEN name and the name the screen uses are the same string.
 */
const noteNamed = (constant) => {
  const m = new RegExp(`export const ${constant} = '([^']*)'`)
    .exec(read('src/journey/shopVisits.js'));
  return m ? m[1] : null;
};
const WENT_TO_REVIEW = noteNamed('WENT_TO_REVIEW');
const TOLD_ABOUT_THE_REVIEW_WAIT = noteNamed('TOLD_ABOUT_THE_REVIEW_WAIT');
const SAW_IT_ARRIVED = noteNamed('SAW_IT_ARRIVED');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const DELIVERY = read('src/screens/delivery.js');
const GUIDE = read('src/screens/reviewguide.js');
const ROUTER = read('src/journey/JourneyScreen.js');
const CONNECT = read('src/screens/linkaccount.js');
const BUY = read('src/screens/buyinterstitial.js');
const TASKSCREEN = read('src/TaskScreen.js');

const AN_ARRIVAL = 1758000000000;
const A_DAY = 24 * 60 * 60 * 1000;

console.log('\nstep 2: connecting the shop opens the next screen by itself');

it('THE AUTOMATIC PATH ASKS THE JOURNEY TO LOOK AGAIN, WITH NO TAP', () => {
  // Step two, in the owner's words: "When it is connected, the next screen
  // appears by itself — no tap."
  //
  // IT DID NOT. The effect that runs when Fayr's own gate says it saw the sign
  // in wrote the note and set this screen's two words, and stopped. The router
  // decides which screen is drawn and was never asked to look again, so the
  // person sat on a screen that now said they were connected, with a button on
  // it, and the button was the only way forward.
  const code = withoutComments(CONNECT);
  const seen = code.indexOf('if (params.justSignedIn !== true) return;');
  ok(seen > -1, 'the screen no longer notices that Fayr saw the sign in');
  const rest = code.slice(seen, seen + 400);
  ok(/params\.onJourneyMoved\(\)/.test(rest),
    'seeing the sign in must ask the journey to look again, or nothing moves');
});

console.log('\nstep 5: coming back from the shop, the app already knows');

it('A FIRST RETURN ALWAYS ASKS OUR SIDE WHAT CHANGED', () => {
  // "even after ten seconds, even without force quitting". The first return has
  // never asked, and "we have never asked" is not "we asked at time zero".
  ok(shouldRefreshOnForeground({
    nextState: 'active', signedIn: true, lastAt: null, now: AN_ARRIVAL,
  }));
});

it('and a return ten seconds later asks again', () => {
  // Ten seconds is the throttle, and the owner's own example of a short trip.
  ok(shouldRefreshOnForeground({
    nextState: 'active', signedIn: true, lastAt: AN_ARRIVAL, now: AN_ARRIVAL + 10000,
  }));
});

it('THE QUESTION IS DRAWN OFF THE RECORD, so no refresh is even needed', () => {
  // The record carries wentToShopAt the moment they tap Buy — our side is told
  // BEFORE the shop opens — so the question is already on screen when they come
  // back, whatever the clock says about refreshing.
  const code = withoutComments(BUY);
  ok(/const hasGone = !!\(authoritative && authoritative\.wentToShopAt != null\);/
    .test(code), 'the buy screen must read the visit off the record');
  ok(/HAVE_YOU_BOUGHT_IT/.test(code) && !/Have you purchased the product/.test(code),
    'the question must be named rather than written');
});

console.log('\nstep 7 and 8: the delivery step');

it('THE SENTENCE AFTER CONFIRMING, AND THE QUESTION, ARE BOTH NAMED', () => {
  const code = withoutComments(DELIVERY);
  for (const name of [
    'THANK_YOU_FOR_CONFIRMING', 'USE_IT_AND_REVIEW_FAIRLY',
    'IS_THE_PRODUCT_DELIVERED',
  ]) {
    ok(code.includes(name), `the delivery screen does not name ${name}`);
  }
  for (const sentence of [
    THANK_YOU_FOR_CONFIRMING, USE_IT_AND_REVIEW_FAIRLY, IS_THE_PRODUCT_DELIVERED,
  ]) {
    ok(!code.includes(sentence),
      `the delivery screen holds its own copy of "${sentence}"`);
    ok(EVERY_SENTENCE.includes(sentence),
      `"${sentence}" is not in the walked list of what a person reads`);
  }
});

console.log('\nstep 10: the arrival is worth three and a half seconds');

it('IT LASTS THREE TO FOUR SECONDS, WHICH IS WHAT WAS ASKED FOR', () => {
  // "for 3 to 4 seconds". He first wrote thirty four and corrected it the same
  // evening; the correction is in the file this came from.
  //
  // NOT AT EITHER END OF THE RANGE. A number written at an edge is one rounding
  // away from being outside it.
  ok(CELEBRATION_MS > SHORTEST_CELEBRATION_MS, 'it is not three seconds exactly');
  ok(CELEBRATION_MS < LONGEST_CELEBRATION_MS, 'it is not four seconds exactly');
  equal(SHORTEST_CELEBRATION_MS, 3000);
  equal(LONGEST_CELEBRATION_MS, 4000);
});

it('and it is shown at the review step, once a delivery is on the record', () => {
  ok(shouldCelebrateDelivery({
    stepKey: 'review', deliveredAt: AN_ARRIVAL, alreadySeen: false,
  }));
});

it('NEVER TWICE FOR ONE CLAIM', () => {
  ok(!shouldCelebrateDelivery({
    stepKey: 'review', deliveredAt: AN_ARRIVAL, alreadySeen: true,
  }));
});

it('and NEVER on a step that is not the review step', () => {
  for (const step of ['connect', 'buy', 'delivered', 'review-shot', 'window', 'refund']) {
    ok(!shouldCelebrateDelivery({
      stepKey: step, deliveredAt: AN_ARRIVAL, alreadySeen: false,
    }), `${step} celebrates an arrival`);
  }
});

it('AND NEVER WITH NO ARRIVAL ON THE RECORD', () => {
  // The review step is also where somebody sits for the whole day it is shut
  // for, and for as long as they take to write the review. A celebration fired
  // by a step rather than by an event would fire on every one of those.
  for (const at of [null, undefined, 'yesterday', NaN]) {
    ok(!shouldCelebrateDelivery({ stepKey: 'review', deliveredAt: at }),
      `an arrival of ${String(at)} is celebrated`);
  }
});

it('the router draws it over the step, and marks it seen when it ENDS', () => {
  const code = withoutComments(ROUTER);
  ok(/shouldCelebrateDelivery\(\{/.test(code), 'the router must ask, not decide');
  ok(/<ArrivedMoment/.test(code), 'and draw it');
  // WRITTEN WHEN IT ENDS, not when it starts: a phone put down mid-celebration
  // would otherwise never show it at all.
  const at = code.indexOf('markVisitedShop(campaignId, SAW_IT_ARRIVED)');
  const inOnDone = code.indexOf('onDone={');
  ok(at > -1 && inOnDone > -1 && at > inOnDone,
    'the note must be written when the celebration ends');
  equal(SAW_IT_ARRIVED, 'sawarrived');
});

console.log('\nstep 12 WAS a 24 hour lock, and the owner took it out on 18 September 2026');

// ── THE RULE THAT REPLACED IT ───────────────────────────────────────────────
//
// His words: "I don't want the review step to get locked for 24 hours after
// delivery. A user can provide a review whenever they want to, and for
// marketplaces like quick marketplaces like ZEPTO, Blinkit and Instamart, they
// can actually use it and give the review anytime they want. This 24-hour lock,
// I don't want in my app."
//
// EVERY SHOP, not only the three. Zepto is what made it obviously wrong — a ten
// minute delivery behind a day-long wait — but the rule he stated is general.
//
// THE CHECKS BELOW REPLACE FOUR THAT WENT WITH IT: that the wait was twenty four
// hours, that it was still shut a millisecond before, that it opened on the
// instant, and that the screen re-armed a timer to open itself. None of those
// describe anything that exists.

it('A TASK DELIVERED ONE SECOND AGO REACHES THE REVIEW STEP', () => {
  // THE CHECK THE PHASE ASKED FOR. A ten minute Zepto delivery is the case this
  // is really about: the parcel is in somebody's hand and the step they came for
  // is in front of them.
  equal(reviewStepFace({ wentToReview: false }), 'guide');
  equal(reviewStepFace({ wentToReview: true }), 'asking');
  // AND NO COMBINATION OF FACTS PRODUCES A LOCK, because there is nothing left
  // that could. Walked rather than asserted.
  for (const wentToReview of [true, false]) {
    for (const told of [true, false]) {
      for (const justAskedYes of [true, false]) {
        for (const lookJustRan of [true, false]) {
          const face = reviewStepFace({ wentToReview, told, justAskedYes, lookJustRan });
          ok(REVIEW_FACES.includes(face), `${face} is one of the five`);
          ok(face !== 'locked', 'and never a lock, whatever has happened');
        }
      }
    }
  }
});

it('A TASK WITH NO DELIVERY INSTANT IS NOT REFUSED THE STEP', () => {
  // "We don't know when it arrived" can never be a reason to refuse somebody the
  // step they came for. It cannot be one now because there is nothing here for a
  // delivery instant to be missing FROM — the face is decided without one.
  equal(reviewStepFace({ deliveredAt: null, wentToReview: false }), 'guide');
  equal(reviewStepFace({ deliveredAt: undefined, wentToReview: true }), 'asking');
  equal(reviewStepFace({}), 'guide');
  equal(reviewStepFace(), 'guide');
  // AND A DELIVERY INSTANT HANDED IN ANYWAY CHANGES NOTHING, which is the
  // stronger statement: the argument is not merely tolerated, it is inert.
  for (const at of [null, undefined, 0, AN_ARRIVAL, AN_ARRIVAL + A_DAY, NaN, 'yesterday']) {
    equal(reviewStepFace({ deliveredAt: at, now: AN_ARRIVAL, wentToReview: true }), 'asking',
      `a deliveredAt of ${String(at)} decides nothing`);
  }
});

it('NOTHING STILL IMPORTS reviewLock OR REVIEW_OPENS_AFTER_MS', () => {
  // GONE, NOT SET TO ZERO. A waiting period of nought is still a waiting period:
  // it keeps a clock, a face nobody can reach, and a number somebody will one
  // day put back.
  equal(reviewStep.reviewLock, undefined, 'reviewLock is not exported');
  equal(reviewStep.REVIEW_OPENS_AFTER_MS, undefined, 'and neither is the wait');
  ok(!Object.keys(reviewStep).includes('reviewLock'), 'it is not exported under any shape');

  // AND NO FILE IN THE APP REACHES FOR EITHER, read off the code and not the prose.
  for (const file of ['src/journey/reviewStep.js', 'src/screens/reviewguide.js',
    'src/ui/journeyWords.js', 'src/ui/journey.js', 'src/journey/JourneyScreen.js']) {
    const code = withoutComments(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
    for (const gone of ['reviewLock', 'REVIEW_OPENS_AFTER_MS', 'ASK_AGAIN_AT_MOST_EVERY_MS']) {
      ok(!code.includes(gone), `${file} still names ${gone}`);
    }
  }
  // AND THE WAITING PERIOD IS NOT HIDING AS A ZERO ANYWHERE.
  const step = withoutComments(readFileSync(new URL('./reviewStep.js', import.meta.url), 'utf8'));
  ok(!/24 \* 60 \* 60 \* 1000/.test(step), 'there is no day-long span left in the file');
  ok(!/deliveredAt|Date\.now\(\)/.test(step), 'and no clock and no delivery instant at all');
});

it('THE SCREEN KEEPS NO CLOCK, because there is nothing to wait for', () => {
  const code = withoutComments(GUIDE);
  ok(!/setTimeout|setInterval/.test(code), 'there is no timer at all');
  ok(!/deliveredInstant/.test(code), 'nor the delivery instant it used to measure from');
  // THE ONE CLOCK READ LEFT IS NOT A WAIT. It is "you posted it two hours ago",
  // which is a span since something that already happened rather than a span
  // until something is allowed — and it is measured from wentToReviewAt, never
  // from a delivery.
  const clocks = [...code.matchAll(/Date\.now\(\)/g)];
  equal(clocks.length, 1, 'the screen reads the clock once and no more');
  ok(/howLongAgoInWords\(Date\.now\(\) - went\)/.test(code),
    'and that once is how long ago they posted it, not how long until anything');
});

it('AND THE SHOP\u2019S OWN 48 TO 72 HOURS IS UNTOUCHED, because it is not ours', () => {
  // It is a fact about the SHOP publishing a review, not a rule of Fayr's, and
  // the phase says so in as many words.
  equal(reviewsGoLiveIn('Zepto'),
    'Zepto reviews go live 48 to 72 hours after they are submitted.');
  ok(EVERY_SENTENCE.includes(waitThenComeBack('Amazon')),
    'and the sentence that carries it is still in the app\u2019s own words');
  ok(faceSaysTheWait('notice') && faceSaysTheWait('notice-again'));
});

console.log('\nsteps 15 to 21: the five faces of the review step');

const facesFor = (over) => reviewStepFace({ ...over });

it('step 13: before they go, it is the guide', () => {
  equal(facesFor({ wentToReview: false }), 'guide');
});

it('step 15: they went and came back, so it asks', () => {
  equal(facesFor({ wentToReview: true }), 'asking');
});

it('step 16: on Yes it says how long the shop takes, and does NOT claim failure', () => {
  equal(facesFor({ wentToReview: true, told: true, justAskedYes: true }), 'notice');
  ok(faceSaysTheWait('notice'));
  ok(!facePutsTheQuestion('notice'));
});

it('step 17: a look came back empty, so it says the same thing knowing more', () => {
  equal(facesFor({ wentToReview: true, told: true, lookJustRan: true }), 'notice-again');
  ok(faceSaysTheWait('notice-again'));
});

it('step 19 and 20: LATER VISITS MUST NOT REPEAT THE FIRST-TIME MESSAGE', () => {
  // The owner's own words: "the screen must NOT repeat the first-time message.
  // It knows they have already been told and already tried."
  equal(facesFor({ wentToReview: true, told: true }), 'asking-again');
  ok(facePutsTheQuestion('asking-again'));
  ok(!faceSaysTheWait('asking-again'));
});

it('and "just said yes" beats "a look just ran", because it is more recent', () => {
  equal(facesFor({
    wentToReview: true, told: true, justAskedYes: true, lookJustRan: true,
  }), 'notice');
});

it('there are five faces; four are named on the screen and the fifth is the rest', () => {
  // THE GUIDE IS THE FALL-THROUGH, and saying so is more honest than making the
  // screen name it. Four faces are special cases of the review step and each one
  // returns early; what is left is the guide the screen has always been. A
  // `return null` for an unrecognised face would draw a blank screen, which is
  // worse than drawing the guide.
  //
  // SIX UNTIL 18 SEPTEMBER 2026. 'locked' went with the waiting period.
  equal(REVIEW_FACES.length, 5);
  ok(!REVIEW_FACES.includes('locked'), 'and the lock is not one of them');
  const code = withoutComments(GUIDE);
  // READ OFF THE BRANCHES THEMSELVES, not off the file containing the word.
  // Caught by breaking it: one face was dropped from the branch that draws it,
  // and the check went on passing because the same word still appeared further
  // down, inside that branch, deciding a line within it.
  const branches = [...code.matchAll(/^\s*if \(face === '([a-z-]+)'(?: \|\| face === '([a-z-]+)')?\)/gm)]
    .flatMap((m) => [m[1], m[2]])
    .filter(Boolean);
  deepEqual(branches.sort(),
    ['asking', 'asking-again', 'notice', 'notice-again']);
  ok(!branches.includes('guide'), 'the guide must be what is left, not a sixth branch');
});

it('THE SCREEN ASKS THE HELPER AND DOES NOT DECIDE FOR ITSELF', () => {
  const code = withoutComments(GUIDE);
  ok(/reviewStepFace\(\{/.test(code), 'the screen must ask which face this is');
  // AND IT ASKS NOTHING ELSE. The second helper it used to ask — reviewLock —
  // no longer exists; this is what stops the screen growing its own answer in
  // the space where a call used to be.
  ok(!/const face = [^;]*\?/.test(code), 'and the face is not decided on this screen');
});

console.log('\nsteps 14 and 17: our own side knows they went, and when');

it('THE VISIT IS RECORDED ON THE RECORD, not only on the phone', () => {
  // Step fourteen: "the backend must know they left for the review — the same
  // way the shop visit for buying is recorded. It belongs on the record, not
  // only on the phone."
  const code = withoutComments(GUIDE);
  ok(/goingToTheReview\(taskId\)/.test(code),
    'the review step must tell our own side that they left');
  const api = withoutComments(read('src/backend/tasksApi.js'));
  ok(/\/going-to-the-review/.test(api), 'and there must be a route to tell');
  const schema = read('backend/prisma/schema.prisma');
  ok(/wentToReviewAt\s+DateTime\?/.test(schema), 'and a column to keep it in');
});

it('and the note on the phone is written too, so the screen moves at once', () => {
  // Our side can be a moment behind, and somebody who has plainly just come back
  // from the shop must not be shown the screen that sends them there again.
  const code = withoutComments(GUIDE);
  ok(/markVisitedShop\(campaignId, WENT_TO_REVIEW\)/.test(code));
  equal(WENT_TO_REVIEW, 'review');
  equal(TOLD_ABOUT_THE_REVIEW_WAIT, 'reviewwait');
});

it('THE TIME IT SAYS BACK IS THE RECORD’S, never a clock on the phone', () => {
  // Step seventeen names what it knows: "they posted it at such a time". The
  // only instant anybody but the shop can vouch for is the one our side wrote.
  const code = withoutComments(GUIDE);
  ok(/youPostedItAgo\(howLongAgoInWords\(Date\.now\(\) - went\)\)/.test(code),
    'the sentence must be built from the record’s own instant');
  ok(/wentToReviewInstant\(task\)/.test(code),
    'and that instant must be read off the record');
  // AND LEFT OUT RATHER THAN GUESSED when there is no such instant.
  ok(/\{went != null \?/.test(code),
    'a missing instant must drop the sentence, not invent one');
});

it('how long ago reads in whole units, singular and plural', () => {
  equal(howLongAgoInWords(30 * 1000), 'a moment');
  equal(howLongAgoInWords(60 * 1000), '1 minute');
  equal(howLongAgoInWords(5 * 60 * 1000), '5 minutes');
  equal(howLongAgoInWords(60 * 60 * 1000), '1 hour');
  equal(howLongAgoInWords(3 * 60 * 60 * 1000), '3 hours');
  equal(howLongAgoInWords(26 * 60 * 60 * 1000), '1 day');
  equal(howLongAgoInWords(72 * 60 * 60 * 1000), '3 days');
  equal(howLongAgoInWords(-5), 'a moment');
  equal(howLongAgoInWords(null), 'a moment');
});

it('THE WAIT IS THE SHOP’S AND IS SAID TO BE THE SHOP’S', () => {
  // Fayr is not promising 48 to 72 hours and cannot: the shop decides.
  ok(reviewsGoLiveIn('Amazon').startsWith('Amazon '));
  ok(/48 to 72 hours/.test(reviewsGoLiveIn('Amazon')));
  ok(waitThenComeBack('Amazon').includes('Amazon'));
});

it('every new sentence is in the one file, and named rather than copied', () => {
  const code = withoutComments(GUIDE);
  for (const sentence of [
    HAVE_YOU_POSTED_THE_REVIEW, REVIEW_CONFIRMATION_RECEIVED, WRITE_A_FAIR_REVIEW,
  ]) {
    ok(EVERY_SENTENCE.includes(sentence), `"${sentence}" is not in the walked list`);
    ok(!code.includes(sentence), `the review step holds a copy of "${sentence}"`);
  }
  ok(EVERY_SENTENCE.includes(PRODUCT_DELIVERED));
  ok(EVERY_SENTENCE.includes(reviewsGoLiveIn('Amazon')));
  ok(EVERY_SENTENCE.includes(youPostedItAgo('2 hours')));
});

console.log('\nsection A: a person does not release their own refund');

it('THERE IS NO BUTTON, AND THE MONEY IS ALREADY THERE', () => {
  // "No button. Nothing to tap. The money is already there." The scheduler
  // releases it, gated on the refund rules, after re-checking that the review is
  // still on the product page.
  const code = withoutComments(TASKSCREEN);
  ok(!/Release \$\{refundLabel\} to wallet/.test(code),
    'the release button is still on the person’s screen');
  ok(!/type: 'RELEASE_REFUND'/.test(code),
    'the person’s screen can still fire a release');
});

it('and what it says instead is the owner’s own three sentences', () => {
  const code = withoutComments(TASKSCREEN);
  ok(/REFUND_CONFIRMED/.test(code));
  ok(/REVIEW_LIVE_AND_WINDOW_CLOSED/.test(code));
  ok(/addedToYourWallet\(refundLabel\)/.test(code));
  equal(REFUND_CONFIRMED, 'Refund confirmed.');
  equal(REVIEW_LIVE_AND_WINDOW_CLOSED,
    'Your review is live and the return window has closed.');
  equal(addedToYourWallet('₹4,495.50'),
    '₹4,495.50 has been added to your wallet.');
});

it('THE AMOUNT IS DROPPED RATHER THAN GUESSED when there is no figure', () => {
  // A sentence saying something has been added to a wallet without saying what
  // is worse than the shorter one.
  const code = withoutComments(TASKSCREEN);
  ok(/\? \(refundLabel\s*\n?\s*\? `\$\{REVIEW_LIVE_AND_WINDOW_CLOSED\} \$\{addedToYourWallet\(refundLabel\)\}`/
    .test(code.replace(/\s+/g, ' ').replace(/ \? /g, ' ? '))
    || /refundLabel\s*\?\s*`\$\{REVIEW_LIVE_AND_WINDOW_CLOSED\}/.test(code),
  'the wallet sentence must be dropped when there is no amount');
});

it('AND THE OPERATOR\u2019S OWN PATH IS UNTOUCHED, which is what actually moves it', () => {
  // ── AND ONE CORRECTION TO THE FILE THIS CAME FROM ─────────────────────
  //
  // Section A says: "Keep the staff-side Release refund action exactly as it is
  // in the admin panel." THERE IS NO SUCH ACTION IN THE PANEL. Measured on
  // 17 September 2026: admin-panel/index.html contains no release control at all,
  // and its only refund words belong to withdrawals — "Reject & refund",
  // "Mark failed & refund". So there was nothing there to keep and nothing there
  // was changed.
  //
  // WHAT REALLY RELEASES A REFUND is the scheduler, which re-checks that the
  // review is still on the product page and only then pays. That, and the
  // operator route beside it, are what this check holds.
  const controller = read('backend/src/tasks/task.controller.ts');
  ok(/@Post\(':id\/release-refund'\)/.test(controller),
    'the release route must still exist');
  const scheduler = read('backend/src/scheduler/scheduler.service.ts');
  ok(/this\.tasks\.autoRelease\(task\.id, now\)/.test(scheduler),
    'the scheduler must still be the thing that releases a refund');
  // AND IT RE-CHECKS BEFORE IT PAYS. Section C: "When the return window closes,
  // the backend runs the SAME check again to see the review is still on the
  // product page." Do not weaken either check.
  //
  // ── SHARPENED 22 SEPTEMBER 2026, AND THE REASON MATTERS ─────────────────
  //
  // This used to compare indexOf('recordVisibilityCheck') against
  // indexOf('autoRelease') — file order standing in for the rule. That was fine
  // while there was exactly one release site. There are now two, because quick
  // commerce publishes no review a server can read, and the branch for it sits
  // ABOVE the re-check. Under the old assertion that read as a violation while
  // the rule itself was intact.
  //
  // The rule is unchanged and is now asserted directly: WHEREVER A REFUND IS
  // RELEASED AFTER A RE-CHECK, THE RE-CHECK COMES FIRST — and the one release
  // that happens WITHOUT a re-check must count itself as unverified, so that a
  // payout on unchecked evidence can never again be invisible. Measured on the
  // owner's own completed Cadbury journey, 22 September: VISIBILITY_CHECK events
  // on that task, 0, and nothing anywhere said so.
  const recheck = scheduler.indexOf('recordVisibilityCheck');
  ok(recheck > -1, 'the scheduler must still re-check a review it can read');
  const sites = [...scheduler.matchAll(/this\.tasks\.autoRelease\(task\.id, now\)/g)]
    .map((m) => m.index);
  ok(sites.length >= 1, 'the scheduler must still be the thing that releases a refund');
  const afterTheCheck = sites.filter((i) => i > recheck);
  ok(afterTheCheck.length === 1,
    'exactly one release site sits after the re-check — the shops whose review can be read');
  // AND EVERY RELEASE SITE THAT DOES NOT IS ACCOUNTED FOR IN WORDS.
  for (const i of sites.filter((x) => x < recheck)) {
    const branch = scheduler.slice(Math.max(0, i - 400), i + 400);
    ok(/releasedUnverified\+\+/.test(branch),
      'a refund released with NO re-check must be counted as unverified, never as a checked one');
    ok(/cannotBeSentBack\(task\.platform\)/.test(branch),
      'and that path is only ever the shop that publishes no readable review');
  }
  const panel = read('admin-panel/index.html');
  ok(!/release-refund/.test(panel),
    'the panel has grown a release action, so this note is out of date');
});

// ── A REVIEW FAYR HAS NOT READ IS NOT A REVIEW ─────────────────────────────
//
// 20 SEPTEMBER 2026, from the owner's own razor. The task screen offered
// "I've written my review", the button dispatched MARK_REVIEWED, and that was
// the whole of it. His task reached REVIEWED carrying:
//
//   task_reviews     0 rows
//   reviewPublished  null
//   wentToReviewAt   null
//
// No rating, no review, no evidence of any kind — and the next row then told
// him "processing automatically, nothing needed from you". He had rated
// nothing, and asked, fairly, whether somebody had rated it for him.
//
// CLAUDE.md is unambiguous about which signal counts: the review being publicly
// visible is the signal. A person's tap is not evidence, and on the three quick
// shops the rating is readable straight off the order — so there is no reason
// for a self-declaration to exist there at all.
console.log('\n=== THE REVIEW STEP OPENS THE ORDER, AND DECLARES NOTHING ===');
{
  const screen = withoutComments(read('src/TaskScreen.js'));

  // THE ONLY WAY TO REVIEWED IS NOW THE SHOP'S OWN RATING, READ BY THE READER.
  // This is the load-bearing one: one leftover dispatch and the loophole is back.
  it('nothing on the task screen can declare the review done', () => {
    if (/MARK_REVIEWED/.test(screen)) {
      throw new Error('TaskScreen still dispatches MARK_REVIEWED somewhere');
    }
  });

  // ── THROUGH FAYR'S OWN REVIEW SCREEN, NOT STRAIGHT TO THE SHOP ───────────
  //
  // 21 September 2026, and this check was written to match my own mistake. It
  // pinned `land: 'order'` on the TASK screen, so it passed while that button
  // sent people straight to Zepto — skipping the Fayr composer, the score and
  // the copy. The owner caught it: "I did not add my review in Fayr and did not
  // have any score. I did not copy it or do anything, so it did not work as
  // planned."
  //
  // HIS FLOW, WHICH IS THE PRODUCT'S: delivered -> write it in Fayr -> score ->
  // copy and add review -> the shop's own ORDER page -> rate, paste, submit.
  // The written review is the thing a brand pays for on a shop that only takes
  // a star, and it is also the only copy the end-of-hold check can compare
  // against. Sending somebody straight to the shop throws all of it away.
  //
  // THE ORDER LANDING IS STILL PINNED — in WriteReviewScreen, where it belongs:
  // theFayrScore.test.mjs holds the one tap to saving, copying and opening the
  // order. One door, checked where it lives.
  it('the step opens Fayr’s own review screen, not the shop', () => {
    if (!/navigation\.navigate\('WriteReview', \{ campaignId \}\)/.test(screen)) {
      throw new Error('the task screen does not open Fayr’s review composer');
    }
    // AND IT NO LONGER REACHES PAST IT TO THE SHOP. A land:'order' here is the
    // composer being skipped again.
    if (/land: 'order'/.test(screen)) {
      throw new Error('the task screen is jumping straight to the shop again');
    }
  });

  // ── THE KEY, NOT THE NUMBER, AND THIS CHECK NOW SAYS WHICH ───────────────
  //
  // 21 September 2026. This used to pin `task.order.id` — the order NUMBER the
  // page prints — so it passed happily while the button built
  // https://www.zepto.com/order/RGTLJGSNT54558?isArchived=false and Zepto
  // answered "the page you are looking for has made an exit". The owner tapped
  // "Write review" and got a 404.
  //
  // A Zepto order's page is addressed by the UUID in its link, a different
  // string, and the two are kept apart on our side on purpose:
  //   tasks.orderId          the number the page prints
  //   tasks.watchedOrderKey  the UUID its address uses
  // Phase 8A fixed this exact bug in WriteReviewScreen on 19 September and left
  // the warning in that file. The task screen's own button was written without
  // reading it, and this check was written to match the broken code.
  it('the order page is addressed by the watched KEY, never the printed number', () => {
    if (!/const key = theWatchedOrderKey\(authoritative\);/.test(screen)) {
      throw new Error('the order page is not addressed by the watched key');
    }
    // AND THE PRINTED NUMBER IS NOT USED FOR IT. A task.order.id anywhere near
    // this door is the 404 coming back.
    if (/orderIdForReview[\s\S]{0,300}task\.order\.id/.test(screen)) {
      throw new Error('the printed order number is being used as an address again');
    }
  });

  it('and with no order number there is no button at all', () => {
    if (!/orderIdForReview != null/.test(screen)) {
      throw new Error('the action is not gated on having an order to open');
    }
  });

  it('once they have been to rate it, the step READS rather than asks again', () => {
    if (!screen.includes('const beenToRateIt = !!(authoritative && authoritative.wentToReviewAt);')) {
      throw new Error('the screen does not know they already went to rate it');
    }
    if (!screen.includes("navigation.navigate('LookingForReview'")) {
      throw new Error('nothing opens the review read, so nothing can reach REVIEWED');
    }
    // AND IT PICKS THE RIGHT READ. A shop Fayr shops inside keeps the rating on
    // the ORDER — Zepto has no reviews page at all — so sending it to the
    // reviews walk finds nothing and hands back to the journey, which draws the
    // review step again. That is the loop the owner went round all evening, and
    // reviews-found was called zero times while it happened.
    if (!screen.includes('const ratingIsOnTheOrder = shopsInsideFayr(campaign.marketplace);')) {
      throw new Error('the screen does not ask where this shop keeps its rating');
    }
    if (!screen.includes("navigation.navigate('LookingForIt', { campaignId })")) {
      throw new Error('a quick-commerce rating is not read off the order');
    }
    // reviews-found is the ONLY route that runs markReviewed + startHold. Without
    // this face the task sits on DELIVERED with a published review on it — which
    // is exactly what the owner hit: he rated the razor, Fayr read the rating,
    // and the screen went on asking him to write a review.
    if (!screen.includes('label: `Check my rating on ${platformName}`')) {
      throw new Error('the second face is not offered');
    }
  });

  it('the step no longer calls itself "write your review"', () => {
    if (!/title: reviewed \? 'Review submitted' : 'Rate your product',/.test(screen)) {
      throw new Error('the heading does not say Rate your product');
    }
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
