// The first-run journey's step order, in one place so it is assertable.
//
// The design's Flow 2 note is "no path dead-ends". Keeping the order here (rather
// than implicit in a component's branches) means a test can check the sequence,
// and a future edit that drops the splash or reorders onboarding fails loudly.

/** Splash → Onboarding → AuthLanding → PhoneEntry → Otp (design §1–3). */
export const STEPS = ['splash', 'onboarding', 'landing', 'phone', 'otp'];

/** The step after `from`, or null at the end of the journey. */
export function nextStep(from) {
  const i = STEPS.indexOf(from);
  return i === -1 || i === STEPS.length - 1 ? null : STEPS[i + 1];
}
