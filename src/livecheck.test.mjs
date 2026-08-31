// The live page check, on the device — both halves, under node.
import assert from 'node:assert/strict';
import {
  LIVE_STATES,
  PAGE_PHRASES,
  PAGE_TIMEOUT_MS,
  buildPageScript,
  cardState,
  readPageOutcome,
  splitByWhetherThereIsAPage,
  summariseRun,
} from './livecheck.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log('  PASS ' + name); }
  catch (err) { failed += 1; console.log('  FAIL ' + name + '\n        ' + err.message); }
}

const page = (extra) => 'x'.repeat(600) + ' ' + (extra || '');

console.log('\nreading a shop page');
test('a page that loads with nothing wrong opened', () => {
  const out = readPageOutcome(page('Add to cart'), 200);
  assert.equal(out.state, 'opened');
  assert.equal(out.evidence, null);
});

test('a page that says sold out is sold out, and says which words decided it', () => {
  const out = readPageOutcome(page('Currently out of stock'), 200);
  assert.equal(out.state, 'sold-out');
  assert.match(out.evidence, /out of stock/);
});

test('a page that says the offer ended is expired', () => {
  assert.equal(readPageOutcome(page('This offer has ended'), 200).state, 'expired');
});

test('a page that says the item is unavailable is unavailable', () => {
  assert.equal(readPageOutcome(page('Currently unavailable'), 200).state, 'unavailable');
  assert.equal(readPageOutcome(page('No longer available'), 200).state, 'unavailable');
});

test('the shop saying not found means a shopper cannot buy it', () => {
  assert.equal(readPageOutcome('', 404).state, 'unavailable');
  assert.equal(readPageOutcome('', 410).state, 'unavailable');
});

test('the shop having a bad moment is about the shop, not the offer', () => {
  // A 500 must never grey out a working offer.
  for (const code of [500, 502, 503]) {
    assert.equal(readPageOutcome('', code).state, 'could-not-open');
  }
});

test('nothing coming back at all is honestly "we could not look"', () => {
  const out = readPageOutcome('', 0);
  assert.equal(out.state, 'could-not-open');
  assert.match(out.evidence, /Nothing came back/);
});

test('a nearly empty page did not really load', () => {
  const out = readPageOutcome('<html></html>', 200);
  assert.equal(out.state, 'could-not-open');
  assert.match(out.evidence, /almost empty/);
});

test('it ignores capitals, because a shop page does not care', () => {
  assert.equal(readPageOutcome(page('SOLD OUT'), 200).state, 'sold-out');
});

test('the more specific reason wins', () => {
  // A page saying both. "Expired" tells somebody more than "unavailable".
  const out = readPageOutcome(page('Offer expired. Currently unavailable.'), 200);
  assert.equal(out.state, 'expired');
});

test('survives anything that is not a page', () => {
  for (const junk of [null, undefined, 42, {}, []]) {
    const out = readPageOutcome(junk, junk);
    assert.ok(LIVE_STATES.includes(out.state), 'always a real state');
    assert.ok(!JSON.stringify(out).includes('undefined'));
  }
});

test('every state it can return is one the backend knows', () => {
  const produced = new Set();
  for (const [status, html] of [[200, page('ok')], [404, ''], [500, ''], [0, ''], [200, 'tiny'],
    [200, page('sold out')], [200, page('offer expired')], [200, page('currently unavailable')]]) {
    produced.add(readPageOutcome(html, status).state);
  }
  for (const s of produced) assert.ok(LIVE_STATES.includes(s), s + ' is not a real state');
});

test('the phrase list is all lowercase, or nothing would ever match', () => {
  for (const [state, phrases] of PAGE_PHRASES) {
    assert.ok(LIVE_STATES.includes(state), state + ' is not a real state');
    for (const p of phrases) assert.equal(p, p.toLowerCase(), p);
  }
});

console.log('\nwhat there is to look at');
test('an offer with no shop page saved is reported, not skipped', () => {
  const { toOpen, noPage } = splitByWhetherThereIsAPage([
    { campaignId: 'a', platform: 'AMAZON', productUrl: 'https://www.amazon.in/dp/X' },
    { campaignId: 'b', platform: 'MEESHO', productUrl: null },
    { campaignId: 'c', platform: 'FLIPKART', productUrl: '   ' },
  ]);
  assert.equal(toOpen.length, 1);
  assert.equal(noPage.length, 2);
  for (const n of noPage) {
    assert.equal(n.state, 'no-link');
    assert.ok(n.evidence.length > 10, 'says why');
  }
});

test('a saved page that is not a web address is not opened', () => {
  const { toOpen, noPage } = splitByWhetherThereIsAPage([
    { campaignId: 'a', platform: 'AMAZON', productUrl: 'javascript:alert(1)' },
    { campaignId: 'b', platform: 'AMAZON', productUrl: 'file:///etc/passwd' },
  ]);
  assert.equal(toOpen.length, 0);
  assert.equal(noPage.length, 2);
});

test('a shop Fayr cannot open is said so, not guessed at', () => {
  const { toOpen, noPage } = splitByWhetherThereIsAPage([
    { campaignId: 'a', platform: 'SOMESHOP', productUrl: 'https://example.com/p' },
  ]);
  assert.equal(toOpen.length, 0);
  assert.match(noPage[0].evidence, /does not know how to open/);
});

test('survives a list that is not a list', () => {
  for (const junk of [null, undefined, 'x', 42, [null, undefined, 7]]) {
    const out = splitByWhetherThereIsAPage(junk);
    assert.ok(Array.isArray(out.toOpen) && Array.isArray(out.noPage));
  }
});

console.log('\nthe script that opens one page');
test('posts back exactly once, through the same channel as the scraper', () => {
  const script = buildPageScript('https://www.amazon.in/dp/X');
  assert.ok(script.includes('window.ReactNativeWebView.postMessage'), 'same channel');
  assert.ok(script.includes('if (sent) return; sent = true;'), 'posts once');
  assert.ok(script.includes('credentials:'), "uses the shopper's own session");
});

test('gives up rather than trying again', () => {
  const script = buildPageScript('https://www.amazon.in/dp/X');
  assert.ok(script.includes(String(PAGE_TIMEOUT_MS)), 'has a time limit');
  assert.ok(!/retry|attempt\s*\+\+|for\s*\(/i.test(script), 'no retrying anywhere');
});

test('the address cannot break out of the script', () => {
  const nasty = 'https://x.example/p"); alert(1); //';
  const script = buildPageScript(nasty);
  // JSON.stringify is what makes this safe; the raw quote must not appear.
  assert.ok(!script.includes('p"); alert(1)'), 'the address is quoted properly');
  assert.ok(script.includes(JSON.stringify(nasty)));
});

test('reads the page and does nothing else', () => {
  const script = buildPageScript('https://www.amazon.in/dp/X');
  // Careful with the word "post": the script legitimately calls postMessage to
  // report back. What must not appear is an HTTP POST or a form being sent.
  assert.ok(!/\.click\(|\.submit\(|method:\s*['\"]POST/i.test(script),
    'no clicking, no forms, no sending anything to the shop');
  assert.ok(script.includes('postMessage'), 'but it does report back');
});

console.log('\nthe morning summary');
test('counts every state and says how many could not be looked at', () => {
  const out = summariseRun([
    { state: 'opened' }, { state: 'opened' }, { state: 'sold-out' },
    { state: 'no-link' }, { state: 'could-not-open' },
  ]);
  assert.equal(out.checked, 5);
  assert.equal(out.counts.opened, 2);
  assert.equal(out.problems, 1);
  assert.equal(out.couldNotLook, 2);
  for (const s of LIVE_STATES) assert.equal(typeof out.counts[s], 'number');
});

test('an empty run is all zeros, never blank', () => {
  const out = summariseRun([]);
  assert.equal(out.checked, 0);
  for (const s of LIVE_STATES) assert.equal(out.counts[s], 0);
  assert.ok(!JSON.stringify(out).includes('undefined'));
});

console.log('\nthe greyed-out card');
test('an ordinary offer is not greyed out and can be claimed', () => {
  const out = cardState({ availability: { greyedOut: false, label: null, reason: null } });
  assert.equal(out.greyedOut, false);
  assert.equal(out.canClaim, true);
  assert.equal(out.label, null);
  assert.equal(out.cta, null);
});

test('an offer that cannot be used is greyed out and says why', () => {
  const out = cardState({
    availability: { greyedOut: true, reason: 'page', label: 'This offer has ended at the shop. It may come back.' },
  });
  assert.equal(out.greyedOut, true);
  assert.equal(out.canClaim, false);
  assert.match(out.label, /come back/);
  assert.ok(out.cta.length > 3, 'the button says something');
});

test('it only ever repeats the words the server sent', () => {
  // No label of its own. Two places writing this sentence is two sentences that
  // drift, and the server is the one that knows why.
  const out = cardState({ availability: { greyedOut: true, label: 'Anything at all.', reason: 'seats' } });
  assert.equal(out.label, 'Anything at all.');
});

test('says nothing rather than guessing when the server said nothing', () => {
  for (const junk of [{}, { availability: null }, { availability: {} }, null, undefined, 42]) {
    const out = cardState(junk);
    assert.equal(out.greyedOut, false);
    assert.equal(out.label, null);
    assert.equal(out.canClaim, true);
  }
});

test('a greyed offer with no words still greys out, silently', () => {
  const out = cardState({ availability: { greyedOut: true, label: null, reason: 'page' } });
  assert.equal(out.greyedOut, true);
  assert.equal(out.label, null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
