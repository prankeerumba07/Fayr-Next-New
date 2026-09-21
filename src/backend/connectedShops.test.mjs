// NEVER ASK A SHOP THAT IS ALREADY CONNECTED.
//
// ── WHAT THIS IS DEFENDING, MEASURED ────────────────────────────────────────
//
// From the owner's own log, 9 September 2026. Amazon connect SUCCEEDED at 19:06.
// At 19:10 the app asked Amazon for its sign in page AGAIN, for a second
// campaign, and Amazon served a body reading only "Click the button below to
// continue shopping", then 503 on /gp/sign-in.html, then its robot puzzle.
//
// The app asked because it did not know. Our side has held the answer since 4
// September — one row per person per shop, for ever — and nothing read it back.
//
// THE STRUCTURAL HALF IS THE IMPORTANT ONE HERE. A store that answers correctly
// and that nothing consults changes nothing, and that was the whole defect.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyProfile, configure, forget, forgetTheReader, haveWeAsked, isConnected,
  list, load, markConnected, markSignedOut, subscribe,
} from './connectedShops.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

/**
 * ── A CRASH IS NOT A CATCH, AND THREE OF THESE GUARDS ONLY CRASH ────────────
 *
 * Found by breaking the code on purpose. Several guards in the store are the only
 * thing between a null and a thrown TypeError: without them `p.connectedShops
 * .filter`, `shopKey.toLowerCase()` and a listener's own error all escape. Called
 * bare, that throw reaches the top of this file, node kills the process, AND NO
 * SUMMARY IS EVER PRINTED — so the mutation harness sees a non-zero exit with
 * nothing run and reports it as caught. That is the hole, not a catch.
 *
 * So every call that a mutation could make throw goes through one of these. A
 * throw becomes a distinctive value that fails its check like anything else, and
 * the summary still prints.
 */
const THREW = Symbol('threw');
function tried(fn) {
  try { return fn(); } catch (e) { return THREW; }
}

console.log('=== 1. nothing is known until our side has been asked ===');
{
  forget();
  ok(haveWeAsked() === false, 'we have not asked');
  ok(list().length === 0, 'so we know of no connected shop');
  // FALSE IS THE SAFE UNKNOWN, AND THE DIRECTION MATTERS.
  //
  // A wrong false costs one sign in visit nobody needed. A wrong true drops
  // somebody into a shop they are not signed in at, where the read finds nothing
  // and they are told to come back — with no way to sign in, because the step
  // that offers it was skipped. So unknown goes the way that always has a way on.
  ok(isConnected('amazon') === false,
    'AND AN UNASKED SHOP IS NOT CONNECTED, because the wrong true has no way out');
  // FOUND BY BREAKING THE CODE. This file asked markConnected about junk and
  // never asked isConnected, so the guard on the question everything actually
  // calls could be deleted with every check still green.
  for (const junk of ['', null, undefined, 42, {}, [], true]) {
    ok(tried(() => isConnected(junk)) === false,
      `asked about ${JSON.stringify(junk) ?? String(junk)}, the answer is no and not a crash`);
  }
}

console.log('\n=== 2. our side answered ===');
{
  forget();
  ok(applyProfile({ connectedShops: ['amazon'] }) === true, 'the list is taken');
  ok(haveWeAsked() === true, 'and we have now asked');
  ok(isConnected('amazon') === true, 'AMAZON IS CONNECTED, so it is never asked again');
  ok(isConnected('flipkart') === false, 'and a shop not in the list is not');
  ok(list().length === 1 && list()[0] === 'amazon', 'and the list is what came back');
}

console.log('\n=== 3. AN OLDER SERVER IS NOT AN EMPTY LIST ===');
{
  // THE TRAP IN THIS WHOLE CHANGE. A build of our side without the field, or a
  // reply we could not read, must leave what we already knew. Reading it as
  // "nothing is connected" would put the sign in step back for everybody, which
  // is the exact behaviour being removed.
  forget();
  applyProfile({ connectedShops: ['amazon'] });
  for (const notAnAnswer of [
    {}, { connectedShops: null }, { connectedShops: 'amazon' },
    { connectedShops: undefined }, null, undefined, 'nope', 42,
  ]) {
    ok(tried(() => applyProfile(notAnAnswer)) === false,
      `${JSON.stringify(notAnAnswer) ?? String(notAnAnswer)} is not an answer`);
    ok(isConnected('amazon') === true, '  and Amazon is still known to be connected');
  }
  // AND A REAL EMPTY LIST IS A REAL ANSWER.
  ok(applyProfile({ connectedShops: [] }) === true, 'a real empty list IS taken');
  ok(isConnected('amazon') === false, 'and it means no shop is connected');
}

console.log('\n=== 4. they signed in just now, so stop asking within this session ===');
{
  forget();
  applyProfile({ connectedShops: [] });
  ok(markConnected('amazon') === true, 'the sign in is written down here too');
  ok(isConnected('amazon') === true, 'and the shop is not asked again');
  ok(markConnected('amazon') === false, 'writing it twice changes nothing');
  ok(list().length === 1, 'and does not put it in the list twice');
  for (const junk of ['', null, undefined, 42, {}]) {
    ok(tried(() => markConnected(junk)) === false,
      `${JSON.stringify(junk) ?? String(junk)} marks nothing`);
  }
}

console.log('\n=== 5. one spelling, whatever it arrives as ===');
{
  // Our side stores AMAZON, the app says 'amazon', and a comparison between the
  // two would silently answer false for ever.
  forget();
  applyProfile({ connectedShops: ['AMAZON', 'Flipkart'] });
  ok(isConnected('amazon') === true, 'AMAZON from our side matches amazon here');
  ok(isConnected('AMAZON') === true, 'and it is asked either way round');
  ok(isConnected('flipkart') === true, 'and a mixed case name too');
  ok(list().every((s) => s === s.toLowerCase()), 'the stored list is all one case');
  forget();
  applyProfile({ connectedShops: ['amazon', '', null, 7, 'zepto'] });
  ok(list().length === 2, 'and rubbish in the list is dropped rather than stored');
}

console.log('\n=== 6. signing out forgets it, and a listener is told ===');
{
  forget();
  applyProfile({ connectedShops: ['amazon'] });
  let told = 0;
  const un = subscribe(() => { told += 1; });
  forget();
  ok(isConnected('amazon') === false,
    'ONE PERSON LIST IS NEVER LEFT FOR THE NEXT, or they are dropped into a shop '
    + 'they have no account on with the sign in step skipped');
  ok(haveWeAsked() === false, 'and we are back to knowing nothing');
  ok(told === 1, 'and whoever was watching was told');
  un();
  forget();
  ok(told === 1, 'and is not told after it has stopped watching');
  // A LISTENER THAT THROWS MUST NOT BREAK THE STORE.
  const un2 = subscribe(() => { throw new Error('bad listener'); });
  let alsoTold = 0;
  const un3 = subscribe(() => { alsoTold += 1; });
  const answer = tried(() => applyProfile({ connectedShops: ['zepto'] }));
  ok(answer === true,
    'a listener that throws does not take the store down with it');
  ok(alsoTold === 1, 'and does not stop the next one being told');
  un2(); un3();
  // AND WHAT IS HANDED OUT CANNOT EDIT THE STORE.
  forget();
  applyProfile({ connectedShops: ['amazon'] });
  const handed = list();
  handed.push('flipkart');
  ok(isConnected('flipkart') === false, 'and editing the handed list changes nothing');
}

console.log('\n=== 7. THE GATE ACTUALLY READS IT ===');
{
  // A store nothing consults is the defect, not the fix.
  const screen = read('src/journey/JourneyScreen.js');
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/import \{ isConnected as isShopConnected \} from '\.\.\/backend\/connectedShops'/
    .test(code), 'the journey screen can read our side record');
  ok(/connected:\s*isShopConnected\(marketplace\)/.test(code),
    'AND OUR RECORD IS THE FIRST OF THE FOUR ANSWERS');
  // THE OTHER THREE ARE KEPT. Each is still a true reason, and our side can be a
  // moment behind on a first launch, so any one of the four is enough.
  ok(/\|\| !!\(authoritative && authoritative\.order\)/.test(code),
    'the task own order still counts');
  ok(/\|\| purchaseShots > 0/.test(code), 'a purchase screenshot still counts');
  ok(/\|\| hasVisitedShop\(campaignId, SIGNED_IN\)/.test(code),
    'and the note on the phone still counts');

  // AND THE GATE IT FEEDS IS STILL THE ONE LINE.
  const journey = read('src/ui/journey.js');
  ok(/if \(s\.connected !== true\) return 'connect';/.test(journey),
    'the one line that decides whether to connect is untouched');
}

console.log('\n=== 8. AND IT IS LOADED, REFRESHED, AND FORGOTTEN ===');
{
  const app = read('App.js');
  const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/import \* as connectedShops from '\.\/src\/backend\/connectedShops'/.test(code),
    'App.js can reach the store');
  ok(/connectedShops\.load\(\);/.test(code), 'and asks our side on the way in');
  ok((code.match(/connectedShops\.load\(\)/g) || []).length === 2,
    'twice: once on the way in, and again on coming back from a shop');
  ok(/connectedShops\.forget\(\);/.test(code), 'and forgets it on sign out');
  ok(/connectedShops\.configure\(getProfile\);/.test(code),
    'and hands it the real profile reader, since it imports nothing itself');

  // THE SIGN OUT FORGET IS INSIDE THE SIGNED-OUT BRANCH, not merely present.
  const outAt = code.indexOf('if (!signedIn) {');
  const forgetAt = code.indexOf('connectedShops.forget();');
  ok(outAt !== -1 && forgetAt > outAt && forgetAt - outAt < 400,
    'and the forget is in the signed-out branch, not somewhere it never runs');

  // THE MOMENT THEY SIGN IN, WITHOUT WAITING FOR A ROUND TRIP.
  const connect = read('src/ConnectScreen.js');
  const cCode = connect.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/markConnected\(platform\.key\);/.test(cCode),
    'and a fresh sign in is written down here at once');
  const reported = cCode.indexOf('reportShopSignIn(platform.key');
  const marked = cCode.indexOf('markConnected(platform.key)');
  ok(reported !== -1 && marked > reported,
    'right after our side is told, so the two cannot disagree');
}

console.log('\n=== 9. AND THE FIELD SURVIVES THE APP OWN WHITELIST ===');
{
  // getProfile copies named fields and DROPS the rest, so a field our side sends
  // and that list does not name can never reach a screen. Same shape as the
  // optimistic whitelist in taskStore.js, which swallowed `quantity` for months.
  const api = read('src/backend/meApi.js');
  ok(/connectedShops: Array\.isArray\(b\.connectedShops\) \? b\.connectedShops : null,/
    .test(api),
  'the field is carried, and NULL when our side did not send it');
  ok(!/connectedShops: Array\.isArray\(b\.connectedShops\) \? b\.connectedShops : \[\]/
    .test(api),
  'and NOT an empty list, which would read an older server as "nothing connected"');
}

console.log('\n=== 10. ASKING OUR SIDE, AND EVERY WAY IT CAN GO WRONG ===');
{
  // Walkable at all ONLY because the reader is handed in. The same arrangement
  // evidenceSync and the task store's outbox already use, and for this reason:
  // a store that reaches the transport cannot be loaded under node.
  forget(); forgetTheReader();
  ok(await load() === false, 'NO READER WIRED asks nothing and claims nothing');
  ok(haveWeAsked() === false, 'and does not pretend it asked');

  configure(async () => ({ ok: true, profile: { connectedShops: ['amazon'] } }));
  ok(await load() === true, 'a good answer is taken');
  ok(isConnected('amazon') === true, 'and Amazon is not asked again');

  // A FAILED CALL LEAVES WHAT WE KNEW. Being wrong the other way costs a sign in
  // visit nobody needed, and every one of those brings the robot block closer.
  for (const bad of [
    { ok: false, status: 500 }, { ok: true, profile: null }, { ok: true }, null, undefined,
  ]) {
    configure(async () => bad);
    ok(await load() === false,
      `${JSON.stringify(bad) ?? String(bad)} changes nothing`);
    ok(isConnected('amazon') === true, '  and Amazon is still known to be connected');
  }
  // AND A READER THAT THROWS IS NOT A REASON TO GUESS.
  configure(async () => { throw new Error('no signal'); });
  ok(await load() === false, 'a reader that throws answers no');
  ok(isConnected('amazon') === true, 'and leaves what we knew');
  configure(() => { throw new Error('threw before any promise'); });
  ok(await load() === false, 'and one that throws before it even returns a promise');
  forgetTheReader(); forget();
}

console.log('\nthe shop’s own word outranks a record that can never be un-written');
{
  // ── THE DEFECT — 21 SEPTEMBER 2026 ──────────────────────────────────────
  //
  // The owner signed OUT of Zepto and claimed a campaign. He landed on Zepto's
  // homepage instead of its sign in page. Our side's record said connected and
  // always would: the row carries a firstAt and a howWeKnew and no third state,
  // and the server's upsert says `update: {}` in as many words. It records that
  // somebody signed in ON SOME DAY — which is true, and is NOT the question
  // isConnected is asked. That question is "are they signed in NOW".
  forget();
  applyProfile({ connectedShops: ['zepto', 'amazon'] });
  ok(isConnected('zepto'), 'our side says connected, as it always will');

  markSignedOut('zepto');
  ok(!isConnected('zepto'),
    'AND THE SHOP SAYING OTHERWISE OUTRANKS IT');
  ok(isConnected('amazon'),
    'and only that shop — one shop’s login form says nothing about another');

  // IT SUBTRACTS AND NEVER ADDS. The record itself is untouched, because it is
  // still true; what changes is only what isConnected answers while this app is
  // open. So the list our side sent is still the list our side sent.
  ok(list().includes('zepto'),
    'the record is left exactly as our side sent it');

  // AND OUR SIDE PUTS IT BACK ON EVERY FOREGROUND. applyProfile REPLACES the
  // list wholesale, so without the override surviving that, the stale yes would
  // return within seconds of being corrected — which is the whole bug again.
  applyProfile({ connectedShops: ['zepto', 'amazon'] });
  ok(!isConnected('zepto'),
    'AND A PROFILE READ DOES NOT PUT THE STALE YES BACK');

  // SIGNING IN AGAIN, IN FRONT OF US, CLEARS IT. Whichever the shop said last is
  // the one that is true; leaving the older reading standing would send somebody
  // who has just signed in to sign in again.
  markConnected('zepto');
  ok(isConnected('zepto'), 'and the shop saying they are in clears it again');

  // AND IT DOES NOT SURVIVE ONE PERSON INTO THE NEXT. A leftover "signed out"
  // would send somebody to sign in at a shop they are signed in at, just as
  // surely as a leftover "connected" would do the reverse.
  markSignedOut('zepto');
  forget();
  applyProfile({ connectedShops: ['zepto'] });
  ok(isConnected('zepto'), 'signing out of Fayr forgets it too');

  // JUNK IS NOT A SHOP.
  for (const junk of [null, undefined, '', 0, {}, []]) {
    ok(markSignedOut(junk) === false, `${String(junk)} is not a shop`);
  }
  forget();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
