// IS THE WALK THROUGH SWITCHED ON FOR THIS COPY OF THE APP?
//
// The walk through opens every screen in the design, including the ones a
// shopper must never see. It was reachable from the profile by anybody, and the
// owner found it in Expo Go and asked for it gone from the normal journey.
//
// It is not deleted. It is switched off, and the switch has to be turned on
// deliberately. Everything under src/walkthrough still works, the block that
// stops it writing anything still works, and its test still runs.
//
// WHY NOT __DEV__. React Native's own development flag is TRUE in Expo Go, which
// is exactly where the owner saw it. A flag that is on wherever the complaint
// came from is not a fix. This one is off everywhere until somebody sets it.
//
// TWO WAYS TO TURN IT ON, both deliberate and both easy to see:
//
//   1. EXPO_PUBLIC_FAYR_WALKTHROUGH=1 in the environment when Metro starts.
//      This is the one to use day to day. ./start prints how.
//   2. "fayrWalkthrough": true under expo.extra in app.json, for a build that
//      is meant to carry it, such as one handed to the team to look at.
//
// THIS FILE IS PURE. It imports nothing, so a plain node test can read the
// decision itself. The half that has to ask Expo lives in isItOn.js next door.
//
// A production build with neither set has no way in at all: the row is not
// drawn, so there is nothing to tap and nothing to find.

/** The environment variable name, in one place so the guide cannot drift. */
export const SWITCH = 'EXPO_PUBLIC_FAYR_WALKTHROUGH';

/** The app.json key, likewise. */
export const CONFIG_KEY = 'fayrWalkthrough';

/** Values that count as on. Anything else, including absent, is off. */
const ON = new Set(['1', 'true', 'yes', 'on']);

/**
 * Read the switch out of a plain object, so the decision itself can be tested
 * without a phone. `env` is process.env, `extra` is expo.extra from app.json.
 */
export function switchedOn(env, extra) {
  const fromEnv = env && env[SWITCH];
  if (typeof fromEnv === 'string' && ON.has(fromEnv.trim().toLowerCase())) return true;
  // Only the exact value true. A string in app.json is a typo, not an intention,
  // and reading a truthy string here would turn it on for anybody who wrote
  // "false" by hand.
  return Boolean(extra) && extra[CONFIG_KEY] === true;
}
