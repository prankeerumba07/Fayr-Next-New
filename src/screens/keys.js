// ONE DESIGN SCREEN, ONE FILE, ONE KEY.
//
// The design has sixty one screens. The app had nineteen files carrying forty one
// of them, so the average file was doing the work of two design screens and
// twenty screens did not exist at all. The owner's rule is that every page stays
// separate and works according to its purpose, so every one of the sixty one gets
// its own file here, named by the design's own key, and nothing is merged,
// skipped or renamed.
//
// THIS FILE IS PURE DATA. It holds no components, so a plain node test can read
// it, compare it against the design file itself, and check that every key that
// claims its own file really has one on disk. The components live in index.js
// next door, which only React Native can load.
//
// THE RATCHET. `stillToSplit()` counts the keys that are not yet their own file.
// keys.test.mjs fails if that number ever goes UP. Work can land one group at a
// time without the suite going red, and the direction is only ever downwards.

/**
 * Where each design screen lives today.
 *
 * `own`     — its own file, at src/screens/<key>.js
 * `folded`  — still inside another file, which is named. Has to be split out.
 * `missing` — nothing at all yet. Has to be built.
 *
 * The order is the design's own order, checked against the design file by the
 * test. Do not reorder to taste.
 */
export const SCREENS = [
  // ── Launch and signing in ────────────────────────────────────────────────
  { key: 'splash', at: 'own', pre: true },
  { key: 'forceupdate', at: 'own' },
  { key: 'maintenance', at: 'own' },
  { key: 'onboard', at: 'own', pre: true },
  { key: 'authlanding', at: 'own', pre: true },
  { key: 'truecaller', at: 'own', pre: true },
  { key: 'phone', at: 'own', pre: true },
  { key: 'otp', at: 'own', pre: true },
  { key: 'otplocked', at: 'own', pre: true },
  { key: 'blocked', at: 'own', pre: true },
  { key: 'newdevice', at: 'own', pre: true },

  // ── Setting up ───────────────────────────────────────────────────────────
  { key: 'setupintro', at: 'folded', inside: 'src/setup/SetupFlow.js' },
  { key: 'setupintrolegacy', at: 'missing' },
  { key: 'setup', at: 'folded', inside: 'src/setup/SetupFlow.js' },
  { key: 'namelast', at: 'folded', inside: 'src/setup/SetupFlow.js' },
  { key: 'buildfeed', at: 'folded', inside: 'src/setup/SetupFlow.js' },
  { key: 'howfayr', at: 'folded', inside: 'src/setup/SetupFlow.js' },

  // ── Finding and claiming an offer ────────────────────────────────────────
  { key: 'home', at: 'folded', inside: 'src/HomeScreen.js' },
  { key: 'howworks', at: 'missing' },
  { key: 'allcampaigns', at: 'missing' },
  { key: 'detail', at: 'folded', inside: 'src/DetailScreen.js' },
  { key: 'claimedsheet', at: 'folded', inside: 'src/ClaimOutcomeScreens.js' },
  { key: 'redirect', at: 'missing' },
  // OFF THE PATH since 2 September 2026, and NOT deleted. The owner took the
  // confirmation page out of the journey: the claim happens on the product page
  // now, where the terms tick box is, so this page was one tap that added nothing.
  // The rule in this project is that no design screen is deleted, so it keeps its
  // own file, keeps its key, and is still counted here. `offPath` records the fact
  // rather than leaving somebody to discover it by reading journey.js.
  { key: 'confirm', at: 'own', offPath: true },
  { key: 'insufficient', at: 'folded', inside: 'src/ClaimOutcomeScreens.js' },
  { key: 'linkaccount', at: 'own' },
  { key: 'seatlost', at: 'folded', inside: 'src/ClaimOutcomeScreens.js' },
  { key: 'enrollfailed', at: 'folded', inside: 'src/ClaimOutcomeScreens.js' },
  { key: 'enrollsuccess', at: 'folded', inside: 'src/ClaimOutcomeScreens.js' },
  { key: 'notifprime', at: 'missing' },
  { key: 'waitlisted', at: 'missing' },

  // ── Buying, proving, waiting, being paid ─────────────────────────────────
  { key: 'buyinterstitial', at: 'own' },
  { key: 'returncatch', at: 'own' },
  { key: 'proofprimer', at: 'own' },
  { key: 'emailconnect', at: 'own' },
  { key: 'emailcode', at: 'own' },
  { key: 'proofupload', at: 'folded', inside: 'src/ProofUploadScreen.js' },
  { key: 'ocrconfirm', at: 'own' },
  { key: 'orderverified', at: 'own' },
  { key: 'imagesuploaded', at: 'own' },
  { key: 'taskstatus', at: 'folded', inside: 'src/TaskScreen.js' },
  { key: 'deliverycheck', at: 'missing' },
  { key: 'deliveryupload', at: 'folded', inside: 'src/ProofUploadScreen.js' },
  { key: 'underreview', at: 'own' },
  { key: 'delivery', at: 'own' },
  { key: 'deliverydelayed', at: 'missing' },
  { key: 'honesty', at: 'missing' },
  { key: 'reviewguide', at: 'own' },
  { key: 'reviewproof', at: 'own' },
  { key: 'verifywait', at: 'folded', inside: 'src/TaskScreen.js' },
  { key: 'returnwindow', at: 'own' },
  { key: 'reward', at: 'own' },

  // ── The tabs, and the account ────────────────────────────────────────────
  { key: 'myproducts', at: 'folded', inside: 'src/MyProductsScreen.js' },
  { key: 'notifcenter', at: 'missing' },
  { key: 'campaigns', at: 'folded', inside: 'src/MyProductsScreen.js' },
  { key: 'insights', at: 'folded', inside: 'src/ProfileScreen.js' },
  { key: 'earnings', at: 'folded', inside: 'src/EarningsScreen.js' },
  { key: 'withdraw', at: 'folded', inside: 'src/WalletScreen.js' },
  { key: 'tickets', at: 'missing' },
  { key: 'profile', at: 'folded', inside: 'src/ProfileScreen.js' },
  { key: 'verifier', at: 'folded', inside: 'src/ConnectScreen.js' },
];

/** Every design key, in the design's order. */
export const KEYS = SCREENS.map((s) => s.key);

/** How many screens the design has. Printed rather than guessed, everywhere. */
export const HOW_MANY = KEYS.length;

/** The keys that have their own file today, in the design's order. */
export const OWN = SCREENS.filter((s) => s.at === 'own').map((s) => s.key);

/**
 * The keys that come BEFORE anybody is signed in.
 *
 * They are not in the navigator, and must not be: the app shows the first run
 * sequence in place of the navigator until there is a session. Registering them
 * as ordinary destinations would put a way into the signed-in app from the sign
 * in screen. They are resolved from the same registry, by the same key, so there
 * is still exactly one file per screen.
 */
export const BEFORE_SIGN_IN = SCREENS.filter((s) => s.pre).map((s) => s.key);

/** The keys the navigator registers: everything with its own file, after sign in. */
export const IN_THE_NAVIGATOR = SCREENS
  .filter((s) => s.at === 'own' && !s.pre)
  .map((s) => s.key);

/** What is left to do, in the design's order. The ratchet counts these. */
export function stillToSplit() {
  return SCREENS.filter((s) => s.at !== 'own').map((s) => s.key);
}

/**
 * THE RATCHET.
 *
 * The number of screens that are not yet their own file. It may go down and it
 * may never go up. keys.test.mjs checks both, so a screen cannot be quietly
 * folded back into another one, and this number is the honest measure of how far
 * through the work we are.
 *
 * Started at 50 of 61 on 1 September 2026: 28 folded into six files, 20 missing
 * altogether, and 2 more that existed but not under their own key.
 *
 * 50 → 39 later the same day, when the claim journey was split. Eleven design
 * screens came out of one file: two of them (confirm, reward) were being built
 * TWICE and are now built once, and nine had never had a file of their own.
 *
 * 39 → 34 the same day again, when the buying journey's five missing screens were
 * built: asking whether they bought it, connecting an inbox, the code sent to it,
 * the order being tracked, and the pictures arriving. Two of the five were named
 * by the owner directly.
 */
export const STILL_TO_SPLIT_CEILING = 34;

/** One screen's row, or null when the key is not the design's. */
export function screenFor(key) {
  return SCREENS.find((s) => s.key === key) || null;
}
