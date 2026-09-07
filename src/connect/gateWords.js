// EVERY WORD SOMEBODY READS WHILE THE SHOP IS OPENING, AND WHEN IT WILL NOT OPEN.
//
// ── WHY THESE WORDS LIVE IN THE APP AND NOT ON OUR SIDE ─────────────────────
//
// The owner's rule is that Fayr's own words live on our side, where the plain
// language check reads them. This is the one place that cannot follow it, and the
// reason is the screen itself: it is the FIRST thing drawn, before anything has
// loaded, and it has to be drawn when the phone has no connection at all. Asking
// our side for the sentence would mean a blank screen exactly when the network is
// the thing that is broken.
//
// SO THE RULE IS KEPT THE OTHER WAY ROUND. The words live here, in ONE file, and
// OUR SIDE'S OWN CHECK READS THIS FILE. backend/src/shops/connect-words.spec.ts
// opens it from disk and puts every sentence in it through the real
// checkPlainLanguage, the same one that reads the assistant's answers. So the same
// rule really does read them, and they are still there when the network is not.
// The same shape as the check that proves the support number is in one file.
//
// ── AND WHY THERE ARE SO FEW OF THEM ────────────────────────────────────────
//
// A person on this screen is waiting to sign in at a shop. Every extra sentence
// is a sentence between them and their money. There are four, and one of them is
// a button.

/** While the shop's own sign in page is on its way. Nothing else is on screen. */
export const OPENING = 'Opening the shop so you can sign in.';

/**
 * When it did not open.
 *
 * IT DOES NOT BLAME THEM AND IT DOES NOT BLAME THE SHOP. We do not know which of
 * the two it was, so it says the one thing we do know.
 */
export const DID_NOT_OPEN = 'The shop did not open. Please try again.';

/** The one control on the failure screen. */
export const TRY_AGAIN = 'Try again';

/**
 * The moment we can see they are in.
 *
 * Said for a breath and then the shop's page closes itself. It names the offer
 * they are going back to, because that is the thing they were doing.
 */
export const SIGNED_IN = 'You are signed in. Taking you back to your offer.';

/**
 * WHEN THE SIGN IN HAS GONE AND THE SHOP WILL NOT SAY WHETHER IT WORKED.
 *
 * THE OWNER FOUND THIS ON A REAL PHONE. He signed in at Flipkart, Flipkart took
 * him to its own home page, and Fayr left him sitting on it. Flipkart's home page
 * prints no greeting and shows no way out, so the two things Fayr can really see
 * were both absent.
 *
 * IT DOES NOT SAY THEY ARE SIGNED IN, and that is the whole point of the wording.
 * A signed out Flipkart home page and a signed in one are the same page as far as
 * anything Fayr can read, which was measured rather than assumed. So this states
 * the one thing that IS known and asks, and the two controls under it are the two
 * things that really might have happened.
 */
export const NOT_SURE =
  'The shop stopped showing a sign in, and we cannot tell if it worked.';

/** Their own answer, when Fayr could not see it for itself. */
export const I_HAVE_SIGNED_IN = 'Yes, I have signed in';

/** Every sentence in this file, for the check on our side that walks them. */
export const EVERY_SENTENCE = [
  OPENING, DID_NOT_OPEN, TRY_AGAIN, SIGNED_IN, NOT_SURE, I_HAVE_SIGNED_IN,
];
