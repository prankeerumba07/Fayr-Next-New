// THE WAITING BOX ON THE HOME PAGE, decided here and nowhere else.
//
// The owner asked for this on 1 September 2026: he must not have to tap My
// Products to find out where a claim stands. The design has had the card since the
// beginning (fayr-design.browser.jsx:3720, RotatingStatusCard) and it had never
// been built.
//
// THE ONE THING THIS FILE EXISTS TO PROVE: no task state falls through to a blank
// box. Every state, every blocker, every closed reason has words. The list of
// situations is checked against the engine's own list of states, so a state added
// to the machine without words here is a failing test rather than an empty card
// in front of somebody waiting on their money.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { STATES, BLOCKERS } from '../taskflow.js';
import {
  SITUATIONS,
  dismissKeyFor,
  situationFor,
  waitingBox,
  waitingBoxes,
  wordsFor,
} from './waiting.js';

let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL ' + name + ' — ' + e.message);
    process.exitCode = 1;
  }
};

const NOW = Date.parse('2026-09-02T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;

/** A live claim: reserved, nothing bought, twenty minutes left. */
const liveClaim = (over = {}) => ({
  id: 'task-1',
  state: STATES.CLAIMED,
  campaign: { id: 'camp-1', productName: 'boAt Rockerz 255 Pro+', imageUrl: null },
  order: null,
  delivery: null,
  review: null,
  returned: null,
  blocker: null,
  blockerReason: null,
  windowEndsAt: null,
  claimExpiresAt: iso(NOW + 20 * MIN),
  closedAt: null,
  closeReason: null,
  ...over,
});

const campaign = (over = {}) => ({
  id: 'camp-1',
  productName: 'boAt Rockerz 255 Pro+',
  imageUrl: null,
  availability: { greyedOut: false, label: null, reason: null },
  ...over,
});

// ── 1. every situation has words, and nothing is blank ───────────────────────

console.log('1. no state, blocker or reason falls through to a blank box');

t('every situation in the list has a full set of words', () => {
  assert.ok(SITUATIONS.length >= 15, `only ${SITUATIONS.length} situations`);
  for (const key of SITUATIONS) {
    const w = wordsFor(key);
    assert.ok(w, `${key} has no words at all`);
    for (const field of ['status', 'tone']) {
      assert.ok(
        typeof w[field] === 'string' && w[field].length > 2,
        `${key} has no ${field}`,
      );
    }
    // `cta` may be null — a situation with nothing to do must not invent a
    // button — but when there is one it has to read as an action.
    if (w.cta !== null) {
      assert.ok(
        typeof w.cta === 'string' && w.cta.length > 2,
        `${key} has a cta that is not a label`,
      );
    }
    assert.ok(typeof w.waiting === 'boolean', `${key} does not say whether it waits`);
  }
});

t('an unknown situation is answered with nothing, never a guess', () => {
  assert.equal(wordsFor('not-a-situation'), null);
  assert.equal(wordsFor(null), null);
  assert.equal(wordsFor(undefined), null);
});

t('EVERY task state the engine has produces a situation with words', () => {
  // The check that matters. Not a list I typed: the engine's own STATES.
  for (const state of Object.values(STATES)) {
    const task = liveClaim({ state });
    // A state past CLAIMED implies an order exists, which is how the machine
    // works — so give it one, otherwise this tests an impossible task.
    if (state !== STATES.CLAIMED) {
      task.order = { id: 'o1', orderConfirmed: true, product: 'x' };
    }
    const key = situationFor(task, NOW);
    assert.ok(key, `${state} produced no situation`);
    assert.ok(SITUATIONS.includes(key), `${state} produced unknown situation ${key}`);
    const w = wordsFor(key);
    assert.ok(w && w.status, `${state} -> ${key} has no words`);
  }
});

t('EVERY blocker the engine has produces a situation with words', () => {
  for (const blocker of Object.values(BLOCKERS)) {
    const task = liveClaim({
      state: STATES.PURCHASED,
      order: { id: 'o1', orderConfirmed: true, product: 'x' },
      blocker,
    });
    const key = situationFor(task, NOW);
    assert.ok(key, `${blocker} produced no situation`);
    const w = wordsFor(key);
    assert.ok(w && w.status, `${blocker} -> ${key} has no words`);
    // And it must not read as an enum. The Task screen used to print these raw.
    assert.doesNotMatch(w.status, /_/, `${blocker} shows an enum to the person`);
  }
});

t('a blocker nobody has heard of still says something sensible', () => {
  const key = situationFor(
    liveClaim({ state: STATES.PURCHASED, order: { id: 'o1' }, blocker: 'brand_new_thing' }),
    NOW,
  );
  const w = wordsFor(key);
  assert.ok(w && w.status);
  assert.doesNotMatch(w.status, /brand_new_thing/);
});

t('every closed reason says what happened', () => {
  for (const reason of ['expired', 'cancelled', 'refunded', 'something-else', null]) {
    const key = situationFor(
      liveClaim({ closedAt: iso(NOW - MIN), closeReason: reason }),
      NOW,
    );
    assert.ok(key, `closeReason ${reason} produced no situation`);
    assert.ok(wordsFor(key).status, `closeReason ${reason} has no words`);
  }
});

t('no words anywhere use a short code, an abbreviation or a double dash', () => {
  for (const key of SITUATIONS) {
    const w = wordsFor(key);
    for (const text of [w.status, w.cta, w.line].filter(Boolean)) {
      assert.doesNotMatch(text, /--/, `${key}: a double dash in "${text}"`);
      assert.doesNotMatch(text, /\bT&C|ToS|OCR|DKIM|UTR|SLA\b/i, `${key}: a short code in "${text}"`);
      assert.doesNotMatch(text, /[A-Z_]{4,}/, `${key}: an enum in "${text}"`);
    }
  }
});

// ── 2. the owner's two named states ──────────────────────────────────────────

console.log('\n2. the two states the owner named himself');

t('a live claim shows the slot, a timer, and going to buy', () => {
  const box = waitingBox(liveClaim(), campaign(), NOW);
  assert.equal(box.situation, 'to-buy');
  assert.match(box.status, /Slot reserved/i);
  assert.equal(box.timer, '20m : 00s');
  assert.equal(box.ticking, true);
  assert.match(box.cta, /buy/i);
  assert.equal(box.over, false);
});

t('a bought claim waiting on a picture says to send one', () => {
  const box = waitingBox(
    liveClaim({
      state: STATES.PURCHASED,
      order: { id: 'o1', product: 'x' },
      blocker: BLOCKERS.ORDER_UNREADABLE,
      claimExpiresAt: null,
    }),
    campaign(),
    NOW,
  );
  assert.equal(box.situation, 'send-order-picture');
  assert.match(box.cta, /picture/i);
  // No timer once the purchase is made: the thirty minutes were for buying.
  assert.equal(box.timer, null);
});

// ── 3. the timer, and the slot running out ───────────────────────────────────

console.log('\n3. the timer is the task’s own deadline, and it never sits at zero');

t('the clock counts down from the record, not from a number in the app', () => {
  const box = waitingBox(liveClaim({ claimExpiresAt: iso(NOW + 9 * MIN + 5000) }), campaign(), NOW);
  assert.equal(box.timer, '9m : 05s');
});

t('a claim whose slot has run out says so, and does not say "go and buy"', () => {
  // The sweep that closes a lapsed claim runs hourly, so a claim can be PAST its
  // deadline and still open in the record. The box must read the clock, not wait
  // for the sweep, or it spends up to an hour telling somebody to go and buy
  // something they can no longer be paid for.
  const box = waitingBox(liveClaim({ claimExpiresAt: iso(NOW - MIN) }), campaign(), NOW);
  assert.equal(box.situation, 'slot-ran-out');
  assert.equal(box.over, true);
  assert.equal(box.timer, null);
  assert.equal(box.ticking, false);
  assert.doesNotMatch(box.status, /buy/i);
  assert.doesNotMatch(box.cta, /buy/i);
  // And it offers the way back, the same as the claimed sheet does.
  assert.match(box.cta, /offer/i);
});

t('a claim the sweep has already closed says the same thing', () => {
  const box = waitingBox(
    liveClaim({ closedAt: iso(NOW - MIN), closeReason: 'expired', claimExpiresAt: iso(NOW - 2 * MIN) }),
    campaign(),
    NOW,
  );
  assert.equal(box.situation, 'slot-ran-out');
});

t('a claim with no deadline at all shows no timer rather than a wrong one', () => {
  const box = waitingBox(liveClaim({ claimExpiresAt: null }), campaign(), NOW);
  assert.equal(box.situation, 'to-buy');
  assert.equal(box.timer, null);
  assert.equal(box.over, false);
});

t('only the buying step ever carries a timer', () => {
  // A countdown on "waiting for delivery" would be inventing a deadline the
  // system does not have.
  for (const state of [STATES.PURCHASED, STATES.DELIVERED, STATES.REVIEWED,
                       STATES.HOLDING, STATES.REFUNDED]) {
    const box = waitingBox(
      liveClaim({ state, order: { id: 'o1', orderConfirmed: true } }),
      campaign(),
      NOW,
    );
    if (!box) continue;
    assert.equal(box.timer, null, `${state} carries a timer`);
  }
});

// ── 4. what is drawn, and what is not ────────────────────────────────────────

console.log('\n4. nothing waiting means nothing drawn');

t('no tasks at all means no box', () => {
  assert.deepEqual(waitingBoxes({ tasks: [], campaigns: [], now: NOW }), []);
  assert.deepEqual(waitingBoxes({ tasks: null, campaigns: null, now: NOW }), []);
  assert.deepEqual(waitingBoxes({}), []);
});

t('a finished and paid claim is not drawn, but it still has words', () => {
  // The design's own Home filters finished claims out of the card. The money is
  // in the wallet and the wallet screen says so, so a box about it is noise.
  // It still has words, because "no state is blank" has to hold for all of them.
  const paid = liveClaim({
    state: STATES.REFUNDED,
    order: { id: 'o1', orderConfirmed: true },
    closedAt: iso(NOW - MIN),
    closeReason: 'refunded',
  });
  assert.equal(situationFor(paid, NOW), 'paid');
  assert.ok(wordsFor('paid').status);
  assert.equal(wordsFor('paid').waiting, false);
  assert.equal(waitingBox(paid, campaign(), NOW), null);
  assert.deepEqual(
    waitingBoxes({ tasks: [paid], campaigns: [campaign()], now: NOW }),
    [],
  );
});

t('a task with no campaign behind it is skipped rather than drawn half empty', () => {
  const boxes = waitingBoxes({ tasks: [liveClaim()], campaigns: [], now: NOW });
  assert.equal(boxes.length, 1, 'the task’s own campaign summary is enough');
  assert.match(boxes[0].productName, /boAt/);
});

t('rubbish in the list is ignored, not rendered', () => {
  const boxes = waitingBoxes({
    tasks: [null, undefined, {}, liveClaim()],
    campaigns: [campaign()],
    now: NOW,
  });
  assert.equal(boxes.length, 1);
});

// ── 5. several claims at once ────────────────────────────────────────────────

console.log('\n5. more than one claim waiting');

t('every waiting claim gets its own box', () => {
  const a = liveClaim({ id: 'task-a', campaign: { id: 'camp-1', productName: 'A' } });
  const b = liveClaim({
    id: 'task-b',
    state: STATES.DELIVERED,
    order: { id: 'o1', orderConfirmed: true },
    claimExpiresAt: null,
    campaign: { id: 'camp-2', productName: 'B' },
  });
  const boxes = waitingBoxes({ tasks: [a, b], campaigns: [campaign(), campaign({ id: 'camp-2' })], now: NOW });
  assert.equal(boxes.length, 2);
  assert.deepEqual(boxes.map((x) => x.situation).sort(), ['to-buy', 'to-review']);
});

t('the one with a running clock comes first, because it is the one that expires', () => {
  const ticking = liveClaim({ id: 'task-a', campaign: { id: 'camp-1', productName: 'A' } });
  const calm = liveClaim({
    id: 'task-b',
    state: STATES.HOLDING,
    order: { id: 'o1', orderConfirmed: true },
    claimExpiresAt: null,
    windowEndsAt: iso(NOW + 5 * 86_400_000),
    campaign: { id: 'camp-2', productName: 'B' },
  });
  const boxes = waitingBoxes({ tasks: [calm, ticking], campaigns: [], now: NOW });
  assert.equal(boxes[0].situation, 'to-buy');
});

// ── 6. the dismissal wears off ───────────────────────────────────────────────

console.log('\n6. closing it is for that claim and that state only');

t('the key names the claim AND what is being said', () => {
  const box = waitingBox(liveClaim(), campaign(), NOW);
  assert.equal(dismissKeyFor(box), 'task-1::to-buy');
});

t('the same claim in a new state gets a NEW key, so the box comes back', () => {
  // THE OWNER'S OWN REQUIREMENT. Somebody who closes "go and buy it" has to see a
  // new box when the state moves on to "send us a picture". Keyed on the claim
  // alone, one dismissal would silently switch off every future reminder for that
  // claim — including the one that says their money is ready.
  const before = waitingBox(liveClaim(), campaign(), NOW);
  const after = waitingBox(
    liveClaim({
      state: STATES.DELIVERED,
      order: { id: 'o1', orderConfirmed: true },
      claimExpiresAt: null,
    }),
    campaign(),
    NOW,
  );
  assert.notEqual(dismissKeyFor(before), dismissKeyFor(after));
});

t('and a slot running out is a new key too, not the same "go and buy"', () => {
  // Without this, dismissing "go and buy it" would also silence "your slot ran
  // out" — the state the engine has not even changed yet, because the sweep is
  // hourly. The record still says CLAIMED, so a key built from the state alone
  // would be identical.
  const live = waitingBox(liveClaim(), campaign(), NOW);
  const lapsed = waitingBox(liveClaim({ claimExpiresAt: iso(NOW - MIN) }), campaign(), NOW);
  assert.notEqual(dismissKeyFor(live), dismissKeyFor(lapsed));
});

t('two claims in the same state have different keys', () => {
  const a = dismissKeyFor(waitingBox(liveClaim({ id: 'task-a' }), campaign(), NOW));
  const b = dismissKeyFor(waitingBox(liveClaim({ id: 'task-b' }), campaign(), NOW));
  assert.notEqual(a, b);
});

t('every blocker is its own message, so one dismissal does not hide the next', () => {
  const keys = new Set();
  for (const blocker of Object.values(BLOCKERS)) {
    keys.add(dismissKeyFor(waitingBox(
      liveClaim({
        state: STATES.PURCHASED,
        order: { id: 'o1' },
        claimExpiresAt: null,
        blocker,
      }),
      campaign(),
      NOW,
    )));
  }
  assert.equal(keys.size, Object.values(BLOCKERS).length, 'two blockers share one key');
});

t('the key is a plain string with nothing private in it', () => {
  const box = waitingBox(liveClaim(), campaign(), NOW);
  const key = dismissKeyFor(box);
  assert.equal(typeof key, 'string');
  // It is held in memory and never logged, but a key carrying a mobile number or
  // a token would be a key that must never be written anywhere at all.
  assert.doesNotMatch(key, /\+?\d{10}/, 'the key carries something like a number');
  assert.doesNotMatch(key, /Bearer|token/i);
});

t('a box with no task id still gets a usable key', () => {
  const box = waitingBox(liveClaim({ id: null }), campaign(), NOW);
  assert.equal(typeof dismissKeyFor(box), 'string');
  assert.ok(dismissKeyFor(box).length > 3);
});

// ── 7. the campaign's status, as well as the product's ───────────────────────

console.log('\n7. the product’s status AND the campaign’s status');

t('a campaign whose shop page has died says so on the box', () => {
  const box = waitingBox(
    liveClaim(),
    campaign({
      availability: {
        greyedOut: true,
        label: 'The shop page for this is not open right now. It may come back.',
        reason: 'page',
      },
    }),
    NOW,
  );
  assert.ok(box.campaignLine, 'the campaign’s own status is not shown');
  assert.match(box.campaignLine, /shop page/i);
});

t('a campaign that has merely filled up says nothing, because a claim is held', () => {
  // "All the places on this offer are taken" is about JOINING. Somebody who has
  // already claimed has their place, and telling them the offer is full would
  // read as their claim being gone.
  const box = waitingBox(
    liveClaim(),
    campaign({
      availability: { greyedOut: true, label: 'All the places on this offer are taken.', reason: 'seats' },
    }),
    NOW,
  );
  assert.equal(box.campaignLine, null);
});

t('a healthy campaign adds no extra line', () => {
  assert.equal(waitingBox(liveClaim(), campaign(), NOW).campaignLine, null);
});

// ── 8. it reads the record, and only the record ──────────────────────────────

console.log('\n8. driven by the record, which is what survives a force quit');

t('nothing in here reads a note on the phone', () => {
  const src = readFileSync(new URL('./waiting.js', import.meta.url), 'utf8');
  for (const name of ['shopVisits', 'AsyncStorage', 'FileSystem', 'localStorage']) {
    assert.ok(!src.includes(name), `waiting.js reads ${name}`);
  }
});

t('it is pure, so this test can read it at all', () => {
  const src = readFileSync(new URL('./waiting.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  for (const from of imports) {
    assert.ok(
      from.endsWith('.js'),
      `${from} has no file extension, so node cannot load it`,
    );
    assert.ok(!from.startsWith('expo'), `${from} cannot be loaded under node`);
    assert.ok(!from.includes('react'), `${from} cannot be loaded under node`);
  }
});

t('the tone is one the screen knows how to colour', () => {
  const tones = ['amber', 'blue', 'purple', 'green', 'red'];
  for (const key of SITUATIONS) {
    assert.ok(tones.includes(wordsFor(key).tone), `${key} has tone ${wordsFor(key).tone}`);
  }
});

// ── 9. the screen really carries it ──────────────────────────────────────────

console.log('\n9. the home page really draws it, and draws it the design’s way');
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const box = strip(readFileSync(new URL('./WaitingBox.js', import.meta.url), 'utf8'));
  const flat = box.replace(/\s+/g, ' ');
  const home = strip(readFileSync(new URL('../HomeScreen.js', import.meta.url), 'utf8'));

  t('it is on the HOME page, which is the owner’s whole point', () => {
    assert.ok(/import WaitingBox/.test(home), 'Home does not import the box');
    assert.ok(/<WaitingBox/.test(home), 'Home never draws the box');
  });

  t('and it is OUTSIDE the scrolling list, so it cannot be scrolled away', () => {
    // The design pins it above the tab bar. Inside the ScrollView it would slide
    // off the top of the screen, which is the same as not having it.
    const afterScroll = home.slice(home.lastIndexOf('</ScrollView>'));
    assert.ok(/<WaitingBox/.test(afterScroll), 'the box is inside the scrolling list');
  });

  t('it clears the tab bar by asking how tall it is', () => {
    // Not a number typed in. The bar's height depends on the phone's own bottom
    // inset, so a written-in guess sits on top of the bar on some phones and
    // floats above it on others.
    assert.ok(/useBottomTabBarHeight/.test(box), 'the box guesses the tab bar height');
    assert.ok(!/bottom: 70/.test(box), 'the box hardcodes the design’s pixel value');
  });

  t('every word it shows comes from the one place that decides them', () => {
    assert.ok(/from '\.\/waiting\.js'/.test(box), 'the box does not use waiting.js');
    // No second table of words. Two copies of "Slot reserved" would drift.
    for (const word of ['Slot reserved', 'Your slot ran out', 'Refund paid']) {
      assert.ok(!flat.includes(word), `the box writes "${word}" itself`);
    }
  });

  t('the cross is there, and it closes ONE message', () => {
    assert.ok(/accessibilityLabel="Close this reminder"/.test(flat), 'there is no cross');
    assert.ok(/closed\.add\(dismissKeyFor\(current\)\)/.test(flat),
      'the cross does not file the dismissal under the message');
    // Not per claim. A dismissal filed under the claim would switch off every
    // future reminder for it, including the one saying the money is ready.
    assert.ok(!/closed\.add\(current\.taskId\)/.test(flat), 'it dismisses the whole claim');
  });

  t('the dismissal is not written to the phone', () => {
    // The owner's requirement is that the box IS THERE when he comes back. A
    // saved dismissal could switch a money reminder off for good.
    for (const name of ['AsyncStorage', 'FileSystem', 'persist(', 'localStorage']) {
      assert.ok(!box.includes(name), `the box saves dismissals with ${name}`);
    }
  });

  t('tapping it opens the journey and names NO step', () => {
    assert.ok(
      /navigation\.navigate\('Journey', \{ campaignId: current\.campaignId \}\)/.test(flat),
      'tapping does not open the claim’s journey',
    );
    assert.ok(!/showPage/.test(box), 'the box tells the journey which page to show');
  });

  t('it asks the backend again on every arrival', () => {
    // This is what makes it right after a force quit: the app comes back with
    // nothing in memory and the list is FETCHED, not remembered.
    assert.ok(/refreshFromBackend\(\)/.test(box), 'the box never refreshes from the backend');
    const focus = (flat.match(/addListener\('focus'[\s\S]{0,220}/) || [''])[0];
    assert.ok(/refreshFromBackend\(\)/.test(focus), 'coming back does not refresh the list');
  });

  t('the clock ticks only while there is a clock, and re-reads the record', () => {
    assert.ok(/if \(!ticking\) return undefined;/.test(flat),
      'the box redraws every second regardless');
    const tick = (flat.match(/setInterval\([\s\S]{0,200}?\}, 1000\)/) || [''])[0];
    assert.ok(/readTasks\(\)/.test(tick), 'the tick does not re-read the record');
  });

  t('it rotates on the design’s own three and a half seconds', () => {
    assert.ok(/ROTATE_MS = 3500/.test(box), 'the rotation is not the design’s timing');
    assert.ok(/count <= 1 \|\| paused/.test(flat),
      'a single claim still rotates, or a held card slides away mid-sentence');
  });

  t('it draws nothing when nothing is waiting', () => {
    assert.ok(/if \(!current\) return null;/.test(flat), 'the box draws an empty card');
  });

  t('it reuses the design’s tone palette rather than a second copy of it', () => {
    assert.ok(/toneOf/.test(box), 'the box does not use the shared tone palette');
    assert.ok(!/#F5A623|#2F6FD0|#7926D9|#30A90F/.test(box), 'the box repeats tone colours');
  });
}

console.log(`\n${passed} passed, ${process.exitCode ? 'some' : '0'} failed`);
