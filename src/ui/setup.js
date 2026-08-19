// The setup sequence's logic: which screen to show, what to save, when it is done.
//
// Two failures this is shaped against:
//
//  1. Verifying the code dropped the user straight onto the campaign feed. The
//     whole setup journey existed in fayr-design.browser.jsx and was never wired in.
//
//  2. A user who abandons setup halfway must RESUME, not start again. So the step is
//     derived from WHAT THE SERVER ALREADY HAS — never from local state, which a
//     reinstall or a second device would lose. Every answer is saved as it is given.
//
// Pure, so it can be tested under node (same reason as stages.js / otp.js).

/** The design's own screen names (fayr-design.browser.jsx SetupFlow). */
export const STEPS = {
  INTRO: 'setupintro',
  SETUP: 'setup',
  NAME: 'namelast',
  BUILD: 'buildfeed',
  HOW: 'howfayr',
};

/** The design requires at least three categories before continuing. */
export const MIN_CATEGORIES = 3;

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Does this user need to see setup at all?
 *
 * `setupDone` is the server's one-way latch and the ONLY authority: once stamped it
 * is never cleared, so a returning user can never be dropped back into onboarding.
 * A null profile means we have not loaded it yet — say no rather than flashing
 * setup at someone who has already finished it.
 */
export function isSetupNeeded(profile) {
  if (!profile) return false;
  return profile.setupDone !== true;
}

/** Has this user answered the age/gender step? Both live on one screen. */
function hasBasics(p) {
  return str(p.ageBand) != null && str(p.gender) != null;
}

/**
 * Has ANY answer been saved? This is what separates "never started" from "came
 * back": someone who answered even one question must not be shown the welcome
 * screen again, because to them it reads as having lost their progress.
 */
function hasAnyAnswer(p) {
  return (
    str(p.ageBand) != null
    || str(p.gender) != null
    || arr(p.categories).length > 0
    || arr(p.platforms).length > 0
    || str(p.name) != null
  );
}

/**
 * Which screen to open, derived from saved answers so a resume lands on the first
 * thing still missing.
 */
export function setupStep(profile) {
  const p = profile || {};
  // Only a genuinely untouched profile sees the welcome. Anyone who has answered
  // anything goes straight back to the questions.
  if (!hasAnyAnswer(p)) return STEPS.INTRO;
  if (!hasBasics(p)) return STEPS.SETUP;
  if (arr(p.categories).length < MIN_CATEGORIES) return STEPS.SETUP;
  if (arr(p.platforms).length === 0) return STEPS.SETUP;
  if (str(p.name) == null) return STEPS.NAME;
  // The terms screen is last, and it is where consent is recorded, so an
  // unconsented user must land on it even if everything else is answered.
  return STEPS.HOW;
}

/**
 * Which of the three question steps inside `setup` to open. Mirrors the design's
 * own gating: age+gender together, then at least three categories, then platforms.
 */
setupStep.question = function question(profile) {
  const p = profile || {};
  if (!hasBasics(p)) return 0;
  if (arr(p.categories).length < MIN_CATEGORIES) return 1;
  return 2;
};

/** Title-case a typed name, exactly as the design's NameLast does. */
function titleCase(name) {
  return String(name || '').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The PATCH body for each point in the sequence. Deliberately minimal: each call
 * sends only what that screen actually asked, so a half-finished setup never
 * overwrites a later answer with an empty one.
 */
export const patchFor = {
  question(step, answers) {
    const a = answers || {};
    if (step === 0) return { ageBand: a.age, gender: a.gender };
    // De-duplicated here as well as on the server: the screen can toggle fast.
    if (step === 1) return { categories: [...new Set(arr(a.cats))] };
    return { platforms: [...new Set(arr(a.plats))] };
  },
  name(value) {
    return { name: titleCase(value) };
  },
  /**
   * The last screen does two things at once, and they belong together: it records
   * WHAT was agreed to and it latches setup as finished. Splitting them would allow
   * a user to be counted as onboarded with no consent on record.
   */
  consent(version) {
    return { acceptTerms: true, termsVersion: version, setupDone: true };
  },
};

/**
 * The intro's copy, which changes for a resume. The design carries both strings;
 * these are its words verbatim.
 */
export function resumeCopy(profile) {
  const p = profile || {};
  const resume = hasAnyAnswer(p);
  return resume
    ? {
      title: 'Pick up where you left off',
      body: "You're halfway there. Your earlier answers are saved.",
      cta: 'CONTINUE SETUP',
    }
    : {
      title: "Let's set up your profile",
      body: 'Takes about 30 seconds — so we can show you campaigns worth your time.',
      cta: "LET'S GO",
    };
}
