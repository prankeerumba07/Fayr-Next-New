// FAYR CONFIRMS THE DELIVERY BY ITSELF, AND THESE ARE THE CHECKS THAT SAY SO.
//
// The delivery step used to draw a green "YES — IT IS DELIVERED" button. A tap
// cannot settle a delivery: a refund that moved because somebody said "it came"
// is a refund anybody could have, which is the whole reason the shop's own page
// is the evidence. So the screen reads instead of asking, and these are the
// promises that keeps.
//
// TWO HALVES, AND THEY FAIL FOR DIFFERENT REASONS.
//
// The NOTE is ordinary code and is run for real. The SCREEN is React and cannot
// be, outside a phone, so it is read as text — the same way this project already
// pins src/order/LookingForItScreen.js and src/ui/funnyWait.js. A source check
// is weaker than running it and is worth having anyway: every one of the things
// removed from that screen was removed because it was WRONG, and a check that
// names them is what stops one quietly coming back.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  alreadyLookedForDelivery, forgetEveryDeliveryLook, rememberWeLookedForDelivery,
} from './deliveryLook.js';

const { ok, equal } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const withoutComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const SCREEN = read('../screens/delivery.js');
const CODE = withoutComments(SCREEN);

console.log('\nthe note that makes the automatic read happen once and not for ever');

it('nothing has been looked at until something has', () => {
  forgetEveryDeliveryLook();
  equal(alreadyLookedForDelivery('task-a'), false);
});

it('and once it has, it stays looked at', () => {
  forgetEveryDeliveryLook();
  rememberWeLookedForDelivery('task-a');
  equal(alreadyLookedForDelivery('task-a'), true);
});

it('EACH TASK ON ITS OWN, so one claim cannot answer for another', () => {
  // This is the whole reason the note is keyed by the task and not the campaign.
  // Somebody who leaves an offer and claims it again gets a NEW task, and must
  // get a new read — not a note left by a claim that no longer exists.
  forgetEveryDeliveryLook();
  rememberWeLookedForDelivery('task-a');
  equal(alreadyLookedForDelivery('task-b'), false);
});

it('an empty id is never stored and never reads as looked', () => {
  // A campaign with no task has nothing to read, and must not be able to write a
  // note under an empty name that every other empty name then matches.
  forgetEveryDeliveryLook();
  rememberWeLookedForDelivery('');
  rememberWeLookedForDelivery(null);
  rememberWeLookedForDelivery(undefined);
  equal(alreadyLookedForDelivery(''), false);
  equal(alreadyLookedForDelivery(null), false);
  equal(alreadyLookedForDelivery(undefined), false);
});

it('and the note is in memory only, so tomorrow is a fresh look', () => {
  // A parcel can arrive overnight. Nothing here is worth surviving a restart, so
  // nothing here does — no AsyncStorage, no file, no server.
  const note = read('./deliveryLook.js');
  ok(!/AsyncStorage|localStorage|writeFile|fetch\(/.test(note),
    'the note must not be written down anywhere');
});

console.log('\nthe screen asks one thing, and the answer settles nothing');

/*
 * ── THE INSTRUCTION THAT CHANGED, AND WHAT DID NOT CHANGE WITH IT ─────────
 *
 * 16 SEPTEMBER 2026, the owner: "Fayr must confirm delivery by reading the
 * user's own Amazon order page, with no buttons and no user input.
 * src/screens/delivery.js currently asks the user, which is wrong." The question
 * came off and the screen read the shop the moment it opened.
 *
 * 17 SEPTEMBER 2026, REVIEW-FLOW-PROMPT.md step eight: "the app asks: Is the
 * product delivered? with Yes / No", and step nine: "Yes reads the delivery off
 * the shop's own page."
 *
 * THE THING THE FIRST ONE FORBIDS IS A TAP SETTLING A DELIVERY, and that is
 * still forbidden and still checked below. The old button was labelled "YES — IT
 * IS DELIVERED": an assertion, by the person being paid, about the one fact the
 * refund turns on. The new one answers a question and starts a read. Somebody
 * who taps Yes on a parcel that has not arrived gets exactly what somebody who
 * taps nothing gets.
 */
it('THE BUTTON THAT ASSERTED A DELIVERY IS STILL GONE', () => {
  // The words matter, not the presence of a control. "YES — IT IS DELIVERED"
  // was a claim; "Yes", under "Is the product delivered?", is an answer that
  // starts a read.
  ok(!/IT IS DELIVERED/i.test(CODE), 'the screen still offers to be told');
  ok(!/Yes,? it is delivered/i.test(CODE));
});

/**
 * THE SCREEN'S CODE WITH ITS IMPORT LINES TAKEN OUT.
 *
 * ── AND THAT IS NOT TIDINESS, IT IS THE DIFFERENCE BETWEEN TWO CHECKS ────
 *
 * "the screen names THANK_YOU_FOR_CONFIRMING" is true of a file that imports the
 * word and never draws it. Caught by breaking it deliberately on 17 September
 * 2026: the sentence was taken off the screen and replaced with one typed in
 * place, and the check went on passing because the import at the top still
 * mentioned the name. What has to be true is that the name reaches the DRAWING.
 */
const DRAWN = CODE.split('\n')
  .filter((l) => !/^\s*(import\b|\}\s*from\b|[A-Z_, ]+,?\s*$)/.test(l))
  .join('\n');

it('THE QUESTION IS THE OWNER\u2019S OWN, AND IT IS NAMED RATHER THAN WRITTEN', () => {
  // Every sentence a person reads lives in src/ui/journeyWords.js, where Fayr's
  // plain language rule reads it off disk.
  ok(/IS_THE_PRODUCT_DELIVERED/.test(DRAWN), 'the screen must ask the question');
  ok(!/Is the product delivered\?/.test(CODE),
    'the screen holds its own copy of the question');
  ok(/\{YES\.toUpperCase\(\)\}/.test(DRAWN) && /\{NO\.toUpperCase\(\)\}/.test(DRAWN),
    'both answers must come from the one words file');
});

it('AND STEP SEVEN\u2019S SENTENCE IS ON IT, WHICH HAS NOWHERE ELSE TO GO', () => {
  // "Thank you for confirming. Once your product is delivered, use it and give a
  // fair review." Confirming the order is what moves the record to this step, so
  // this screen is the first thing somebody sees afterwards.
  ok(/THANK_YOU_FOR_CONFIRMING/.test(DRAWN) && /USE_IT_AND_REVIEW_FAIRLY/.test(DRAWN),
    'the screen must DRAW the sentence that follows confirming the order');
  ok(!/Thank you for confirming/.test(CODE), 'and must not hold a copy of it');
});

it('AND SO IS "OPEN THE SHOP", WHICH WAS A BUG', () => {
  // It called navigation.navigate(key) — the marketplace's own web view, which
  // is the screen for reading a REVIEW — and landed the person on the shop's
  // home page with nothing to do there.
  ok(!/navigate\(key/.test(CODE), 'the screen still navigates to a bare shop key');
  ok(!/so we can read it/i.test(CODE));
  ok(!/markVisitedShop/.test(CODE), 'the screen still marks a shop visit');
});

it('it starts the SAME read, by name, and does not write a second one', () => {
  ok(/navigation\.navigate\('LookingForIt'/.test(CODE),
    'the screen must start the read the purchase step already runs');
  // And it hosts no web view of its own. Two readers of one shop, in one
  // language, would eventually disagree about somebody's refund.
  ok(!/react-native-webview|WebView/.test(SCREEN),
    'the delivery screen must not open its own web view');
  ok(!/orderhistory|sendFoundOrders|injectJavaScript/.test(CODE),
    'the delivery screen must not read the shop itself');
});

it('THE READ STARTS FROM THE ANSWER, AND ONCE PER SITTING', () => {
  // It started from the screen opening until 17 September 2026. Step nine puts
  // it behind the answer, which is what stops Fayr asking a shop for pages every
  // time an app is opened — the thing that gets an account blocked.
  ok(/const theySaidYes = useCallback\(/.test(CODE),
    'the read must be started by the answer');
  ok(!/if \(started\.current\) return undefined;\s*started\.current = true;\s*\/\/ NO TASK/
    .test(CODE), 'the read still starts from the screen opening');
  // The note is written BEFORE the move. Written after, a screen that comes
  // straight back has no note and starts the same read again.
  const startedAt = CODE.indexOf('rememberWeLookedForDelivery(taskId)');
  const movedAt = CODE.indexOf("navigation.navigate('LookingForIt'");
  ok(startedAt > -1 && movedAt > -1, 'the read is not started here at all');
  ok(startedAt < movedAt, 'the note must be written before the screen leaves');
  // AND A READ THAT ALREADY RAN DOES NOT PUT THE QUESTION BACK UP. Otherwise
  // somebody answers Yes and watches the same nothing happen again.
  ok(/looked \? 'nothing' : 'asking'/.test(CODE),
    'a sitting that has already looked must not be asked again');
});

it('AND THE ANSWER SETTLES NOTHING ABOUT A DELIVERY', () => {
  // The whole of what makes a question allowable here. Tapping Yes starts a
  // read; it writes no evidence, moves no task and touches nothing that decides
  // money. The only thing it changes on this side is which screen is drawn.
  // BOUNDED BY TWO THINGS THAT SURVIVE COMMENT STRIPPING, because CODE has its
  // comments taken out and a slice ending at a comment ends at minus one — which
  // reads the whole rest of the file and fails on the first word that looks bad.
  const from = CODE.indexOf('const theySaidYes');
  const to = CODE.indexOf('useEffect(() => {', from);
  ok(from > -1 && to > from, 'the answer handler is not where this check thinks it is');
  const said = CODE.slice(from, to);
  for (const forbidden of [
    'submitEvidence', 'sendFoundOrders', 'markReviewed', 'confirmOrder',
    'applyAuthoritative', 'postTaskAction', 'delivery:',
  ]) {
    ok(!said.includes(forbidden),
      `the answer reaches ${forbidden}, which is a decision and not a read`);
  }
});

it('IT SAYS WHAT IT IS DOING while it is doing it', () => {
  ok(/Checking your \$\{shop\} orders/.test(CODE),
    'the screen must say it is checking the orders');
});

it('and it cannot be sat on: the reading state always ends', () => {
  // The ordinary case is that starting the read takes this screen away within a
  // frame. This is for when it does not — a navigator that refused the move, or
  // the screen opened with no navigator at all.
  ok(/READ_SHOULD_HAVE_LEFT_MS/.test(CODE), 'there is no limit on the wait');
  ok(/setTimeout\(\(\) => setWhere\('nothing'\), READ_SHOULD_HAVE_LEFT_MS\)/.test(CODE),
    'nothing takes the screen off the reading state by itself');
});

it('ONLY ONE THING IS OFFERED once the read has run, and it is the picture', () => {
  const ghosts = CODE.match(/<Ghost\b/g) || [];
  equal(ghosts.length, 1, `the screen offers ${ghosts.length} quiet actions, not 1`);
  ok(/Send a picture of the delivery/.test(CODE));
  ok(/kind: 'DELIVERY'/.test(CODE));
  // And nothing is offered WHILE the shop is being read, which would be asking
  // for a photograph of the very thing Fayr is in the middle of reading.
  // ── AND THE GUARD READ IS THE OFFER'S OWN, NOT ANY GUARD SHAPED LIKE IT ──
  //
  // The same three words guard the "nothing to do" card further up the screen.
  // Caught by breaking it deliberately: the OFFER's guard was loosened and this
  // check went on passing, because it was reading the card's.
  const offerAt = CODE.indexOf('Send a picture of the delivery');
  ok(offerAt > -1, 'the offer is not on the screen at all');
  const guard = CODE.lastIndexOf('?', CODE.lastIndexOf('<Ghost', offerAt));
  const itsGuard = CODE.slice(CODE.lastIndexOf('{', guard), guard + 1);
  ok(/!reading && !asking && !delivered/.test(itsGuard),
    `the picture is offered under "${itsGuard.trim()}", which is not the whole rule`);
});

it('it never decides it is delivered on this side', () => {
  // Delivered is a state of the RECORD. The journey works the step out from it,
  // so a copy kept here is how two places disagree about where somebody is.
  ok(/getAuthoritative\(campaignId\)/.test(CODE));
  ok(/const delivered = !!\(task && task\.delivery\);/.test(CODE));
  ok(!/setDelivered|setState\('delivered'\)|'delivered'/.test(CODE),
    'the screen keeps its own copy of whether the parcel came');
});

console.log('\nthe delivery step names the order instead of searching for it again');

const LOOK = withoutComments(read('./LookingForItScreen.js'));

it('THE SCREEN HANDS THE ORDER NUMBER OVER, rather than sending it to search', () => {
  // The purchase step has to search; nobody has said which order it is about.
  // The delivery step does not, and searching there is what put the campaign's
  // own order outside a look that only reached four cards of a list still
  // drawing. Measured on the owner's phone, 16 September 2026.
  ok(/onlyThisOrder: itsOrder/.test(CODE),
    'the delivery screen must name the order it already knows');
  ok(/known\.order && typeof known\.order\.id === 'string'/.test(CODE),
    'the number must come off the record, not from anywhere else');
});

it('and a task with no order number still searches, rather than reading nothing', () => {
  ok(/itsOrder = [\s\S]*?: null;/.test(CODE),
    'a task with no order number must fall back to the ordinary search');
});

it('THE READ OPENS THE NAMED ONE INSTEAD OF THE LIST, not as well as', () => {
  // Not "as well as": every other number on the list is a page fetched for
  // nothing and a slot spent against the ceiling.
  ok(/onlyThisOrder != null\s*\n?\s*\? pagesToOpen\(\[onlyThisOrder\], platformKey\)/
    .test(LOOK), 'the read still opens whatever it harvested');
  ok(/: pagesToOpen\(worth\.numbers, platformKey\)/.test(LOOK),
    'the ordinary search must still be there for the purchase step');
  // ── AND THE SHOP'S OWN ORDER SEARCH DOES NOT RUN HERE AT ALL ────────────
  //
  // Added 16 September 2026, when the purchase step learned to ask the shop's
  // own search for the product by name before reading the list. That question
  // has no meaning on this step: the order is already named, so asking it would
  // be one more request against a shop that rate-limits us, for nothing.
  ok(/onlyThisOrder == null && searchesItsOrders\(platformKey\)/.test(LOOK),
    'a named order must skip the shop\u2019s search entirely');
});

it('A NAMED NUMBER IS CHECKED LIKE ANY OTHER, so a bad one opens nothing', () => {
  // Routed through pagesToOpen rather than fetched directly, which is the whole
  // point: a value arriving in a route param is refused exactly as a harvested
  // one would be if it is not this shop's shape.
  ok(!/orderDetailPageFor\(platformKey, onlyThisOrder\)/.test(LOOK),
    'a named number must not bypass the shape check');
});

it('and the log says one was named, but never which', () => {
  // An order number is a strong identifier tied to the account. That one was
  // named is what tells the two reads apart; the number itself is already kept
  // server side and never belongs in a log.
  ok(/named=\$\{onlyThisOrder != null\}/.test(LOOK),
    'the log must say whether an order was named');
  ok(!/named=\$\{onlyThisOrder\}/.test(LOOK),
    'the log must never carry the order number itself');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
