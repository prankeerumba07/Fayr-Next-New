// WHO OWNS THE SPACE ABOVE A SCREEN'S BODY.
//
// The owner reported an empty band at the top of every journey screen on
// 2 September 2026: between the "Step N of 11" strip and the screen underneath it,
// and under the "Next:" line.
//
// IT WAS THREE LOTS OF PADDING STACKED, and none of them was wrong on its own:
//
//   the journey strip     paddingBottom  8   (SPACE.sm, ours, below "Next:")
//   the screen's TopBar   paddingTop     6   (the design's own value, see below)
//   the screen's body     paddingTop     4   (the design's own value, see below)
//                                        --
//                                        18 points of empty colour
//
// Every one of those is right when a screen is opened ON ITS OWN, which every one
// of these screens can be. Inside the journey the strip has already done the job of
// separating the screen from the top of the phone, so the other two are a second
// and third helping.
//
// THE DESIGN'S OWN NUMBERS, measured off the design file rather than chosen:
//   TopBar    padding: "6px 18px 8px"   fayr-design.browser.jsx:397
//   body      padding: "4px 22px 22px"  fayr-design.browser.jsx:2303 (LinkAccount)
// The design has no journey strip at all — that is ours — so the design states no
// value for the space between the strip and a screen. The strip's own paddingBottom
// is therefore the only gap there should be, and the screen contributes nothing.
//
// THIS FILE IS PURE. It imports nothing, so a plain node test can read the
// decision. The React half is src/journey/insideJourney.js next door, which follows
// the same shape as the SafeAreaInsetsContext trick already used to zero the notch.

/** The design's own top padding on its title bar, in points. */
export const TOP_BAR_TOP = 6;

/** The design's own top padding on a screen's scrolling body, in points. */
export const BODY_TOP = 4;

/**
 * How much top padding a screen should contribute.
 *
 * Zero inside the journey, because the strip above it already owns that space.
 * The screen's own value everywhere else, because on its own it owns it again.
 *
 * `base` is passed in rather than read from here so one function serves the title
 * bar and the body without knowing which is which.
 */
export function topPaddingInside(base, insideJourney) {
  if (insideJourney === true) return 0;
  return typeof base === 'number' && Number.isFinite(base) && base > 0 ? base : 0;
}
