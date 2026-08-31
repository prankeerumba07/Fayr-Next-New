// THE WHOLE OPENING SEQUENCE, IN ONE PLACE.
//
// Every piece of this already existed and worked. What did not exist was anything
// that described the sequence END TO END, from the logo to the home page. The
// first-run journey knew its own five steps, the setup flow knew its own five,
// and nothing at all knew that one runs into the other — so the join was the one
// part of the most-seen sequence in the app that no test could fail on.
//
// NOTHING HERE DECIDES ANYTHING NEW. It is built out of the two lists that were
// already the truth, so it cannot drift from them: change either one and the
// sequence here changes with it. A second copy of the routing would have been
// exactly the parallel system this project keeps refusing to build.

import { STEPS as BEFORE_SIGN_IN } from './steps.js';
import { STEPS as SETUP, setupStep, isSetupNeeded } from '../ui/setup.js';

/** The setup screens, in the order the design runs them. */
export const SETUP_ORDER = [
  SETUP.INTRO,
  SETUP.SETUP,
  SETUP.NAME,
  SETUP.BUILD,
  SETUP.HOW,
];

/** The home page. Named, so the sequence has an end and not just a last step. */
export const HOME = 'home';

/**
 * Logo, three animations, sign in, the setup questions, home.
 *
 * Composed rather than written out, so it is the same order the app really runs.
 */
export const OPENING_SEQUENCE = [...BEFORE_SIGN_IN, ...SETUP_ORDER, HOME];

/** The screen that shows the logo. */
export const LOGO_STEP = BEFORE_SIGN_IN[0];

/** The screen that runs the three animations. */
export const ANIMATIONS_STEP = BEFORE_SIGN_IN[1];

/** Where the number and the code are typed. */
export const NUMBER_STEP = 'phone';
export const CODE_STEP = 'otp';

/** Where the name is typed. */
export const NAME_STEP = SETUP.NAME;

/**
 * WHAT SOMEBODY ACTUALLY SEES, GIVEN WHAT IS ALREADY KNOWN ABOUT THEM.
 *
 * Two facts decide it, and they are deliberately different kinds of fact:
 *
 *   seenTheAnimations — a property of this INSTALL, kept on the device. Signing
 *     out must not replay three introductory slides at somebody who has used the
 *     app for months, and asking the server would make the first paint wait on
 *     the network.
 *
 *   profile — the server's record, and the ONLY authority on whether setup is
 *     done. The latch is one way: once stamped it is never cleared, so a
 *     returning person can never be dropped back into the questions.
 *
 * A null profile means we have not asked yet, and the honest answer is to show
 * nothing rather than guess: a wrongly repeated setup reads as having lost
 * somebody's answers.
 */
export function openingScreensFor(state) {
  const s = state && typeof state === 'object' ? state : {};
  const seen = s.seenTheAnimations === true;
  const signedIn = s.signedIn === true;
  const profile = s.profile && typeof s.profile === 'object' ? s.profile : null;

  const out = [];
  if (!signedIn) {
    out.push(LOGO_STEP);
    if (!seen) out.push(ANIMATIONS_STEP);
    out.push('landing', NUMBER_STEP, CODE_STEP);
  }

  if (profile && isSetupNeeded(profile)) {
    // From the first thing still missing onwards, which is how a resume lands
    // somebody back where they stopped rather than at the beginning.
    const from = setupStep(profile);
    const at = SETUP_ORDER.indexOf(from);
    out.push(...(at === -1 ? SETUP_ORDER : SETUP_ORDER.slice(at)));
  }

  out.push(HOME);
  return out;
}

/** Does this person still have to type their name? */
export function needsTheNameStep(profile) {
  return openingScreensFor({ signedIn: true, profile }).includes(NAME_STEP);
}

/** Will this person be shown the three animations? */
export function willSeeTheAnimations(seenTheAnimations) {
  return openingScreensFor({ seenTheAnimations, signedIn: false }).includes(
    ANIMATIONS_STEP,
  );
}
