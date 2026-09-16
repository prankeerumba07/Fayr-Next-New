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

console.log('\nthe screen asks nobody anything');

it('THE BUTTON THAT ASKED IS GONE', () => {
  // "YES — IT IS DELIVERED" was a question whose answer Fayr does not accept,
  // dressed as a decision.
  ok(!/IT IS DELIVERED/i.test(CODE), 'the screen still offers to be told');
  ok(!/Yes,? it is delivered/i.test(CODE));
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

it('the read starts on its own, with nothing tapped to begin it', () => {
  ok(/useEffect\(/.test(CODE), 'the read must start from the screen opening');
  // The note is written BEFORE the move. Written after, a screen that comes
  // straight back has no note and starts the same read again.
  const startedAt = CODE.indexOf('rememberWeLookedForDelivery(taskId)');
  const movedAt = CODE.indexOf("navigation.navigate('LookingForIt'");
  ok(startedAt > -1 && movedAt > -1, 'the read is not started here at all');
  ok(startedAt < movedAt, 'the note must be written before the screen leaves');
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
  ok(/\{!reading && !delivered \?/.test(CODE),
    'the offer is not held back until the read has run');
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
  ok(/const numbers = onlyThisOrder != null/.test(LOOK),
    'the read still opens whatever it harvested');
  ok(/\? pagesToOpen\(\[onlyThisOrder\], platformKey\)/.test(LOOK));
  ok(/: pagesToOpen\(worth\.numbers, platformKey\)/.test(LOOK),
    'the ordinary search must still be there for the purchase step');
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
