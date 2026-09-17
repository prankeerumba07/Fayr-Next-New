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
  REVIEW_FACES, REVIEW_OPENS_AFTER_MS, facePutsTheQuestion, faceSaysTheWait,
  reviewLock, reviewStepFace,
} from './reviewStep.js';
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

console.log('\nstep 12: the review step is shut for a day after the parcel arrives');

it('TWENTY FOUR HOURS, AND FROM THE DELIVERY INSTANT ON THE RECORD', () => {
  // "The 24 hours are measured from the DELIVERY instant on the record, which is
  // the server's word and not the phone's."
  equal(REVIEW_OPENS_AFTER_MS, A_DAY);
  const shut = reviewLock({ deliveredAt: AN_ARRIVAL, now: AN_ARRIVAL + 1000 });
  equal(shut.locked, true);
  equal(shut.opensAt, AN_ARRIVAL + A_DAY);
});

it('it is still shut one millisecond before the day is up', () => {
  const shut = reviewLock({ deliveredAt: AN_ARRIVAL, now: AN_ARRIVAL + A_DAY - 1 });
  equal(shut.locked, true);
  equal(shut.msLeft, 1);
});

it('AND OPEN ON THE INSTANT IT IS UP, not a poll later', () => {
  const open = reviewLock({ deliveredAt: AN_ARRIVAL, now: AN_ARRIVAL + A_DAY });
  equal(open.locked, false);
  equal(open.msLeft, 0);
});

it('NO DELIVERY INSTANT MEANS NOT SHUT, which is the safe direction', () => {
  // A step shut on a clock nobody can read is a step that never opens, and the
  // person has no way to tell anybody.
  equal(reviewLock({ deliveredAt: null, now: AN_ARRIVAL }).locked, false);
  equal(reviewLock({}).locked, false);
});

it('it opens by itself, with nothing tapped and nothing refreshed', () => {
  const code = withoutComments(GUIDE);
  ok(/ASK_AGAIN_AT_MOST_EVERY_MS/.test(code), 'there is no timer at all');
  // RE-ARMED FROM WHAT IS REALLY LEFT. A single timer set for a whole day is a
  // timer no phone can be trusted to keep, and a fixed poll is late at the one
  // moment that matters.
  ok(/Math\.min\(shut\.msLeft, ASK_AGAIN_AT_MOST_EVERY_MS\)/.test(code),
    'the timer must be the smaller of a minute and what is really left');
});

console.log('\nsteps 15 to 21: the six faces of the review step');

const facesFor = (over) => reviewStepFace({
  deliveredAt: AN_ARRIVAL, now: AN_ARRIVAL + A_DAY + 1000, ...over,
});

it('SHUT BEATS EVERYTHING, whatever else has happened', () => {
  equal(reviewStepFace({
    deliveredAt: AN_ARRIVAL, now: AN_ARRIVAL + 5,
    wentToReview: true, told: true, justAskedYes: true, lookJustRan: true,
  }), 'locked');
});

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

it('there are six faces; five are named on the screen and the sixth is the rest', () => {
  // THE GUIDE IS THE FALL-THROUGH, and saying so is more honest than making the
  // screen name it. Five faces are special cases of the review step and each one
  // returns early; what is left is the guide the screen has always been. A
  // `return null` for an unrecognised face would draw a blank screen, which is
  // worse than drawing the guide.
  equal(REVIEW_FACES.length, 6);
  const code = withoutComments(GUIDE);
  // READ OFF THE BRANCHES THEMSELVES, not off the file containing the word.
  // Caught by breaking it: one face was dropped from the branch that draws it,
  // and the check went on passing because the same word still appeared further
  // down, inside that branch, deciding a line within it.
  const branches = [...code.matchAll(/^\s*if \(face === '([a-z-]+)'(?: \|\| face === '([a-z-]+)')?\)/gm)]
    .flatMap((m) => [m[1], m[2]])
    .filter(Boolean);
  deepEqual(branches.sort(),
    ['asking', 'asking-again', 'locked', 'notice', 'notice-again']);
  ok(!branches.includes('guide'), 'the guide must be what is left, not a sixth branch');
});

it('THE SCREEN ASKS THE HELPER AND DOES NOT DECIDE FOR ITSELF', () => {
  const code = withoutComments(GUIDE);
  ok(/reviewStepFace\(\{/.test(code), 'the screen must ask which face this is');
  ok(/reviewLock\(\{/.test(code), 'and it must ask whether the step is shut');
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
  const recheck = scheduler.indexOf('recordVisibilityCheck');
  const release = scheduler.indexOf('autoRelease');
  ok(recheck > -1 && release > recheck,
    'the visibility re-check must happen BEFORE the refund is released');
  const panel = read('admin-panel/index.html');
  ok(!/release-refund/.test(panel),
    'the panel has grown a release action, so this note is out of date');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
