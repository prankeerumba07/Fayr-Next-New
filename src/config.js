// Build-time switches.

// Unfiltered diagnostic capture. When TRUE, a fetch returns every review the
// account has plus __amazonOrdersSample - raw page text, order ids, ASINs and
// prices from the user's OTHER orders. That is how the parsers were calibrated,
// and it is a privacy hole: it must never be true in a shipped build.
//
// When FALSE (the default), a fetch surfaces ONLY the campaign product and
// carries no diagnostics. A fetch with no campaign ASIN set fails closed with
// error:"no_campaign_target" rather than falling back to returning everything.
//
// Flip this to true ONLY for a local calibration capture, and flip it back.
export const DEBUG_CAPTURE = false;

// Whether the in-app "Show all my reviews (dev)" toggle may exist at all.
// Gated on React Native's __DEV__, which the bundler compiles to a LITERAL
// `false` in a production build - so in production this is a dead constant, the
// toggle never renders, and the unfiltered path is unreachable no matter what
// UI state exists. Unlike DEBUG_CAPTURE (a committed file flag that a fetch
// always honours), this can never be true in a shipped build even by mistake.
// Reference the BARE __DEV__ identifier: Metro replaces it with a literal
// `false` in a production build, so any `__DEV__ && ...` gate downstream is
// dead-code-eliminated. Do NOT wrap it in typeof - that defeats the fold and
// leaves the dev branch (and its label) in the shipped bundle.
// eslint-disable-next-line no-undef
export const DEV_TOOLS = __DEV__;
