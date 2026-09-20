// WHEN A WAITING SCREEN ASKS AGAIN — every case, including the ones that spin.

import { strict as assert } from 'node:assert';
import {
  AFTER_MS, AT_MOST_MS, FLOOR_MS, IN_SIGHT_MS, THE_WAITING_STATE, askAgainIn,
} from './waitingCadence.js';

const { ok, equal } = assert;
let passed = 0;
let failed = 0;
function it(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS ${name}`); }
  catch (e) { failed += 1; console.log(`  FAIL ${name}\n        ${e.message}`); }
}

const NOW = 1700000000000;
const at = (state, endsInMs) => askAgainIn({
  state,
  windowEndsAt: endsInMs == null ? null : NOW + endsInMs,
  now: NOW,
});

console.log('\nwhen a screen that is only waiting asks our side again');

it('THE REHEARSAL: a two minute hold is asked about before it is over, and after', () => {
  // The owner's own run, 21 September 2026. Two minutes, and the screen sat on
  // "unlocks in 2 minutes" straight through the moment the money landed.
  equal(at(THE_WAITING_STATE, 2 * 60 * 1000), AT_MOST_MS, 'a minute in, while it waits');
  equal(at(THE_WAITING_STATE, 30 * 1000), 31 * 1000, 'then just after the window closes');
  equal(at(THE_WAITING_STATE, -1), AFTER_MS, 'and again once it has closed and nothing has moved');
  equal(at(THE_WAITING_STATE, -60 * 60 * 1000), AFTER_MS, 'however long ago it closed');
});

it('and a window that is not in sight is not asked about at all', () => {
  equal(at(THE_WAITING_STATE, IN_SIGHT_MS + 1), null, 'a long hold is left alone');
  equal(at(THE_WAITING_STATE, 3 * 60 * 60 * 1000), null, 'the product’s own three hours');
  equal(at(THE_WAITING_STATE, IN_SIGHT_MS), AT_MOST_MS, 'and the edge itself is in sight');
});

it('and no other step is asked about, because no other step is waiting for a clock', () => {
  for (const other of [
    'CLAIMED', 'PURCHASED', 'DELIVERED', 'REVIEWED', 'REFUNDED', 'CLOSED', null, undefined, '',
  ]) {
    equal(at(other, 30 * 1000), null, `${String(other)} is not asked about`);
  }
  // AND IT IS MATCHED EXACTLY. A lower-cased state is a bug upstream, not a
  // licence to start polling.
  equal(at('holding', 30 * 1000), null, 'however it is spelled');
});

it('and a HOLDING task with no window is left alone rather than polled at', () => {
  equal(at(THE_WAITING_STATE, null), null);
  for (const junk of ['soon', NaN, Infinity, {}, []]) {
    equal(askAgainIn({ state: THE_WAITING_STATE, windowEndsAt: junk, now: NOW }), null,
      `${String(junk)} is not a window`);
  }
  equal(askAgainIn({ state: THE_WAITING_STATE, windowEndsAt: NOW, now: 'later' }), null,
    'and a clock that is not a clock answers nothing');
  equal(askAgainIn(), null, 'and nothing at all answers nothing');
});

it('THE SPIN GUARD: a window one millisecond away does not become a tight loop', () => {
  // Without the floor this is a chain of timers a millisecond apart, each one
  // firing a request, for as long as the screen is open.
  equal(at(THE_WAITING_STATE, 1), FLOOR_MS);
  equal(at(THE_WAITING_STATE, 0), AFTER_MS);
  for (let ms = -5; ms <= 5000; ms += 137) {
    const said = at(THE_WAITING_STATE, ms);
    ok(said >= FLOOR_MS, `${ms}ms away asks in ${said}ms, which is not a spin`);
  }
});

it('and it never asks more often than the release itself runs, once past the window', () => {
  ok(AFTER_MS >= FLOOR_MS);
  ok(AT_MOST_MS <= 60 * 1000, 'a minute is the ceiling, because the release is a minute');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
