// ONE ORDER, NEVER THE LIST, WHEN THE KEY IS KNOWN — Phase 8A, Tasks 3 and 4.
//
// The run this comes from is at the top of whichRead.js. What is proved here:
// the decision picks the one page for a key and the list for none; the screen
// asks it before the search and before the list; the watched path opens one
// page, posts its text, and hands back — never opening the list, never asking
// "is this your order?", and never treating an unreadable page as a failure.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { howThisShopNamesAnOrder } from './detailLook.js';
import {
  NOWHERE, ONE_PAGE, THE_LIST, howToLook, theWatchedOrderKey,
} from './whichRead.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const withoutComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const KEY = '01a0b4d7-870c-7dca-b701-e038477c5106';
const ZEPTO = howThisShopNamesAnOrder('zepto');

console.log('=== 1. THE DECISION: ONE PAGE FOR A KEY, THE LIST FOR NONE, NOWHERE FOR A KEY THAT BUILDS NOTHING ===');
{
  const one = howToLook({ watchedOrderKey: KEY, shape: ZEPTO });
  ok(one.path === ONE_PAGE, 'a watched key on a shop with a measured shape is ONE PAGE');
  ok(one.url === `https://www.zepto.com/order/${KEY}?isArchived=false`,
    'built the way the review step builds it: the measured shape with the key in the middle');
  for (const none of [null, undefined, '', '   ']) {
    const out = howToLook({ watchedOrderKey: none, shape: ZEPTO });
    ok(out.path === THE_LIST && out.url === null, `${JSON.stringify(none)} is no key, so the list, exactly as before`);
  }
  ok(howToLook({}).path === THE_LIST && howToLook().path === THE_LIST, 'and nothing at all is the list');
  ok(howToLook({ watchedOrderKey: KEY, shape: null }).path === NOWHERE,
    'A KEY ON A SHOP WITH NO MEASURED SHAPE IS NOWHERE — never the list, because we know which order');
  ok(howToLook({ watchedOrderKey: KEY, shape: howThisShopNamesAnOrder('blinkit') }).path === NOWHERE,
    'which is Blinkit and Instamart today');
  ok(howToLook({ watchedOrderKey: 'a/b', shape: ZEPTO }).path === NOWHERE,
    'and a key that cannot be part of an address builds nothing');
  ok(howToLook({ watchedOrderKey: `  ${KEY}  `, shape: ZEPTO }).url === `https://www.zepto.com/order/${KEY}?isArchived=false`,
    'while stray spaces around a real key are not a different key');
}

console.log('\n=== 2. THE KEY IS THE RECORD’S ===');
{
  ok(theWatchedOrderKey({ watchedOrderKey: KEY }) === KEY, 'read off the task response');
  ok(theWatchedOrderKey({ watchedOrderKey: `  ${KEY} ` }) === KEY, 'trimmed');
  for (const none of [{ watchedOrderKey: '' }, { watchedOrderKey: null }, {}, null, undefined, 'task', 7]) {
    ok(theWatchedOrderKey(none) === null, `${JSON.stringify(none)} carries no key`);
  }
  ok(theWatchedOrderKey({ order: { id: 'JKLIKGSNS48449' } }) === null,
    'AND THE ORDER NUMBER IS NEVER READ AS THE KEY: two identifiers, never confused');
}

console.log('\n=== 3. THE SCREEN ASKS FIRST, AND THE WATCHED PATH TOUCHES NO LIST ===');
{
  const code = withoutComments(read('src/order/LookingForItScreen.js'));
  ok(/import \{ NOWHERE, THE_LIST, howToLook, theWatchedOrderKey \} from '\.\/whichRead\.js';/.test(code),
    'the screen asks whichRead.js');
  ok(/const watchedKey = theWatchedOrderKey\(campaignId \? getAuthoritative\(campaignId\) : null\);/.test(code),
    'THE KEY IS READ OFF THE RECORD, never off a route param, so a reinstall reads the same page');
  ok(!/params\.watchedOrderKey/.test(code), 'and no param can name a different page');
  ok(/howToLook\(\{\s*watchedOrderKey: watchedKey, shape: howThisShopNamesAnOrder\(platformKey\),\s*\}\)/.test(code),
    'with the shop’s measured shape from detailLook.js');

  const decided = code.indexOf('const how = howToLook({');
  const searched = code.indexOf('openTheSearchWith(');
  const listed = code.indexOf('await openWith(theList)');
  ok(decided > -1 && searched > decided && listed > decided,
    'THE DECISION IS MADE BEFORE THE SEARCH AND BEFORE THE LIST');

  // ── AND BEFORE THE GUARD THAT GIVES UP WHEN A SHOP HAS NO LIST PAGE ─────
  //
  // MOVED ON 20 SEPTEMBER 2026, and this is the assertion that keeps it moved.
  // The NOWHERE answer is written for a claim that knows WHICH order was
  // placed on a shop nobody has measured — which is Blinkit and Instamart, and
  // those two have no order list page either. So while the decision sat below
  // the no-list guard, the branch written for exactly those two shops could
  // never run. Phase 8B-b's measurement mode is what makes them able to produce
  // a watched key at all, so the ordering had to be right first.
  const nowhere = code.indexOf("if (how.path === NOWHERE) {");
  const noList = code.indexOf('if (!taskId || !theList || !platform) {');
  ok(nowhere > -1 && noList > -1, 'both guards are where expected');
  ok(nowhere > decided && nowhere < noList,
    'THE NOWHERE EXIT IS REACHABLE: decided first, then answered, then the no-list guard');
  ok(/if \(how\.path === NOWHERE\) \{\s*logLook\('watched', 'opened=0 why=nowhere'\);\s*await settle\(\);\s*if \(alive\) moveOn\('Journey'\);\s*return;\s*\}/.test(code),
    'and it reads nothing, says why, and hands back to the journey');

  const start = code.indexOf('if (how.path !== THE_LIST) {');
  const end = code.indexOf('let fromTheSearch = [];', start);
  ok(start > -1 && end > start, 'the watched branch is where expected');
  const branch = code.slice(start, end);
  ok(branch.length > 300, 'and is not empty');
  for (const never of [
    'openWith(theList)', 'openTheSearchWith', 'harvestRendered', 'pagesToOpen', 'ordersWorthOpening',
    'IsThisYourOrder', 'onlyThisOrder', 'PRESSES_AT_MOST',
  ]) {
    ok(!branch.includes(never), `the watched path never reaches ${never}`);
  }
  ok(/openOneOrderWith\(\s*platformKey, how\.url, Date\.now\(\), aFreshName\(\), watchedKey, whatIsLeft\(\),\s*\)/.test(branch),
    'IT OPENS THE ONE PAGE, through the same opener every order page uses, with its own name and what is left of the look');
  ok(/const detail = readDetailStep\(next, one\);/.test(branch), 'reads it the way the step was opened');
  ok(/await askTheServer\(\[detail\.text\]\);/.test(branch),
    'POSTS ITS TEXT THROUGH THE SAME sendFoundOrders EVERY PAGE GOES THROUGH');
  // NOT READABLE YET IS NOT A FAILURE. It hands back; it does not open the list.
  const unread = branch.indexOf('if (!detail.looked) {');
  const asked = branch.indexOf('await askTheServer(');
  ok(unread > -1 && asked > unread, 'an unreadable page is answered before anything is posted');
  ok(/if \(!detail\.looked\) \{\s*await leaveWith\(\[\]\);\s*return;\s*\}/.test(branch),
    'AND THE ANSWER IS TO HAND BACK, so the journey looks again — never the list');
  // NO "IS THIS YOUR ORDER?" ON THE WATCHED PATH: every exit hands back to the journey.
  // TWO, not three, since 20 September 2026: the NOWHERE exit moved above the
  // no-list guard and hands back there instead. See the note in section 3.
  ok((branch.match(/await leaveWith\(\[\]\);/g) || []).length === 2,
    'every one of its two exits hands back with nothing to ask about');
  ok(!/leaveWith\(matched\)/.test(branch), 'and never with a match to confirm by hand');
  // THE REFUSALS ARE THE SAME TWO, IN THE SAME WORDS.
  ok(/if \(detail\.wantsSignIn === true\) \{[\s\S]{0,120}setNeedsSignIn\(true\);/.test(branch), 'a sign in wall stops it');
  ok(/if \(detail\.whyNot != null\) \{[\s\S]{0,120}setRefused\(detail\.whyNot\);/.test(branch), 'and so does a refusal');
  // AND NOWHERE IS NO LONGER IN HERE AT ALL — it is answered above, before the
  // list is even built, which is the only place it could ever be reached from.
  ok(!branch.includes('NOWHERE'),
    'the one-page branch no longer carries a dead NOWHERE arm');
  // THE LOG NEVER CARRIES THE KEY OR THE PAGE.
  const lines = code.match(/logLook\('watched',[\s\S]*?\);/g) || [];
  ok(lines.length === 2, 'two watched lines in the screen');
  // THE PAGE IS `${one.html}` OR `${detail.text}` ON A LINE; its LENGTH is a
  // count and is what the order page line already prints.
  ok(lines.every((l) => !/watchedKey|how\.url|\$\{detail\.text\}|\$\{one\.html\}|\$\{one\.text\}/.test(l)),
    'and neither carries the key, the address or the page');

  // THE LIST PATH IS EXACTLY AS IT WAS for a task with no key.
  ok(/if \(fromTheSearch\.length === 0\) \{\s*const answer = await openWith\(theList\);/.test(code),
    'and the list is still opened, after the search, for everybody without a key');
}

console.log('\n=== 4. THE DELIVERY READ OPENS THE SAME ONE PAGE, AND OFFERS NO PHOTOGRAPH ===');
{
  const code = withoutComments(read('src/screens/delivery.js'));
  ok(/navigation\.navigate\('LookingForIt', \{ campaignId, onlyThisOrder: itsOrder \}\)/.test(code),
    'the delivery step starts the SAME read, which reads the watched page off the record');
  ok(!/orderDetailPageFor|theOrderPage\(|sendFoundOrders/.test(code), 'and builds no address and reads nothing itself');
  // THE PHOTOGRAPH IS NOT OFFERED TO A SHOP INSIDE FAYR.
  const offer = code.indexOf('Send a picture of the delivery');
  ok(offer > -1, 'the door still exists for the four other shops');
  const guard = code.slice(code.lastIndexOf('{', code.lastIndexOf('<Ghost', offer)), code.lastIndexOf('?', code.lastIndexOf('<Ghost', offer)) + 1);
  ok(/!asksNothing/.test(guard), `and is shut for a shop inside Fayr: ${guard.trim()}`);
  ok((code.match(/<Ghost\b/g) || []).length === 1, 'and there is still exactly one quiet door');
  // ── AND THE QUESTION IS UP AGAIN, WHICH IS A DIFFERENT FLAG — 21 Sep 2026 ─
  //
  // This line used to read `&& !asksNothing`, pinning "the question is never up
  // for a shop inside Fayr". The owner reversed that on 21 September: the tap is
  // the trigger again. What THIS section is about is the PHOTOGRAPH, and that
  // did not change — so the two were split onto two flags and only this one is
  // still asksNothing. The reversal itself is pinned, with his words, in
  // src/journey/deliveryCadence.test.mjs section 4.
  ok(/const asking = \(where === 'asking' \|\| mustAsk\) && !delivered\s*&& !theShopLooksWithoutBeingAsked;/.test(code),
    'while the question is governed by its own flag, not by the photograph\u2019s');
  ok(!/&& !delivered && !asksNothing;/.test(code),
    'AND THE TWO ARE NOT ONE FLAG AGAIN, which is how the camera door would reopen');
  // THE CARD'S SENTENCE GOES WITH THE DOOR.
  ok(/\{!asksNothing\s*\?\s*` If it has arrived and \$\{shop\} is slow to say so, send us a `/.test(code),
    'and the card offers a picture only where a picture is offered');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
