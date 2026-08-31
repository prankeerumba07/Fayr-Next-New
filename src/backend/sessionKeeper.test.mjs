// Keeping a signed-in person signed in — the deciding, with a fake clock.
//
// The thing worth proving here is that a renewal happens BEFORE anything is
// refused. The old behaviour renewed after a failed request, which is why
// somebody who left the app open over lunch came back and waited.
import {
  MAX_RENEW_DELAY_MS,
  MIN_RENEW_DELAY_MS,
  RENEW_MARGIN_MS,
  expiryOf,
  msUntilRenew,
  shouldRenew,
  startKeeper,
} from './sessionKeeper.js';

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) { pass += 1; console.log(`  PASS ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}`); }
}

const NOW = Date.UTC(2026, 7, 31, 10, 0, 0);

/** A token shaped exactly like the real one, expiring when we say. */
function tokenExpiringAt(ms) {
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: 'a-user', mobile: '+910000000000', exp: Math.floor(ms / 1000) }),
    'not-a-real-signature',
  ].join('.');
}

console.log('=== 1. when does this token stop being good ===');
{
  const in15 = NOW + 15 * 60 * 1000;
  ok(expiryOf(tokenExpiringAt(in15)) === Math.floor(in15 / 1000) * 1000,
    'it reads the expiry out of the token itself');

  for (const bad of [null, undefined, '', 'not-a-token', 'a.b', 'a.b.c.d', 42, {}]) {
    ok(expiryOf(bad) === null, `cannot read ${JSON.stringify(bad)}, and says so`);
  }
  ok(expiryOf('aaa.!!!!.ccc') === null, 'nor something that is not base sixty four');
  ok(expiryOf(['x', Buffer.from('{"no":"exp"}').toString('base64url'), 'y'].join('.')) === null,
    'nor a token with no expiry in it');
  ok(expiryOf(['x', Buffer.from('{"exp":"soon"}').toString('base64url'), 'y'].join('.')) === null,
    'nor one whose expiry is not a number');
}

console.log('\n=== 2. is it time to renew ===');
{
  const fresh = tokenExpiringAt(NOW + 15 * 60 * 1000);
  ok(shouldRenew(fresh, NOW) === false, 'a fresh token is left alone');

  const nearly = tokenExpiringAt(NOW + RENEW_MARGIN_MS - 1000);
  ok(shouldRenew(nearly, NOW) === true,
    'one inside the margin is renewed BEFORE anything is refused');

  const gone = tokenExpiringAt(NOW - 60 * 1000);
  ok(shouldRenew(gone, NOW) === true, 'and an expired one certainly is');

  ok(shouldRenew('nonsense', NOW) === true,
    'a token we cannot read is renewed, which is the safe way round');
  ok(shouldRenew(null, NOW) === true, 'and so is nothing at all');

  const exactly = tokenExpiringAt(NOW + RENEW_MARGIN_MS);
  ok(shouldRenew(exactly, NOW) === true, 'exactly at the margin counts as due');
}

console.log('\n=== 3. how long to wait ===');
{
  const in5 = tokenExpiringAt(NOW + 5 * 60 * 1000);
  ok(msUntilRenew(in5, NOW) === 5 * 60 * 1000 - RENEW_MARGIN_MS,
    'it waits until the margin, then renews');

  const gone = tokenExpiringAt(NOW - 60 * 1000);
  ok(msUntilRenew(gone, NOW) === MIN_RENEW_DELAY_MS,
    'an expired token does not turn into a renewal every millisecond');

  const aYear = tokenExpiringAt(NOW + 365 * 24 * 60 * 60 * 1000);
  ok(msUntilRenew(aYear, NOW) === MAX_RENEW_DELAY_MS,
    'and it still looks every ten minutes, whatever the token claims');

  ok(msUntilRenew('nonsense', NOW) === MIN_RENEW_DELAY_MS,
    'an unreadable one is looked at soon');
}

console.log('\n=== 4. the keeper, running ===');
{
  // A tiny fake clock and timer, so the whole loop runs without waiting.
  function fakeWorld(startAt) {
    let clock = startAt;
    let next = 1;
    const timers = new Map();
    return {
      now: () => clock,
      setTimer: (fn, ms) => {
        const id = next; next += 1;
        timers.set(id, { at: clock + ms, fn });
        return id;
      },
      clearTimer: (id) => { timers.delete(id); },
      /** Run every timer that is due within this many milliseconds. */
      async advance(ms) {
        const until = clock + ms;
        for (let guard = 0; guard < 1000; guard += 1) {
          let soonestId = null;
          let soonest = Infinity;
          for (const [id, t] of timers) {
            if (t.at <= until && t.at < soonest) { soonest = t.at; soonestId = id; }
          }
          if (soonestId === null) break;
          const t = timers.get(soonestId);
          timers.delete(soonestId);
          clock = t.at;
          t.fn();
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        }
        clock = until;
      },
      pending: () => timers.size,
    };
  }

  // A fresh fifteen-minute token that renews itself each time.
  {
    const world = fakeWorld(NOW);
    let token = tokenExpiringAt(NOW + 15 * 60 * 1000);
    let renewals = 0;
    const keeper = startKeeper({
      getToken: () => token,
      renew: async () => {
        renewals += 1;
        token = tokenExpiringAt(world.now() + 15 * 60 * 1000);
      },
      now: world.now,
      setTimer: world.setTimer,
      clearTimer: world.clearTimer,
    });

    await world.advance(10 * 60 * 1000);
    ok(renewals === 0, 'nothing is renewed while the token is still good');

    await world.advance(5 * 60 * 1000);
    ok(renewals === 1, 'it renews once, on its own, before the token expires');

    await world.advance(60 * 60 * 1000);
    ok(renewals >= 4 && renewals <= 6,
      `and keeps going, quietly — ${renewals} renewals in the next hour`);

    keeper.stop();
    const after = renewals;
    await world.advance(60 * 60 * 1000);
    ok(renewals === after, 'stopping really stops it');
    ok(world.pending() === 0, 'and leaves no timer behind');
  }

  // Coming back to the foreground after the phone was asleep.
  {
    const world = fakeWorld(NOW);
    // Asleep in a pocket: no timer ran, and the token is long gone.
    let token = tokenExpiringAt(NOW - 60 * 60 * 1000);
    let renewals = 0;
    const keeper = startKeeper({
      getToken: () => token,
      renew: async () => {
        renewals += 1;
        token = tokenExpiringAt(world.now() + 15 * 60 * 1000);
      },
      now: world.now,
      setTimer: world.setTimer,
      clearTimer: world.clearTimer,
    });

    await keeper.checkNow();
    ok(renewals === 1, 'looking on the way back to the foreground renews at once');
    keeper.stop();
  }

  // A renewal that fails must not stop it trying.
  {
    const world = fakeWorld(NOW);
    const token = tokenExpiringAt(NOW - 1000);
    let attempts = 0;
    const keeper = startKeeper({
      getToken: () => token,
      renew: async () => {
        attempts += 1;
        throw new Error('no network');
      },
      now: world.now,
      setTimer: world.setTimer,
      clearTimer: world.clearTimer,
    });

    await world.advance(60 * 1000);
    ok(attempts > 1, `a failed renewal is tried again — ${attempts} attempts`);
    keeper.stop();
  }

  // Nobody signed in: it must not renew nothing, forever.
  {
    const world = fakeWorld(NOW);
    let renewals = 0;
    const keeper = startKeeper({
      getToken: () => null,
      renew: async () => { renewals += 1; },
      now: world.now,
      setTimer: world.setTimer,
      clearTimer: world.clearTimer,
    });
    await world.advance(60 * 60 * 1000);
    ok(renewals === 0, 'with nobody signed in, nothing is renewed');
    keeper.stop();
  }

  // One at a time, even when a renewal is slow.
  {
    const world = fakeWorld(NOW);
    const token = tokenExpiringAt(NOW - 1000);
    let inFlight = 0;
    let overlapped = false;
    const keeper = startKeeper({
      getToken: () => token,
      renew: async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
      },
      now: world.now,
      setTimer: world.setTimer,
      clearTimer: world.clearTimer,
    });
    await world.advance(2 * 60 * 1000);
    await keeper.checkNow();
    ok(!overlapped, 'two renewals never run at once');
    keeper.stop();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
