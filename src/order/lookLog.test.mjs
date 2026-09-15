// THE LOOK'S COMMENTARY, AND THE THREE PROMISES IT HAS TO KEEP.
//
// It exists because the automatic order find came back with nothing on a real
// phone on 11 September 2026 and left NO evidence anywhere of why. Four
// different outcomes land on the same screen and leave the same trace, which is
// none. These lines tell them apart.
//
// But a log that leaks is worse than no log, and this project has already had
// one leak the owner's own telephone number. So the promises are checked here,
// structurally rather than by reading the words:
//
//   1. EVERY line begins with the tag, because there is ONE console.log and it
//      is inside say(), which puts the tag in front.
//   2. EVERY line is masked, because lookLine() masks the WHOLE assembled line
//      as its last act — so it cannot matter which argument a caller puts a
//      page's answer into.
//   3. NOTHING is said at all unless __DEV__ is on.
//
// And the fourth promise is about the CALL SITES rather than this file: no page
// HTML and no order text is ever passed in. That is checked by reading the
// screen, because it is the one thing this file cannot enforce for itself.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { TAG, lookLine, lookLogIsOn, logLook, stamp } from './lookLog.js';
import { countOrderCardSlots, harvestOrderNumbers } from './detailLook.js';

const { ok, equal, deepEqual } = assert;
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

console.log('\nevery line begins with the tag, and there is one place that writes');

it('the tag is its own word, so a whole look can be searched for', () => {
  equal(TAG, '[fayr-look]');
  ok(lookLine('list', 'status=200').startsWith(TAG));
  ok(lookLine('x').startsWith(TAG));
  ok(lookLine('', '').startsWith(TAG));
});

it('THERE IS EXACTLY ONE console.log IN THE FILE, and the tag goes in front', () => {
  // The promise is kept by the SHAPE of the file, not by anybody remembering.
  // The same check guards src/connect/gateLog.js, for the same reason.
  const code = withoutComments(read('./lookLog.js'));
  const writes = code.match(/console\.\w+\(/g) || [];
  deepEqual(writes, ['console.log('], `found: ${writes.join(', ')}`);
  ok(/return maskNumbers\(`\$\{TAG\} /.test(code),
    'the line is assembled with the tag in front and masked in one expression');
});

it('and nothing else in the file can print', () => {
  const code = withoutComments(read('./lookLog.js'));
  ok(!/process\.stdout|console\.(warn|error|info|debug)/.test(code));
});

console.log('\nthe mask, which is the promise that already failed once elsewhere');

it('A TELEPHONE NUMBER NEVER SURVIVES, in whichever argument it arrives', () => {
  // gateLog.js leaked the owner's own number exactly this way: a shop's sign in
  // page greets a person by their mobile number, and the page's raw answer went
  // into a line that was then pasted into a message.
  for (const line of [
    lookLine('post', 'why="Signed in as +919876543210"'),
    lookLine('+919876543210', 'x'),
    lookLine('list', 'said="98765 43210"'),
    lookLine('x', 'n=+91 98765 43210'),
  ]) {
    ok(!/9876543210|98765 43210/.test(line), `a number survived: ${line}`);
    ok(line.includes('[number removed]'), `it was not masked: ${line}`);
  }
});

it('AND AN AMAZON ORDER NUMBER STILL READS, which the mask must not eat', () => {
  // The mask was rewritten once because its first version ate exactly this. A
  // log that cannot show an order number would be useless for this very read.
  const line = lookLine('order', 'n=403-1234567-8901234');
  ok(line.includes('403-1234567-8901234'), line);
});

it('and a status code, a byte count and a clock reading all survive', () => {
  const line = lookLine('list', 'status=503 bytes=48210');
  ok(line.includes('status=503'), line);
  ok(line.includes('bytes=48210'), line);
  ok(/\d{2}:\d{2}:\d{2}\.\d{3}/.test(line), line);
});

it('the clock is to the millisecond, because the look is timed', () => {
  equal(stamp(Date.UTC(2026, 8, 11, 0, 0, 0, 7)).length, 12);
  ok(/^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(stamp()));
});

it('junk in is still a line out, never a throw', () => {
  for (const junk of [null, undefined, 0, {}, []]) {
    ok(lookLine(junk, junk).startsWith(TAG));
  }
});

console.log('\nand it is silent unless somebody is developing');

it('SAYS NOTHING when __DEV__ is not on, and says so', () => {
  equal(lookLogIsOn(), false, 'under node there is no __DEV__');
  equal(logLook('list', 'status=200'), false, 'it must not have printed');
});

it('the guard is the first line of logLook, not a wrapper around it', () => {
  const code = withoutComments(read('./lookLog.js'));
  ok(code.includes('if (!lookLogIsOn()) return false;'));
});

console.log('\nthe call sites: counts and status words, never a page');

const screen = withoutComments(read('./LookingForItScreen.js'));

it('all four lines are there', () => {
  ok(/logLook\('list',/.test(screen), 'the list line');
  ok(/logLook\('numbers',/.test(screen), 'the harvest line');
  ok(/logLook\('detail',/.test(screen), 'the order page line');
  ok(/logLook\('post',/.test(screen), 'the server line');
});

it('THE LIST LINE SAYS WHETHER THE SHOP EVER DREW THE LIST', () => {
  // The whole point of the change that added it. A shop that draws its own list
  // answers a fetch with an empty frame, so "we read the page" and "the orders
  // were on it" stopped being the same thing — and every field here exists to
  // tell those two apart on the next empty answer rather than the next month.
  const line = (screen.match(/logLook\('list',[\s\S]*?\);/) || [''])[0];
  for (const field of ['drawn=', 'drew=', 'waited=', 'looks=', 'rows=', 'strangers=']) {
    ok(line.includes(field), `the list line has no ${field}`);
  }
  // AND EVERY ONE OF THEM COMES FROM THE FACTS THE PAGE REPORTED, put through
  // drawFacts first. A page can write anything at all into these.
  ok(/drawn\.drew/.test(line), 'drew= must come from the page, through drawFacts');
  ok(/drawFacts\(/.test(screen), 'the screen must make the page\u2019s facts safe');
  ok(!/\$\{answer\.drew\}|\$\{answer\.waited\}/.test(line),
    'a field is read straight off the page without being made safe');
});

it('THE ORDER PAGE LINE says which page the order read landed on', () => {
  // The belief this whole one-page-at-a-time design rests on is that an order's
  // OWN page is sent whole by the shop's server. Nothing had ever measured it —
  // and could not have, because every one of these answers used to resolve null
  // against a view that had already been torn down. This is the measurement.
  const line = (screen.match(/logLook\('detail',[\s\S]*?\);/) || [''])[0];
  for (const field of ['status=', 'bytes=', 'landed=', 'looked=', 'wantsSignIn=']) {
    ok(line.includes(field), `the order page line has no ${field}`);
  }
  ok(/\.html\.length/.test(line), 'it must log the length, not the page');
  ok(/detail\.landed/.test(line), 'landed= must come from the reader');
  // AND NOT THE ORDER NUMBER. It is in the address this line is about, it is a
  // strong identifier tied to the account, and `n=` answers the question.
  ok(!/numbers\[|\$\{url\}|orderDetailPageFor/.test(line),
    'the order page line carries an order number or its address');
});

it('and the order page line is said BEFORE the two branches that stop the look', () => {
  // A refusal and a sign in wall both return without ever reaching the server
  // line, so a line said after them is a line that never appears on exactly the
  // runs worth explaining.
  const at = screen.indexOf("logLook('detail',");
  const stops = screen.indexOf('if (detail.wantsSignIn === true)');
  ok(at > 0 && stops > 0, 'both the line and the branch are there to compare');
  ok(at < stops, 'the order page line is said before the look can stop');
});

it('THE LIST LINE says what came back without carrying it', () => {
  const line = (screen.match(/logLook\('list',[\s\S]*?\);/) || [''])[0];
  for (const field of ['status=', 'bytes=', 'whyNot=', 'wantsSignIn=']) {
    ok(line.includes(field), `the list line has no ${field}`);
  }
  // THE PAGE'S LENGTH, NEVER THE PAGE. An order list carries the buyer's name
  // and their address.
  ok(/\.html\.length/.test(line), 'it must log the length, not the html');
  ok(!/\$\{answer\.html\}|\$\{html\}/.test(line), 'it passes the page itself');
});

it('THE HARVEST LINE separates the two empty answers', () => {
  const line = (screen.match(/logLook\('numbers',[\s\S]*?\);/) || [''])[0];
  for (const field of ['slots=', 'shaped=', 'opening=']) {
    ok(line.includes(field), `the harvest line has no ${field}`);
  }
  ok(/countOrderCardSlots\(/.test(line), 'slots must come from the counter');
  // AND NOT ONE ORDER NUMBER. A count answers the question; an identifier tied
  // to somebody's account does not need to be anywhere near a console.
  ok(!/numbers\[|numbers\.join|\$\{numbers\}/.test(line),
    'the harvest line carries an order number');
});

it('THE SERVER LINE says whether the request even left the phone', () => {
  const line = (screen.match(/logLook\('post',[\s\S]*?\);/) || [''])[0];
  for (const field of ['pages=', 'ok=', 'status=', 'why=']) {
    ok(line.includes(field), `the server line has no ${field}`);
  }
  // AND EVERY ONE OF THEM IS READ FROM THE ANSWER, not written down. Typing
  // `ok=true status=200` into the line keeps all four labels and says nothing —
  // which is exactly the failure this line exists to end.
  ok(/\$\{sent\.ok\}/.test(line), 'ok= must come from the answer');
  ok(/\$\{sent\.status\}/.test(line), 'status= must come from the answer');
  ok(/sent\.why/.test(line), 'why= must come from the answer');
  // PAGE COUNT, NEVER PAGE TEXT.
  ok(/pages\.length/.test(line), 'it must log how many, not what');
  ok(!/pages\[|pages\.join/.test(line), 'the server line carries a page');
});

it('and NO call site anywhere passes a page or an order text', () => {
  const calls = screen.match(/logLook\([\s\S]*?\);/g) || [];
  // FOUR NOW, AND IT IS A DECISION AND NOT A DRIFT. The fourth is the order page
  // line above. This count exists so that adding a call site is something
  // somebody has to come here and think about, and that is what it just did.
  ok(calls.length === 4, `expected four calls, found ${calls.length}`);
  for (const call of calls) {
    ok(!/detail\.text|\.blocks|outcome\.blocks/.test(call),
      `a call site carries page text: ${call.slice(0, 80)}`);
  }
});

console.log('\nthe slot count, which is the whole point of the harvest line');

const card = (n) => `<div data-csa-c-slot-id="amzn1.yourorders.order-card.${n}"></div>`;

it('counts the cards on a real page, and the harvest agrees', () => {
  const html = card('408-5094957-4481129') + card('402-3925017-7784521');
  equal(countOrderCardSlots(html, 'amazon'), 2);
  equal(harvestOrderNumbers(html, 'amazon').length, 2);
});

it('SLOTS WITHOUT SHAPES — the case that says the format moved', () => {
  // The whole reason this function exists. The cards are there and every id in
  // them was refused, so the fix is one regular expression and there is nothing
  // wrong with the session.
  const html = card('AB12-345') + card('99999');
  equal(countOrderCardSlots(html, 'amazon'), 2);
  equal(harvestOrderNumbers(html, 'amazon').length, 0);
});

it('NO SLOTS AT ALL — the case that says it was not an orders page', () => {
  for (const html of [
    '<html><body>Sign in</body></html>',
    '<html><body>Click the button below to continue shopping</body></html>',
    '',
  ]) {
    equal(countOrderCardSlots(html, 'amazon'), 0);
    equal(harvestOrderNumbers(html, 'amazon').length, 0);
  }
});

it('counts every card, including the duplicates the harvest folds away', () => {
  // The harvest answers each number ONCE. The count answers how many cards the
  // page drew. They are different questions and must not be made one.
  const n = '408-5094957-4481129';
  equal(countOrderCardSlots(card(n) + card(n) + card(n), 'amazon'), 3);
  equal(harvestOrderNumbers(card(n) + card(n) + card(n), 'amazon').length, 1);
});

it('ignores a slot id that is not an order card', () => {
  const html = '<div data-csa-c-slot-id="amzn1.yourorders.filter.408-5094957-4481129"></div>';
  equal(countOrderCardSlots(html, 'amazon'), 0);
});

it('answers the same twice, and never throws on junk', () => {
  const html = card('408-5094957-4481129');
  equal(countOrderCardSlots(html, 'amazon'), countOrderCardSlots(html, 'amazon'));
  for (const junk of [null, undefined, 42, {}, []]) equal(countOrderCardSlots(junk, 'amazon'), 0);
});

it('AND IT RETURNS A NUMBER, never the text it matched', () => {
  const got = countOrderCardSlots(card('408-5094957-4481129'), 'amazon');
  equal(typeof got, 'number');
  ok(!String(got).includes('408'), 'it handed back the order number');
});

console.log('\nthe reason a failed request gives back');

it('sendFoundOrders hands the reason back instead of dropping it', () => {
  const api = withoutComments(read('../backend/orderCandidatesApi.js'));
  // ANCHORED TO sendFoundOrders' OWN BODY. The first writing of this read the
  // whole file, and thisOrderIsMine further down already carried the very line
  // being looked for — so the check passed while sendFoundOrders answered
  // `why: null`. A check that matches the wrong function is not a check.
  const start = api.indexOf('export async function sendFoundOrders');
  ok(start > -1, 'sendFoundOrders was not found');
  const body = api.slice(start, api.indexOf('export async function listFoundOrders'));
  ok(body.length > 0 && body.length < api.length, 'the body slice is wrong');
  ok(/why:/.test(body), 'sendFoundOrders answers no why at all');
  ok(/res\.body\.message \|\| res\.body\.error/.test(body),
    'the reason must be the server or the runtime own words, not a guess');
  ok(!/why: null,\s*\};/.test(body), 'the failure answer hands back no reason');
  // AND THE SHAPE IT ALREADY PROMISED IS KEPT. Every caller reads ok/status/
  // orders, and this must not have become a throwing client.
  ok(/Never throws/.test(read('../backend/orderCandidatesApi.js')));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
