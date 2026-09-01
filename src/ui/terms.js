// ACCEPTING THE TERMS, AS ONE DECISION IN ONE PLACE.
//
// The owner asked on 1 September 2026 for a tick box on the product page reading
// "I accept the terms and conditions and I have read everything above", with the
// claim button dead until it is ticked. He also asked for the acceptance to be
// RECORDED rather than merely used to light up a button: a promise nobody wrote
// down is not a promise.
//
// So the sentence lives here, once, and the rule about what counts as accepted
// lives here too. Two copies of the sentence would drift, and the copy on the
// screen is the one a person actually agreed to.
//
// THE ACCEPTANCE TRAVELS WITH THE CLAIM. The product page is where the tick box
// is; the claim itself happens two screens later, on the confirmation page. So the
// product page hands the acceptance forward and the confirmation page sends it to
// the server with the claim. The server refuses a claim that does not carry it, so
// arriving at the confirmation page by some other route cannot get past this.
//
// THIS FILE IS PURE. It imports nothing, so a plain node test can read every
// decision in it without a phone.

/**
 * The tick box's words, exactly as the owner gave them.
 *
 * Do not reword this without being asked to. It is the sentence a person agrees
 * to, and the same string is what the app's own test looks for on the screen.
 */
export const TERMS_SENTENCE =
  'I accept the terms and conditions and I have read everything above.';

/**
 * Did they accept? Only a literal yes counts.
 *
 * Anything else — absent, missing, the string "true", a 1 — is NOT acceptance. A
 * truthy check here would let a route param that survived as a string, or a
 * default that crept in somewhere, stand in for a person's tick.
 */
export function acceptedTerms(value) {
  return value === true;
}

/**
 * Why the claim button is dead, in one plain sentence, or null when it is live.
 *
 * The button is disabled AND says why. A dead button with no explanation reads as
 * a broken screen, and this one is dead on purpose.
 */
export function claimBlockedLine(accepted) {
  if (acceptedTerms(accepted)) return null;
  return 'Tick the box above to accept the terms and conditions.';
}

/**
 * What the confirmation page says when the acceptance did not reach it.
 *
 * This happens when somebody arrives at that page without coming through the
 * product page — from the staff walk through, for instance. It is not an error and
 * must not read as one: it says where to go and why.
 */
export function needsTermsLine(accepted) {
  if (acceptedTerms(accepted)) return null;
  return 'Please read and accept the terms on the product page first.';
}
