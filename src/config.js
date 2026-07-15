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
